import { OmniPromptSections, SceneDirection, TopicBrief } from '../types';

const cleanSpace = (value: unknown) => String(value ?? '').replace(/\[object Object\]/gi, '').replace(/\s+/g, ' ').trim();
const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings) : typeof value === 'string' ? value.split(/\s*[|;]\s*/).map(cleanSpace).filter(Boolean) : [];
const commaStrings = (value:unknown):string[] => strings(value).flatMap(item=>item.split(/\s*,\s*/).map(cleanSpace).filter(Boolean));
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const uniqueStrings = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  return values.flatMap(strings).filter(value => { const normalized=key(value).replace(/^(no|avoid|exclude|without|do not show) /,''); if(!normalized||seen.has(normalized)) return false; seen.add(normalized); return true; });
};

const sentence = (value: unknown): string => {
  let text=cleanSpace(value).replace(/\s+([,.;:!?])/g,'$1').replace(/([,.;:!?])\1+/g,'$1').replace(/\s*[,;:]\s*$/,'').trim();
  text=text.replace(/\b(?:and|or|of|for|on|the|with|to|from|while|but|a|an)\s*[.!?]?$/i,'').trim();
  if(!text) return '';
  text=text[0].toUpperCase()+text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const supportedScale = ['medium close-up','medium-wide','close-up','medium','wide'];
const supportedLens = ['long telephoto','short telephoto','wide-angle','normal'];
const supportedView = ['front three-quarter','rear three-quarter','side profile','low side','interior-oblique','overhead'];
const movementMap: Array<[RegExp,string]> = [
  [/\b(lock|static|stationary)\b/i,'locked camera'],[/\bpan\b/i,'slow pan'],[/\b(push|move)\s*-?in\b/i,'slow push-in'],[/\b(pull|move)\s*-?back\b/i,'slow pull-back'],[/\b(crane|rise)\b/i,'restrained crane rise'],[/\b(dolly|lateral)\b/i,'slow lateral dolly'],[/\b(track(?:ing)?|follow(?:ing)?)\b/i,'restrained tracking movement'],
];
const pick = (value:string, options:string[], fallback:string) => options.find(option=>value.toLowerCase().includes(option)) || fallback;
const naturalList=(items:string[])=>items.length<2?(items[0]||''):items.length===2?`${items[0]} and ${items[1]}`:`${items.slice(0,-1).join(', ')}, and ${items.at(-1)}`;
const viewPattern = (viewpoint:string) => viewpoint.includes('rear')?/(tail|fin|stabil|engine|rotodome|hook|rear)/i:viewpoint.includes('front')?/(forward|nose|wing|engine|nacelle|rotodome|gear|front)/i:viewpoint.includes('side')?/(proportion|wing|engine|rotodome|gear|fuselage|side)/i:viewpoint.includes('interior')?/(interior|cockpit|cabin|bay|rack|panel|interface)/i:viewpoint.includes('overhead')?/(planform|wing|span|roof|top|rotodome|layout)/i:null;
const rankedUnique=(items:Array<{value:unknown;score:number}>,limit:number)=>{
  const best=new Map<string,{value:string;score:number;order:number}>();let order=0;
  items.forEach(item=>strings(item.value).forEach(value=>{const normalized=key(value);const score=item.score+(/\b(?:exactly|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.test(value)?25:0);const current=best.get(normalized);if(!current||score>current.score)best.set(normalized,{value,score,order:order++});}));
  return [...best.values()].sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,limit).map(item=>item.value);
};

export interface ResolvedProductionScene {
  stage: any;
  environment: any;
  geometryModules: any[];
  references: any[];
  transition: any;
  identity: string[];
  present: string[];
  absent: string[];
  exposed: string[];
  forbidden: string[];
  confirmed: string[];
  inferred: string[];
  camera: { shotScale:string; lens:string; viewpoint:string; behavior:string; movementCount:number; contradictions:string[] };
}

export function resolveProductionScene(topic: TopicBrief | null, direction: SceneDirection): ResolvedProductionScene {
  const handoff=(topic as any)?._production_handoff || {};
  const stages=Array.isArray(handoff.production_stages)?handoff.production_stages:[];
  const stage=stages.find((item:any)=>item.stage_id===direction.stage_id) || {};
  const environments=Array.isArray(handoff.environments)?handoff.environments:[];
  const environment=environments.find((item:any)=>item.environment_id===(stage.environment_id||direction.environment_ref)) || {};
  const modules=Array.isArray(handoff.geometry_modules)?handoff.geometry_modules:[];
  const moduleIds=[stage.geometry_control?.primary_geometry_module_id,...(stage.geometry_control?.secondary_geometry_module_ids||[])].filter(Boolean);
  const geometryModules=modules.filter((item:any)=>moduleIds.includes(item.module_id));
  const references=(handoff.reference_assets||[]).filter((item:any)=>(stage.visual_evidence?.reference_asset_ids||[]).includes(item.asset_id));
  const transition=(handoff.stage_transitions||[]).find((item:any)=>item.from_stage_id===direction.stage_id)||{};
  const guidance=stage.camera_guidance||{};
  const stageViews=strings(guidance.preferred_views).join(' ').toLowerCase();
  const stageScales=strings(guidance.safe_shot_scales).join(' ').toLowerCase();
  const stageMovements=strings(guidance.preferred_camera_movements).join(' ').toLowerCase();
  const forbiddenMovements=strings(guidance.forbidden_camera_movements).join(' ').toLowerCase();
  const rawCamera=`${direction.camera.shot_scale} ${direction.camera.lens} ${direction.camera.angle} ${direction.camera.movement}`.toLowerCase();
  const directionMovements=movementMap.filter(([pattern])=>pattern.test(direction.camera.movement)).map(([,label])=>label);
  const stageMovement=movementMap.find(([pattern])=>pattern.test(stageMovements))?.[1];
  const contradictions:string[]=[];
  if(/static|locked/.test(rawCamera)&&/track|dolly|pan|push|pull|crane/.test(rawCamera)) contradictions.push('Locked/static camera conflicts with camera movement.');
  if(/macro/.test(rawCamera)&&/wide|medium-wide/.test(rawCamera)) contradictions.push('Macro conflicts with a wide shot scale.');
  if(/wide-angle/.test(rawCamera)&&/\b(?:50|85|100|135)\s*mm/.test(rawCamera)) contradictions.push('Wide-angle conflicts with the supplied focal length.');
  if(/close-up/.test(rawCamera)&&/establishing/.test(rawCamera)) contradictions.push('Close-up conflicts with an establishing view.');
  const scaleSource=stageScales||direction.camera.shot_scale;
  const shotScale=/macro/i.test(rawCamera)&&/\b(?:wide|medium-wide)\b/i.test(rawCamera)&&!stageScales?'close-up':pick(scaleSource,supportedScale,'medium-wide');
  const focal=rawCamera.match(/\b(\d{2,3})\s*mm\b/)?.[1];
  const lens=focal?(Number(focal)<=35?'wide-angle':Number(focal)<=60?'normal':'short telephoto'):pick(`${stageViews} ${direction.camera.lens}`,supportedLens,'normal');
  const viewpoint=pick(stageViews||direction.camera.angle,supportedView,direction.camera.angle||'side profile');
  const viewpointWords=viewpoint.toLowerCase();
  const viewTerms=viewPattern(viewpointWords);
  const identityCandidates=[
    ...direction.required_visible_features.map(value=>({value,score:120+(viewTerms?.test(value)?30:0)})),
    ...strings(stage.geometry_control?.required_visible_anchors).map(value=>({value,score:105+(viewTerms?.test(value)?30:0)})),
    ...geometryModules.flatMap((item:any)=>strings(item.required_visible_features).map(value=>({value,score:90+(viewTerms?.test(value)?30:0)}))),
    ...strings(handoff.product?.immutable_identity_features).map(value=>({value,score:65+(viewTerms?.test(value)?30:0)})),
  ];
  const identity=rankedUnique(identityCandidates,6);
  const movementConflict=directionMovements.length>1||(/static|locked/.test(rawCamera)&&/track|dolly|pan|push|pull|crane/.test(rawCamera));
  let behavior=stageMovement||(!movementConflict?directionMovements[0]:undefined)||'locked camera';
  const movementKeywords=key(behavior).split(' ').filter(word=>!['slow','restrained','camera','movement'].includes(word));
  if(forbiddenMovements&&movementKeywords.some(word=>forbiddenMovements.includes(word)))behavior='locked camera';
  return {
    stage,environment,geometryModules,references,transition,
    identity,
    present:uniqueStrings([stage.present_now,direction.required_visible_features]),
    absent:uniqueStrings([stage.not_yet_installed,direction.forbidden_elements]),
    exposed:uniqueStrings([stage.temporarily_exposed,stage.open_interfaces,stage.unfinished_edges_or_sections]),
    forbidden:uniqueStrings([stage.geometry_control?.negative_constraints,stage.geometry_control?.forbidden_transformations,stage.stage_actions?.flatMap((a:any)=>a.forbidden_actions||[]),environment.forbidden_elements,direction.forbidden_elements]),
    confirmed:uniqueStrings([stage.visual_evidence?.confirmed_visual_details]), inferred:uniqueStrings([stage.visual_evidence?.analyst_inferred_visual_details]),
    camera:{ shotScale, lens, viewpoint, behavior, movementCount:directionMovements.length, contradictions },
  };
}

function identitySentence(topic:TopicBrief|null,resolved:ResolvedProductionScene):string {
  const product=(topic as any)?._production_handoff?.product;
  const name=[product?.official_name,product?.exact_variant].filter(Boolean).join(' ') || topic?.topic.product || topic?.topic.title || 'product';
  return sentence(resolved.identity.length?`Preserve the exact ${name} configuration with ${naturalList(resolved.identity)}`:`Preserve the exact ${name} configuration and proportions throughout the shot`);
}

function stateSentence(direction:SceneDirection,resolved:ResolvedProductionScene):string {
  const present=resolved.present.length?`show ${naturalList(resolved.present)}`:`show ${direction.product_visual_state}`;
  const absent=resolved.absent.length?` Do not show ${naturalList(resolved.absent)}`:'';
  const exposed=resolved.exposed.length?` Keep ${naturalList(resolved.exposed)} visibly unfinished or exposed`:'';
  return sentence(`Show only the incomplete State ${direction.state} configuration: ${present}.${exposed}.${absent}`.replace(/\.\s*\./g,'. '));
}

export function normalizeOmniSections(raw:any,direction:SceneDirection,topic:TopicBrief|null):{sections:OmniPromptSections;resolved:ResolvedProductionScene} {
  const resolved=resolveProductionScene(topic,direction);
  const inferred=resolved.inferred.length?`Use a plausible modern production environment consistent with this stage; do not invent proprietary internal layouts`:'';
  const factory=/factory|assembly|production|hangar|workshop/i.test(`${direction.environment_description} ${resolved.environment?.facility_type||''}`);
  const carrier=/carrier|maritime|deck/i.test(direction.environment_description);
  const sound=carrier?'Generate synchronized maritime deck ambience with wind, distant machinery, restrained deck-equipment movement, and physically matched mechanical sound':factory?'Generate synchronized factory ambience with distant ventilation, restrained machinery hum, soft tool contact, and subtle footsteps':'Generate realistic synchronized environmental and mechanical ambience appropriate to the visible action';
  const rawSubject=cleanSpace(raw?.subject)||direction.subject;
  const rawEnvironment=cleanSpace(raw?.environment)||direction.environment_description;
  const rawStyle=cleanSpace(raw?.style_lighting)||direction.lighting_and_material;
  const coveredStateTerms=new Set((direction.state==='C'?[]:[...resolved.present,...resolved.absent,...resolved.exposed]).map(key));
  ['dialogue','narration','music','readable generated text'].forEach(value=>coveredStateTerms.add(key(value)));
  const exclusionCandidates=[
    ...direction.forbidden_elements.map(value=>({value,score:120})),
    ...strings(resolved.stage.geometry_control?.forbidden_transformations).map(value=>({value,score:110})),
    ...strings(resolved.stage.geometry_control?.negative_constraints).map(value=>({value,score:100})),
    ...(resolved.stage.stage_actions||[]).flatMap((action:any)=>strings(action.forbidden_actions).map(value=>({value,score:90}))),
    ...strings(resolved.environment.forbidden_elements).map(value=>({value,score:80})),
    ...commaStrings(raw?.exclusions).map(value=>({value,score:60})),
  ].filter(item=>!coveredStateTerms.has(key(String(item.value))));
  const sections:OmniPromptSections={
    cinematography:`Use a ${resolved.camera.shotScale} ${resolved.camera.viewpoint} view on a ${resolved.camera.lens} lens, with one ${resolved.camera.behavior}`,
    subject:/\b(?:is|are|stands|sits|rests|remains|appears|moves|shows)\b/i.test(rawSubject)?rawSubject:`The scene shows ${rawSubject}`,
    action:cleanSpace(raw?.action)||direction.primary_action,
    environment:[/\b(?:is|are|inside|within|across|on the|in the)\b/i.test(rawEnvironment)?rawEnvironment:`Set the shot in ${rawEnvironment}`,inferred].filter(Boolean).join('. '),
    style_lighting:/^(?:use|render|light|keep)\b/i.test(rawStyle)?rawStyle:`Use ${rawStyle}`,
    product_state:direction.state==='C'?identitySentence(topic,resolved):stateSentence(direction,resolved),
    sound,
    exclusions:rankedUnique(exclusionCandidates,8).join(', '),
  };
  return {sections,resolved};
}

export function compileOmniPrompt(sections:OmniPromptSections,direction:SceneDirection):string {
  const parts=[`${Number(direction.duration.toFixed(3))}-second continuous shot.`,sentence(sections.cinematography),sentence(sections.subject),sentence(sections.action),sentence(sections.environment),sentence(sections.style_lighting),sentence(sections.product_state),sentence(sections.sound),sentence('Exclude dialogue, narration, music, and readable generated text'),sections.exclusions?sentence(`Exclude ${sections.exclusions.replace(/^(exclude|no|avoid)\s+/i,'')}`):''];
  const seen=new Set<string>();
  return parts.filter(Boolean).filter(part=>{const normalized=key(part);if(seen.has(normalized))return false;seen.add(normalized);return true;}).join(' ').replace(/\s+/g,' ').replace(/\.\s*\./g,'.').trim();
}

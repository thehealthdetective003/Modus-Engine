import { OmniPromptSections, PromptDiagnostics, PromptFieldLocks, PromptValidationIssue, SceneDirection, TopicBrief } from '../types';

const cleanSpace = (value: unknown) => String(value ?? '').replace(/\[object Object\]/gi, '').replace(/\s+/g, ' ').trim();
const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings) : typeof value === 'string' ? value.split(/\s*[|;]\s*/).map(cleanSpace).filter(Boolean) : [];
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const uniqueStrings = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  return values.flatMap(strings).filter(value => { const normalized=key(value).replace(/^(no|avoid|exclude|without|do not show) /,''); if(!normalized||seen.has(normalized)) return false; seen.add(normalized); return true; });
};

const dangling = /\b(?:and|or|of|for|on|the|with|to|from|while|but|a|an)$/i;
const placeholder = /\b(?:undefined|null|n\/a|tbd|todo|placeholder)\b|\{\{.*?\}\}|<[^>]+>/i;
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
  [/\b(lock|static|stationary)\b/i,'locked camera'],[/\bpan\b/i,'slow pan'],[/\b(push|move)\s*-?in\b/i,'slow push-in'],[/\b(pull|move)\s*-?back\b/i,'slow pull-back'],[/\b(crane|rise)\b/i,'restrained crane rise'],[/\b(dolly|lateral)\b/i,'slow lateral dolly'],[/\b(track|follow)\b/i,'restrained tracking movement'],
];
const pick = (value:string, options:string[], fallback:string) => options.find(option=>value.toLowerCase().includes(option)) || fallback;

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
  const rawCamera=`${direction.camera.shot_scale} ${direction.camera.lens} ${direction.camera.angle} ${direction.camera.movement}`.toLowerCase();
  const movementMatches=movementMap.filter(([pattern])=>pattern.test(direction.camera.movement)).map(([,label])=>label);
  const contradictions:string[]=[];
  if(/static|locked/.test(rawCamera)&&/track|dolly|pan|push|pull|crane/.test(rawCamera)) contradictions.push('Locked/static camera conflicts with camera movement.');
  if(/macro/.test(rawCamera)&&/wide|medium-wide/.test(rawCamera)) contradictions.push('Macro conflicts with a wide shot scale.');
  if(/wide-angle/.test(rawCamera)&&/\b(?:50|85|100|135)\s*mm/.test(rawCamera)) contradictions.push('Wide-angle conflicts with the supplied focal length.');
  if(/close-up/.test(rawCamera)&&/establishing/.test(rawCamera)) contradictions.push('Close-up conflicts with an establishing view.');
  const viewpoint=pick(direction.camera.angle,supportedView,direction.camera.angle||'side profile');
  const viewpointWords=viewpoint.toLowerCase();
  const anchors=uniqueStrings([
    ...(geometryModules.flatMap((item:any)=>item.required_visible_features||[])),
    stage.geometry_control?.required_visible_anchors,
    (handoff.product?.immutable_identity_features||[]),
  ]);
  const viewTerms=viewpointWords.includes('rear')?/(tail|fin|stabil|engine|rotodome|hook|rear)/i:viewpointWords.includes('front')?/(forward|nose|wing|engine|nacelle|rotodome|gear|front)/i:viewpointWords.includes('side')?/(proportion|wing|engine|rotodome|gear|fuselage|side)/i:null;
  const relevant=anchors.filter(anchor=>!viewTerms||viewTerms.test(anchor));
  return {
    stage,environment,geometryModules,references,transition,
    identity:(relevant.length?relevant:anchors).slice(0,7),
    present:uniqueStrings([stage.present_now,direction.required_visible_features]),
    absent:uniqueStrings([stage.not_yet_installed,direction.forbidden_elements]),
    exposed:uniqueStrings([stage.temporarily_exposed,stage.open_interfaces,stage.unfinished_edges_or_sections]),
    forbidden:uniqueStrings([stage.geometry_control?.negative_constraints,stage.geometry_control?.forbidden_transformations,stage.stage_actions?.flatMap((a:any)=>a.forbidden_actions||[]),environment.forbidden_elements,direction.forbidden_elements]),
    confirmed:uniqueStrings([stage.visual_evidence?.confirmed_visual_details]), inferred:uniqueStrings([stage.visual_evidence?.analyst_inferred_visual_details]),
    camera:{ shotScale:pick(rawCamera,supportedScale,'medium-wide'), lens:pick(rawCamera,supportedLens,/\b(?:70|85|100|135)\s*mm/.test(rawCamera)?'short telephoto':/\b(?:18|24|28|35)\s*mm/.test(rawCamera)?'wide-angle':'normal'), viewpoint, behavior:movementMatches[0]||'locked camera', movementCount:movementMatches.length, contradictions },
  };
}

function identitySentence(topic:TopicBrief|null,resolved:ResolvedProductionScene):string {
  const product=(topic as any)?._production_handoff?.product;
  const name=[product?.official_name,product?.exact_variant].filter(Boolean).join(' ') || topic?.topic.product || topic?.topic.title || 'product';
  return sentence(`Preserve the exact ${name} configuration with ${resolved.identity.join(', ')}`);
}

function stateSentence(direction:SceneDirection,resolved:ResolvedProductionScene):string {
  if(direction.state==='C') return identitySentence(null as any,{...resolved,identity:resolved.identity} as any).replace(/^Preserve the exact product configuration/i,'Preserve the completed configuration');
  const present=resolved.present.length?`show ${resolved.present.join(', ')}`:`show ${direction.product_visual_state}`;
  const absent=resolved.absent.length?` Do not show ${resolved.absent.join(', ')}`:'';
  const exposed=resolved.exposed.length?` Keep ${resolved.exposed.join(', ')} visibly unfinished or exposed`:'';
  return sentence(`Show only the incomplete State ${direction.state} configuration: ${present}.${exposed}.${absent}`.replace(/\.\s*\./g,'. '));
}

export function defaultLocks():PromptFieldLocks { return {identity:false,assemblyState:false,camera:false,prompt:false,sections:{}}; }

export function normalizeOmniSections(raw:any,direction:SceneDirection,topic:TopicBrief|null):{sections:OmniPromptSections;resolved:ResolvedProductionScene} {
  const resolved=resolveProductionScene(topic,direction);
  const inferred=resolved.inferred.length?`Use a plausible modern production environment consistent with this stage; do not invent proprietary internal layouts`:'';
  const factory=/factory|assembly|production|hangar|workshop/i.test(`${direction.environment_description} ${resolved.environment?.facility_type||''}`);
  const carrier=/carrier|maritime|deck/i.test(direction.environment_description);
  const sound=carrier?'Generate synchronized maritime deck ambience with wind, distant machinery, restrained deck-equipment movement, and physically matched mechanical sound':factory?'Generate synchronized factory ambience with distant ventilation, restrained machinery hum, soft tool contact, and subtle footsteps':'Generate realistic synchronized environmental and mechanical ambience appropriate to the visible action';
  const rawSubject=cleanSpace(raw?.subject)||direction.subject;
  const rawEnvironment=cleanSpace(raw?.environment)||direction.environment_description;
  const rawStyle=cleanSpace(raw?.style_lighting)||direction.lighting_and_material;
  const sections:OmniPromptSections={
    cinematography:`Use a ${resolved.camera.shotScale} ${resolved.camera.viewpoint} view on a ${resolved.camera.lens} lens, with one ${resolved.camera.behavior}`,
    subject:/\b(?:is|are|stands|sits|rests|remains|appears|moves|shows)\b/i.test(rawSubject)?rawSubject:`The scene shows ${rawSubject}`,
    action:cleanSpace(raw?.action)||direction.primary_action,
    environment:[/\b(?:is|are|inside|within|across|on the|in the)\b/i.test(rawEnvironment)?rawEnvironment:`Set the shot in ${rawEnvironment}`,inferred].filter(Boolean).join('. '),
    style_lighting:/^(?:use|render|light|keep)\b/i.test(rawStyle)?rawStyle:`Use ${rawStyle}`,
    product_state:direction.state==='C'?identitySentence(topic,resolved):stateSentence(direction,resolved),
    sound,
    exclusions:uniqueStrings([raw?.exclusions,resolved.forbidden]).join(', '),
  };
  return {sections,resolved};
}

export function compileOmniPrompt(sections:OmniPromptSections,direction:SceneDirection):string {
  const parts=[`${Number(direction.duration.toFixed(3))}-second continuous shot.`,sentence(sections.cinematography),sentence(sections.subject),sentence(sections.action),sentence(sections.environment),sentence(sections.style_lighting),sentence(sections.product_state),sentence(sections.sound),sentence('Exclude dialogue, narration, music, and readable generated text'),sections.exclusions?sentence(`Exclude ${sections.exclusions.replace(/^(exclude|no|avoid)\s+/i,'')}`):''];
  const seen=new Set<string>();
  return parts.filter(Boolean).filter(part=>{const normalized=key(part);if(seen.has(normalized))return false;seen.add(normalized);return true;}).join(' ').replace(/\s+/g,' ').replace(/\.\s*\./g,'.').trim();
}

const tokens=(value:string)=>new Set(key(value).split(' ').filter(Boolean));
const jaccard=(a:string,b:string)=>{const left=tokens(a),right=tokens(b);const intersection=[...left].filter(x=>right.has(x)).length;const union=new Set([...left,...right]).size;return union?intersection/union:0;};
export function sceneSimilarity(a:SceneDirection,b:SceneDirection):number {
  const exact=[[a.stage_id,b.stage_id],[a.state,b.state],[a.environment_ref,b.environment_ref],[a.camera.shot_scale,b.camera.shot_scale],[a.camera.angle,b.camera.angle],[a.camera.movement,b.camera.movement]];
  const exactScore=exact.reduce((sum,[x,y])=>sum+(key(x)===key(y)?1:0),0)/exact.length;
  const semantic=(jaccard(a.primary_action,b.primary_action)+jaccard(a.lighting_and_material,b.lighting_and_material)+jaccard(a.required_visible_features.join(' '),b.required_visible_features.join(' ')))/3;
  return Number((exactScore*.7+semantic*.3).toFixed(3));
}

export function diagnosticsFor(direction:SceneDirection,topic:TopicBrief|null,allDirections:SceneDirection[]):PromptDiagnostics {
  const resolved=resolveProductionScene(topic,direction);let best=0,similarSceneNumber: number|undefined;
  for(const other of allDirections){if(other.number===direction.number)continue;const score=sceneSimilarity(direction,other);if(score>best){best=score;similarSceneNumber=other.number;}}
  return {lifecycleStage:direction.stage_id,productState:direction.state,environment:direction.environment_description,shotScale:resolved.camera.shotScale,lens:resolved.camera.lens,viewpoint:resolved.camera.viewpoint,cameraBehavior:resolved.camera.behavior,primaryAction:direction.primary_action,supportingAction:direction.supporting_motion,componentsPresent:resolved.present,componentsAbsent:resolved.absent,geometryAnchors:resolved.identity,referenceAssets:resolved.references.map((item:any)=>item.asset_id).filter(Boolean),exclusions:resolved.forbidden,evidenceConfidence:resolved.stage.evidence_confidence||resolved.references.map((item:any)=>item.confidence).filter(Boolean).join(', ')||'UNSPECIFIED',similarityScore:best,similarSceneNumber};
}

export function validateOmniPrompt(prompt:string,sections:OmniPromptSections,direction:SceneDirection,topic:TopicBrief|null,diagnostics:PromptDiagnostics,threshold=.78):PromptValidationIssue[] {
  const resolved=resolveProductionScene(topic,direction);const issues:PromptValidationIssue[]=[];const add=(code:string,severity:PromptValidationIssue['severity'],message:string,field?:PromptValidationIssue['field'])=>issues.push({code,severity,message,field});
  if(!prompt.trim()||placeholder.test(prompt)||/\[object Object\]/i.test(prompt)||dangling.test(prompt.replace(/[.!?]+$/,''))) add('MALFORMED_PROMPT','error','Prompt contains incomplete text or an unresolved placeholder.','prompt');
  if(!diagnostics.geometryAnchors.length&&direction.state==='C') add('MISSING_IDENTITY','error','No authoritative product-identity geometry is available.','product_state');
  if(!direction.state||!sections.product_state) add('MISSING_STATE','error','Lifecycle product state is missing.','product_state');
  const positiveText=prompt.split(/(?<=[.!?])\s+/).filter(part=>!/^\s*(?:do not|exclude|avoid|without)/i.test(part)&&!/(?:not yet installed|remain absent)/i.test(part)).join(' ');
  const leaked=resolved.absent.filter(component=>component.length>2&&new RegExp(`\\b${component.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(positiveText));
  if(direction.state!=='C'&&leaked.length) add('FUTURE_COMPONENT_LEAK','error',`Prompt positively introduces absent components: ${leaked.join(', ')}.`,'continuity');
  const counts=new Map<string,string>();
  for(const match of prompt.matchAll(/\bexactly\s+(\w+)\s+([a-z-]+(?:\s+[a-z-]+){0,2})/gi)){const count=match[1].toLowerCase(),feature=key(match[2]).replace(/s$/,'');const prior=counts.get(feature);if(prior&&prior!==count)add('COUNT_CONTRADICTION','error',`Conflicting exact counts for ${feature}.`,'product_state');else counts.set(feature,count);}
  resolved.camera.contradictions.forEach(message=>add('CAMERA_CONTRADICTION','error',message,'cinematography'));
  if(resolved.camera.movementCount>1) add('MULTIPLE_CAMERA_MOVES','warning','Several camera movements were supplied; prefer one primary behavior.','cinematography');
  if(/represents|symbolizes|demonstrates the|illustrates|serves as/i.test(sections.action)) add('ABSTRACT_ACTION','error','Action must describe literal camera-visible activity.','action');
  if((sections.action.match(/\b(?:while|and then|simultaneously|as .* also)\b/gi)||[]).length>1) add('MULTIPLE_MAJOR_ACTIONS','warning','The scene may contain several simultaneous major actions.','action');
  if(/fold|rotate|lower|raise|launch|landing|touchdown|arrest|propeller/i.test(sections.action)) add('COMPLEX_MECHANICAL_MOTION','warning','Verify rigid pivots, fixed interfaces, and physically limited motion.','action');
  if(prompt.split(/\s+/).length>190) add('EXCESSIVE_LENGTH','warning','Prompt is unusually long for a short clip.','prompt');
  if(resolved.inferred.length) add('INFERRED_VISUAL','warning','Factory detail includes analyst-inferred information and must remain plausibly worded.','environment');
  if(diagnostics.similarityScore>=threshold) add('SCENE_SIMILARITY','warning',`Scene is ${Math.round(diagnostics.similarityScore*100)}% similar to scene ${diagnostics.similarSceneNumber}; vary action, viewpoint, environment, scale, or lighting.`,'similarity');
  if(direction.number<=5&&diagnostics.similarityScore>=threshold&&diagnostics.similarSceneNumber&&diagnostics.similarSceneNumber<=5) add('REPETITIVE_OPENING','warning','Opening scenes repeat the same visual setup; move into the production lifecycle sooner.','similarity');
  if(!/\b(?:wide|medium|close|telephoto|angle|profile|view|camera|dolly|pan|track|push|pull|crane)\b/i.test(sections.cinematography)) add('CAMERA_SPECIFICITY','info','Add a clearer shot scale, lens, viewpoint, or camera behavior.','cinematography');
  if(!/ambience|sound|hum|wind|machinery|footsteps|propeller/i.test(sections.sound)) add('SOUND_SPECIFICITY','info','Add contextual synchronized environmental sound.','sound');
  return issues;
}

export function hasBlockingIssues(issues:PromptValidationIssue[]=[],accepted:string[]=[]):boolean {
  return issues.some(issue=>issue.severity==='error'||(issue.severity==='warning'&&!accepted.includes(issue.code)));
}

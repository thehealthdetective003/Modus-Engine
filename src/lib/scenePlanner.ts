import type { CameraPlatform, CinematicEnergy, GraphicAnnotationDevice, GraphicComposition, GraphicMotionPattern, GraphicSceneSpec, GraphicSubtype, PlannedScene, ProductVisibility, ShowdownRole, StoryFunction, TimedScene, TopicBrief, VisualFamily, VisualTreatment } from '../types';
import type { V2Chapter, V2ProductionStage, V2VisualBeat, VisualProductionHandoffV2 } from '../types/visualProductionV2';

interface Candidate {
  chapter: V2Chapter | null;
  beat: V2VisualBeat;
  treatment: VisualTreatment;
  sourceBeatId: string;
}

const CONTEXT = new Set<VisualFamily>(['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH','FACTORY_INTERIOR_WIDE','MAP_OR_SUPPLY_CHAIN']);
const PROCESS = new Set<VisualFamily>(['ASSEMBLY_PROCESS','COMPONENT_MACRO','TOOL_LEVEL_DETAIL','WORKER_POV','MACHINERY_ACTION','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION','MATERIAL_FLOW','COMPONENT_LOGISTICS']);
const RESET = new Set<VisualFamily>(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN','ATMOSPHERIC_INTERSTITIAL','CHAPTER_TRANSITION','STATIC_GROUND_TEST','DYNAMIC_TESTING','ENVIRONMENTAL_TESTING']);
const GRAPHIC = new Set<VisualFamily>(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN']);
const OPERATIONAL = new Set<VisualFamily>(['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT']);
const balanceKey=(family:VisualFamily):string=>family==='HERO_PRODUCT'?'completed_product_hero_imagery_percent':GRAPHIC.has(family)||family==='ARCHIVAL_REFERENCE'?'graphics_and_reference_media_percent':['STATIC_GROUND_TEST','DYNAMIC_TESTING','ENVIRONMENTAL_TESTING','OPERATIONAL_CONTEXT','DELIVERY_AND_ROLLOUT'].includes(family)?'testing_and_operational_context_percent':['COMPONENT_MACRO','TOOL_LEVEL_DETAIL','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION'].includes(family)?'component_detail_and_quality_control_percent':CONTEXT.has(family)||['MATERIAL_FLOW','COMPONENT_LOGISTICS'].includes(family)?'factory_scale_and_logistics_percent':'manufacturing_and_assembly_percent';
const tokenize = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length;
const isV2 = (topic: TopicBrief): topic is TopicBrief & { _production_handoff: VisualProductionHandoffV2 } =>
  (topic._production_handoff as any)?.schema?.version === '2.0.0';

export function resolvePlannedState(topic:TopicBrief|null|undefined,stageId:string,visibility:ProductVisibility):'A'|'B'|'C'{
  const rawStage=(topic as any)?._production_handoff?.production_stages?.find((item:any)=>item.stage_id===stageId);
  const legacyStage=topic?.lifecycle_stages?.find(item=>item.stage_id===stageId);
  const candidate=String(rawStage?.product_state_code||legacyStage?.state||'').toUpperCase().replace(/^STATE[_\s-]*/,'');
  if(candidate==='A'||candidate==='B'||candidate==='C')return candidate;
  return visibility==='FULL'?'C':visibility==='NONE'?'A':'B';
}

export function isOperationallyMobileProduct(topic:TopicBrief|null|undefined):boolean{
  const handoff:any=(topic as any)?._production_handoff;
  const identity=`${handoff?.product?.product_class||''} ${handoff?.product?.official_name||''} ${handoff?.product?.exact_variant||''} ${topic?.topic?.category||''} ${topic?.topic?.product||''}`.toLowerCase();
  const mobile=/\b(aircraft|airplane|aeroplane|helicopter|rotorcraft|fighter|jet|drone|uas|uav|warship|ship|submarine|tank|armou?red vehicle|military vehicle|automobile|truck|locomotive|train|spacecraft|rocket)\b/.test(identity);
  const hasOperationalBeat=handoff?.visual_story_plan?.chapters?.some((chapter:any)=>chapter.visual_beats?.some((beat:any)=>OPERATIONAL.has(beat.visual_family)));
  return mobile||Boolean(hasOperationalBeat);
}

export function isAviationProduct(topic:TopicBrief|null|undefined):boolean{
  const handoff:any=(topic as any)?._production_handoff;
  const identity=`${handoff?.product?.product_class||''} ${handoff?.product?.official_name||''} ${handoff?.product?.exact_variant||''} ${topic?.topic?.category||''} ${topic?.topic?.product||''}`.toLowerCase();
  return /\b(aircraft|airplane|aeroplane|helicopter|rotorcraft|fighter|jet|drone|uas|uav)\b/.test(identity);
}

const SHOWDOWN_PLATFORM:Record<ShowdownRole,CameraPlatform>={
  ANTICIPATION:'DISTANT_OBSERVATION',
  GROUND_REVEAL:'GROUND_TRIPOD',
  HUMAN_SCALE:'GROUND_HANDHELD',
  PREPARATION:'GROUND_HANDHELD',
  DEPARTURE:'RUNWAY_LONG_LENS',
  AIRBORNE_ESTABLISHMENT:'CHASE_AIRCRAFT',
  PERFORMANCE_PASS:'DISTANT_OBSERVATION',
  COCKPIT_IMMERSION:'COCKPIT_MOUNTED',
  ENVIRONMENTAL_SPECTACLE:'CHASE_AIRCRAFT',
  OPERATIONAL_RESET:'GROUND_HANDHELD',
  SECOND_PEAK:'CHASE_AIRCRAFT',
  CONTROLLED_RETURN:'RUNWAY_LONG_LENS',
};
const SHOWDOWN_ENERGY:Record<ShowdownRole,CinematicEnergy>={
  ANTICIPATION:'LOW',GROUND_REVEAL:'LOW',HUMAN_SCALE:'LOW',PREPARATION:'LOW',
  DEPARTURE:'MEDIUM',AIRBORNE_ESTABLISHMENT:'MEDIUM',PERFORMANCE_PASS:'HIGH',
  COCKPIT_IMMERSION:'HIGH',ENVIRONMENTAL_SPECTACLE:'HIGH',OPERATIONAL_RESET:'LOW',
  SECOND_PEAK:'HIGH',CONTROLLED_RETURN:'LOW',
};

function showdownRoleFor(index:number,total:number,family:VisualFamily,operationalOrdinal:number):ShowdownRole|null{
  if(index===0&&OPERATIONAL.has(family))return 'GROUND_REVEAL';
  if(index===1&&PROCESS.has(family))return 'HUMAN_SCALE';
  if(index===2&&OPERATIONAL.has(family))return 'DEPARTURE';
  if(!OPERATIONAL.has(family)){
    const progress=total<=1?0:index/(total-1);
    return progress>=0.42&&progress<=0.58&&(family==='STATIC_GROUND_TEST'||family==='HERO_PRODUCT')?'OPERATIONAL_RESET':null;
  }
  const progress=total<=1?0:index/(total-1);
  if(progress>=0.85)return 'CONTROLLED_RETURN';
  if(progress>=0.62)return operationalOrdinal%3===0?'COCKPIT_IMMERSION':operationalOrdinal%2===0?'ENVIRONMENTAL_SPECTACLE':'SECOND_PEAK';
  if(progress>=0.42&&progress<=0.58)return 'OPERATIONAL_RESET';
  if(operationalOrdinal===2)return 'AIRBORNE_ESTABLISHMENT';
  return operationalOrdinal%3===0?'COCKPIT_IMMERSION':operationalOrdinal%2===0?'ENVIRONMENTAL_SPECTACLE':'PERFORMANCE_PASS';
}

function treatmentFor(beat: V2VisualBeat): VisualTreatment {
  if (!GRAPHIC.has(beat.visual_family)) return 'LIVE_ACTION_T2V';
  const words = `${beat.beat_name} ${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')}`.toLowerCase();
  return /flow|path|sequence|motion|movement|relationship|layer|mechanism|supply|route/.test(words) ? 'MOTION_GRAPHIC_T2V' : 'STATIC_GRAPHIC_T2V';
}

const GRAPHIC_COMPOSITION:Record<GraphicSubtype,GraphicComposition>={
  COMPONENT_HIGHLIGHT:'SINGLE_SUBJECT',
  TECHNICAL_CUTAWAY:'ORTHOGRAPHIC_CUTAWAY',
  PROCESS_FLOW:'LEFT_TO_RIGHT_FLOW',
  MECHANICAL_RELATIONSHIP:'SINGLE_SUBJECT',
  LAYER_EXPLANATION:'LAYERED_SEPARATION',
  SCALE_COMPARISON:'TWO_PANEL_COMPARISON',
  SENSOR_SIGNAL:'CONCENTRIC_SIGNAL_FIELD',
  HEAT_OR_ENERGY_FLOW:'ORTHOGRAPHIC_CUTAWAY',
  FACTORY_SCHEMATIC:'SCHEMATIC_FACTORY',
  SYMBOLIC_LOCATION:'SYMBOLIC_ROUTE',
  CONCEPTUAL_TRANSITION:'MATCHED_SHAPE_TRANSITION',
};
const GRAPHIC_MOTION:Record<GraphicSubtype,GraphicMotionPattern>={
  COMPONENT_HIGHLIGHT:'HIGHLIGHT_PULSE',
  TECHNICAL_CUTAWAY:'MINIMAL_PARALLAX',
  PROCESS_FLOW:'FLOW_DRAW_ON',
  MECHANICAL_RELATIONSHIP:'COMPONENT_TRANSLATION',
  LAYER_EXPLANATION:'LAYER_SEPARATION',
  SCALE_COMPARISON:'MINIMAL_PARALLAX',
  SENSOR_SIGNAL:'SIGNAL_SWEEP',
  HEAT_OR_ENERGY_FLOW:'HEAT_ZONE_PROGRESSION',
  FACTORY_SCHEMATIC:'CONTROLLED_ASSEMBLY',
  SYMBOLIC_LOCATION:'FLOW_DRAW_ON',
  CONCEPTUAL_TRANSITION:'MATCH_ANCHOR',
};
const GRAPHIC_ANNOTATIONS:Record<GraphicSubtype,GraphicAnnotationDevice[]>={
  COMPONENT_HIGHLIGHT:['HIGHLIGHT_RING'],
  TECHNICAL_CUTAWAY:['FLOW_LINES','COLORED_ZONE'],
  PROCESS_FLOW:['DIRECTIONAL_ARROWS','FLOW_LINES'],
  MECHANICAL_RELATIONSHIP:['DIRECTIONAL_ARROWS','HIGHLIGHT_RING'],
  LAYER_EXPLANATION:['DIRECTIONAL_ARROWS','COLORED_ZONE'],
  SCALE_COMPARISON:['MEASUREMENT_BASELINE'],
  SENSOR_SIGNAL:['SIGNAL_WAVES','COLORED_ZONE'],
  HEAT_OR_ENERGY_FLOW:['FLOW_LINES','COLORED_ZONE'],
  FACTORY_SCHEMATIC:['HIGHLIGHT_RING','DIRECTIONAL_ARROWS'],
  SYMBOLIC_LOCATION:['FLOW_LINES'],
  CONCEPTUAL_TRANSITION:['HIGHLIGHT_RING'],
};

function graphicSubtypeFor(value:string):GraphicSubtype{
  if(/\b(radar|sensor|signal|scan|detect|stealth|observab)/i.test(value))return 'SENSOR_SIGNAL';
  if(/\b(heat|thermal|combust|exhaust|energy|temperature|thrust|airflow)/i.test(value))return 'HEAT_OR_ENERGY_FLOW';
  if(/\b(engine|turbine|compressor|cutaway|cross[- ]section|interior|internal mechanism)/i.test(value))return 'TECHNICAL_CUTAWAY';
  if(/\b(compare|comparison|versus|\bvs\b|larger|smaller|faster|slower|scale|size|weight|dimension)/i.test(value))return 'SCALE_COMPARISON';
  if(/\b(layer|laminate|stack|coating|material section|sandwich)/i.test(value))return 'LAYER_EXPLANATION';
  if(/\b(factory|assembly hall|robotic arm|production line|manufactur)/i.test(value))return 'FACTORY_SCHEMATIC';
  if(/\b(map|location|route|supply chain|logistics path|geograph)/i.test(value))return 'SYMBOLIC_LOCATION';
  if(/\b(transition|chapter|match cut|bridge)/i.test(value))return 'CONCEPTUAL_TRANSITION';
  if(/\b(flow|path|sequence|cycle|process|stages|from .* to)/i.test(value))return 'PROCESS_FLOW';
  if(/\b(install|connect|interface|hinge|linkage|relationship|mechanism|movement)/i.test(value))return 'MECHANICAL_RELATIONSHIP';
  return 'COMPONENT_HIGHLIGHT';
}

function singleVisualClaim(value:string):string{
  const cleaned=value.replace(/contextual generic|t2v[- ]safe|editor[- ]controlled|add(?:ed)? (?:later|in the editor)/gi,'').replace(/\s+/g,' ').trim();
  const clause=cleaned.split(/(?<=[.!?])\s+|\s*;\s*/)[0]||'Show one clear technical relationship';
  const limited=clause.length>180?clause.slice(0,180).replace(/\s+\S*$/,''):clause;
  return limited.trim()||'Show one clear technical relationship';
}

function createGraphicSceneSpec(scene:TimedScene,source:string,treatment:VisualTreatment,claimSource=scene.text):GraphicSceneSpec{
  const graphic_subtype=graphicSubtypeFor(`${scene.text} ${source}`);
  const motion=GRAPHIC_MOTION[graphic_subtype];
  return {
    graphic_subtype,
    visual_claim:singleVisualClaim(claimSource||scene.text),
    composition:GRAPHIC_COMPOSITION[graphic_subtype],
    motion_pattern:treatment==='STATIC_GRAPHIC_T2V'?(graphic_subtype==='COMPONENT_HIGHLIGHT'?'HIGHLIGHT_PULSE':'MINIMAL_PARALLAX'):motion,
    annotation_devices:GRAPHIC_ANNOTATIONS[graphic_subtype].slice(0,2),
    palette_profile:'PREMIUM_TECHNICAL_VECTOR',
    maximum_animated_elements:treatment==='STATIC_GRAPHIC_T2V'?1:3,
    transition_anchor:graphic_subtype==='CONCEPTUAL_TRANSITION'?'centered matched geometric form':graphic_subtype==='TECHNICAL_CUTAWAY'?'centered component cross-section':graphic_subtype==='HEAT_OR_ENERGY_FLOW'?'centered flow boundary':null,
    text_policy:'NO_GENERATED_TEXT',
  };
}

export function deriveGraphicSceneSpec(topic:TopicBrief|null|undefined,scene:TimedScene,plan:Pick<PlannedScene,'beat_id'|'visual_family'|'visual_treatment'>):GraphicSceneSpec|null{
  if(plan.visual_treatment!=='STATIC_GRAPHIC_T2V'&&plan.visual_treatment!=='MOTION_GRAPHIC_T2V')return null;
  const handoff:any=(topic as any)?._production_handoff;
  const sourceId=plan.beat_id.replace(/__T2V_SAFE$/,'');
  const beat=handoff?.visual_story_plan?.chapters?.flatMap((chapter:any)=>chapter.visual_beats||[]).find((item:any)=>item.beat_id===sourceId);
  const source=[beat?.beat_name,beat?.narrative_purpose,...(beat?.semantic_alignment_terms||[]),plan.visual_family].filter(Boolean).join(' ');
  return createGraphicSceneSpec(scene,source,plan.visual_treatment,beat?.narrative_purpose||beat?.beat_name||scene.text);
}

function candidatesFromV2(handoff: VisualProductionHandoffV2): Candidate[] {
  const all = handoff.visual_story_plan.chapters.flatMap(chapter => chapter.visual_beats.map(beat => ({ chapter, beat })));
  const safe = all.filter(({ beat }) => beat.generation_permission === 'T2V_ALLOWED' && beat.preferred_media_routes.includes('GENERATED_T2V'));
  const normalized:Candidate[]=all.map(({ chapter, beat }):Candidate => {
    if (beat.generation_permission === 'T2V_ALLOWED' && beat.preferred_media_routes.includes('GENERATED_T2V')) return { chapter, beat, treatment: treatmentFor(beat), sourceBeatId: beat.beat_id };
    if(GRAPHIC.has(beat.visual_family)){
      const conceptual:V2VisualBeat={...beat,beat_id:`${beat.beat_id}__T2V_SAFE`,reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,must_not_show:[...beat.must_not_show,'readable labels, numbers, logos, maps, interfaces, or precise generated data']};
      return {chapter,beat:conceptual,treatment:treatmentFor(conceptual),sourceBeatId:conceptual.beat_id};
    }
    if(OPERATIONAL.has(beat.visual_family)){
      const contextual:V2VisualBeat={...beat,beat_id:`${beat.beat_id}__T2V_SAFE`,narrative_purpose:`Contextual generic operational demonstration: ${beat.narrative_purpose}`,reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,must_not_show:[...beat.must_not_show,'exact event recreation','identifiable real-world location','invented unit markings','weapon discharge','explosions or active combat']};
      return {chapter,beat:contextual,treatment:'LIVE_ACTION_T2V',sourceBeatId:contextual.beat_id};
    }
    const substitute = safe.find(x => x.chapter.chapter_id === chapter.chapter_id && x.beat.story_function === beat.story_function)
      || safe.find(x => x.chapter.chapter_id === chapter.chapter_id && x.beat.visual_family === beat.visual_family)
      || safe.find(x => x.beat.story_function === beat.story_function)
      || safe.find(x => RESET.has(x.beat.visual_family))
      || safe[0];
    if (substitute) return { chapter, beat: substitute.beat, treatment: treatmentFor(substitute.beat), sourceBeatId: substitute.beat.beat_id };
    const conceptual: V2VisualBeat = { ...beat, beat_id: `${beat.beat_id}__T2V_SAFE`, visual_family: 'TECHNICAL_GRAPHIC', product_visibility: 'NONE', reference_asset_ids: [], preferred_media_routes: ['GENERATED_T2V'], generation_permission: 'T2V_ALLOWED', exact_factory_claim_allowed: false, must_not_show: [...beat.must_not_show, 'readable labels, numbers, logos, or precise data'] };
    return { chapter, beat: conceptual, treatment: treatmentFor(conceptual), sourceBeatId: conceptual.beat_id };
  });
  const present=new Set(normalized.map(x=>x.beat.visual_family));
  const fallbackFamilies:VisualFamily[]=['FACTORY_AERIAL','ASSEMBLY_PROCESS','COMPONENT_MACRO','MACHINERY_ACTION','QUALITY_CONTROL','TECHNICAL_GRAPHIC','ATMOSPHERIC_INTERSTITIAL','STATIC_GROUND_TEST','OPERATIONAL_CONTEXT'];
  const stages=handoff.production_stages.length?handoff.production_stages:[{} as V2ProductionStage];
  fallbackFamilies.forEach((family,fi)=>{
    if(present.has(family))return;
    const stage=OPERATIONAL.has(family)||family==='STATIC_GROUND_TEST'||family==='DYNAMIC_TESTING'?stages.at(-1)!:stages[fi%stages.length], graphic=GRAPHIC.has(family);
    const identity=`${handoff.product.product_class} ${handoff.product.official_name}`.toLowerCase();
    const operationalPurpose=/helicopter|rotorcraft/.test(identity)?'show the complete aircraft performing one controlled hover, climb, bank, transit, or landing maneuver with visible rotor physics and environmental response':/aircraft|airplane|fighter|jet|uas|uav|drone/.test(identity)?'show the complete aircraft performing one controlled taxi, takeoff, climb, formation transit, banked pass, approach, or landing action with visible aerodynamic response':'show the completed product performing one supported defining operation in a generic non-identifying real environment';
    const purpose=family==='FACTORY_AERIAL'?'establish industrial scale and location':family==='ATMOSPHERIC_INTERSTITIAL'?'reset attention with material, light, weather, and industrial atmosphere':family==='TECHNICAL_GRAPHIC'?'explain an unlabeled mechanical relationship with shapes, layers, and paths':OPERATIONAL.has(family)?operationalPurpose:`show ${family.toLowerCase().replaceAll('_',' ')} as physical documentary evidence`;
    const beat={beat_id:`SYNTH_${family}`,beat_order:900+fi,beat_name:`T2V-safe ${family.replaceAll('_',' ')}`,story_function:(CONTEXT.has(family)?'ESTABLISH_SCALE':RESET.has(family)?'RESET_ATTENTION':'EXPLAIN_PROCESS') as StoryFunction,visual_family:family,narrative_purpose:purpose,semantic_alignment_terms:[family,...purpose.split(' ')],applicable_stage_ids:stage.stage_id?[stage.stage_id]:[],environment_ids:stage.environment_ids||[],product_visibility:(graphic||CONTEXT.has(family)||family==='ATMOSPHERIC_INTERSTITIAL'?'NONE':family==='COMPONENT_MACRO'?'DETAIL_ONLY':family==='ASSEMBLY_PROCESS'?'PARTIAL':'FULL') as ProductVisibility,required_product_state_code:null,facility_claim_status:'CONTEXTUAL_INDUSTRIAL_VISUAL',reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,preferred_shot_scales:[],preferred_camera_movements:[],minimum_usable_duration_seconds:0,preferred_duration_seconds:10,maximum_duration_seconds:10,must_show:[],must_not_show:['readable text','invented logos','unsupported facility identity'],continuity_requirements:[],negative_constraints:[]} as V2VisualBeat;
    normalized.push({chapter:handoff.visual_story_plan.chapters[0]||null,beat,treatment:treatmentFor(beat),sourceBeatId:beat.beat_id});
  });
  return normalized;
}

function legacyCandidates(topic: TopicBrief): Candidate[] {
  const families: VisualFamily[] = ['FACTORY_EXTERIOR','ASSEMBLY_PROCESS','COMPONENT_MACRO','MACHINERY_ACTION','QUALITY_CONTROL','TECHNICAL_GRAPHIC','ATMOSPHERIC_INTERSTITIAL','OPERATIONAL_CONTEXT'];
  const stages = topic.lifecycle_stages || [];
  const usableStages=stages.length ? stages : [{ stage_id:'STAGE_01', stage_name:'Production', environment_ref: topic.environments[0]?.environment_id || 'ENV_01' } as any];
  const identity=`${topic.topic.category} ${topic.topic.product||''}`.toLowerCase();
  const operation=/helicopter|rotorcraft/.test(identity)?'completed aircraft performs one controlled hover, climb, transit, bank, or landing maneuver with visible rotor physics and environmental response':/aircraft|airplane|fighter|jet|uas|uav|drone/.test(identity)?'completed aircraft performs one controlled taxi, takeoff, climb, formation transit, banked pass, approach, or landing action with visible aerodynamic response':'completed product performs one supported defining operation in a generic non-identifying environment';
  const operationalEnv=topic.environments.find(environment=>/outdoor|test|operational|flight|apron|range|airfield|runway|deck/i.test(`${environment.name} ${environment.environment_type||''} ${environment.visual_details}`))?.environment_id||usableStages.at(-1)?.environment_ref||'ENV_OPERATIONAL';
  return usableStages.flatMap((stage, si) => families.filter(family=>!OPERATIONAL.has(family)||si===usableStages.length-1).map((family, fi) => ({
    chapter: null,
    sourceBeatId: `LEGACY_${si+1}_${fi+1}`,
    treatment: (GRAPHIC.has(family) ? 'MOTION_GRAPHIC_T2V' : 'LIVE_ACTION_T2V') as VisualTreatment,
    beat: { beat_id:`LEGACY_${si+1}_${fi+1}`, beat_order:fi+1, beat_name:family.replaceAll('_',' '), story_function:(OPERATIONAL.has(family)?'OPENING_HOOK':fi===0?'ESTABLISH_LOCATION':fi===5?'EXPLAIN_HIDDEN_SYSTEM':fi===6?'RESET_ATTENTION':'EXPLAIN_PROCESS') as StoryFunction, visual_family:family, narrative_purpose:OPERATIONAL.has(family)?operation:stage.action || stage.stage_name, semantic_alignment_terms:[stage.stage_name,stage.action || '',family,OPERATIONAL.has(family)?operation:''], applicable_stage_ids:[stage.stage_id || `STAGE_${si+1}`], environment_ids:[OPERATIONAL.has(family)?operationalEnv:stage.environment_ref], product_visibility:family==='TECHNICAL_GRAPHIC'||family==='ATMOSPHERIC_INTERSTITIAL'?'NONE':family==='COMPONENT_MACRO'?'DETAIL_ONLY':family==='ASSEMBLY_PROCESS'?'PARTIAL':'FULL', required_product_state_code:null, facility_claim_status:'CONTEXTUAL_INDUSTRIAL_VISUAL', reference_asset_ids:[], preferred_media_routes:['GENERATED_T2V'], generation_permission:'T2V_ALLOWED', exact_factory_claim_allowed:false, preferred_shot_scales:[], preferred_camera_movements:[], minimum_usable_duration_seconds:0, preferred_duration_seconds:10, maximum_duration_seconds:10, must_show:[], must_not_show:OPERATIONAL.has(family)?['weapon discharge','explosions or active combat','invented markings','exact event or location claim']:[], continuity_requirements:[], negative_constraints:[] } as V2VisualBeat,
  })));
}

function runLength<T>(items: T[], value: T): number { let count=0; for(let i=items.length-1;i>=0&&items[i]===value;i--) count++; return count; }

export function buildDocumentaryScenePlan(topic: TopicBrief, scenes: TimedScene[]): PlannedScene[] {
  const handoff = isV2(topic) ? topic._production_handoff : null;
  const operationalEligible=isOperationallyMobileProduct(topic);
  const aviationEligible=isAviationProduct(topic);
  const sourceCandidates = handoff ? candidatesFromV2(handoff) : legacyCandidates(topic);
  const candidates=sourceCandidates.filter(candidate=>operationalEligible||!OPERATIONAL.has(candidate.beat.visual_family)||!candidate.sourceBeatId.startsWith('SYNTH_'));
  const stages = handoff?.production_stages || [];
  const plan: PlannedScene[] = [];
  let lastResetEnd = 0;
  let lastOperationalEnd=0;
  let operationalCount=0;
  const desiredOpening = (index:number, family:VisualFamily) => operationalEligible&&index===0?OPERATIONAL.has(family):index===1?PROCESS.has(family):operationalEligible&&index===2?OPERATIONAL.has(family):index===3?CONTEXT.has(family):index===4?RESET.has(family):operationalEligible&&index===5?OPERATIONAL.has(family):false;
  for (let i=0;i<scenes.length;i++) {
    const scene=scenes[i], vo=tokenize(scene.text), progress=scenes.length<=1?0:i/(scenes.length-1);
    const expectedStage=stages[Math.min(stages.length-1,Math.floor(progress*Math.max(stages.length,1)))];
    const recentFamilies=plan.slice(-2).map(x=>x.visual_family), recentVisibility=plan.slice(-2).map(x=>x.product_visibility), recentEnvs=plan.slice(-3).map(x=>x.environment_ref),recentOperational=plan.slice(-2).map(x=>OPERATIONAL.has(x.visual_family));
    const scored=candidates.map((candidate, order) => {
      const beat=candidate.beat;
      const words=tokenize(`${beat.beat_name} ${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')}`);
      const stage=beat.applicable_stage_ids.includes(expectedStage?.stage_id) ? expectedStage?.stage_id : beat.applicable_stage_ids[0] || expectedStage?.stage_id || topic.lifecycle_stages?.[0]?.stage_id || 'STAGE_01';
      const stageData=stages.find(x=>x.stage_id===stage);
      const env=beat.environment_ids[0] || stageData?.environment_ids[0] || topic.lifecycle_stages?.find(x=>x.stage_id===stage)?.environment_ref || topic.environments[0]?.environment_id || 'ENV_01';
      let score=overlap(vo,words)*8 - Math.abs((order/Math.max(candidates.length-1,1))-progress)*3;
      if (stage===expectedStage?.stage_id) score+=3;
      if(scene.duration<beat.minimum_usable_duration_seconds||scene.duration>beat.maximum_duration_seconds)score-=120;
      if (recentFamilies.length===2&&recentFamilies.every(x=>x===beat.visual_family)) score-=1000;
      if (beat.product_visibility==='FULL'&&recentVisibility.length===2&&recentVisibility.every(x=>x==='FULL')) score-=1000;
      if (recentEnvs.length===3&&recentEnvs.every(x=>x===env)) score-=1000;
      if (i<10&&desiredOpening(i,beat.visual_family)) score+=2000;
      if(recentOperational.length===2&&recentOperational.every(Boolean)&&OPERATIONAL.has(beat.visual_family))score-=1000;
      if (i<10&&new Set(plan.slice(0,10).map(x=>x.visual_family)).size<5&&!plan.slice(0,10).some(x=>x.visual_family===beat.visual_family)) score+=120;
      if (i<10&&beat.product_visibility==='FULL'&&plan.filter(x=>x.product_visibility==='FULL').length>=3) score-=500;
      if (scene.end-lastResetEnd>=35&&RESET.has(beat.visual_family)) score+=180;
      if (scene.end-lastResetEnd>=60&&!RESET.has(beat.visual_family)) score-=500;
      if (plan.slice(-6).every(x=>x.visual_family!==beat.visual_family)) score+=15;
      if(scene.end>=30&&candidate.treatment==='STATIC_GRAPHIC_T2V'&&!plan.some(x=>x.visual_treatment==='STATIC_GRAPHIC_T2V'))score+=220;
      if(scene.end>=30&&candidate.treatment==='MOTION_GRAPHIC_T2V'&&!plan.some(x=>x.visual_treatment==='MOTION_GRAPHIC_T2V'))score+=220;
      if(operationalEligible&&scene.end-lastOperationalEnd>=60&&OPERATIONAL.has(beat.visual_family))score+=650;
      if(operationalEligible&&scene.end-lastOperationalEnd>=90&&!OPERATIONAL.has(beat.visual_family))score-=1200;
      const targets=(handoff as any)?.visual_story_plan?.visual_balance_targets;const target=targets?.[balanceKey(beat.visual_family)];
      if(target){const used=plan.filter(x=>balanceKey(x.visual_family)===balanceKey(beat.visual_family)).length;const actual=plan.length?used/plan.length*100:0;const midpoint=(Number(target.minimum)+Number(target.maximum))/2;if(actual<midpoint)score+=Math.min(45,(midpoint-actual)*1.5);else if(actual>Number(target.maximum))score-=35;}
      const minuteFamilies=new Set(plan.filter(x=>x.number>=Math.max(1,scene.number-Math.ceil(60/Math.max(scene.duration,1)))).map(x=>x.visual_family));
      if(minuteFamilies.size<3&&!minuteFamilies.has(beat.visual_family))score+=80;
      return {candidate,stage,env,score};
    }).sort((a,b)=>b.score-a.score||a.candidate.beat.beat_order-b.candidate.beat.beat_order);
    const chosen=scored[0];
    const beat=chosen.candidate.beat;
    if(RESET.has(beat.visual_family)) lastResetEnd=scene.end;
    const isOperational=OPERATIONAL.has(beat.visual_family);
    if(isOperational){lastOperationalEnd=scene.end;operationalCount++;}
    const showdownRole=aviationEligible?showdownRoleFor(i,scenes.length,beat.visual_family,operationalCount):null;
    const plannedVisibility:ProductVisibility=showdownRole==='COCKPIT_IMMERSION'?'DETAIL_ONLY':beat.product_visibility;
    const planItem:PlannedScene={
      number:scene.number, chapter_id:chosen.candidate.chapter?.chapter_id || 'LEGACY_DOCUMENTARY',
      beat_id:chosen.candidate.sourceBeatId, visual_family:beat.visual_family,
      story_function:beat.story_function, visual_treatment:chosen.candidate.treatment,
      product_visibility:plannedVisibility, stage_id:chosen.stage, environment_ref:chosen.env,
      state:resolvePlannedState(topic,chosen.stage,plannedVisibility),
      showdown_role:showdownRole,
      energy_level:showdownRole?SHOWDOWN_ENERGY[showdownRole]:'MEDIUM',
      camera_platform:showdownRole?SHOWDOWN_PLATFORM[showdownRole]:null,
      graphic_spec:null,
    };
    planItem.graphic_spec=deriveGraphicSceneSpec(topic,scene,planItem);
    plan.push(planItem);
  }
  return plan;
}

export function summarizeScenePlan(plan: PlannedScene[]) {
  const count=(key:keyof PlannedScene)=>Object.entries(plan.reduce<Record<string,number>>((a,x)=>{const v=String(x[key]);a[v]=(a[v]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
  const operational=plan.filter(item=>OPERATIONAL.has(item.visual_family));
  const showdown=plan.filter(item=>item.showdown_role);
  const graphic=plan.filter(item=>item.graphic_spec);
  const graphicSubtypes=Object.entries(graphic.reduce<Record<string,number>>((a,item)=>{const key=String(item.graphic_spec?.graphic_subtype);a[key]=(a[key]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
  return { families:count('visual_family'), treatments:count('visual_treatment'), visibility:count('product_visibility'), showdownRoles:count('showdown_role'), graphicSubtypes, operationalScenes:operational.length, openingOperationalScenes:operational.filter(item=>item.number<=10).length, firstOperationalScene:operational[0]?.number, showdownScenes:showdown.length, graphicScenes:graphic.length };
}

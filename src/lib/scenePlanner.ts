import type { PlannedScene, ProductVisibility, StoryFunction, TimedScene, TopicBrief, VisualFamily, VisualTreatment } from '../types';
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
const balanceKey=(family:VisualFamily):string=>family==='HERO_PRODUCT'?'completed_product_hero_imagery_percent':GRAPHIC.has(family)||family==='ARCHIVAL_REFERENCE'?'graphics_and_reference_media_percent':['STATIC_GROUND_TEST','DYNAMIC_TESTING','ENVIRONMENTAL_TESTING','OPERATIONAL_CONTEXT','DELIVERY_AND_ROLLOUT'].includes(family)?'testing_and_operational_context_percent':['COMPONENT_MACRO','TOOL_LEVEL_DETAIL','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION'].includes(family)?'component_detail_and_quality_control_percent':CONTEXT.has(family)||['MATERIAL_FLOW','COMPONENT_LOGISTICS'].includes(family)?'factory_scale_and_logistics_percent':'manufacturing_and_assembly_percent';
const tokenize = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length;
const isV2 = (topic: TopicBrief): topic is TopicBrief & { _production_handoff: VisualProductionHandoffV2 } =>
  (topic._production_handoff as any)?.schema?.version === '2.0.0';

function treatmentFor(beat: V2VisualBeat): VisualTreatment {
  if (!GRAPHIC.has(beat.visual_family)) return 'LIVE_ACTION_T2V';
  const words = `${beat.beat_name} ${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')}`.toLowerCase();
  return /flow|path|sequence|motion|movement|relationship|layer|mechanism|supply|route/.test(words) ? 'MOTION_GRAPHIC_T2V' : 'STATIC_GRAPHIC_T2V';
}

function candidatesFromV2(handoff: VisualProductionHandoffV2): Candidate[] {
  const all = handoff.visual_story_plan.chapters.flatMap(chapter => chapter.visual_beats.map(beat => ({ chapter, beat })));
  const safe = all.filter(({ beat }) => beat.generation_permission === 'T2V_ALLOWED' && beat.preferred_media_routes.includes('GENERATED_T2V'));
  const normalized=all.map(({ chapter, beat }) => {
    if (beat.generation_permission === 'T2V_ALLOWED' && beat.preferred_media_routes.includes('GENERATED_T2V')) return { chapter, beat, treatment: treatmentFor(beat), sourceBeatId: beat.beat_id };
    if(GRAPHIC.has(beat.visual_family)){
      const conceptual:V2VisualBeat={...beat,beat_id:`${beat.beat_id}__T2V_SAFE`,reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,must_not_show:[...beat.must_not_show,'readable labels, numbers, logos, maps, interfaces, or precise generated data']};
      return {chapter,beat:conceptual,treatment:treatmentFor(conceptual),sourceBeatId:conceptual.beat_id};
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
    const stage=stages[fi%stages.length], graphic=GRAPHIC.has(family);
    const purpose=family==='FACTORY_AERIAL'?'establish industrial scale and location':family==='ATMOSPHERIC_INTERSTITIAL'?'reset attention with material, light, weather, and industrial atmosphere':family==='TECHNICAL_GRAPHIC'?'explain an unlabeled mechanical relationship with shapes, layers, and paths':`show ${family.toLowerCase().replaceAll('_',' ')} as physical documentary evidence`;
    const beat={beat_id:`SYNTH_${family}`,beat_order:900+fi,beat_name:`T2V-safe ${family.replaceAll('_',' ')}`,story_function:(CONTEXT.has(family)?'ESTABLISH_SCALE':RESET.has(family)?'RESET_ATTENTION':'EXPLAIN_PROCESS') as StoryFunction,visual_family:family,narrative_purpose:purpose,semantic_alignment_terms:[family,...purpose.split(' ')],applicable_stage_ids:stage.stage_id?[stage.stage_id]:[],environment_ids:stage.environment_ids||[],product_visibility:(graphic||CONTEXT.has(family)||family==='ATMOSPHERIC_INTERSTITIAL'?'NONE':family==='COMPONENT_MACRO'?'DETAIL_ONLY':family==='ASSEMBLY_PROCESS'?'PARTIAL':'FULL') as ProductVisibility,required_product_state_code:null,facility_claim_status:'CONTEXTUAL_INDUSTRIAL_VISUAL',reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,preferred_shot_scales:[],preferred_camera_movements:[],minimum_usable_duration_seconds:0,preferred_duration_seconds:10,maximum_duration_seconds:10,must_show:[],must_not_show:['readable text','invented logos','unsupported facility identity'],continuity_requirements:[],negative_constraints:[]} as V2VisualBeat;
    normalized.push({chapter:handoff.visual_story_plan.chapters[0]||null,beat,treatment:treatmentFor(beat),sourceBeatId:beat.beat_id});
  });
  return normalized;
}

function legacyCandidates(topic: TopicBrief): Candidate[] {
  const families: VisualFamily[] = ['FACTORY_EXTERIOR','ASSEMBLY_PROCESS','COMPONENT_MACRO','MACHINERY_ACTION','QUALITY_CONTROL','TECHNICAL_GRAPHIC','ATMOSPHERIC_INTERSTITIAL','OPERATIONAL_CONTEXT'];
  const stages = topic.lifecycle_stages || [];
  return (stages.length ? stages : [{ stage_id:'STAGE_01', stage_name:'Production', environment_ref: topic.environments[0]?.environment_id || 'ENV_01' } as any]).flatMap((stage, si) => families.map((family, fi) => ({
    chapter: null,
    sourceBeatId: `LEGACY_${si+1}_${fi+1}`,
    treatment: GRAPHIC.has(family) ? 'MOTION_GRAPHIC_T2V' : 'LIVE_ACTION_T2V',
    beat: { beat_id:`LEGACY_${si+1}_${fi+1}`, beat_order:fi+1, beat_name:family.replaceAll('_',' '), story_function:(fi===0?'ESTABLISH_LOCATION':fi===5?'EXPLAIN_HIDDEN_SYSTEM':fi===6?'RESET_ATTENTION':'EXPLAIN_PROCESS') as StoryFunction, visual_family:family, narrative_purpose:stage.action || stage.stage_name, semantic_alignment_terms:[stage.stage_name,stage.action || '',family], applicable_stage_ids:[stage.stage_id || `STAGE_${si+1}`], environment_ids:[stage.environment_ref], product_visibility:family==='TECHNICAL_GRAPHIC'||family==='ATMOSPHERIC_INTERSTITIAL'?'NONE':family==='COMPONENT_MACRO'?'DETAIL_ONLY':family==='ASSEMBLY_PROCESS'?'PARTIAL':'FULL', required_product_state_code:null, facility_claim_status:'CONTEXTUAL_INDUSTRIAL_VISUAL', reference_asset_ids:[], preferred_media_routes:['GENERATED_T2V'], generation_permission:'T2V_ALLOWED', exact_factory_claim_allowed:false, preferred_shot_scales:[], preferred_camera_movements:[], minimum_usable_duration_seconds:0, preferred_duration_seconds:10, maximum_duration_seconds:10, must_show:[], must_not_show:[], continuity_requirements:[], negative_constraints:[] } as V2VisualBeat,
  })));
}

function runLength<T>(items: T[], value: T): number { let count=0; for(let i=items.length-1;i>=0&&items[i]===value;i--) count++; return count; }

export function buildDocumentaryScenePlan(topic: TopicBrief, scenes: TimedScene[]): PlannedScene[] {
  const handoff = isV2(topic) ? topic._production_handoff : null;
  const candidates = handoff ? candidatesFromV2(handoff) : legacyCandidates(topic);
  const stages = handoff?.production_stages || [];
  const plan: PlannedScene[] = [];
  let lastResetEnd = 0;
  const desiredOpening = (index:number, family:VisualFamily) => index===0 ? CONTEXT.has(family) : index===2 ? PROCESS.has(family) : index===4 ? RESET.has(family) : false;
  for (let i=0;i<scenes.length;i++) {
    const scene=scenes[i], vo=tokenize(scene.text), progress=scenes.length<=1?0:i/(scenes.length-1);
    const expectedStage=stages[Math.min(stages.length-1,Math.floor(progress*Math.max(stages.length,1)))];
    const recentFamilies=plan.slice(-2).map(x=>x.visual_family), recentVisibility=plan.slice(-2).map(x=>x.product_visibility), recentEnvs=plan.slice(-3).map(x=>x.environment_ref);
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
      if (i<10&&desiredOpening(i,beat.visual_family)) score+=300;
      if (i<10&&new Set(plan.slice(0,10).map(x=>x.visual_family)).size<5&&!plan.slice(0,10).some(x=>x.visual_family===beat.visual_family)) score+=120;
      if (i<10&&beat.product_visibility==='FULL'&&plan.filter(x=>x.product_visibility==='FULL').length>=3) score-=500;
      if (scene.end-lastResetEnd>=35&&RESET.has(beat.visual_family)) score+=180;
      if (scene.end-lastResetEnd>=60&&!RESET.has(beat.visual_family)) score-=500;
      if (plan.slice(-6).every(x=>x.visual_family!==beat.visual_family)) score+=15;
      if(scene.end>=30&&candidate.treatment==='STATIC_GRAPHIC_T2V'&&!plan.some(x=>x.visual_treatment==='STATIC_GRAPHIC_T2V'))score+=220;
      if(scene.end>=30&&candidate.treatment==='MOTION_GRAPHIC_T2V'&&!plan.some(x=>x.visual_treatment==='MOTION_GRAPHIC_T2V'))score+=220;
      const targets=(handoff as any)?.visual_story_plan?.visual_balance_targets;const target=targets?.[balanceKey(beat.visual_family)];
      if(target){const used=plan.filter(x=>balanceKey(x.visual_family)===balanceKey(beat.visual_family)).length;const actual=plan.length?used/plan.length*100:0;const midpoint=(Number(target.minimum)+Number(target.maximum))/2;if(actual<midpoint)score+=Math.min(45,(midpoint-actual)*1.5);else if(actual>Number(target.maximum))score-=35;}
      const minuteFamilies=new Set(plan.filter(x=>x.number>=Math.max(1,scene.number-Math.ceil(60/Math.max(scene.duration,1)))).map(x=>x.visual_family));
      if(minuteFamilies.size<3&&!minuteFamilies.has(beat.visual_family))score+=80;
      return {candidate,stage,env,score};
    }).sort((a,b)=>b.score-a.score||a.candidate.beat.beat_order-b.candidate.beat.beat_order);
    const chosen=scored[0];
    const beat=chosen.candidate.beat;
    if(RESET.has(beat.visual_family)) lastResetEnd=scene.end;
    plan.push({ number:scene.number, chapter_id:chosen.candidate.chapter?.chapter_id || 'LEGACY_DOCUMENTARY', beat_id:chosen.candidate.sourceBeatId, visual_family:beat.visual_family, story_function:beat.story_function, visual_treatment:chosen.candidate.treatment, product_visibility:beat.product_visibility, stage_id:chosen.stage, environment_ref:chosen.env });
  }
  return plan;
}

export function summarizeScenePlan(plan: PlannedScene[]) {
  const count=(key:keyof PlannedScene)=>Object.entries(plan.reduce<Record<string,number>>((a,x)=>{const v=String(x[key]);a[v]=(a[v]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
  return { families:count('visual_family'), treatments:count('visual_treatment'), visibility:count('product_visibility') };
}

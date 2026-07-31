import type { MediaRoute, PlannedScene, TimedScene, TopicBrief, VisualTreatment } from '../types';
import type { V3Chapter, V3MediaRoute, V3VisualBeat, VisualEngineeringHandoffV3 } from '../types/visualEngineeringV3';
import { deriveGraphicSceneSpec } from './scenePlanner';
import { prepareEngineeringSceneForT2V } from './engineeringT2V';

const STOP=new Set(['the','and','that','this','with','from','into','while','through','about','then','than','only','also','must','still','each','when','where','which','their','there','have','has','had','does','not','without','show','scene','visual','product','system']);
const stem=(value:string)=>value.length>5?value.replace(/(?:ing|tion|ions|ments|ment|ed|es|s)$/,''):value;
const tokens=(value:string)=>new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).map(stem).filter(value=>!STOP.has(value)));
const overlap=(a:Set<string>,b:Set<string>)=>[...a].filter(value=>b.has(value)).length;
const text=(value:unknown)=>Array.isArray(value)?value.join(' '):String(value||'');
const GRAPHIC=new Set(['SYSTEM_CUTAWAY','AIRFLOW_VISUALIZATION','HYDRODYNAMIC_FLOW','STRUCTURAL_LOAD_PATH','PROPULSION_OR_ENERGY_FLOW','SENSOR_OR_SIGNAL_FLOW','CONTROL_RELATIONSHIP','THERMAL_OR_ENVIRONMENTAL_FLOW','SCALE_COMPARISON','TECHNICAL_GRAPHIC','MAP_OR_TIMELINE']);
const MOTION_GRAPHIC=new Set(['AIRFLOW_VISUALIZATION','HYDRODYNAMIC_FLOW','STRUCTURAL_LOAD_PATH','PROPULSION_OR_ENERGY_FLOW','SENSOR_OR_SIGNAL_FLOW','CONTROL_RELATIONSHIP','THERMAL_OR_ENVIRONMENTAL_FLOW']);
const EXACT_ROUTES=new Set<V3MediaRoute>(['REFERENCE_IMAGE_I2V','AUTHENTIC_VIDEO','REFERENCE_LOCKED_GRAPHIC','STATIC_IMAGE_WITH_MOTION']);
const READABLE=/\b(map|timeline|dimension|label|number|table|formula|interface|precise data|measurement)\b/i;

export interface EngineeringRouteResolution {route:V3MediaRoute;reason:string}

export function resolveEngineeringMediaRoute(handoff:VisualEngineeringHandoffV3,beat:V3VisualBeat):EngineeringRouteResolution {
  const claims=new Map(handoff.evidence_boundaries.claims.map(claim=>[claim.claim_id,claim]));
  const referenced=beat.evidence_claim_ids.map(id=>claims.get(id)).filter(Boolean);
  if(beat.generation_permission==='NOT_ALLOWED'||referenced.some(claim=>claim?.visualization_permission==='NOT_ALLOWED'||claim?.wording_permission==='EXCLUDE'))
    return {route:'NO_VALID_ROUTE',reason:'Evidence or generation permission blocks visualization.'};
  if(READABLE.test(`${beat.narrative_purpose} ${beat.must_show.join(' ')}`))
    return beat.preferred_media_routes.includes('EDITOR_NATIVE_GRAPHIC')
      ?{route:'EDITOR_NATIVE_GRAPHIC',reason:'Readable or precise material requires an editor-native graphic.'}
      :{route:'NO_VALID_ROUTE',reason:'Readable or precise material has no editor-native route.'};
  const genericOnly=referenced.some(claim=>claim?.claim_type==='GENERAL_PRINCIPLE'||claim?.visualization_permission==='GENERIC_PRINCIPLE_ONLY');
  if(beat.visual_family==='SYSTEM_CUTAWAY'&&!genericOnly){
    const supported=beat.reference_asset_ids.some(id=>handoff.reference_assets.some(asset=>asset.asset_id===id&&asset.visual_verification==='PASS'&&asset.visible_geometry_features.length>0));
    if(!supported)return {route:'NO_VALID_ROUTE',reason:'Exact internal cutaway lacks verified product-specific reference media.'};
  }
  if(beat.exact_event_or_location_claim_allowed){
    const verified=beat.reference_asset_ids.some(id=>handoff.reference_assets.some(asset=>asset.asset_id===id&&asset.visual_verification==='PASS'&&asset.exact_event_or_location_verified));
    const route=beat.preferred_media_routes.find(value=>EXACT_ROUTES.has(value));
    return verified&&route?{route,reason:'Verified exact context uses authentic or reference-locked media.'}:{route:'NO_VALID_ROUTE',reason:'Exact event or location is not fully reference-verified.'};
  }
  if(beat.generation_permission==='EDITOR_ONLY')
    return beat.preferred_media_routes.includes('EDITOR_NATIVE_GRAPHIC')?{route:'EDITOR_NATIVE_GRAPHIC',reason:'Beat is explicitly editor-only.'}:{route:'NO_VALID_ROUTE',reason:'Editor-only beat has no editor route.'};
  if(beat.generation_permission==='REFERENCE_REQUIRED'){
    if(!beat.reference_asset_ids.length)return {route:'NO_VALID_ROUTE',reason:'Reference-required beat has no supporting asset.'};
    const route=beat.preferred_media_routes.find(value=>value!=='GENERATED_T2V'&&value!=='NO_VALID_ROUTE');
    return route?{route,reason:'Reference-required evidence uses a reference-supported route.'}:{route:'NO_VALID_ROUTE',reason:'Reference-required beat has no valid reference route.'};
  }
  if(genericOnly&&beat.product_visibility!=='NONE'&&beat.visual_family==='SYSTEM_CUTAWAY')
    return {route:'NO_VALID_ROUTE',reason:'A general principle cannot become an exact product cutaway.'};
  if(beat.preferred_media_routes.includes('GENERATED_T2V'))return {route:'GENERATED_T2V',reason:'Contextual or observable beat is permitted for generated T2V.'};
  const route=beat.preferred_media_routes.find(value=>value!=='NO_VALID_ROUTE');
  return route?{route,reason:'Using the first permitted preferred media route.'}:{route:'NO_VALID_ROUTE',reason:'No truthful media route is available.'};
}

function explicitChapter(textValue:string):number|null{
  const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const match=textValue.toLowerCase().match(/\bchapter\s+(?:(\d{1,2})|(one|two|three|four|five|six|seven|eight|nine|ten))\b/);
  if(!match)return null;
  return (match[1]?Number(match[1]):words[match[2]])-1;
}
const chapterText=(chapter:V3Chapter)=>[chapter.chapter_name,chapter.narrative_goal,chapter.chapter_question,chapter.observable_clue,chapter.physical_constraint,chapter.design_response,chapter.system_interaction,chapter.tradeoff,chapter.evidence_resolution,chapter.chapter_payoff,...chapter.visual_beats.flatMap(beat=>[beat.beat_name,beat.narrative_purpose,...beat.semantic_alignment_terms])].join(' ');
function alignChapters(handoff:VisualEngineeringHandoffV3,scenes:TimedScene[]):V3Chapter[]{
  const chapters=[...handoff.visual_story_plan.chapters].sort((a,b)=>a.chapter_order-b.chapter_order);
  let current=0;const hasExplicit=scenes.some(scene=>explicitChapter(scene.text)!==null);
  return scenes.map(scene=>{
    const explicit=explicitChapter(scene.text);
    if(explicit!==null&&explicit>=current&&explicit<chapters.length)current=explicit;
    else if(!hasExplicit&&current<chapters.length-1){
      const sceneTokens=tokens(scene.text),currentScore=overlap(sceneTokens,tokens(chapterText(chapters[current])));
      const nextScore=overlap(sceneTokens,tokens(chapterText(chapters[current+1])));
      if(nextScore>=4&&nextScore>=currentScore+3)current++;
    }
    return chapters[current];
  });
}
const beatScore=(scene:TimedScene,beat:V3VisualBeat,chapter:V3Chapter)=>{
  const value=[beat.beat_name,beat.narrative_purpose,...beat.semantic_alignment_terms,...beat.must_show,chapter.observable_clue,chapter.physical_constraint,chapter.design_response,chapter.system_interaction,chapter.tradeoff].join(' ');
  return overlap(tokens(scene.text),tokens(value));
};
const treatmentFor=(beat:V3VisualBeat):VisualTreatment=>MOTION_GRAPHIC.has(beat.visual_family)?'MOTION_GRAPHIC_T2V':GRAPHIC.has(beat.visual_family)?'STATIC_GRAPHIC_T2V':'LIVE_ACTION_T2V';
const runLength=<T>(items:T[],value:T)=>{let count=0;for(let index=items.length-1;index>=0&&items[index]===value;index--)count++;return count;};

export function buildEngineeringScenePlan(topic:TopicBrief,scenes:TimedScene[]):PlannedScene[]{
  const handoff=topic._production_handoff as VisualEngineeringHandoffV3;
  if(handoff?.schema?.version!=='3.0.0')throw new Error('Engineering V3 planner requires a validated 3.0.0 handoff.');
  const chapters=alignChapters(handoff,scenes),plan:PlannedScene[]=[];
  const relationships=handoff.system_relationships,bridges=handoff.concept_bridges;
  scenes.forEach((scene,index)=>{
    const chapter=chapters[index],sceneTokens=tokens(scene.text);
    const candidates=chapter.visual_beats
      .filter(beat=>!chapter.forbidden_visual_families.includes(beat.visual_family))
      .map(beat=>({beat,route:resolveEngineeringMediaRoute(handoff,beat),semantic:beatScore(scene,beat,chapter)}));
    const maxFamily=handoff.visual_story_plan.rhythm_policy.maximum_consecutive_same_visual_family;
    const maxFull=handoff.visual_story_plan.rhythm_policy.maximum_consecutive_full_product_scenes;
    const ranked=candidates.map(candidate=>{
      const beat=candidate.beat;
      let score=candidate.semantic*18-Math.abs((beat.beat_order/Math.max(chapter.visual_beats.length,1))-(index/Math.max(scenes.length-1,1)))*2;
      if(plan.at(-1)?.beat_id===beat.beat_id)score+=10;
      else if(plan.at(-1)?.visual_family===beat.visual_family)score+=5;
      if(runLength(plan.map(item=>item.visual_family),beat.visual_family)>=maxFamily)score-=22;
      if(beat.product_visibility==='FULL'&&runLength(plan.map(item=>item.product_visibility),beat.product_visibility)>=maxFull)score-=20;
      if(scene.duration<beat.minimum_usable_duration_seconds)score-=30;
      if(scene.duration>beat.maximum_duration_seconds)score-=10;
      return {...candidate,score};
    }).sort((a,b)=>b.score-a.score||a.beat.beat_order-b.beat.beat_order);
    const preferred=ranked[0];
    if(!preferred)throw new Error(`Chapter ${chapter.chapter_id} has no visual beats.`);
    const purposeTokens=tokens(preferred.beat.narrative_purpose);
    const truthfulAlternative=ranked.find(candidate=>
      candidate.route.route!=='NO_VALID_ROUTE'
      &&(candidate.beat.story_function===preferred.beat.story_function
        ||overlap(purposeTokens,tokens(candidate.beat.narrative_purpose))>=2)
    );
    const selected=preferred.route.route==='NO_VALID_ROUTE'?(truthfulAlternative||preferred):preferred;
    const beat=selected.beat,systemSet=new Set(beat.applicable_engineering_system_ids);
    const relationship=relationships
      .filter(item=>systemSet.has(item.from_system_id)&&systemSet.has(item.to_system_id)&&item.visualization_permission!=='NOT_ALLOWED')
      .sort((a,b)=>overlap(sceneTokens,tokens(`${a.relationship_summary} ${a.physical_or_information_path} ${a.observable_evidence.join(' ')} ${a.tradeoff}`))-overlap(sceneTokens,tokens(`${b.relationship_summary} ${b.physical_or_information_path} ${b.observable_evidence.join(' ')} ${b.tradeoff}`))).at(-1);
    const bridge=bridges.find(item=>systemSet.has(item.from_system_id)&&systemSet.has(item.to_system_id));
    const routedBase:PlannedScene={
      number:scene.number,handoff_mode:'ENGINEERING_V3',chapter_id:chapter.chapter_id,beat_id:beat.beat_id,
      visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:treatmentFor(beat),
      product_visibility:beat.product_visibility,environment_ref:beat.environment_ids[0]||handoff.environments[0]?.environment_id||'',
      engineering_system_ids:[...beat.applicable_engineering_system_ids],operational_state_ids:[...beat.applicable_operational_state_ids],
      evidence_claim_ids:[...beat.evidence_claim_ids],geometry_module_ids:[...beat.geometry_module_ids],
      relationship_id:relationship?.relationship_id||null,concept_bridge_id:bridge?.bridge_id||null,
      truth_status:beat.context_truth_status,generation_permission:beat.generation_permission,
      media_route:selected.route.route as MediaRoute,route_reason:selected.route.reason,
      showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,
    };
    const base=prepareEngineeringSceneForT2V(routedBase);
    base.graphic_spec=GRAPHIC.has(beat.visual_family)?deriveGraphicSceneSpec(topic,scene,base):null;
    plan.push(base);
  });
  return plan;
}

export function summarizeEngineeringRoutes(plan:PlannedScene[]){
  const counts=new Map<string,number>();
  plan.forEach(item=>counts.set(item.media_route||'NO_VALID_ROUTE',(counts.get(item.media_route||'NO_VALID_ROUTE')||0)+1));
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]);
}

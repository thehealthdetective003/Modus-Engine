import type { PlannedScene, TopicBrief } from '../types';
import type { VisualEngineeringHandoffV3 } from '../types/visualEngineeringV3';
import { prepareEngineeringSceneForT2V } from './engineeringT2V';

export function buildEngineeringDirectionContext(topic:TopicBrief,plan:PlannedScene[]){
  const handoff=topic._production_handoff as VisualEngineeringHandoffV3;
  const effectivePlan=plan.map(prepareEngineeringSceneForT2V);
  const systems=new Set(effectivePlan.flatMap(item=>item.engineering_system_ids||[]));
  const states=new Set(effectivePlan.flatMap(item=>item.operational_state_ids||[]));
  const claims=new Set(effectivePlan.filter(item=>!item.t2v_substitution).flatMap(item=>item.evidence_claim_ids||[]));
  const modules=new Set(effectivePlan.flatMap(item=>item.geometry_module_ids||[]));
  const environments=new Set(effectivePlan.map(item=>item.environment_ref));
  const relationships=new Set(effectivePlan.map(item=>item.relationship_id).filter(Boolean));
  const bridges=new Set(effectivePlan.map(item=>item.concept_bridge_id).filter(Boolean));
  const beats=new Set(effectivePlan.map(item=>item.beat_id));
  const referenceIds=new Set<string>();
  handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats).filter(beat=>beats.has(beat.beat_id)&&!effectivePlan.some(item=>item.beat_id===beat.beat_id&&item.t2v_substitution)).forEach(beat=>beat.reference_asset_ids.forEach(id=>referenceIds.add(id)));
  handoff.geometry_modules.filter(module=>modules.has(module.module_id)).forEach(module=>module.reference_asset_ids.forEach(id=>referenceIds.add(id)));
  return {
    schema:handoff.schema,product:handoff.product,dimensions_and_proportions:handoff.dimensions_and_proportions,
    evidence_boundaries:{...handoff.evidence_boundaries,claims:handoff.evidence_boundaries.claims.filter(claim=>claims.has(claim.claim_id))},
    geometry_modules:handoff.geometry_modules.filter(module=>modules.has(module.module_id)),
    reference_assets:handoff.reference_assets.filter(asset=>referenceIds.has(asset.asset_id)),
    environments:handoff.environments.filter(environment=>environments.has(environment.environment_id)),
    engineering_systems:handoff.engineering_systems.filter(system=>systems.has(system.system_id)),
    operational_states:handoff.operational_states.filter(state=>states.has(state.state_id)),
    system_relationships:handoff.system_relationships.filter(relationship=>relationships.has(relationship.relationship_id)),
    concept_bridges:handoff.concept_bridges.filter(bridge=>bridges.has(bridge.bridge_id)),
    selected_beats:handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats).filter(beat=>beats.has(beat.beat_id)).map(beat=>{
      const scene=effectivePlan.find(item=>item.beat_id===beat.beat_id);
      if(!scene?.t2v_substitution)return beat;
      return {...beat,narrative_purpose:`Qualitative T2V-safe substitute for ${beat.story_function.toLowerCase().replaceAll('_',' ')}. Do not reproduce exact source data or claims.`,evidence_claim_ids:[],reference_asset_ids:[],generation_permission:'T2V_ALLOWED' as const,preferred_media_routes:['GENERATED_T2V' as const],exact_event_or_location_claim_allowed:false,product_visibility:scene.product_visibility};
    }),
    planned_scenes:effectivePlan,
    evidence_visualization_policy:handoff.visual_story_plan.evidence_visualization_policy,
    media_routing_policy:handoff.visual_story_plan.media_routing_policy,
    global_prompt_rules:handoff.global_prompt_rules,
  };
}

export const ENGINEERING_DIRECTION_INSTRUCTION=`You direct evidence-led engineering documentary scenes from a validated Modus Engineering V3 plan. Return one object per planned scene, in order, and copy each scene number exactly. Return only the requested creative fields; never return or change mode, chapter, beat, engineering-system IDs, operational-state IDs, evidence-claim IDs, relationship, bridge, truth status, generation permission, media route, timing, or VO.

Illustrate the exact engineering claim in the scene rather than the general product topic. Engineering systems are explanatory modules, operational states are stable observable configurations, system relationships are forces, flows, signals, dependencies, causes, or trade-offs, and concept bridges connect ideas without physical transformation. Never reinterpret them as manufacturing stages or component installation.

For GENERATED_T2V scenes, use the smallest assigned geometry module, one stable product configuration, one primary camera-visible action or relationship, no more than one minor supporting action, and one physically compatible camera movement. Establish a visible opening, meaningful midpoint event, physical or environmental response, and stable ending. Preserve exact product count, immutable geometry, configuration, appendages, and markings. Use a generic non-identifying environment unless exact context is explicitly verified.

Evidence is authoritative. GENERAL_PRINCIPLE and GENERIC_PRINCIPLE_ONLY material must remain a separate generic visualization and cannot prove the product's internal implementation. QUALIFIED or analyst-inferred material must remain visibly plausible and non-definitive. Never invent unknown internals. External observation does not automatically prove function. Exact events, locations, internal views, geometry, or markings require their assigned verified reference route.

Every planned scene is delivered to Phase 3 as T2V. When t2v_substitution is EDITOR_DATA_TO_TEXT_FREE_GRAPHIC, convert the editorial evidence target into a complete qualitative technical animation made only from the supplied physical primitives: omit readable labels, values, scales, maps, tables, formulas, interfaces, and precise data. When it is REFERENCE_TO_CONTEXTUAL_T2V, create a contextual reconstruction that preserves supported external identity but does not claim an exact source image, event, location, marking, or proprietary internal detail. When it is BLOCKED_TO_NEUTRAL_CONTEXT, do not visualize the blocked claim or product; create only a neutral engineering-context transition. Never request later editor work, fake labels, decorative pseudo-technical complexity, or an exact unsupported cutaway.

Use physical, camera-visible language. Do not copy or paraphrase the narration into the visual. Do not add dialogue, narration, music, combat, explosions, unsupported events, unsupported locations, unsupported variants, or proprietary details.`;

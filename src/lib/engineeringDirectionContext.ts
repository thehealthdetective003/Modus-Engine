import type { PlannedScene, TopicBrief } from '../types';
import type { VisualEngineeringHandoffV3 } from '../types/visualEngineeringV3';

export function buildEngineeringDirectionContext(topic:TopicBrief,plan:PlannedScene[]){
  const handoff=topic._production_handoff as VisualEngineeringHandoffV3;
  const systems=new Set(plan.flatMap(item=>item.engineering_system_ids||[]));
  const states=new Set(plan.flatMap(item=>item.operational_state_ids||[]));
  const claims=new Set(plan.flatMap(item=>item.evidence_claim_ids||[]));
  const modules=new Set(plan.flatMap(item=>item.geometry_module_ids||[]));
  const environments=new Set(plan.map(item=>item.environment_ref));
  const relationships=new Set(plan.map(item=>item.relationship_id).filter(Boolean));
  const bridges=new Set(plan.map(item=>item.concept_bridge_id).filter(Boolean));
  const beats=new Set(plan.map(item=>item.beat_id));
  const referenceIds=new Set<string>();
  handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats).filter(beat=>beats.has(beat.beat_id)).forEach(beat=>beat.reference_asset_ids.forEach(id=>referenceIds.add(id)));
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
    selected_beats:handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats).filter(beat=>beats.has(beat.beat_id)),
    evidence_visualization_policy:handoff.visual_story_plan.evidence_visualization_policy,
    media_routing_policy:handoff.visual_story_plan.media_routing_policy,
    global_prompt_rules:handoff.global_prompt_rules,
  };
}

export const ENGINEERING_DIRECTION_INSTRUCTION=`You direct evidence-led engineering documentary scenes from a validated Modus Engineering V3 plan. Return one object per planned scene, in order, and copy each scene number exactly. Return only the requested creative fields; never return or change mode, chapter, beat, engineering-system IDs, operational-state IDs, evidence-claim IDs, relationship, bridge, truth status, generation permission, media route, timing, or VO.

Illustrate the exact engineering claim in the scene rather than the general product topic. Engineering systems are explanatory modules, operational states are stable observable configurations, system relationships are forces, flows, signals, dependencies, causes, or trade-offs, and concept bridges connect ideas without physical transformation. Never reinterpret them as manufacturing stages or component installation.

For GENERATED_T2V scenes, use the smallest assigned geometry module, one stable product configuration, one primary camera-visible action or relationship, no more than one minor supporting action, and one physically compatible camera movement. Establish a visible opening, meaningful midpoint event, physical or environmental response, and stable ending. Preserve exact product count, immutable geometry, configuration, appendages, and markings. Use a generic non-identifying environment unless exact context is explicitly verified.

Evidence is authoritative. GENERAL_PRINCIPLE and GENERIC_PRINCIPLE_ONLY material must remain a separate generic visualization and cannot prove the product's internal implementation. QUALIFIED or analyst-inferred material must remain visibly plausible and non-definitive. Never invent unknown internals. External observation does not automatically prove function. Exact events, locations, internal views, geometry, or markings require their assigned verified reference route.

For editor, reference, authentic-video, static-image, or NO_VALID_ROUTE scenes, describe only the truthful visual target and its constraints; do not convert it into a generated-video concept. Text-free generated technical graphics may show one general force, flow, signal, load path, or control relationship. Readable maps, timelines, dimensions, labels, numbers, tables, formulas, interfaces, and precise data remain editor-native. Never request fake labels, readable generated text, decorative pseudo-technical complexity, or an exact unsupported cutaway.

Use physical, camera-visible language. Do not copy or paraphrase the narration into the visual. Do not add dialogue, narration, music, combat, explosions, unsupported events, unsupported locations, unsupported variants, or proprietary details.`;

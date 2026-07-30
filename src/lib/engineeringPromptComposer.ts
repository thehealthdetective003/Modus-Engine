import type { OmniPromptSections, SceneDirection, T2VPromptProfile, TopicBrief } from '../types';
import type { V3EvidenceClaim, V3VisualBeat, VisualEngineeringHandoffV3 } from '../types/visualEngineeringV3';

const clean=(value:unknown)=>String(value??'').replace(/\[object Object\]/gi,'').replace(/\s+/g,' ').trim();
const sentence=(value:unknown)=>{
  const result=clean(value).replace(/\s+([,.;:!?])/g,'$1').replace(/([,.;:!?])\1+/g,'$1').replace(/\s*[,;:]\s*$/,'');
  if(!result)return '';
  const capital=result[0].toUpperCase()+result.slice(1);
  return /[.!?]$/.test(capital)?capital:`${capital}.`;
};
const unique=(values:unknown[])=>{
  const seen=new Set<string>();
  return values.flatMap(value=>Array.isArray(value)?value:[value]).map(clean).filter(value=>{
    const key=value.toLowerCase().replace(/^(no|avoid|exclude|do not)\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();
    if(!key||seen.has(key))return false;seen.add(key);return true;
  });
};
const list=(values:string[])=>values.length<2?(values[0]||''):values.length===2?`${values[0]} and ${values[1]}`:`${values.slice(0,-1).join(', ')}, and ${values.at(-1)}`;
const handoffFor=(topic:TopicBrief|null)=>topic?._production_handoff as VisualEngineeringHandoffV3;
const beatFor=(handoff:VisualEngineeringHandoffV3,direction:SceneDirection):V3VisualBeat|undefined=>handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats).find(beat=>beat.beat_id===direction.beat_id);
const claimsFor=(handoff:VisualEngineeringHandoffV3,direction:SceneDirection):V3EvidenceClaim[]=>{
  const ids=new Set(direction.evidence_claim_ids||[]);
  return handoff.evidence_boundaries.claims.filter(claim=>ids.has(claim.claim_id)&&claim.visualization_permission!=='NOT_ALLOWED'&&claim.wording_permission!=='EXCLUDE');
};

export function buildEngineeringPromptContext(topic:TopicBrief|null,directions:SceneDirection[]){
  const handoff=handoffFor(topic);
  if(!handoff||handoff.schema?.version!=='3.0.0')return null;
  return {
    mode:'ENGINEERING_V3',
    schema:handoff.schema,
    product:handoff.product,
    dimensions_and_proportions:handoff.dimensions_and_proportions,
    global_prompt_rules:handoff.global_prompt_rules,
    evidence_policy:handoff.visual_story_plan.evidence_visualization_policy,
    scenes:directions.map(direction=>{
      const beat=beatFor(handoff,direction);
      const systemIds=new Set(direction.engineering_system_ids||[]),stateIds=new Set(direction.operational_state_ids||[]);
      const moduleIds=new Set(direction.geometry_module_ids||[]);
      const referenceIds=new Set(beat?.reference_asset_ids||[]);
      const environment=handoff.environments.find(item=>item.environment_id===direction.environment_ref);
      return {
        number:direction.number,duration:direction.duration,visual_family:direction.visual_family,story_function:direction.story_function,
        visual_treatment:direction.visual_treatment,product_visibility:direction.product_visibility,
        subject:direction.subject,product_visual_state:direction.product_visual_state,primary_action:direction.primary_action,
        supporting_motion:direction.supporting_motion,environment_description:direction.environment_description,camera:direction.camera,
        lighting_and_material:direction.lighting_and_material,continuity_from_previous:direction.continuity_from_previous,
        transition_to_next:direction.transition_to_next,required_visible_features:direction.required_visible_features,
        forbidden_elements:direction.forbidden_elements,temporal_action:direction.temporal_action,
        media_route:direction.media_route,generation_permission:direction.generation_permission,truth_status:direction.truth_status,
        selected_beat:beat,
        engineering_systems:handoff.engineering_systems.filter(item=>systemIds.has(item.system_id)),
        operational_states:handoff.operational_states.filter(item=>stateIds.has(item.state_id)),
        geometry_modules:handoff.geometry_modules.filter(item=>moduleIds.has(item.module_id)),
        relationship:handoff.system_relationships.find(item=>item.relationship_id===direction.relationship_id)||null,
        concept_bridge:handoff.concept_bridges.find(item=>item.bridge_id===direction.concept_bridge_id)||null,
        evidence_claims:claimsFor(handoff,direction),
        environment,
        reference_assets:handoff.reference_assets.filter(item=>referenceIds.has(item.asset_id)),
      };
    }),
  };
}

function productIdentity(handoff:VisualEngineeringHandoffV3,direction:SceneDirection){
  const product=handoff.product;
  const official=clean(product.official_name),variant=clean(product.exact_variant_or_configuration);
  const name=variant&&variant.toLowerCase().startsWith(official.toLowerCase())?variant:[official,variant].filter(Boolean).join(' ');
  const moduleIds=new Set(direction.geometry_module_ids||[]);
  const modules=handoff.geometry_modules.filter(module=>moduleIds.has(module.module_id));
  const anchors=unique([direction.required_visible_features,modules[0]?.required_visible_features,product.immutable_identity_features]).slice(0,6);
  return {name,anchors,smallestModule:modules[0]};
}
function qualificationClause(claims:V3EvidenceClaim[]){
  const generic=claims.some(claim=>claim.claim_type==='GENERAL_PRINCIPLE'||claim.visualization_permission==='GENERIC_PRINCIPLE_ONLY');
  const inferred=claims.some(claim=>claim.claim_type==='PRODUCT_INFERENCE'||claim.confidence==='ANALYST_INFERRED'||claim.wording_permission==='QUALIFIED');
  return generic?'Present the engineering relationship as a separate generic principle and do not imply an exact product-specific internal implementation.':inferred?'Present product-specific interpretation only as a plausible visual inference, not a confirmed internal fact.':'';
}

export function compileEngineeringOmniPrompt(raw:Partial<OmniPromptSections>,direction:SceneDirection,topic:TopicBrief|null):{sections:OmniPromptSections;prompt:string}{
  const handoff=handoffFor(topic);
  if(!handoff||handoff.schema?.version!=='3.0.0')throw new Error('Engineering prompt compilation requires a validated V3 handoff.');
  if(direction.media_route!=='GENERATED_T2V'||direction.generation_permission!=='T2V_ALLOWED')throw new Error(`Scene ${direction.number} is routed to ${direction.media_route||'NO_VALID_ROUTE'} and cannot produce a generated T2V prompt.`);
  const beat=beatFor(handoff,direction),claims=claimsFor(handoff,direction),identity=productIdentity(handoff,direction);
  const state=handoff.operational_states.find(item=>(direction.operational_state_ids||[]).includes(item.state_id));
  const relationship=handoff.system_relationships.find(item=>item.relationship_id===direction.relationship_id);
  const bridge=handoff.concept_bridges.find(item=>item.bridge_id===direction.concept_bridge_id);
  const environment=handoff.environments.find(item=>item.environment_id===direction.environment_ref);
  const genericEnvironment=environment&&['EXACT_EVENT_VERIFIED','EXACT_LOCATION_VERIFIED'].includes(environment.context_truth_status)
    ?environment.environment_name
    :`a generic non-identifying ${environment?.environment_type||direction.environment_description||'operational environment'}`;
  const temporal=direction.temporal_action;
  const action=state
    ?`${state.opening_state}. ${state.primary_action}. Midway, ${state.midpoint_event}; ${state.propulsion_or_control_behavior}. ${state.physical_environmental_response}. End with ${state.stable_ending_state}`
    :temporal?`${temporal.opening_state}. ${temporal.primary_motion}; ${temporal.physical_interaction}. Midway, ${temporal.mid_shot_progression}. End with ${temporal.ending_state}`
    :direction.primary_action;
  const evidenceQualification=qualificationClause(claims);
  const positiveGeometry=identity.anchors.length?`Keep ${list(identity.anchors)} clearly visible`:direction.product_visual_state;
  const relationshipText=relationship?`${relationship.relationship_summary}. Show ${relationship.physical_or_information_path} through observable evidence only: ${relationship.observable_evidence.join(', ')}`:bridge?`${bridge.bridge_logic}. Preserve ${bridge.shared_visual_anchor} as a conceptual continuity anchor without morphing one system into another`:'';
  const sound=direction.visual_treatment==='LIVE_ACTION_T2V'
    ?'Generate synchronized physical and environmental sound appropriate to the visible action'
    :'Use restrained synchronized abstract engineering sound with no speech or musical score';
  const exclusions=unique([direction.forbidden_elements,beat?.must_not_show,beat?.negative_constraints,identity.smallestModule?.forbidden_geometry_changes,identity.smallestModule?.likely_wrong_substitutions,handoff.product.visually_similar_products_to_avoid,handoff.product.global_negative_constraints,'dialogue','narration','music','readable generated text','invented internal systems','geometry morphing']).slice(0,12);
  const camera=state?[state.preferred_shot_scales[0],state.camera_platform_options[0],state.preferred_camera_movements[0]].filter(Boolean).join(', '):`${direction.camera.shot_scale}, ${direction.camera.angle}, ${direction.camera.lens}, ${direction.camera.movement}`;
  const sections:OmniPromptSections={
    cinematography:clean(raw.cinematography)||`Use one physically compatible camera instruction: ${camera}`,
    subject:`Show exactly the ${identity.name} in one stable configuration. ${positiveGeometry}`,
    action:[clean(raw.action)||action,relationshipText,evidenceQualification].filter(Boolean).join('. '),
    environment:`Set the scene in ${genericEnvironment}. ${environment?.weather_and_atmosphere||''} ${environment?.ground_water_or_surface||''}`,
    style_lighting:clean(raw.style_lighting)||`${direction.lighting_and_material}. Use evidence-led photorealistic engineering-documentary treatment`,
    product_state:state?`Preserve this exact operational configuration: ${state.product_configuration}. Do not change ${list(state.forbidden_configuration_changes)}`:`Preserve one stable product configuration and exact product count`,
    sound,
    exclusions:list(exclusions.map(value=>value.replace(/^(no|avoid|exclude|do not)\s+/i,''))),
  };
  const parts=[`${Number(direction.duration.toFixed(3))}-second continuous shot.`,sections.cinematography,sections.subject,sections.action,sections.environment,sections.style_lighting,sections.product_state,sections.sound,'Exclude dialogue, narration, music, and readable generated text',sections.exclusions?`Exclude ${sections.exclusions}`:''];
  const seen=new Set<string>();
  const prompt=parts.map(sentence).filter(Boolean).filter(part=>{const key=part.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(seen.has(key))return false;seen.add(key);return true;}).join(' ');
  return {sections,prompt};
}

export function finalizeEngineeringPrompt(generated:string,direction:SceneDirection,topic:TopicBrief|null,profile:T2VPromptProfile):string{
  const cleanGenerated=clean(generated)
    .replace(/(?:exact\s+)?\d+(?:\.\d+)?[-\s]second(?:\s+continuous)?\s+shot[.:]?/gi,' ')
    .replace(/\b(?:voiceover|narration|transcript)\s*:[^.!?]*(?:[.!?]|$)/gi,' ')
    .trim();
  const base=compileEngineeringOmniPrompt({action:cleanGenerated},direction,topic).prompt;
  return profile==='veo-flow'?base.replace('Use evidence-led photorealistic engineering-documentary treatment.','Use concise cinematic Veo composition with evidence-led photorealistic engineering-documentary treatment.'):base;
}

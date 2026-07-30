export type V3Confidence='CONFIRMED'|'CORROBORATED'|'CREATOR_PROVIDED'|'ANALYST_INFERRED'|'UNKNOWN';
export type V3ClaimType='FACT'|'OBSERVATION'|'GENERAL_PRINCIPLE'|'PRODUCT_INFERENCE'|'UNKNOWN';
export type V3ClaimScope='PRODUCT_SPECIFIC'|'OBSERVED_FROM_REFERENCE'|'GENERAL_ENGINEERING'|'COMPARATIVE_CONTEXT';
export type V3WordingPermission='DIRECT'|'QUALIFIED'|'CONTEXT_ONLY'|'EXCLUDE';
export type V3VisualizationPermission='EXACT_ALLOWED'|'REFERENCE_REQUIRED'|'GENERIC_PRINCIPLE_ONLY'|'NOT_ALLOWED';
export type V3ContextTruthStatus='EXACT_EVENT_VERIFIED'|'EXACT_LOCATION_VERIFIED'|'ENVIRONMENT_TYPE_CORROBORATED'|'CONTEXTUAL_NON_IDENTIFYING'|'UNUSABLE';
export type V3VisualFamily='OPERATIONAL_CONTEXT'|'DYNAMIC_TESTING'|'STATIC_TESTING'|'FULL_PRODUCT_GEOMETRY'|'EXTERNAL_FEATURE_DETAIL'|'COMPONENT_REFERENCE'|'SYSTEM_CUTAWAY'|'AIRFLOW_VISUALIZATION'|'HYDRODYNAMIC_FLOW'|'STRUCTURAL_LOAD_PATH'|'PROPULSION_OR_ENERGY_FLOW'|'SENSOR_OR_SIGNAL_FLOW'|'CONTROL_RELATIONSHIP'|'THERMAL_OR_ENVIRONMENTAL_FLOW'|'SCALE_COMPARISON'|'HUMAN_OPERATION'|'PROGRAM_CONTEXT'|'TECHNICAL_GRAPHIC'|'MAP_OR_TIMELINE'|'ARCHIVAL_REFERENCE'|'HERO_PRODUCT'|'CHAPTER_TRANSITION'|'ATMOSPHERIC_INTERSTITIAL';
export type V3StoryFunction='OPENING_HOOK'|'ESTABLISH_CONTEXT'|'INTRODUCE_MYSTERY'|'ESTABLISH_SCALE'|'SHOW_GEOMETRY'|'EXPLAIN_PRINCIPLE'|'EXPLAIN_SYSTEM'|'SHOW_RELATIONSHIP'|'SHOW_TRADEOFF'|'SHOW_EVIDENCE'|'SHOW_HUMAN_SCALE'|'COMPARE_SYSTEMS'|'BRIDGE_CONCEPT'|'RESET_ATTENTION'|'PREVIEW_PAYOFF'|'DELIVER_PAYOFF'|'CONCLUDE_CHAPTER';
export type V3SystemCategory='MISSION_AND_ENVIRONMENT'|'GEOMETRY_AND_FLOW'|'STRUCTURE_AND_LOADS'|'PROPULSION_AND_POWER'|'CONTROL_AND_STABILITY'|'SENSORS_AND_MISSION_SYSTEMS'|'THERMAL_AND_ENVIRONMENTAL'|'HUMAN_OPERATION'|'TEST_AND_VALIDATION'|'SYSTEM_TRADEOFF'|'OTHER';
export type V3RelationshipType='FORCE'|'AIRFLOW'|'HYDRODYNAMIC'|'STRUCTURAL_LOAD'|'ENERGY'|'THERMAL'|'CONTROL_SIGNAL'|'SENSOR_DATA'|'SPATIAL'|'CAUSE_AND_EFFECT'|'TRADEOFF';
export type V3ProductVisibility='NONE'|'PARTIAL'|'FULL'|'DETAIL_ONLY';
export type V3GenerationPermission='T2V_ALLOWED'|'REFERENCE_REQUIRED'|'EDITOR_ONLY'|'NOT_ALLOWED';
export type V3MediaRoute='GENERATED_T2V'|'REFERENCE_IMAGE_I2V'|'AUTHENTIC_VIDEO'|'EDITOR_NATIVE_GRAPHIC'|'REFERENCE_LOCKED_GRAPHIC'|'STATIC_IMAGE_WITH_MOTION'|'NO_VALID_ROUTE';

export interface V3Measurement { value:number|null;unit:string;confidence:V3Confidence }
export interface V3Product {
  official_name:string;exact_variant_or_configuration:string;product_class:string;
  developer_or_design_authority_if_confirmed:string;operator_or_customer_if_confirmed:string;program_status:string;
  aliases:string[];overall_visual_description:string;immutable_identity_features:string[];
  visually_similar_products_to_avoid:string[];global_negative_constraints:string[];
}
export interface V3EvidenceClaim {
  claim_id:string;claim:string;claim_type:V3ClaimType;claim_scope:V3ClaimScope;
  source_url_or_creator_reference:string;source_tier:'Tier 1'|'Tier 2'|'Tier 3'|'Tier 4'|'Tier 5'|'Creator Provided';
  confidence:V3Confidence;wording_permission:V3WordingPermission;visualization_permission:V3VisualizationPermission;
  qualifier_required:string;notes:string;
}
export interface V3EvidenceBoundaries {
  overall_evidence_ceiling:string;confirmed_product_specific_scope:string[];observable_scope:string[];
  general_principles_allowed:string[];qualified_product_inferences:string[];unknowns:string[];
  excluded_claims:string[];claims:V3EvidenceClaim[];
}
export interface V3Dimensions {
  overall_length:V3Measurement;overall_width_or_wingspan:V3Measurement;overall_height:V3Measurement;
  important_proportion_rules:string[];human_scale_reference:string;
}
export interface V3GeometryModule {
  module_id:string;module_name:string;required_visible_features:string[];minimum_visible_anchor_count:number;
  forbidden_geometry_changes:string[];likely_wrong_substitutions:string[];reference_asset_ids:string[];
}
export interface V3ReferenceAsset {
  asset_id:string;asset_type:'IMAGE'|'VIDEO'|'PDF'|'DIAGRAM'|'WEB_PAGE'|'CREATOR_FILE'|'OTHER';
  product_or_component:string;exact_variant_or_configuration:string;operational_state_or_context:string;view_angle:string;
  source_page_url:string;direct_media_url_or_file_reference:string;publisher_or_owner:string;date_or_event:string;
  visual_verification:'PASS'|'PARTIAL'|'FAIL';context_truth_status:V3ContextTruthStatus;exact_event_or_location_verified:boolean;
  visible_geometry_features:string[];allowed_usage:string[];forbidden_usage:string[];
  recommended_media_routes:V3MediaRoute[];confidence:V3Confidence;
}
export interface V3Environment {
  environment_id:string;environment_name:string;
  setting_scope:'INTERIOR'|'EXTERIOR'|'AERIAL'|'UNDERWATER'|'AT_SEA'|'RUNWAY'|'TEST_RANGE'|'LABORATORY'|'OPERATIONAL'|'GRAPHIC'|'OTHER';
  environment_type:string;context_truth_status:V3ContextTruthStatus;exact_event_or_location_if_verified:string;
  geographic_or_environmental_context:string;physical_features:string[];ground_water_or_surface:string;
  weather_and_atmosphere:string;lighting:string;equipment_and_supports:string[];human_roles:string[];
  uniforms_and_ppe:string[];scale_references:string[];allowed_background_activity:string[];forbidden_elements:string[];
}
export interface V3VisualOpportunities {
  recommended_visual_families:V3VisualFamily[];full_product_opportunities:string[];external_detail_opportunities:string[];
  reference_supported_internal_opportunities:string[];general_principle_graphic_opportunities:string[];
  force_flow_energy_signal_opportunities:string[];testing_opportunities:string[];human_operation_opportunities:string[];
  non_product_cutaway_opportunities:string[];
}
export interface V3EngineeringSystem {
  system_id:string;system_name:string;system_category:V3SystemCategory;engineering_question:string;engineering_problem:string;
  operating_environment:string;observable_clues:string[];confirmed_product_specific_findings:string[];
  applicable_general_principles:string[];qualified_product_inferences:string[];governing_constraints:string[];
  system_inputs:string[];system_outputs:string[];interacting_system_ids:string[];tradeoffs:string[];
  test_or_operational_evidence:string[];unknowns_and_limits:string[];geometry_module_ids:string[];
  operational_state_ids:string[];reference_asset_ids:string[];evidence_claim_ids:string[];visual_opportunities:V3VisualOpportunities;
}
export interface V3OperationalState {
  state_id:string;state_name:string;state_purpose:string;environment_ids:string[];product_configuration:string;
  required_visible_identity_anchors:string[];geometry_module_ids:string[];opening_state:string;primary_action:string;
  midpoint_event:string;propulsion_or_control_behavior:string;physical_environmental_response:string;stable_ending_state:string;
  camera_platform_options:string[];preferred_shot_scales:string[];preferred_camera_movements:string[];
  forbidden_camera_movements:string[];continuity_requirements:string[];forbidden_configuration_changes:string[];
  reference_asset_ids:string[];evidence_claim_ids:string[];generation_permission:V3GenerationPermission;
}
export interface V3SystemRelationship {
  relationship_id:string;from_system_id:string;to_system_id:string;relationship_type:V3RelationshipType;
  relationship_summary:string;physical_or_information_path:string;observable_evidence:string[];
  applicable_general_principle:string;product_specific_inference:string;tradeoff:string;evidence_claim_ids:string[];
  visualization_permission:V3VisualizationPermission;recommended_visual_families:V3VisualFamily[];must_not_imply:string[];
}
export interface V3ConceptBridge {
  bridge_id:string;from_system_id:string;to_system_id:string;bridge_logic:string;shared_visual_anchor:string;
  continuity_requirements:string[];continuity_risks:string[];recommended_visual_families:V3VisualFamily[];
}
export interface V3VisualBeat {
  beat_id:string;beat_order:number;beat_name:string;story_function:V3StoryFunction;visual_family:V3VisualFamily;
  narrative_purpose:string;semantic_alignment_terms:string[];applicable_engineering_system_ids:string[];
  applicable_operational_state_ids:string[];evidence_claim_ids:string[];environment_ids:string[];geometry_module_ids:string[];
  product_visibility:V3ProductVisibility;context_truth_status:V3ContextTruthStatus;reference_asset_ids:string[];
  preferred_media_routes:V3MediaRoute[];generation_permission:V3GenerationPermission;
  exact_event_or_location_claim_allowed:boolean;preferred_shot_scales:string[];preferred_camera_movements:string[];
  minimum_usable_duration_seconds:number;preferred_duration_seconds:number;maximum_duration_seconds:number;
  must_show:string[];must_not_show:string[];continuity_requirements:string[];negative_constraints:string[];
}
export interface V3Chapter {
  chapter_id:string;chapter_name:string;chapter_order:number;narrative_goal:string;chapter_question:string;
  observable_clue:string;physical_constraint:string;design_response:string;system_interaction:string;tradeoff:string;
  evidence_resolution:string;chapter_payoff:string;opening_rehook_intent:string;unresolved_bridge:string;
  applicable_engineering_system_ids:string[];applicable_operational_state_ids:string[];evidence_claim_ids:string[];
  required_visual_families:V3VisualFamily[];optional_visual_families:V3VisualFamily[];
  forbidden_visual_families:V3VisualFamily[];visual_beats:V3VisualBeat[];
}
export interface V3RhythmPolicy {
  preferred_usable_scene_duration_seconds:{minimum:number;preferred:number;maximum:number};
  maximum_consecutive_same_visual_family:number;maximum_consecutive_full_product_scenes:number;
  maximum_consecutive_same_environment_without_new_information:number;
  require_context_geometry_principle_evidence_cycle_when_supported:boolean;
  attention_reset_interval_seconds:{minimum:number;maximum:number};minimum_meaningful_visual_families_per_60_seconds:number;
  avoid_repeated_camera_angle:boolean;avoid_repeated_camera_movement:boolean;avoid_decorative_visuals_without_narrative_purpose:boolean;
}
export interface V3VisualStoryPlan {
  documentary_arc:{central_engineering_question:string;opening_observable_clue:string;opening_visual_promise:string;promised_payoffs:string[];closing_answer:string;remaining_uncertainty:string;closing_visual_payoff:string};
  chapters:V3Chapter[];rhythm_policy:V3RhythmPolicy;
  evidence_visualization_policy:Record<string,boolean>;
  media_routing_policy:Record<string,boolean>;
  visual_balance_targets:Record<string,{minimum:number;maximum:number}|boolean>;
}
export interface V3GlobalPromptRules {
  use_positive_geometry_before_negative_constraints:boolean;use_smallest_relevant_geometry_module:boolean;
  treat_each_generated_clip_as_stateless:boolean;one_stable_product_configuration_per_clip:boolean;
  one_primary_action_or_relationship_per_clip:boolean;maximum_minor_supporting_actions:number;maximum_camera_movements:number;
  generated_readable_text_forbidden:boolean;geometry_transformation_forbidden:boolean;generic_product_fallback_forbidden:boolean;
  unsupported_internal_layout_forbidden:boolean;general_principle_cannot_prove_product_implementation:boolean;
  reference_asset_required_when_text_cannot_lock_identity:boolean;final_prompt_generation_belongs_to_app:boolean;
  transcript_alignment_belongs_to_app:boolean;scene_plan_must_precede_prompt_generation:boolean;
  visual_beat_must_have_narrative_purpose:boolean;exact_event_or_location_claim_requires_verified_reference:boolean;
  contextual_environment_cannot_be_named_as_exact:boolean;editor_native_graphics_required_for_readable_diagrams:boolean;
}
export interface VisualEngineeringHandoffV3 {
  schema:{name:'Modus Assembly Visual Engineering Handoff';version:'3.0.0';contract_type:'VISUAL_ONLY_ENGINE_TO_APP_HANDOFF'};
  product:V3Product;evidence_boundaries:V3EvidenceBoundaries;dimensions_and_proportions:V3Dimensions;
  geometry_modules:V3GeometryModule[];reference_assets:V3ReferenceAsset[];environments:V3Environment[];
  engineering_systems:V3EngineeringSystem[];operational_states:V3OperationalState[];
  system_relationships:V3SystemRelationship[];concept_bridges:V3ConceptBridge[];
  visual_story_plan:V3VisualStoryPlan;global_prompt_rules:V3GlobalPromptRules;
}

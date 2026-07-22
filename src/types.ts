import type { AnyVisualProductionHandoff } from './types/visualProductionV2';

export type PhaseType = 1 | 2 | 3;
export type ProjectFormatId = 'standard-lifecycle';
export type T2VPromptProfile = 'omni-flash' | 'veo-flow';
export interface Settings {
  apiKey: string;
  model: string;
  defaultDuration: string;
  defaultStyle: string;
  sceneDurationSeconds: 8 | 10;
  productionTemplate?: Record<string, any>;
  productionTemplateName?: string;
  productionTemplateImportedAt?: string;
}
export interface OmniPromptSections {
  cinematography: string;
  subject: string;
  action: string;
  environment: string;
  style_lighting: string;
  product_state: string;
  sound: string;
  exclusions: string;
}
export interface TopicBrief {
  schema_version?: string;
  topic: { 
    title: string; 
    product?: string; 
    category: string; 
    manufacturer?: string;
    suggested_duration?: string | number;
    platform_risk?: string;
  };
  source_integrity?: {
    source_quality_summary?: string;
    evidence_confidence_summary?: string;
    allowed_claim_confidence?: string[];
    disallowed_claim_confidence?: string[];
    research_ledger_note?: string;
  };
  global_visual_constants: string;
  /**
   * The full anchor text (legacy single-field format).
   * May contain both positive descriptions and "NOT / NO" exclusion clauses.
   * The prompt engine automatically splits this via parseAnchorComponents().
   * You may also provide the split fields below directly.
   */
  anti_hallucination_anchor?: string;
  /**
   * Optional: positive-only visual specification for the finished product.
   * If provided, takes precedence over parsing anti_hallucination_anchor.
   */
  visual_lock?: string;
  /**
   * Optional: comma-separated list of what the product is NOT / does NOT have.
   * Added to negative prompts section only, never injected into positive subject.
   */
  visual_exclusions?: string;
  product_identity_lock?: {
    core_geometry: string;
    surface_finish: string;
    markings: string;
    scale_reference: string;
    distinctive_features: string[];
    must_remain_consistent_across_all_scenes: boolean;
  };
  master_voiceover_script?: string;
  global_negative_prompts?: string;
  negative_prompt_global?: string[];
  cinematography_rules?: {
    camera_style: string;
    lens_language: string;
    lighting_style: string;
    color_grade: string;
    motion_rules: string;
  };
  scene_continuity_rules?: {
    lifecycle_progression: string;
    state_consistency: string;
    environment_logic: string;
    markings_consistency: string;
    scale_consistency: string;
    no_stage_skipping: boolean;
  };
  lifecycle_stage_count?: number | string;
  quality_control?: any;
  _production_handoff?: AnyVisualProductionHandoff;
  environments: Array<{
    environment_id?: string;
    stage_ref?: string;
    name: string;
    environment_type?: string;
    visual_details: string;
    confirmed_visuals?: string;
    inferred_visuals?: string;
    reference_confidence?: {
      visual_reference?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
      manufacturing_accuracy?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
      inference_level?: string;
    };
    do_not_show?: string[];
    nation?: string;
  }>;
  lifecycle_stages?: Array<{
    stage_id?: string;
    stage_name: string;
    environment_ref: string;
    stage_function?: string;
    evidence_confidence?: string;
    action: string;
    product_visual_state: string;
    /**
     * Explicit state classification for this lifecycle stage.
     * A = raw materials / logistics (no finished product present)
     * B = mid-fabrication / sub-assembly (partial geometry only)
     * C = finished product visible (convoy, deployment, final cleanroom)
     * When provided, this label is injected into the Phase 2 shot list
     * and travels into Phase 4 batches, eliminating per-batch LLM guessing.
    */
    state?: 'A' | 'B' | 'C';
    primary_camera_shot?: string;
    secondary_detail_shots?: string[];
    motion_direction?: string;
    quality_control_focus?: string;
    continuity_from_previous_stage?: string;
    transition_to_next_stage?: string;
    visual_risk_notes?: string;
    source_claim_refs?: string[];
  }>;
  shot_plan?: Array<{
    stage_ref: string;
    shot_number: number;
    shot_type: string;
    purpose: string;
    camera_motion: string;
    approx_duration_seconds?: string | number;
    continuity_notes?: string;
  }>;
}
export interface TimedWord { text: string; start: number; end: number; probability: number; }
export interface TimedTranscriptSegment { text: string; start: number; end: number; words: TimedWord[]; }
export interface TimedScene { number: number; start: number; end: number; duration: number; text: string; silent: boolean; }
export interface VoiceoverTranscription {
  audioFileName: string;
  duration: number;
  language: 'en';
  languageProbability: number;
  model: string;
  computeType: string;
  text: string;
  segments: TimedTranscriptSegment[];
  words: TimedWord[];
  sceneDurationSeconds: 8 | 10;
  scenes: TimedScene[];
  importedAt: string;
}
export interface SceneDirection {
  number: number;
  start: number;
  end: number;
  duration: number;
  voiceover: string;
  silent: boolean;
  stage_id: string;
  state: 'A' | 'B' | 'C';
  subject: string;
  product_visual_state: string;
  primary_action: string;
  supporting_motion: string;
  environment_ref: string;
  environment_description: string;
  camera: { shot_scale: string; lens: string; angle: string; movement: string; movement_speed: string };
  lighting_and_material: string;
  continuity_from_previous: string;
  transition_to_next: string;
  required_visible_features: string[];
  forbidden_elements: string[];
}
export interface T2VPrompt {
  number: number;
  stage_id?: string;
  state?: 'A' | 'B' | 'C';
  continuity_notes?: string;
  quality_flags?: string[];
  action_description: string;
  video_prompt: string;
  voiceover: string;
  stock_keywords: string;
  omniSections?: OmniPromptSections;
}
export interface AppState {
  projectSchemaVersion: 5;
  id?: string;
  projectName: string;
  projectFormat: ProjectFormatId;
  phase: PhaseType;
  topic: TopicBrief | null;
  sceneDirections: SceneDirection[];
  masterVoiceoverScript: string;
  voiceoverTranscription: VoiceoverTranscription | null;
  t2vPromptProfile: T2VPromptProfile;
  visualPrompts: T2VPrompt[];
  demoState: 'idle' | 'generating' | 'review' | 'approved';
  demoScenes: T2VPrompt[];
  demoSceneNumbers: number[];
}
export interface SavedProject {
  id: string;
  name: string;
  title: string;
  category: string;
  phase: PhaseType;
  sceneCount: number;
  demoOnly: boolean;
  savedAt: string;
  createdAt: string;
}
export interface FullProjectData extends AppState {
  id: string;
  savedAt: string;
  createdAt: string;
}

import { SceneDirection, T2VPromptProfile, TopicBrief } from '../types';

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean);
const truncateWords = (value: string, limit: number) => {
  const parts = words(value);
  return parts.length > limit ? `${parts.slice(0, limit).join(' ').replace(/[,:;|]+$/, '')}.` : value.trim();
};

export function normalizeConstraintList(value: unknown): string[] {
  const flattened: string[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === 'string') item.split(/\s*[,|]\s*/).map(part => part.trim()).filter(part => part && !/\[object Object\]/i.test(part)).forEach(part => flattened.push(part));
  };
  visit(value);
  const seen = new Set<string>();
  return flattened.filter(item => {
    const key = item.toLowerCase().replace(/^(no|avoid|without)\s+/, '').trim();
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function compactIdentity(topic: TopicBrief | null): string {
  if (!topic) return '';
  const lock = topic.product_identity_lock;
  const candidates = typeof topic.visual_lock === 'string' && topic.visual_lock.trim()
    ? [topic.visual_lock.split('|').slice(0, 6).join(', ')]
    : [lock?.core_geometry, lock?.surface_finish, lock?.markings, ...(Array.isArray(lock?.distinctive_features) ? lock!.distinctive_features.slice(0, 5) : [])];
  const normalized = normalizeConstraintList(candidates).join(', ');
  return truncateWords(normalized, 48);
}

export function relevantNegatives(direction: SceneDirection, topic: TopicBrief | null): string[] {
  return normalizeConstraintList([
    direction.forbidden_elements,
    topic?.visual_exclusions,
    topic?.negative_prompt_global,
    topic?.global_negative_prompts,
  ]).slice(0, 8);
}

export function profileInstruction(profile: T2VPromptProfile): string {
  const common = `Return one concise video_prompt per supplied scene, normally 55-85 words before application guards. The application adds the duration, canonical identity, audio rule, and compact exclusions, so do not repeat those blocks. Use exactly one primary action and one continuous camera movement. Never include voiceover, labels, JSON, bullet lists, pipe-delimited data, headings, or abstract narration.`;
  return profile === 'omni-flash'
    ? `Write natural conversational directions optimized for Gemini Omni Flash. Emphasize believable physical motion, temporal progression, environmental response, and smooth cinematic camera behavior. ${common}`
    : `Write compact cinematography directions optimized for Veo in Google Flow. Emphasize subject composition, shot scale, lens, camera path, controlled action, lighting, material realism, and continuity. ${common}`;
}

export function buildFocusedProductionContext(topic: TopicBrief | null, directions: SceneDirection[]) {
  const handoff=(topic as any)?._production_handoff;
  if(!handoff||typeof handoff!=='object') return null;
  const stageIds=new Set(directions.map(direction=>direction.stage_id).filter(Boolean));
  const environmentIds=new Set(directions.map(direction=>direction.environment_ref).filter(Boolean));
  const stages=(Array.isArray(handoff.production_stages)?handoff.production_stages:[]).filter((stage:any)=>stageIds.has(stage.stage_id));
  stages.forEach((stage:any)=>{if(stage.environment_id)environmentIds.add(stage.environment_id);});
  const moduleIds=new Set<string>();
  const referenceIds=new Set<string>();
  stages.forEach((stage:any)=>{
    if(stage.geometry_control?.primary_geometry_module_id)moduleIds.add(stage.geometry_control.primary_geometry_module_id);
    (stage.geometry_control?.secondary_geometry_module_ids||[]).forEach((id:string)=>moduleIds.add(id));
    (stage.visual_evidence?.reference_asset_ids||[]).forEach((id:string)=>referenceIds.add(id));
  });
  return {
    schema:handoff.schema,
    product:handoff.product,
    dimensions_and_proportions:handoff.dimensions_and_proportions,
    global_prompt_rules:handoff.global_prompt_rules,
    production_stages:stages,
    environments:(handoff.environments||[]).filter((environment:any)=>environmentIds.has(environment.environment_id)),
    geometry_modules:(handoff.geometry_modules||[]).filter((module:any)=>moduleIds.has(module.module_id)),
    reference_assets:(handoff.reference_assets||[]).filter((asset:any)=>referenceIds.has(asset.asset_id)),
    stage_transitions:(handoff.stage_transitions||[]).filter((transition:any)=>stageIds.has(transition.from_stage_id)||stageIds.has(transition.to_stage_id)),
  };
}

function stripInjectedClauses(value: string): string {
  return value
    .replace(/(?:exact\s+)?\d+(?:\.\d+)?[-\s]second(?:\s+continuous)?\s+shot[.:]?/gi, ' ')
    .replace(/\b(?:global negatives?|forbidden elements?|required visible features?|visual lock verbatim)\s*:[^.!?]*(?:[.!?]|$)/gi, ' ')
    .replace(/\[object Object\]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function finalizeFlowPrompt(generated: string, direction: SceneDirection, topic: TopicBrief | null, profile: T2VPromptProfile): string {
  const prefix = `${Number(direction.duration.toFixed(3))}-second continuous shot.`;
  const body = truncateWords(stripInjectedClauses(generated), 65);
  const identity = direction.state === 'C'
    ? truncateWords(compactIdentity(topic), 38)
    : truncateWords(`Show only the incomplete State ${direction.state} condition: ${direction.product_visual_state}. Do not reveal finished or future-stage components`, 28);
  const identityClause = identity ? `${direction.state === 'C' ? 'Maintain this finished-product identity' : 'Assembly-state constraint'}: ${identity}` : '';
  const negatives = relevantNegatives(direction, topic);
  const cleanNegatives = negatives.map(value => value.replace(/^(?:no|avoid|without|do not include)\s+/i, '').trim()).filter(Boolean);
  const negativeTerms = truncateWords(cleanNegatives.join(', '), 24);
  const negativeClause = negativeTerms ? (profile === 'veo-flow' ? `Negative prompt: ${negativeTerms}` : `Exclude ${negativeTerms}`) : '';
  const audio = profile === 'omni-flash'
    ? 'Generate realistic synchronized ambient sound. Exclude dialogue, narration, music, and readable generated text.'
    : 'Audio: realistic ambient production sound synchronized to movement.';
  return [prefix, body, identityClause, audio, negativeClause].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function buildFlowContext(topic: TopicBrief | null, directions: SceneDirection[], profile: T2VPromptProfile) {
  return {
    target_profile: profile,
    canonical_finished_identity: compactIdentity(topic),
    cinematography_rules: topic?.cinematography_rules,
    continuity_rules: topic?.scene_continuity_rules,
    ...(profile === 'omni-flash' ? { authoritative_production_handoff: buildFocusedProductionContext(topic,directions) } : {}),
    scenes: directions.map(direction => ({ ...direction, relevant_forbidden_elements: relevantNegatives(direction, topic) })),
  };
}

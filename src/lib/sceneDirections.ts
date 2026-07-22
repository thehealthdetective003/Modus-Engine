import { PlannedScene, SceneDirection, TimedScene } from '../types';

const requiredStrings: Array<keyof SceneDirection> = [
  'stage_id', 'subject', 'product_visual_state', 'primary_action', 'supporting_motion',
  'environment_ref', 'environment_description', 'lighting_and_material',
  'continuity_from_previous', 'transition_to_next',
];

export function mergeDirectionMetadata(generated: any[], timedScenes: TimedScene[], plannedScenes: PlannedScene[] = []): SceneDirection[] {
  const byNumber = new Map(generated.map(item => [Number(item?.number), item]));
  const planByNumber = new Map(plannedScenes.map(item => [item.number, item]));
  return timedScenes.map(timed => {
    const item = byNumber.get(timed.number) || {};
    const plan = planByNumber.get(timed.number)!;
    return {
      number: timed.number, start: timed.start, end: timed.end, duration: timed.duration,
      voiceover: timed.text, silent: timed.silent,
      chapter_id: plan?.chapter_id || '', beat_id: plan?.beat_id || '', visual_family: plan?.visual_family,
      story_function: plan?.story_function, visual_treatment: plan?.visual_treatment,
      product_visibility: plan?.product_visibility, stage_id: plan?.stage_id || String(item.stage_id || ''), state: item.state,
      subject: String(item.subject || ''), product_visual_state: String(item.product_visual_state || ''),
      primary_action: String(item.primary_action || ''), supporting_motion: String(item.supporting_motion || ''),
      environment_ref: String(item.environment_ref || ''), environment_description: String(item.environment_description || ''),
      camera: {
        shot_scale: String(item.camera?.shot_scale || ''), lens: String(item.camera?.lens || ''),
        angle: String(item.camera?.angle || ''), movement: String(item.camera?.movement || ''),
        movement_speed: String(item.camera?.movement_speed || ''),
      },
      lighting_and_material: String(item.lighting_and_material || ''),
      continuity_from_previous: String(item.continuity_from_previous || ''), transition_to_next: String(item.transition_to_next || ''),
      required_visible_features: Array.isArray(item.required_visible_features) ? item.required_visible_features.map(String) : [],
      forbidden_elements: Array.isArray(item.forbidden_elements) ? item.forbidden_elements.map(String) : [],
      temporal_action: {
        opening_state: String(item.temporal_action?.opening_state || ''), primary_motion: String(item.temporal_action?.primary_motion || ''),
        physical_interaction: String(item.temporal_action?.physical_interaction || ''), mid_shot_progression: String(item.temporal_action?.mid_shot_progression || ''),
        ending_state: String(item.temporal_action?.ending_state || ''),
      },
    } as SceneDirection;
  });
}

export function validateSceneDirections(directions: unknown, timedScenes: TimedScene[], plannedScenes?: PlannedScene[]): string[] {
  if (!Array.isArray(directions)) return ['Directions must be a JSON array.'];
  const errors: string[] = [];
  if (directions.length !== timedScenes.length) errors.push(`Expected ${timedScenes.length} scenes; found ${directions.length}.`);
  const seen = new Set<number>();
  directions.forEach((direction: any, index) => {
    const label = `Scene ${index + 1}`;
    const number = Number(direction?.number);
    if (!Number.isInteger(number)) errors.push(`${label}: number must be an integer.`);
    if (seen.has(number)) errors.push(`${label}: duplicate scene number ${number}.`);
    seen.add(number);
    const timed = timedScenes[number - 1];
    if (!timed) { errors.push(`${label}: scene number ${number} is outside the transcript.`); return; }
    if (Math.abs(Number(direction.start) - timed.start) > 0.001 || Math.abs(Number(direction.end) - timed.end) > 0.001 || Math.abs(Number(direction.duration) - timed.duration) > 0.001) errors.push(`${label}: timing metadata was modified.`);
    if (String(direction.voiceover ?? '') !== timed.text || Boolean(direction.silent) !== timed.silent) errors.push(`${label}: imported VO or silence metadata was modified.`);
    const plan = plannedScenes?.find(item => item.number === number);
    if (plan) (['chapter_id','beat_id','visual_family','story_function','visual_treatment','product_visibility','stage_id'] as const).forEach(field => {
      if (direction[field] !== plan[field]) errors.push(`${label}: immutable plan field ${field} was modified.`);
    });
    if (!['A', 'B', 'C'].includes(direction.state)) errors.push(`${label}: state must be A, B, or C.`);
    requiredStrings.forEach(field => { if (!String(direction[field] || '').trim()) errors.push(`${label}: ${field} is required.`); });
    ['shot_scale', 'lens', 'angle', 'movement', 'movement_speed'].forEach(field => { if (!String(direction.camera?.[field] || '').trim()) errors.push(`${label}: camera.${field} is required.`); });
    if (!Array.isArray(direction.required_visible_features) || direction.required_visible_features.length === 0) errors.push(`${label}: required_visible_features must contain at least one item.`);
    if (!Array.isArray(direction.forbidden_elements) || direction.forbidden_elements.length === 0) errors.push(`${label}: forbidden_elements must contain at least one item.`);
    if (plannedScenes) ['opening_state','primary_motion','physical_interaction','mid_shot_progression','ending_state'].forEach(field => { if (!String(direction.temporal_action?.[field] || '').trim()) errors.push(`${label}: temporal_action.${field} is required.`); });
  });
  timedScenes.forEach(scene => { if (!seen.has(scene.number)) errors.push(`Scene ${scene.number} is missing.`); });
  return [...new Set(errors)];
}

export interface StageSummaryItem {
  stage_id: string;
  scenes: number;
}

export function calculateStageSummary(directions: SceneDirection[]): StageSummaryItem[] {
  const counts = new Map<string, number>();
  directions.forEach(item => counts.set(item.stage_id, (counts.get(item.stage_id) || 0) + 1));
  return [...counts.entries()].map(([stage_id, scenes]) => ({ stage_id, scenes }));
}

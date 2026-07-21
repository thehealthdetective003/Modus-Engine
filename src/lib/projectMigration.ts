import { AppState, T2VPrompt } from '../types';
import { resplitTranscription } from './timedTranscript';
import { validateSceneDirections } from './sceneDirections';

export type MigrationResult = { state: AppState | null; message?: string; error?: string };

export function projectSceneDuration(raw: any, fallback: 8 | 10): 8 | 10 {
  const value = Number(raw?.voiceoverTranscription?.sceneDurationSeconds);
  return value === 8 || value === 10 ? value : fallback;
}

export function migrateProject(raw: any, initial: AppState, sceneDuration: 8 | 10): MigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: null, error: 'Invalid project file.' };
  if (raw.projectFormat && raw.projectFormat !== 'standard-lifecycle') return { state: null, error: 'Unsupported production format.' };
  if (raw.creationMode && raw.creationMode !== 'standard-pacing') return { state: null, error: 'Rapid and Hybrid projects are no longer supported.' };

  sceneDuration = projectSceneDuration(raw, sceneDuration);
  let transcription = raw.voiceoverTranscription || null;
  let timingChanged = false;
  if (transcription && transcription.sceneDurationSeconds !== sceneDuration) {
    transcription = resplitTranscription(transcription, sceneDuration);
    timingChanged = true;
  }
  const rawDirections = Array.isArray(raw.sceneDirections) ? raw.sceneDirections : [];
  const directionsValid = !!transcription && validateSceneDirections(rawDirections, transcription.scenes).length === 0;
  const imageMode = raw.phase4Mode === 'image-animation';
  const compatiblePrompts: T2VPrompt[] = directionsValid && !imageMode && Array.isArray(raw.visualPrompts) && raw.visualPrompts.length === transcription.scenes.length
    ? raw.visualPrompts.filter((item: any) => item && typeof item.video_prompt === 'string').map((item: any) => ({
        number: Number(item.number), stage_id: item.stage_id || item.stage_ref, state: item.state,
        continuity_notes: item.continuity_notes, quality_flags: item.quality_flags,
        action_description: String(item.action_description || ''), video_prompt: String(item.video_prompt || ''),
        voiceover: transcription.scenes[Number(item.number) - 1]?.text || '', stock_keywords: String(item.stock_keywords || ''),
      }))
    : [];
  const preserveOutput = compatiblePrompts.length === transcription?.scenes.length;
  const phase = directionsValid ? (Number(raw.phase) >= 3 ? 3 : Math.max(1, Number(raw.phase) || 1)) : (raw.topic ? 2 : 1);
  const state: AppState = {
    ...initial,
    id: raw.id,
    projectName: raw.projectName || initial.projectName,
    projectFormat: 'standard-lifecycle',
    phase: phase as 1 | 2 | 3,
    topic: raw.topic || null,
    masterVoiceoverScript: transcription?.text || '',
    voiceoverTranscription: transcription,
    sceneDirections: directionsValid ? rawDirections : [],
    visualPrompts: preserveOutput ? compatiblePrompts : [],
    demoState: 'idle', demoScenes: [], demoSceneNumbers: [],
    projectSchemaVersion: 3,
  };
  const reset = timingChanged || imageMode || !directionsValid || !preserveOutput;
  return { state, message: reset && raw.topic ? 'Project migrated to the timestamped T2V pipeline; incompatible downstream output was reset.' : undefined };
}

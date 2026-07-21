import { VoiceoverTranscription } from '../types';

export const WHISPER_SERVICE_URL = 'http://127.0.0.1:8765';
export type WhisperJob = {
  id: string;
  status: 'queued' | 'loading_model' | 'transcribing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string | null;
  result?: Omit<VoiceoverTranscription, 'sceneDurationSeconds' | 'scenes' | 'transcribedAt'> | null;
};

export async function checkWhisperHealth(signal?: AbortSignal) {
  const response = await fetch(`${WHISPER_SERVICE_URL}/health`, { signal });
  if (!response.ok) throw new Error('Local Whisper service is unavailable.');
  return response.json();
}

export async function createTranscription(file: File, model: string): Promise<{ id: string }> {
  const body = new FormData();
  body.append('file', file);
  body.append('model', model);
  const response = await fetch(`${WHISPER_SERVICE_URL}/transcriptions`, { method: 'POST', body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Transcription could not be started.');
  return payload;
}

export async function getTranscriptionJob(id: string): Promise<WhisperJob> {
  const response = await fetch(`${WHISPER_SERVICE_URL}/transcriptions/${id}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Transcription job could not be read.');
  return payload;
}

export async function cancelTranscription(id: string): Promise<void> {
  await fetch(`${WHISPER_SERVICE_URL}/transcriptions/${id}`, { method: 'DELETE' });
}

import { VoiceoverTranscription } from '../types';

const headers = (token: string) => token ? { Authorization: `Bearer ${token}` } : {};
export type WhisperJob = {
  id: string;
  status: 'queued' | 'loading_model' | 'transcribing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string | null;
  result?: Omit<VoiceoverTranscription, 'sceneDurationSeconds' | 'scenes' | 'transcribedAt'> | null;
};

export async function checkWhisperHealth(serviceUrl: string, token: string, signal?: AbortSignal) {
  const response = await fetch(`${serviceUrl.replace(/\/$/,'')}/health`, { signal, headers: headers(token) });
  if (!response.ok) throw new Error('Local Whisper service is unavailable.');
  return response.json();
}

export async function createTranscription(serviceUrl: string, token: string, file: File, model: string): Promise<{ id: string }> {
  const body = new FormData();
  body.append('file', file);
  body.append('model', model);
  const response = await fetch(`${serviceUrl.replace(/\/$/,'')}/transcriptions`, { method: 'POST', body, headers: headers(token) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Transcription could not be started.');
  return payload;
}

export async function getTranscriptionJob(serviceUrl: string, token: string, id: string): Promise<WhisperJob> {
  const response = await fetch(`${serviceUrl.replace(/\/$/,'')}/transcriptions/${id}`, { headers: headers(token) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Transcription job could not be read.');
  return payload;
}

export async function cancelTranscription(serviceUrl: string, token: string, id: string): Promise<void> {
  await fetch(`${serviceUrl.replace(/\/$/,'')}/transcriptions/${id}`, { method: 'DELETE', headers: headers(token) });
}

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, FileAudio, Loader2, RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, VoiceoverTranscription } from '../types';
import { useSettings } from './SettingsContext';
import { buildTimedScenes, formatTimestamp, resetDownstreamForTiming } from '../lib/timedTranscript';
import { cancelTranscription, checkWhisperHealth, createTranscription, getTranscriptionJob } from '../lib/whisperClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';

interface Props { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; }

export function VoiceoverTranscriptionPanel({ state, setState }: Props) {
  const { settings } = useSettings();
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkHealth = async () => {
    try { await checkWhisperHealth(settings.whisperServiceUrl, settings.whisperAccessToken); setServiceOnline(true); }
    catch { setServiceOnline(false); }
  };
  useEffect(() => { checkHealth(); }, []);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const job = await getTranscriptionJob(settings.whisperServiceUrl, settings.whisperAccessToken, jobId);
        if (stopped) return;
        setStatus(job.status);
        setProgress(job.progress || 0);
        if (job.status === 'completed' && job.result) {
          const scenes = buildTimedScenes(job.result.words, job.result.duration, settings.sceneDurationSeconds);
          const transcript: VoiceoverTranscription = { ...job.result, sceneDurationSeconds: settings.sceneDurationSeconds, scenes, transcribedAt: new Date().toISOString() };
          setState(prev => ({ ...resetDownstreamForTiming(prev), masterVoiceoverScript: transcript.text, voiceoverTranscription: transcript } as AppState));
          setJobId(null);
          toast.success(`VO transcribed into ${scenes.length} timed scenes.`);
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          setJobId(null);
          if (job.status === 'failed') toast.error(job.error || 'Local transcription failed.');
          return;
        }
        window.setTimeout(poll, 750);
      } catch (error) {
        setJobId(null);
        setServiceOnline(false);
        toast.error(error instanceof Error ? error.message : 'Lost connection to local Whisper.');
      }
    };
    poll();
    return () => { stopped = true; };
  }, [jobId, settings.sceneDurationSeconds, setState]);

  const transcribe = async (file: File) => {
    const allowed = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.mp4'];
    const suffix = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(suffix)) { toast.error('Choose WAV, MP3, M4A, FLAC, OGG, or MP4 audio.'); return; }
    try {
      await checkWhisperHealth(settings.whisperServiceUrl, settings.whisperAccessToken);
      setServiceOnline(true);
      setState(prev => ({ ...resetDownstreamForTiming(prev), masterVoiceoverScript: '', voiceoverTranscription: null } as AppState));
      setStatus('uploading'); setProgress(0);
      const job = await createTranscription(settings.whisperServiceUrl, settings.whisperAccessToken, file, settings.whisperModel);
      setJobId(job.id);
    } catch (error) {
      setServiceOnline(false);
      toast.error(error instanceof Error ? error.message : 'Could not start transcription.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const updateSceneText = (number: number, text: string) => {
    setState(prev => {
      if (!prev.voiceoverTranscription) return prev;
      const scenes = prev.voiceoverTranscription.scenes.map(scene => scene.number === number ? { ...scene, text, silent: !text.trim() } : scene);
      const masterVoiceoverScript = scenes.map(scene => scene.text).filter(Boolean).join(' ');
      return { ...prev, phase: 2, masterVoiceoverScript, voiceoverTranscription: { ...prev.voiceoverTranscription, scenes, text: masterVoiceoverScript }, sceneDirections: [], visualPrompts: [], demoScenes: [], demoSceneNumbers: [], demoState: 'idle' };
    });
  };

  const transcript = state.voiceoverTranscription;
  const busy = !!jobId;
  return (
    <div className="mb-8 rounded-xl border border-primary/25 bg-primary/5 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold tracking-widest text-sm flex items-center gap-2"><FileAudio className="h-4 w-4 text-primary" /> VO AUDIO & LOCAL TRANSCRIPTION</h3>
          <p className="text-[10px] text-muted-foreground mt-1">Required · English · {settings.sceneDurationSeconds}s scenes · {settings.whisperModel} CPU INT8</p>
        </div>
        <Badge variant="outline" className={serviceOnline ? 'text-green-500 border-green-500/30' : serviceOnline === false ? 'text-red-500 border-red-500/30' : ''}>
          <Cpu className="h-3 w-3 mr-1" /> {serviceOnline ? 'LOCAL SERVICE READY' : serviceOnline === false ? 'SERVICE OFFLINE' : 'CHECKING'}
        </Badge>
      </div>
      {serviceOnline === false && (
        <div className="p-3 rounded-md border border-red-500/20 bg-red-500/5 text-xs text-red-400 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /><span>Run <code>npm run setup:whisper</code> once, then keep <code>npm run whisper:service</code> running. In Google AI Studio, paste the local access token in Settings.</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="relative" disabled={busy || serviceOnline === false}>
          <FileAudio className="h-4 w-4 mr-2" /> {transcript ? 'REPLACE VO AUDIO' : 'SELECT VO AUDIO'}
          <input ref={inputRef} type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.mp4,audio/*,video/mp4" className="absolute inset-0 opacity-0 cursor-pointer" onChange={event => event.target.files?.[0] && transcribe(event.target.files[0])} />
        </Button>
        <Button variant="ghost" size="sm" onClick={checkHealth}><RefreshCw className="h-3.5 w-3.5 mr-2" />CHECK SERVICE</Button>
        {busy && <Button variant="destructive" size="sm" onClick={async () => { if (jobId) await cancelTranscription(settings.whisperServiceUrl, settings.whisperAccessToken, jobId); }}><Square className="h-3 w-3 mr-2" />CANCEL</Button>}
      </div>
      {busy && <div className="space-y-2"><div className="flex justify-between text-xs"><span className="uppercase">{status.replace('_', ' ')}...</span><span>{progress}%</span></div><Progress value={progress} /></div>}
      {transcript && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-[10px]"><Badge><CheckCircle2 className="h-3 w-3 mr-1" />TRANSCRIBED</Badge><Badge variant="outline">{transcript.audioFileName}</Badge><Badge variant="outline">{formatTimestamp(transcript.duration)}</Badge><Badge variant="outline">{transcript.scenes.length} scenes</Badge></div>
          <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
            {transcript.scenes.map(scene => (
              <div key={scene.number} className="grid grid-cols-[110px_1fr] gap-3 items-start p-3 rounded-md border border-border/40 bg-background/50">
                <div className="text-[10px] font-mono"><div className="font-bold">SCENE {String(scene.number).padStart(3, '0')}</div><div className="text-muted-foreground mt-1">{formatTimestamp(scene.start)}<br />{formatTimestamp(scene.end)}</div></div>
                <Textarea value={scene.text} placeholder="Silent VO window" onChange={event => updateSceneText(scene.number, event.target.value)} className="min-h-[58px] text-xs" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

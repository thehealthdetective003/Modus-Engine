import { Dispatch, SetStateAction, useMemo, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { ArrowLeft, CheckCircle2, Copy, Loader2, PenTool } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, SceneDirection } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useSettings } from './SettingsContext';
import { copyToClipboard } from '@/lib/utils';
import { TranscriptionImportPanel } from './TranscriptionImportPanel';
import { calculateStageSummary, mergeDirectionMetadata, validateSceneDirections } from '../lib/sceneDirections';
import { formatTimestamp } from '../lib/timedTranscript';

interface Props { state: AppState; setState: Dispatch<SetStateAction<AppState>>; }

const directionSchema = {
  type: Type.ARRAY,
  items: { type: Type.OBJECT, required: ['number','stage_id','state','subject','product_visual_state','primary_action','supporting_motion','environment_ref','environment_description','camera','lighting_and_material','continuity_from_previous','transition_to_next','required_visible_features','forbidden_elements'], properties: {
    number: { type: Type.INTEGER }, stage_id: { type: Type.STRING }, state: { type: Type.STRING }, subject: { type: Type.STRING },
    product_visual_state: { type: Type.STRING }, primary_action: { type: Type.STRING }, supporting_motion: { type: Type.STRING },
    environment_ref: { type: Type.STRING }, environment_description: { type: Type.STRING },
    camera: { type: Type.OBJECT, required: ['shot_scale','lens','angle','movement','movement_speed'], properties: {
      shot_scale: { type: Type.STRING }, lens: { type: Type.STRING }, angle: { type: Type.STRING }, movement: { type: Type.STRING }, movement_speed: { type: Type.STRING },
    }},
    lighting_and_material: { type: Type.STRING }, continuity_from_previous: { type: Type.STRING }, transition_to_next: { type: Type.STRING },
    required_visible_features: { type: Type.ARRAY, items: { type: Type.STRING } }, forbidden_elements: { type: Type.ARRAY, items: { type: Type.STRING } },
  }}
};

export function Phase2Script({ state, setState }: Props) {
  const { settings } = useSettings();
  const [isLoading, setIsLoading] = useState(false);
  const [editor, setEditor] = useState(() => state.sceneDirections.length ? JSON.stringify(state.sceneDirections, null, 2) : '[]');
  const scenes = state.voiceoverTranscription?.scenes || [];
  const parsed = useMemo(() => { try { const value = JSON.parse(editor); return Array.isArray(value) ? value as SceneDirection[] : null; } catch { return null; } }, [editor]);
  const errors = useMemo(() => parsed ? validateSceneDirections(parsed, scenes) : ['Directions must be a valid JSON array.'], [parsed, scenes]);
  const stageSummary = useMemo(() => parsed && errors.length === 0 ? calculateStageSummary(parsed) : {}, [parsed, errors]);
  const transcript = state.voiceoverTranscription;

  const generate = async () => {
    if (!state.topic || !transcript?.scenes.length) return toast.error('Import timestamped VO JSON before generating directions.');
    const apiKey = settings.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return toast.error('Add a Gemini API key in Settings.');
    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const context = { topic: state.topic, timed_scenes: transcript.scenes.map(({ number,start,end,duration,text,silent }) => ({ number,start,end,duration,voiceover:text,silent })) };
      const response = await ai.models.generateContent({ model: settings.model, contents: JSON.stringify(context), config: {
        responseMimeType: 'application/json', responseSchema: directionSchema,
        systemInstruction: `You are a manufacturing film scene director. Return exactly one direction object for every supplied timed scene, in order. Copy each number exactly; timing, voiceover and silence are attached by the application and must not be returned. Use the production handoff, lifecycle stages, geometry modules, environments, visual locks, exclusions, cinematography and continuity rules. Use physical, camera-visible language only. Every scene has one stable product state and one primary action. State must be A, B, or C. Preserve State A/B incompleteness and apply State C identity locks. Make environment, camera, lighting/material, continuity, visible features and forbidden elements concrete enough to drive an accurate T2V model. Silent windows still require synchronized visuals. Do not invent product components.`,
      }});
      const generated = JSON.parse(response.text || '[]');
      const merged = mergeDirectionMetadata(generated, transcript.scenes);
      const validation = validateSceneDirections(merged, transcript.scenes);
      if (validation.length) throw new Error(validation.join(' '));
      setEditor(JSON.stringify(merged, null, 2));
      setState(prev => ({ ...prev, sceneDirections: merged, visualPrompts: [], demoScenes: [], demoSceneNumbers: [], demoState: 'idle', phase: 2 }));
      toast.success(`Generated ${merged.length} timestamp-locked directions.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Direction generation failed.'); }
    finally { setIsLoading(false); }
  };

  const approve = () => {
    if (!parsed || errors.length) return toast.error(errors[0]);
    setState(prev => ({ ...prev, sceneDirections: parsed, visualPrompts: [], demoScenes: [], demoSceneNumbers: [], demoState: 'idle', phase: 3 }));
    toast.success('Scene directions approved.');
  };

  return <div className="space-y-6">
    <Button variant="link" className="p-0 text-muted-foreground" onClick={() => setState(s => ({ ...s, phase: 1 }))}><ArrowLeft className="h-3 w-3 mr-1"/>Change Topic</Button>
    <div><h2 className="text-xl font-bold tracking-wider">PHASE 2 — VO & DIRECTION</h2><p className="text-xs text-muted-foreground">Imported timestamps own timing and narration. Gemini supplies camera-visible direction.</p></div>
    <TranscriptionImportPanel state={state} setState={setState}/>
    {transcript && <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {[['Runtime',formatTimestamp(transcript.duration)],['Scenes',scenes.length],['Window',`${transcript.sceneDurationSeconds}s`],['Final scene',`${scenes.at(-1)?.duration.toFixed(3)}s`],['Silent windows',scenes.filter(s=>s.silent).length]].map(([k,v]) => <div key={k} className="border rounded-md p-3"><div className="text-[10px] text-muted-foreground uppercase">{k}</div><div className="font-bold mt-1">{v}</div></div>)}
    </div>}
    <Button onClick={generate} disabled={isLoading || !transcript} className="w-full h-12 font-bold">{isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <PenTool className="h-4 w-4 mr-2"/>}{isLoading ? 'GENERATING DIRECTIONS…' : 'GENERATE DETAILED SCENE DIRECTIONS'}</Button>
    <div className="space-y-2">
      <div className="flex justify-between"><Badge variant="outline">STRICT SCENE-DIRECTION JSON</Badge><Button size="sm" variant="ghost" onClick={async()=>toast[await copyToClipboard(editor)?'success':'error']('JSON copied')}><Copy className="h-3 w-3 mr-2"/>COPY</Button></div>
      <Textarea value={editor} onChange={e=>setEditor(e.target.value)} className="min-h-[520px] font-mono text-xs" spellCheck={false}/>
      {errors.length ? <div className="border border-red-500/30 bg-red-500/5 rounded-md p-3 text-xs text-red-400">{errors.slice(0,5).map((e,i)=><div key={i}>• {e}</div>)}</div> : <div className="text-xs text-green-500 flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/>Schema valid; imported timing and VO metadata are unchanged.</div>}
      {Object.keys(stageSummary).length > 0 && <div className="flex flex-wrap gap-2">{Object.entries(stageSummary).map(([stage,count])=><Badge key={stage} variant="secondary">{stage}: {count}</Badge>)}</div>}
    </div>
    <Button onClick={approve} disabled={errors.length > 0} className="w-full h-14 font-bold tracking-widest">APPROVE DIRECTIONS → PHASE 3</Button>
  </div>;
}

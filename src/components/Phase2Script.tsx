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
import { buildDocumentaryScenePlan, summarizeScenePlan } from '../lib/scenePlanner';

interface Props { state: AppState; setState: Dispatch<SetStateAction<AppState>>; }
const directionSchema={type:Type.ARRAY,items:{type:Type.OBJECT,required:['number','state','subject','product_visual_state','primary_action','supporting_motion','environment_description','camera','lighting_and_material','continuity_from_previous','transition_to_next','required_visible_features','forbidden_elements','temporal_action'],properties:{number:{type:Type.INTEGER},state:{type:Type.STRING},subject:{type:Type.STRING},product_visual_state:{type:Type.STRING},primary_action:{type:Type.STRING},supporting_motion:{type:Type.STRING},environment_description:{type:Type.STRING},camera:{type:Type.OBJECT,required:['shot_scale','lens','angle','movement','movement_speed'],properties:{shot_scale:{type:Type.STRING},lens:{type:Type.STRING},angle:{type:Type.STRING},movement:{type:Type.STRING},movement_speed:{type:Type.STRING}}},lighting_and_material:{type:Type.STRING},continuity_from_previous:{type:Type.STRING},transition_to_next:{type:Type.STRING},required_visible_features:{type:Type.ARRAY,items:{type:Type.STRING}},forbidden_elements:{type:Type.ARRAY,items:{type:Type.STRING}},temporal_action:{type:Type.OBJECT,required:['opening_state','primary_motion','physical_interaction','mid_shot_progression','ending_state'],properties:{opening_state:{type:Type.STRING},primary_motion:{type:Type.STRING},physical_interaction:{type:Type.STRING},mid_shot_progression:{type:Type.STRING},ending_state:{type:Type.STRING}}}}}};

export function Phase2Script({state,setState}:Props){
 const {settings}=useSettings(); const [isLoading,setIsLoading]=useState(false); const [batchStatus,setBatchStatus]=useState('');
 const [editor,setEditor]=useState(()=>state.sceneDirections.length?JSON.stringify(state.sceneDirections,null,2):'[]');
 const scenes=state.voiceoverTranscription?.scenes||[]; const transcript=state.voiceoverTranscription;
 const parsed=useMemo(()=>{try{const v=JSON.parse(editor);return Array.isArray(v)?v as SceneDirection[]:null}catch{return null}},[editor]);
 const errors=useMemo(()=>parsed?validateSceneDirections(parsed,scenes,state.plannedScenes):['Directions must be a valid JSON array.'],[parsed,scenes,state.plannedScenes]);
 const stageSummary=useMemo(()=>parsed&&!errors.length?calculateStageSummary(parsed):[],[parsed,errors]);
 const planSummary=useMemo(()=>summarizeScenePlan(state.plannedScenes),[state.plannedScenes]);
 const canResume=state.plannedScenes.length===scenes.length&&state.sceneDirections.length>0&&state.sceneDirections.length<scenes.length;
 const generate=async(resume=false)=>{
  if(!state.topic||!transcript?.scenes.length)return toast.error('Import timestamped VO JSON before generating directions.');
  const apiKey=settings.apiKey||process.env.GEMINI_API_KEY;if(!apiKey)return toast.error('Add a Gemini API key in Settings.');
  setIsLoading(true);
  try{
   const ai=new GoogleGenAI({apiKey}); const plan=resume?state.plannedScenes:buildDocumentaryScenePlan(state.topic,transcript.scenes); const generated:any[]=resume?[...state.sceneDirections]:[];
   if(!resume)setState(p=>({...p,plannedScenes:plan,sceneDirections:[],visualPrompts:[],demoScenes:[],demoSceneNumbers:[],demoState:'idle',phase:2}));
   for(let offset=generated.length;offset<scenes.length;offset+=30){
    const timedBatch=scenes.slice(offset,offset+30),planBatch=plan.slice(offset,offset+30);setBatchStatus(`batch ${Math.floor(offset/30)+1}/${Math.ceil(scenes.length/30)} · scenes ${timedBatch[0].number}–${timedBatch.at(-1)?.number}`);
    const stages=new Set(planBatch.map(x=>x.stage_id)),envs=new Set(planBatch.map(x=>x.environment_ref));const raw:any=state.topic._production_handoff;
    const production_context=raw?.schema?.version==='2.0.0'?{product:raw.product,geometry_modules:raw.geometry_modules,production_stages:raw.production_stages?.filter((x:any)=>stages.has(x.stage_id)),environments:raw.environments?.filter((x:any)=>envs.has(x.environment_id)),selected_beats:raw.visual_story_plan?.chapters?.flatMap((c:any)=>c.visual_beats).filter((b:any)=>planBatch.some(p=>p.beat_id.replace(/__T2V_SAFE$/,'')===b.beat_id))}:state.topic;
    const contents=JSON.stringify({production_context,prior_scene:generated.at(-1)||null,planned_scenes:planBatch.map((p,i)=>({...p,...timedBatch[i],voiceover:timedBatch[i].text}))});
    const response=await ai.models.generateContent({model:settings.model,contents,config:{responseMimeType:'application/json',responseSchema:directionSchema,systemInstruction:`You direct concise documentary manufacturing scenes. Return one object per planned scene, in order. Return number and creative fields only; never return or change plan metadata, timing, or VO. Assigned beat, family, treatment, visibility, stage, and environment are authoritative. LIVE_ACTION_T2V needs a physical opening, one primary motion and interaction, visible mid-shot progression, and settled ending. STATIC_GRAPHIC_T2V needs a stable unlabeled technical composition with only subtle parallax or light motion. MOTION_GRAPHIC_T2V needs controlled staged animation of shapes, layers, paths, components, or mechanical relationships. Graphics contain no readable text, labels, logos, maps, numbers, or invented precise data. Product visibility is strict: NONE omits the product; DETAIL_ONLY shows only the smallest relevant module; PARTIAL preserves current present/absent components; FULL preserves canonical identity. Use physical camera-visible language, one stable state, one primary action, and one coherent camera. Avoid generic 'remains visible' actions. Do not invent components or proprietary internals.`}});
    const batch=JSON.parse(response.text||'[]'),nums=batch.map((x:any)=>Number(x.number)),expected=timedBatch.map(x=>x.number);
    if(batch.length!==expected.length||new Set(nums).size!==nums.length||expected.some(n=>!nums.includes(n))||nums.some((n:number)=>!expected.includes(n)))throw new Error(`Direction batch ${Math.floor(offset/30)+1} returned missing, duplicate, or unexpected scene numbers.`);
    generated.push(...batch);const partialTimed=scenes.slice(0,generated.length),partialPlan=plan.slice(0,generated.length),partial=mergeDirectionMetadata(generated,partialTimed,partialPlan);
    setEditor(JSON.stringify(partial,null,2));setState(p=>({...p,plannedScenes:plan,sceneDirections:partial}));
   }
   const merged=mergeDirectionMetadata(generated,scenes,plan),validation=validateSceneDirections(merged,scenes,plan);if(validation.length)throw new Error(validation.join(' '));
   setEditor(JSON.stringify(merged,null,2));setState(p=>({...p,plannedScenes:plan,sceneDirections:merged,visualPrompts:[],demoScenes:[],demoSceneNumbers:[],demoState:'idle',phase:2}));toast.success(`Planned and directed ${merged.length} timestamp-locked scenes.`);
  }catch(error){toast.error(error instanceof Error?error.message:'Direction generation failed.')}finally{setIsLoading(false);setBatchStatus('')}
 };
 const approve=()=>{if(!parsed||errors.length)return toast.error(errors[0]);setState(p=>({...p,sceneDirections:parsed,visualPrompts:[],demoScenes:[],demoSceneNumbers:[],demoState:'idle',phase:3}));toast.success('Scene directions approved.')};
 return <div className="space-y-6">
  <Button variant="link" className="p-0 text-muted-foreground" onClick={()=>setState(s=>({...s,phase:1}))}><ArrowLeft className="h-3 w-3 mr-1"/>Change Topic</Button>
  <div><h2 className="text-xl font-bold tracking-wider">PHASE 2 — VO & DIRECTION</h2><p className="text-xs text-muted-foreground">Imported timestamps own timing and narration. The documentary planner assigns visual variety before Gemini directs each scene.</p></div>
  <TranscriptionImportPanel state={state} setState={setState}/>
  {transcript&&<div className="grid grid-cols-2 md:grid-cols-5 gap-2">{[['Runtime',formatTimestamp(transcript.duration)],['Scenes',scenes.length],['Window',`${transcript.sceneDurationSeconds}s`],['Final scene',`${scenes.at(-1)?.duration.toFixed(3)}s`],['Silent windows',scenes.filter(s=>s.silent).length]].map(([k,v])=><div key={k} className="border rounded-md p-3"><div className="text-[10px] text-muted-foreground uppercase">{k}</div><div className="font-bold mt-1">{v}</div></div>)}</div>}
  <Button onClick={()=>generate(canResume)} disabled={isLoading||!transcript} className="w-full h-12 font-bold">{isLoading?<Loader2 className="h-4 w-4 mr-2 animate-spin"/>:<PenTool className="h-4 w-4 mr-2"/>}{isLoading?`PLANNING & GENERATING · ${batchStatus}`:canResume?`RESUME DIRECTION GENERATION FROM SCENE ${state.sceneDirections.length+1}`:'GENERATE DETAILED SCENE DIRECTIONS'}</Button>
  {!!state.plannedScenes.length&&<div className="border rounded-md p-3 space-y-2"><div className="text-[10px] uppercase text-muted-foreground">Automatic documentary plan</div><div className="flex flex-wrap gap-2">{planSummary.families.map(([k,v])=><Badge key={k} variant="secondary">{k.replaceAll('_',' ')}: {v}</Badge>)}</div><div className="flex flex-wrap gap-2">{planSummary.treatments.map(([k,v])=><Badge key={k} variant="outline">{k.replace('_T2V','').replaceAll('_',' ')}: {v}</Badge>)}</div></div>}
  <div className="space-y-2"><div className="flex justify-between"><Badge variant="outline">STRICT SCENE-DIRECTION JSON</Badge><Button size="sm" variant="ghost" onClick={async()=>toast[await copyToClipboard(editor)?'success':'error']('JSON copied')}><Copy className="h-3 w-3 mr-2"/>COPY</Button></div><Textarea value={editor} onChange={e=>setEditor(e.target.value)} className="min-h-[520px] font-mono text-xs" spellCheck={false}/>{errors.length?<div className="border border-red-500/30 bg-red-500/5 rounded-md p-3 text-xs text-red-400">{errors.slice(0,5).map((e,i)=><div key={i}>• {e}</div>)}</div>:<div className="text-xs text-green-500 flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/>Schema valid; timing, VO, and documentary plan are unchanged.</div>}{stageSummary.length>0&&<div className="flex flex-wrap gap-2">{stageSummary.map(item=><Badge key={item.stage_id} variant="secondary">{item.stage_id}: {item.scenes}</Badge>)}</div>}</div>
  <Button onClick={approve} disabled={errors.length>0} className="w-full h-14 font-bold tracking-widest">APPROVE DIRECTIONS → PHASE 3</Button>
 </div>
}

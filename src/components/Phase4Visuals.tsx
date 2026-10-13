import { Dispatch, SetStateAction, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { AlertCircle, ArrowLeft, Copy, Download, Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, Phase3Mode, T2VPrompt, T2VPromptProfile } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useSettings } from './SettingsContext';
import { copyToClipboard } from '@/lib/utils';
import { formatTimestamp } from '../lib/timedTranscript';
import { buildFlowContext, finalizeFlowPrompt, profileInstruction } from '../lib/flowPrompt';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { createDirectionBatches, missingDirections, PromptBatchError, runSequentialBatches, T2V_BATCH_SIZE, validateBatchNumbers, validateBatchResponse } from '../lib/promptBatch';
import { compileOmniPrompt, normalizeOmniSections, recompileOmniPrompts } from '../lib/omniPromptCompiler';
import { archetypeBrief, buildI2VPrompt, classifyMotionArchetype, recompileI2VPrompts } from '../lib/i2vPromptCompiler';

interface Props { state: AppState; setState: Dispatch<SetStateAction<AppState>>; }
const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['number','action_description','video_prompt','stock_keywords'], properties: {
  number: { type: Type.INTEGER }, action_description: { type: Type.STRING }, video_prompt: { type: Type.STRING }, stock_keywords: { type: Type.STRING },
  continuity_notes: { type: Type.STRING }, quality_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
}}};
const omniSectionsProperties = {
  cinematography:{type:Type.STRING},subject:{type:Type.STRING},action:{type:Type.STRING},environment:{type:Type.STRING},style_lighting:{type:Type.STRING},product_state:{type:Type.STRING},sound:{type:Type.STRING},exclusions:{type:Type.STRING},
};
const omniResponseSchema = { type:Type.ARRAY, items:{type:Type.OBJECT,required:['number','action_description','prompt_sections','stock_keywords'],properties:{
  number:{type:Type.INTEGER},action_description:{type:Type.STRING},stock_keywords:{type:Type.STRING},continuity_notes:{type:Type.STRING},prompt_sections:{type:Type.OBJECT,required:Object.keys(omniSectionsProperties),properties:omniSectionsProperties},
}}};

const i2vImageProperties = { subject:{type:Type.STRING}, frozen_moment:{type:Type.STRING}, environment:{type:Type.STRING}, lighting_and_materials:{type:Type.STRING} };
const i2vAnimationProperties = { primary_motion:{type:Type.STRING}, secondary_motion:{type:Type.STRING}, environment_motion:{type:Type.STRING} };
const i2vResponseSchema = { type:Type.ARRAY, items:{type:Type.OBJECT,required:['number','action_description','image','animation','stock_keywords'],properties:{
  number:{type:Type.INTEGER},action_description:{type:Type.STRING},stock_keywords:{type:Type.STRING},continuity_notes:{type:Type.STRING},
  image:{type:Type.OBJECT,required:Object.keys(i2vImageProperties),properties:i2vImageProperties},
  animation:{type:Type.OBJECT,required:Object.keys(i2vAnimationProperties),properties:i2vAnimationProperties},
}}};
const I2V_SYSTEM_INSTRUCTION = `You write image-to-video directions for documentary manufacturing, engineering, and operational footage. Each scene is produced in two steps: an image model renders the opening frame, then a video model animates that frame. Return one item per supplied scene and copy each scene number exactly. Every scene carries a motion_archetype and archetype_brief; follow them.

IMAGE fields describe only the opening frame: one frozen instant matching temporal_action.opening_state. This frame is the visual foundation of the whole clip, so make it rich and exact. In subject, describe exactly what the subject looks like at that instant: geometry, configuration, assembly state, and pose or attitude. For aircraft, include flight attitude, bank or pitch, landing-gear and control-surface positions, and altitude cues. For people, include posture, hand placement, protective equipment, and tool grip. In frozen_moment, state the precise instant and the spatial relationships (what is about to touch what, the path ahead, the distance to the ground). In environment, describe the physical setting with foreground, midground, and background layers. In lighting_and_materials, give the light direction, quality, and color temperature, the atmosphere, and how real materials respond (anodized aluminum, composite weave, painted steel, glass, rubber). Use stative language only (is positioned, rests, holds, is banked). Never mention camera movement, progressive change, speed lines, motion blur, or long exposure, because they make the still image blurry. The frame must already contain everything the animation will move; nothing should need to enter later. The application adds composition, lens, identity lock, rendering quality, and exclusions, so do not repeat them.

ANIMATION fields describe motion only. Refer to things by short role nouns (the aircraft, the technician, the robot arm, the load) and never re-describe colors, materials, markings, or design, because the image already defines them. In primary_motion, give the one main action with its direction, pace, and physical cause, progressing from the opening instant. In secondary_motion, give movements caused by the primary action (rotors or propellers turning, fingers adjusting grip, cables tensing, landing gear compressing). In environment_motion, give the physical response of the surroundings (downwash, dust, spray, sparks, coolant, clouds or terrain passing, reflections, heat haze). Keep the motion physically plausible with believable mass, momentum, and contact. The application adds camera motion, timing, stability guards, sound, and exclusions, so do not write them.

Treat the authoritative handoff, product_visibility, state, required_visible_features, and forbidden elements as binding. NONE visibility omits the product, DETAIL_ONLY stays on the component, and PARTIAL never shows uninstalled parts. Never invent components, proprietary internals, combat, weapon discharge, explosions, impossible aerobatics, readable text, numbers, logos, unit markings, or identifiable locations. For graphic scenes, the image is the complete text-free flat vector composition explaining only graphic_spec.visual_claim, and the animation is only the assigned graphic_spec motion. Do not return voiceover, duration, headings, or JSON text inside fields.`;

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const download = (name: string, text: string, type: string) => { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); };

export function Phase4Visuals({ state, setState }: Props) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState<'demo'|'full'|null>(null);
  const [batchProgress, setBatchProgress] = useState<{ batch:number; total:number; start:number; end:number; completed:number; error?:string } | null>(null);
  const directions = state.sceneDirections;

  const imageMode = state.phase3Mode === 'image-to-video';
  const requestI2VPrompts = async (ai: GoogleGenAI, selected: typeof directions): Promise<T2VPrompt[]> => {
    const context=buildFlowContext(state.topic, selected, 'omni-flash');
    const contents=JSON.stringify({...context,target:'image-to-video',animation_profile:state.t2vPromptProfile,scenes:context.scenes.map(scene=>{const archetype=classifyMotionArchetype(scene,state.topic);return {...scene,motion_archetype:archetype,archetype_brief:archetypeBrief(archetype)};})});
    const response = await ai.models.generateContent({ model: settings.model, contents, config:{ responseMimeType:'application/json', responseSchema:i2vResponseSchema, systemInstruction:I2V_SYSTEM_INSTRUCTION }});
    const raw=validateBatchNumbers(JSON.parse(response.text || '[]'),selected);
    const byNumber=new Map(raw.map(item=>[Number(item.number),item]));
    return selected.map(direction=>{
      const item=byNumber.get(direction.number);
      if(!item?.image||!item?.animation)throw new Error(`Scene ${direction.number} has no image or animation sections.`);
      return buildI2VPrompt({number:direction.number,stage_id:direction.stage_id,state:direction.state,action_description:String(item.action_description||direction.primary_action),voiceover:direction.voiceover,stock_keywords:String(item.stock_keywords||''),continuity_notes:String(item.continuity_notes||direction.continuity_from_previous),quality_flags:[]},{image:item.image,animation:item.animation},direction,state.topic,state.t2vPromptProfile);
    });
  };

  const requestPrompts = async (ai: GoogleGenAI, selected: typeof directions): Promise<T2VPrompt[]> => {
    if(imageMode) return requestI2VPrompts(ai, selected);
    const omni=state.t2vPromptProfile==='omni-flash';
    const response = await ai.models.generateContent({ model: settings.model, contents: JSON.stringify(buildFlowContext(state.topic, selected, state.t2vPromptProfile)), config: {
      responseMimeType:'application/json', responseSchema:omni?omniResponseSchema:responseSchema,
      systemInstruction:omni
        ? `Return one structured Omni Flash direction for every supplied scene and copy each scene number exactly. Fill prompt_sections with complete natural-language clauses for cinematography, subject, literal visible action, environment, style_lighting, product_state, synchronized ambient sound, and concise scene exclusions. Honor visual_treatment, visual_family, product_visibility, showdown_role, energy_level, camera_platform, and graphic_spec exactly. LIVE_ACTION_T2V is physical documentary footage. For STATIC_GRAPHIC_T2V and MOTION_GRAPHIC_T2V, explain only graphic_spec.visual_claim with its assigned flat-vector composition, motion pattern, nonverbal annotation devices, and maximum animated-element count. Use one clear concept, a static background, stable simplified geometry, limited keyframed motion, and a final-quarter comprehension hold. The graphic must be complete without editor work: never request labels, blank cards, later typography, numbers, maps with readable locations, speech bubbles, fake HUDs, or precise generated data. For an aviation showdown scene, use the supplied physically credible filming platform, one continuous aerodynamically plausible action, stable scale and geometry, environmental response caused by the aircraft, and a settled ending. The role controls the shot's narrative function: establish before release, vary exterior and operator perspective, use grounded resets, make a later peak materially stronger, and resolve through stable return. Never turn a fixed 8/10-second scene into a rapid internal montage. OPERATIONAL_CONTEXT, DYNAMIC_TESTING, and DELIVERY_AND_ROLLOUT must preserve the supplied starting state, one physically plausible maneuver, propulsion or control behavior, environmental response, one achievable camera, and a stable ending configuration across the full clip. Never add weapon discharge, explosions, active combat, impossible aerobatics, unverified flares or stores, invented unit markings, or exact-event/location claims. For NONE visibility omit the product; DETAIL_ONLY stays module-scoped; PARTIAL preserves incompleteness; FULL preserves canonical identity. The application compiles final prose and temporal progression. Use one primary action and camera behavior. Treat the handoff as authoritative; preserve counts, state, geometry, chronology, and continuity. Never invent internals, future components, readable graphic text, labels, logos, maps, or precise generated data. Do not return voiceover, duration, headings, raw JSON text, or abstract narration.`
        : `Create direct text-to-video prompts only. Return exactly one item per supplied scene and copy its number. Do not return or rewrite voiceover. Use the supplied subject, primary action, supporting motion, environment, camera, lighting, material, transition, continuity, visible features and assembly state. Do not invent components or extra actions. ${profileInstruction(state.t2vPromptProfile)}`,
    }});
    const parsed=JSON.parse(response.text || '[]');
    const raw = omni?validateBatchNumbers(parsed,selected):validateBatchResponse(parsed, selected);
    const byNumber = new Map(raw.map(item=>[Number(item.number),item]));
    return selected.map(direction => { const item=byNumber.get(direction.number);
      if(!omni) return { number:direction.number, stage_id:direction.stage_id, state:direction.state, action_description:String(item.action_description||direction.primary_action), video_prompt:finalizeFlowPrompt(String(item.video_prompt),direction,state.topic,state.t2vPromptProfile), voiceover:direction.voiceover, stock_keywords:String(item.stock_keywords||''), continuity_notes:String(item.continuity_notes||direction.continuity_from_previous), quality_flags:Array.isArray(item.quality_flags)?item.quality_flags:[] };
      if(!item?.prompt_sections||typeof item.prompt_sections!=='object') throw new Error(`Scene ${direction.number} has no structured Omni prompt sections.`);
      const {sections}=normalizeOmniSections(item.prompt_sections,direction,state.topic);
      const video_prompt=compileOmniPrompt(sections,direction);
      return {number:direction.number,stage_id:direction.stage_id,state:direction.state,action_description:String(item.action_description||direction.primary_action),video_prompt,voiceover:direction.voiceover,stock_keywords:String(item.stock_keywords||''),continuity_notes:String(item.continuity_notes||direction.continuity_from_previous),quality_flags:[],omniSections:sections};
    });
  };

  const generate = async (demo: boolean, resume = false) => {
    if (!directions.length) return toast.error('Approve valid Phase 2 directions first.');
    const apiKey = settings.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return toast.error('Add a Gemini API key in Settings.');
    setLoading(demo ? 'demo' : 'full');
    setBatchProgress(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      if (demo) {
        const selected = directions.slice(0, Math.min(3,directions.length));
        const prompts = await requestPrompts(ai, selected);
        setState(p=>({...p,demoState:'generated',demoScenes:prompts,demoSceneNumbers:prompts.map(x=>x.number)}));
        toast.success(imageMode?'Demo image-to-video prompts generated.':'Demo T2V prompts generated.');
      } else {
        const existing = resume ? state.visualPrompts : [];
        if (!resume) setState(previous=>({...previous,visualPrompts:[],demoScenes:[],demoSceneNumbers:[],demoState:'idle'}));
        const remaining = missingDirections(directions, existing);
        const batches = createDirectionBatches(remaining);
        const totalProjectBatches = Math.ceil(directions.length / T2V_BATCH_SIZE);
        let accumulated:T2VPrompt[];
        try {
          accumulated = await runSequentialBatches(batches,existing,batch=>requestPrompts(ai,batch),(batch,items)=>{
            const batchNumber=Math.floor((batch[0].number-1)/T2V_BATCH_SIZE)+1;
            setBatchProgress({batch:batchNumber,total:totalProjectBatches,start:batch[0].number,end:batch.at(-1)!.number,completed:items.length});
          },(batch,items)=>{
            const batchNumber=Math.floor((batch[0].number-1)/T2V_BATCH_SIZE)+1;
            setState(previous=>({...previous,visualPrompts:items,demoState:'approved',demoScenes:[],demoSceneNumbers:[]}));
            setBatchProgress({batch:batchNumber,total:totalProjectBatches,start:batch[0].number,end:batch.at(-1)!.number,completed:items.length});
          });
        } catch(error) {
          if(error instanceof PromptBatchError){
            const batchNumber=Math.floor((error.batch[0].number-1)/T2V_BATCH_SIZE)+1;
            setBatchProgress({batch:batchNumber,total:totalProjectBatches,start:error.batch[0].number,end:error.batch.at(-1)!.number,completed:error.accumulated.length,error:error.message});
            toast.error(`Batch ${batchNumber} paused: ${error.message}`); return;
          }
          throw error;
        }
        toast.success(`All ${accumulated.length} ${imageMode?'image-to-video':'T2V'} prompts generated in ${totalProjectBatches} batch${totalProjectBatches===1?'':'es'}.`);
      }
    } catch(error) { toast.error(error instanceof Error?error.message:'T2V generation failed.'); }
    finally { setLoading(null); }
  };
  const completedNumbers = new Set(state.visualPrompts.map(prompt=>prompt.number).filter(number=>directions.some(direction=>direction.number===number)));
  const isComplete = directions.length > 0 && completedNumbers.size === directions.length;
  const isPartial = completedNumbers.size > 0 && !isComplete;
  const canResume = !isComplete && (isPartial || Boolean(batchProgress?.error));
  const shown = state.visualPrompts.length ? state.visualPrompts : state.demoScenes;
  const update = (number:number,field:'video_prompt'|'action_description'|'stock_keywords'|'image_prompt'|'animation_prompt',value:string) => setState(p=>({ ...p, visualPrompts:p.visualPrompts.map(x=>x.number===number?{...x,[field]:value,...(field==='animation_prompt'?{video_prompt:value}:{})}:x), demoScenes:p.demoScenes.map(x=>x.number===number?{...x,[field]:value,...(field==='animation_prompt'?{video_prompt:value}:{})}:x) }));
  const profileLabel = state.t2vPromptProfile === 'omni-flash' ? 'Gemini Omni Flash' : 'Veo / Google Flow';
  const sorted = [...shown].sort((a,b)=>a.number-b.number);
  const allText = sorted.map(prompt=>`${prompt.number}: ${prompt.video_prompt}`).join('\n\n');
  const timestampHeader = (number:number) => { const d=directions[number-1]; return `Scene ${number} [${formatTimestamp(d?.start||0)} - ${formatTimestamp(d?.end||0)}]`; };
  const allImageText = sorted.map(prompt=>`${timestampHeader(prompt.number)}\n${prompt.image_prompt||''}`).join('\n\n');
  const allAnimationText = sorted.map(prompt=>`${timestampHeader(prompt.number)}\n${prompt.animation_prompt||prompt.video_prompt}`).join('\n\n');
  const copyText = async (text:string,label:string) => toast[await copyToClipboard(text)?'success':'error'](`Copied ${label}.`);
  const csvColumns = 'profile,number,start,end,duration,chapter,beat,visual_family,story_function,visual_treatment,product_visibility,showdown_role,energy_level,camera_platform,graphic_subtype,graphic_claim,graphic_composition,graphic_motion,stage,state,action,voiceover';
  const directionCells = (p:T2VPrompt) => { const d=directions[p.number-1]; return [state.t2vPromptProfile,p.number,d?.start,d?.end,d?.duration,d?.chapter_id,d?.beat_id,d?.visual_family,d?.story_function,d?.visual_treatment,d?.product_visibility,d?.showdown_role,d?.energy_level,d?.camera_platform,d?.graphic_spec?.graphic_subtype,d?.graphic_spec?.visual_claim,d?.graphic_spec?.composition,d?.graphic_spec?.motion_pattern,p.stage_id,p.state,p.action_description,p.voiceover]; };
  const exportCsv = () => imageMode
    ? download('i2v-prompts.csv', [`${csvColumns},motion_archetype,image_prompt,animation_prompt,keywords,continuity`,...state.visualPrompts.map(p=>[...directionCells(p),p.i2vSections?.archetype,p.image_prompt,p.animation_prompt,p.stock_keywords,p.continuity_notes].map(csvCell).join(','))].join('\n'),'text/csv')
    : download('t2v-prompts.csv', [`${csvColumns},t2v_prompt,keywords,continuity,quality_flags`,...state.visualPrompts.map(p=>[...directionCells(p),p.video_prompt,p.stock_keywords,p.continuity_notes,(p.quality_flags||[]).join('|')].map(csvCell).join(','))].join('\n'),'text/csv');
  const exportImagePrompts = () => download('image-prompts.txt', allImageText, 'text/plain');
  const exportAnimationPrompts = () => download('animation-prompts.txt', allAnimationText, 'text/plain');
  const exportVo = () => download('timestamped-vo.txt', directions.map(d=>`[${formatTimestamp(d.start)} - ${formatTimestamp(d.end)}] Scene ${d.number}${d.silent?' [SILENT]':''}\n${d.voiceover}`).join('\n\n'),'text/plain');
  const canRecompile = imageMode || state.t2vPromptProfile==='omni-flash';
  const recompileAll = () => {
    if(!canRecompile)return;
    const promptCount=state.visualPrompts.length||state.demoScenes.length;
    if(!promptCount)return;
    setState(previous=>({
      ...previous,
      visualPrompts:imageMode?recompileI2VPrompts(previous.visualPrompts,directions,previous.topic,previous.t2vPromptProfile):recompileOmniPrompts(previous.visualPrompts,directions,previous.topic),
      demoScenes:imageMode?recompileI2VPrompts(previous.demoScenes,directions,previous.topic,previous.t2vPromptProfile):recompileOmniPrompts(previous.demoScenes,directions,previous.topic),
    }));
    toast.success(`Recompiled ${promptCount} ${imageMode?'image-to-video':'Omni'} prompt${promptCount===1?'':'s'} locally. No API request was made.`);
  };
  const clearOutput = { visualPrompts:[], demoScenes:[], demoSceneNumbers:[], demoState:'idle' as const };

  return <div className="space-y-6">
    <Button variant="link" className="p-0 text-muted-foreground" onClick={()=>setState(s=>({...s,phase:2}))}><ArrowLeft className="h-3 w-3 mr-1"/>Review Directions</Button>
    <div><h2 className="text-xl font-bold tracking-wider">PHASE 3 — {imageMode?'IMAGE-TO-VIDEO PROMPTS':'T2V PROMPTS'}</h2><p className="text-xs text-muted-foreground">{imageMode?'Each scene gets a still opening-frame image prompt plus a separate motion-only animation prompt, with the exact imported VO attached locally.':'Direct timestamped video prompts with the exact imported VO attached locally.'}</p></div>
    <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-2">
      <label className="text-[10px] font-bold tracking-widest text-muted-foreground">PROMPT TYPE</label>
      <div className="grid grid-cols-2 gap-2 max-w-md">
        {([['text-to-video','Text-to-Video'],['image-to-video','Image-to-Video']] as [Phase3Mode,string][]).map(([mode,label])=><Button key={mode} variant={state.phase3Mode===mode?'default':'outline'} disabled={!!loading} onClick={()=>{ if(state.phase3Mode===mode) return; setBatchProgress(null); setState(previous=>({...previous,phase3Mode:mode,...clearOutput})); }}>{label}</Button>)}
      </div>
      <p className="text-[10px] text-muted-foreground">{imageMode?'Image prompt: one frozen, sharp opening frame for an image model (Nano Banana / Imagen). Animation prompt: motion only, for animating that frame in Flow (Frames to Video) or Omni.':'One text-to-video prompt per scene.'} Switching type clears only generated Phase 3 output.</p>
      <label className="text-[10px] font-bold tracking-widest text-muted-foreground block pt-2">{imageMode?'ANIMATION TARGET PROFILE':'GOOGLE FLOW TARGET PROFILE'}</label>
      <Select value={state.t2vPromptProfile} onValueChange={(value) => setState(previous => ({ ...previous, t2vPromptProfile:value as T2VPromptProfile, ...clearOutput }))}>
        <SelectTrigger className="max-w-md"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="omni-flash">Gemini Omni Flash</SelectItem><SelectItem value="veo-flow">Veo / Google Flow</SelectItem></SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">Changing profile clears only generated Phase 3 output. Select the matching 8s/10s generation length in Flow; available lengths depend on the active Flow model.</p>
    </div>
    {!state.visualPrompts.length && !batchProgress?.error && <div className="grid md:grid-cols-2 gap-3"><Button variant="outline" className="h-12" disabled={!!loading} onClick={()=>generate(true)}>{loading==='demo'?<Loader2 className="animate-spin mr-2"/>:<Play className="h-4 w-4 mr-2"/>}GENERATE 3-SCENE DEMO</Button><Button className="h-12 font-bold" disabled={!!loading} onClick={()=>generate(false,false)}>{loading==='full'&&<Loader2 className="animate-spin mr-2"/>}GENERATE ALL · BATCHES OF 30</Button></div>}
    {state.demoScenes.length>0&&!state.visualPrompts.length&&!batchProgress?.error&&<Button className="w-full" disabled={!!loading} onClick={()=>generate(false,false)}>DEMO APPROVED — GENERATE FULL SET IN BATCHES</Button>}
    {canResume && !loading && <div className="grid md:grid-cols-2 gap-3"><Button className="h-12 font-bold" onClick={()=>generate(false,true)}><RefreshCw className="h-4 w-4 mr-2"/>RESUME FROM SCENE {missingDirections(directions,state.visualPrompts)[0]?.number}</Button><Button variant="outline" className="h-12" onClick={()=>generate(false,false)}>RESTART FULL GENERATION</Button></div>}
    {batchProgress && <div className={`rounded-lg border p-4 space-y-3 ${batchProgress.error?'border-red-500/40 bg-red-500/5':'border-primary/30 bg-primary/5'}`}>
      <div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-bold">{batchProgress.error?'GENERATION PAUSED':isComplete?'GENERATION COMPLETE':`BATCH ${batchProgress.batch} OF ${batchProgress.total}`}</span><span>{batchProgress.completed} / {directions.length} scenes completed</span></div>
      <Progress value={directions.length ? (batchProgress.completed/directions.length)*100 : 0}/>
      <div className="text-[10px] text-muted-foreground">Scenes {batchProgress.start}–{batchProgress.end} · fixed {T2V_BATCH_SIZE}-scene sequential batches</div>
      {batchProgress.error&&<div className="flex gap-2 text-xs text-red-400"><AlertCircle className="h-4 w-4 shrink-0"/>{batchProgress.error}</div>}
    </div>}
    {isComplete && !batchProgress && <Badge className="bg-green-600/20 text-green-500 border-green-500/30">GENERATION COMPLETE · {directions.length} SCENES</Badge>}
    {shown.length>0 && <div className="flex flex-wrap gap-2">
      {imageMode ? <>
        <Button variant="outline" onClick={()=>copyText(allImageText,`${shown.length} image prompt${shown.length===1?'':'s'}`)}><Copy className="h-4 w-4 mr-2"/>COPY ALL IMAGE PROMPTS</Button>
        <Button variant="outline" onClick={()=>copyText(allAnimationText,`${shown.length} animation prompt${shown.length===1?'':'s'}`)}><Copy className="h-4 w-4 mr-2"/>COPY ALL ANIMATION PROMPTS</Button>
      </> : <Button variant="outline" onClick={()=>copyText(allText,`${shown.length} prompt${shown.length===1?'':'s'} in scene order`)}><Copy className="h-4 w-4 mr-2"/>COPY ALL PROMPTS</Button>}
      {canRecompile&&<Button variant="outline" onClick={recompileAll}><RefreshCw className="h-4 w-4 mr-2"/>RECOMPILE ALL PROMPTS</Button>}
      {isComplete&&<>{imageMode&&<><Button variant="outline" onClick={exportImagePrompts}><Download className="h-4 w-4 mr-2"/>IMAGE PROMPTS</Button><Button variant="outline" onClick={exportAnimationPrompts}><Download className="h-4 w-4 mr-2"/>ANIMATION PROMPTS</Button></>}<Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2"/>CSV</Button><Button variant="outline" onClick={exportVo}><Download className="h-4 w-4 mr-2"/>TIMESTAMPED VO</Button></>}
    </div>}
    <div className="space-y-4">{shown.map(prompt=>{const d=directions[prompt.number-1];return <div key={prompt.number} className="border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap gap-2"><Badge>SCENE {prompt.number}</Badge><Badge variant="outline">{profileLabel}</Badge><Badge variant="outline">{formatTimestamp(d?.start||0)}–{formatTimestamp(d?.end||0)}</Badge><Badge variant="outline">{prompt.stage_id}</Badge><Badge variant="secondary">STATE {prompt.state}</Badge>{imageMode&&prompt.i2vSections?.archetype&&<Badge variant="outline">{prompt.i2vSections.archetype.replaceAll('_',' ')}</Badge>}</div>
      <label className="text-[10px] text-muted-foreground">ACTION</label><Textarea value={prompt.action_description} onChange={e=>update(prompt.number,'action_description',e.target.value)} className="min-h-[65px]"/>
      {imageMode ? <>
        <div className="flex items-center justify-between"><label className="text-[10px] text-primary font-bold">IMAGE PROMPT · OPENING FRAME</label><Button size="sm" variant="ghost" onClick={()=>copyText(prompt.image_prompt||'',`scene ${prompt.number} image prompt`)}><Copy className="h-3 w-3 mr-1"/>COPY</Button></div>
        <Textarea value={prompt.image_prompt||''} onChange={e=>update(prompt.number,'image_prompt',e.target.value)} className="min-h-[180px]"/>
        <div className="flex items-center justify-between"><label className="text-[10px] text-primary font-bold">ANIMATION PROMPT · MOTION ONLY</label><Button size="sm" variant="ghost" onClick={()=>copyText(prompt.animation_prompt||prompt.video_prompt,`scene ${prompt.number} animation prompt`)}><Copy className="h-3 w-3 mr-1"/>COPY</Button></div>
        <Textarea value={prompt.animation_prompt||prompt.video_prompt} onChange={e=>update(prompt.number,'animation_prompt',e.target.value)} className="min-h-[160px]"/>
      </> : <><label className="text-[10px] text-primary font-bold">T2V PROMPT</label><Textarea value={prompt.video_prompt} onChange={e=>update(prompt.number,'video_prompt',e.target.value)} className="min-h-[180px]"/></>}
      <div className="bg-muted/40 p-3 rounded text-xs"><div className="text-[10px] text-muted-foreground mb-1">EXACT IMPORTED VO {d?.silent?'· SILENT WINDOW':''}</div>{prompt.voiceover||'[SILENT]'}</div>
      <label className="text-[10px] text-muted-foreground">STOCK KEYWORDS</label><Textarea value={prompt.stock_keywords} onChange={e=>update(prompt.number,'stock_keywords',e.target.value)} className="min-h-[52px]"/>
    </div>})}</div>
  </div>;
}

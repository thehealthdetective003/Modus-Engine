import { Dispatch, SetStateAction, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { AlertCircle, ArrowLeft, Copy, Download, History, Loader2, Lock, Play, RefreshCw, Sparkles, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, OmniPromptSections, PromptRevision, T2VPrompt, T2VPromptProfile } from '../types';
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
import { compileOmniPrompt, defaultLocks, diagnosticsFor, hasBlockingIssues, normalizeOmniSections, validateOmniPrompt } from '../lib/omniPromptCompiler';

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
const revision = (reason:PromptRevision['reason'],prompt:T2VPrompt):PromptRevision => ({createdAt:new Date().toISOString(),reason,video_prompt:prompt.video_prompt,sections:prompt.omniSections});

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const download = (name: string, text: string, type: string) => { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); };

export function Phase4Visuals({ state, setState }: Props) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState<'demo'|'full'|null>(null);
  const [batchProgress, setBatchProgress] = useState<{ batch:number; total:number; start:number; end:number; completed:number; error?:string } | null>(null);
  const directions = state.sceneDirections;

  const requestPrompts = async (ai: GoogleGenAI, selected: typeof directions): Promise<T2VPrompt[]> => {
    const omni=state.t2vPromptProfile==='omni-flash';
    const response = await ai.models.generateContent({ model: settings.model, contents: JSON.stringify(buildFlowContext(state.topic, selected, state.t2vPromptProfile)), config: {
      responseMimeType:'application/json', responseSchema:omni?omniResponseSchema:responseSchema,
      systemInstruction:omni
        ? `Return one structured Omni Flash direction for every supplied scene and copy each scene number exactly. Fill prompt_sections with complete natural-language clauses for cinematography, subject, literal visible action, environment, style_lighting, product_state, synchronized ambient sound, and concise scene exclusions. The application compiles the final prose. Use one primary action and one camera behavior. Treat the production handoff as authoritative; preserve exact product counts, present and absent components, evidence confidence, geometry, stage chronology, and continuity. Never invent internals or future-stage components. Do not return voiceover, duration, headings, raw JSON text, or abstract narration.`
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
      const diagnostics=diagnosticsFor(direction,state.topic,directions);
      const validationIssues=validateOmniPrompt(video_prompt,sections,direction,state.topic,diagnostics,settings.omniSimilarityThreshold);
      const prompt:T2VPrompt={number:direction.number,stage_id:direction.stage_id,state:direction.state,action_description:String(item.action_description||direction.primary_action),video_prompt,voiceover:direction.voiceover,stock_keywords:String(item.stock_keywords||''),continuity_notes:String(item.continuity_notes||direction.continuity_from_previous),quality_flags:validationIssues.filter(issue=>issue.severity!=='info').map(issue=>issue.code),omniSections:sections,diagnostics,validationIssues,acceptedWarningCodes:[],locks:defaultLocks(),revisions:[]};
      prompt.revisions=[revision('generated',prompt)]; return prompt;
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
        toast.success('Demo T2V prompts generated.');
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
        toast.success(`All ${accumulated.length} T2V prompts generated in ${totalProjectBatches} batch${totalProjectBatches===1?'':'es'}.`);
      }
    } catch(error) { toast.error(error instanceof Error?error.message:'T2V generation failed.'); }
    finally { setLoading(null); }
  };
  const completedNumbers = new Set(state.visualPrompts.map(prompt=>prompt.number).filter(number=>directions.some(direction=>direction.number===number)));
  const isComplete = directions.length > 0 && completedNumbers.size === directions.length;
  const isPartial = completedNumbers.size > 0 && !isComplete;
  const canResume = !isComplete && (isPartial || Boolean(batchProgress?.error));
  const blockedPrompts=state.t2vPromptProfile==='omni-flash'?state.visualPrompts.filter(prompt=>hasBlockingIssues(prompt.validationIssues,prompt.acceptedWarningCodes)):[];
  const exportReady=isComplete&&blockedPrompts.length===0;
  const shown = state.visualPrompts.length ? state.visualPrompts : state.demoScenes;
  const update = (number:number,field:'video_prompt'|'action_description'|'stock_keywords',value:string) => setState(p=>({ ...p, visualPrompts:p.visualPrompts.map(x=>x.number===number?{...x,[field]:value}:x), demoScenes:p.demoScenes.map(x=>x.number===number?{...x,[field]:value}:x) }));
  const profileLabel = state.t2vPromptProfile === 'omni-flash' ? 'Gemini Omni Flash' : 'Veo / Google Flow';
  const replacePrompt=(number:number,transform:(prompt:T2VPrompt)=>T2VPrompt)=>setState(previous=>({...previous,visualPrompts:previous.visualPrompts.map(prompt=>prompt.number===number?transform(prompt):prompt),demoScenes:previous.demoScenes.map(prompt=>prompt.number===number?transform(prompt):prompt)}));
  const revalidate=(prompt:T2VPrompt,video_prompt=prompt.video_prompt,sections=prompt.omniSections)=>{const direction=directions.find(item=>item.number===prompt.number);if(!direction||!sections)return {...prompt,video_prompt};const diagnostics=diagnosticsFor(direction,state.topic,directions);return {...prompt,video_prompt,diagnostics,validationIssues:validateOmniPrompt(video_prompt,sections,direction,state.topic,diagnostics,settings.omniSimilarityThreshold)};};
  const editPrompt=(number:number,value:string)=>replacePrompt(number,prompt=>{const revisions=[...(prompt.revisions||[])];const last=revisions.at(-1);if(last?.reason==='manual-edit')revisions[revisions.length-1]={...last,video_prompt:value};else revisions.push(revision('manual-edit',{...prompt,video_prompt:value}));return {...revalidate(prompt,value),revisions};});
  const toggleLock=(number:number,name:'identity'|'assemblyState'|'camera'|'prompt')=>replacePrompt(number,prompt=>{const locks=prompt.locks||defaultLocks();return {...prompt,locks:{...locks,[name]:!locks[name]}};});
  const toggleSectionLock=(number:number,name:keyof OmniPromptSections)=>replacePrompt(number,prompt=>{const locks=prompt.locks||defaultLocks();return {...prompt,locks:{...locks,sections:{...locks.sections,[name]:!locks.sections[name]}}};});
  const acceptWarning=(number:number,code:string)=>replacePrompt(number,prompt=>({...prompt,acceptedWarningCodes:[...new Set([...(prompt.acceptedWarningCodes||[]),code])]}));
  const regenerateScene=async(number:number)=>{const current=state.visualPrompts.find(item=>item.number===number);const direction=directions.find(item=>item.number===number);if(!current||!direction||current.locks?.prompt)return toast.error('Unlock the prompt before regeneration.');const apiKey=settings.apiKey||process.env.GEMINI_API_KEY;if(!apiKey)return toast.error('Add a Gemini API key in Settings.');try{const fresh=(await requestPrompts(new GoogleGenAI({apiKey}),[direction]))[0];const locks=current.locks||defaultLocks();const sections={...fresh.omniSections!};if(locks.identity||locks.assemblyState)sections.product_state=current.omniSections?.product_state||sections.product_state;if(locks.camera)sections.cinematography=current.omniSections?.cinematography||sections.cinematography;for(const entry of Object.keys(locks.sections) as (keyof OmniPromptSections)[])if(locks.sections[entry])sections[entry]=current.omniSections?.[entry]||sections[entry];const compiled=compileOmniPrompt(sections,direction);const next=revalidate({...fresh,locks,acceptedWarningCodes:current.acceptedWarningCodes||[],revisions:[...(current.revisions||[]),revision('scene-regeneration',current)],omniSections:sections},compiled,sections);replacePrompt(number,()=>next);toast.success(`Scene ${number} regenerated.`);}catch(error){toast.error(error instanceof Error?error.message:'Scene regeneration failed.');}};
  const regenerateSection=async(number:number,section:keyof OmniPromptSections)=>{const current=state.visualPrompts.find(item=>item.number===number);const direction=directions.find(item=>item.number===number);if(!current||!direction||current.locks?.prompt||current.locks?.sections[section])return toast.error('Unlock this prompt section first.');const apiKey=settings.apiKey||process.env.GEMINI_API_KEY;if(!apiKey)return toast.error('Add a Gemini API key in Settings.');try{const ai=new GoogleGenAI({apiKey});const response=await ai.models.generateContent({model:settings.model,contents:JSON.stringify(buildFlowContext(state.topic,[direction],'omni-flash')),config:{responseMimeType:'application/json',responseSchema:{type:Type.OBJECT,required:['value'],properties:{value:{type:Type.STRING}}},systemInstruction:`Rewrite only the ${section} section for scene ${number}. Return one complete natural-language clause in value. Preserve the authoritative product, stage, geometry, counts, evidence, and all locked facts. Add no narration, duration, headings, or new technical facts.`}});const value=String(JSON.parse(response.text||'{}').value||'').trim();if(!value)throw new Error('Gemini returned an empty section.');const sections={...current.omniSections!,[section]:value};const compiled=compileOmniPrompt(sections,direction);const next=revalidate({...current,omniSections:sections,revisions:[...(current.revisions||[]),revision('section-regeneration',current)]},compiled,sections);replacePrompt(number,()=>next);toast.success(`${section.replace('_',' ')} regenerated.`);}catch(error){toast.error(error instanceof Error?error.message:'Section regeneration failed.');}};
  const rewriteClarity=async(number:number)=>{const current=state.visualPrompts.find(item=>item.number===number);if(!current||current.locks?.prompt||current.locks?.identity||current.locks?.assemblyState||current.locks?.camera)return toast.error('Unlock prompt, identity, state, and camera before clarity rewriting.');const apiKey=settings.apiKey||process.env.GEMINI_API_KEY;if(!apiKey)return toast.error('Add a Gemini API key in Settings.');try{const response=await new GoogleGenAI({apiKey}).models.generateContent({model:settings.model,contents:current.video_prompt,config:{responseMimeType:'application/json',responseSchema:{type:Type.OBJECT,required:['video_prompt'],properties:{video_prompt:{type:Type.STRING}}},systemInstruction:'Repair grammar and punctuation only. Preserve every technical fact, exact count, lifecycle state, geometry anchor, camera instruction, sound rule, and exclusion. Add no new facts. Return the complete prompt.'}});const value=String(JSON.parse(response.text||'{}').video_prompt||'').trim();if(!value)throw new Error('Gemini returned an empty rewrite.');const next=revalidate({...current,revisions:[...(current.revisions||[]),revision('clarity-rewrite',current)]},value);replacePrompt(number,()=>next);toast.success(`Scene ${number} rewritten for clarity.`);}catch(error){toast.error(error instanceof Error?error.message:'Clarity rewrite failed.');}};
  const allText = shown.map(p=>`${profileLabel.toUpperCase()} · SCENE ${p.number}\n${p.video_prompt}`).join('\n\n');
  const exportCsv = () => download('t2v-prompts.csv', ['profile,number,start,end,duration,stage,state,action,voiceover,t2v_prompt,keywords,continuity,quality_flags,validation_severity,accepted_warnings,similarity_score,evidence_confidence',...state.visualPrompts.map(p=>{const d=directions[p.number-1];const severity=p.validationIssues?.some(i=>i.severity==='error')?'error':p.validationIssues?.some(i=>i.severity==='warning'&&!p.acceptedWarningCodes?.includes(i.code))?'warning':'clear'; return [state.t2vPromptProfile,p.number,d?.start,d?.end,d?.duration,p.stage_id,p.state,p.action_description,p.voiceover,p.video_prompt,p.stock_keywords,p.continuity_notes,(p.quality_flags||[]).join('|'),severity,(p.acceptedWarningCodes||[]).join('|'),p.diagnostics?.similarityScore,p.diagnostics?.evidenceConfidence].map(csvCell).join(',')})].join('\n'),'text/csv');
  const exportVo = () => download('timestamped-vo.txt', directions.map(d=>`[${formatTimestamp(d.start)} - ${formatTimestamp(d.end)}] Scene ${d.number}${d.silent?' [SILENT]':''}\n${d.voiceover}`).join('\n\n'),'text/plain');

  return <div className="space-y-6">
    <Button variant="link" className="p-0 text-muted-foreground" onClick={()=>setState(s=>({...s,phase:2}))}><ArrowLeft className="h-3 w-3 mr-1"/>Review Directions</Button>
    <div><h2 className="text-xl font-bold tracking-wider">PHASE 3 — T2V PROMPTS</h2><p className="text-xs text-muted-foreground">Direct timestamped video prompts with the exact imported VO attached locally.</p></div>
    <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-2">
      <label className="text-[10px] font-bold tracking-widest text-muted-foreground">GOOGLE FLOW TARGET PROFILE</label>
      <Select value={state.t2vPromptProfile} onValueChange={(value) => setState(previous => ({ ...previous, t2vPromptProfile:value as T2VPromptProfile, visualPrompts:[], demoScenes:[], demoSceneNumbers:[], demoState:'idle' }))}>
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
    {isComplete && !batchProgress && <Badge className={exportReady?'bg-green-600/20 text-green-500 border-green-500/30':'bg-amber-600/20 text-amber-500 border-amber-500/30'}>{exportReady?`GENERATION COMPLETE · ${directions.length} SCENES`:`REVIEW REQUIRED · ${blockedPrompts.length} SCENES`}</Badge>}
    {isComplete && !exportReady && <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">Resolve validation errors and accept or correct each warning before complete-set export.</div>}
    {isComplete && <div className="flex flex-wrap gap-2">{exportReady&&<><Button variant="outline" onClick={async()=>toast[await copyToClipboard(allText)?'success':'error']('T2V prompts copied')}><Copy className="h-4 w-4 mr-2"/>COPY T2V PROMPTS</Button><Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2"/>CSV</Button></>}<Button variant="outline" onClick={exportVo}><Download className="h-4 w-4 mr-2"/>TIMESTAMPED VO</Button></div>}
    <div className="space-y-4">{shown.map(prompt=>{const d=directions[prompt.number-1];const omni=state.t2vPromptProfile==='omni-flash'&&!!prompt.omniSections;const locks=prompt.locks||defaultLocks(); return <div key={prompt.number} className="border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap gap-2"><Badge>SCENE {prompt.number}</Badge><Badge variant="outline">{profileLabel}</Badge><Badge variant="outline">{formatTimestamp(d?.start||0)}–{formatTimestamp(d?.end||0)}</Badge><Badge variant="outline">{prompt.stage_id}</Badge><Badge variant="secondary">STATE {prompt.state}</Badge></div>
      {omni&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>regenerateScene(prompt.number)} disabled={locks.prompt}><RefreshCw className="h-3.5 w-3.5 mr-1"/>REGENERATE SCENE</Button><Button size="sm" variant="outline" onClick={()=>rewriteClarity(prompt.number)} disabled={locks.prompt||locks.identity||locks.assemblyState||locks.camera}><Sparkles className="h-3.5 w-3.5 mr-1"/>REWRITE FOR CLARITY</Button>{(['identity','assemblyState','camera','prompt'] as const).map(name=><Button key={name} size="sm" variant={locks[name]?'default':'outline'} onClick={()=>toggleLock(prompt.number,name)}>{locks[name]?<Lock className="h-3.5 w-3.5 mr-1"/>:<Unlock className="h-3.5 w-3.5 mr-1"/>}{name.replace(/([A-Z])/g,' $1').toUpperCase()}</Button>)}</div>}
      <label className="text-[10px] text-muted-foreground">ACTION</label><Textarea value={prompt.action_description} onChange={e=>update(prompt.number,'action_description',e.target.value)} className="min-h-[65px]"/>
      <label className="text-[10px] text-primary font-bold">T2V PROMPT</label><Textarea value={prompt.video_prompt} disabled={locks.prompt} onChange={e=>omni?editPrompt(prompt.number,e.target.value):update(prompt.number,'video_prompt',e.target.value)} className="min-h-[180px]"/>
      {omni&&<details className="rounded border border-border/50 p-3"><summary className="cursor-pointer text-[10px] font-bold tracking-widest">STRUCTURED PROMPT SECTIONS</summary><div className="mt-3 space-y-3">{(Object.keys(prompt.omniSections!) as (keyof OmniPromptSections)[]).map(section=><div key={section} className="grid gap-2 md:grid-cols-[150px_1fr_auto_auto] items-start"><span className="text-[10px] uppercase text-muted-foreground pt-2">{section.replace('_',' ')}</span><div className="text-xs rounded bg-muted/30 p-2">{prompt.omniSections![section]}</div><Button size="sm" variant="outline" disabled={locks.prompt||locks.sections[section]} onClick={()=>regenerateSection(prompt.number,section)}><RefreshCw className="h-3.5 w-3.5"/></Button><Button size="sm" variant={locks.sections[section]?'default':'outline'} onClick={()=>toggleSectionLock(prompt.number,section)}>{locks.sections[section]?<Lock className="h-3.5 w-3.5"/>:<Unlock className="h-3.5 w-3.5"/>}</Button></div>)}</div></details>}
      {omni&&!!prompt.validationIssues?.length&&<div className="space-y-2">{prompt.validationIssues.map(issue=>{const accepted=prompt.acceptedWarningCodes?.includes(issue.code);return <div key={`${issue.code}-${issue.message}`} className={`rounded border p-2 text-xs ${issue.severity==='error'?'border-red-500/30 text-red-400':issue.severity==='warning'?'border-amber-500/30 text-amber-400':'border-blue-500/30 text-blue-400'}`}><div className="flex justify-between gap-2"><span><b>{issue.severity.toUpperCase()}</b> · {issue.message}</span>{issue.severity==='warning'&&!accepted&&<Button size="sm" variant="outline" onClick={()=>acceptWarning(prompt.number,issue.code)}>ACCEPT</Button>}{accepted&&<Badge variant="outline">ACCEPTED</Badge>}</div></div>})}</div>}
      {omni&&prompt.diagnostics&&<details className="rounded border border-border/50 p-3"><summary className="cursor-pointer text-[10px] font-bold tracking-widest">DIAGNOSTICS · SIMILARITY {Math.round(prompt.diagnostics.similarityScore*100)}%</summary><pre className="mt-3 whitespace-pre-wrap text-[10px] text-muted-foreground">{JSON.stringify(prompt.diagnostics,null,2)}</pre></details>}
      {omni&&!!prompt.revisions?.length&&<details className="rounded border border-border/50 p-3"><summary className="cursor-pointer text-[10px] font-bold tracking-widest flex items-center gap-2"><History className="h-3.5 w-3.5"/>ORIGINAL / REVISION HISTORY ({prompt.revisions.length})</summary><div className="mt-3 space-y-3">{prompt.revisions.map((item,index)=><div key={`${item.createdAt}-${index}`} className="rounded bg-muted/30 p-3"><div className="text-[10px] text-muted-foreground mb-1">{item.reason.toUpperCase()} · {new Date(item.createdAt).toLocaleString()}</div><div className="text-xs">{item.video_prompt}</div></div>)}</div></details>}
      <div className="bg-muted/40 p-3 rounded text-xs"><div className="text-[10px] text-muted-foreground mb-1">EXACT IMPORTED VO {d?.silent?'· SILENT WINDOW':''}</div>{prompt.voiceover||'[SILENT]'}</div>
      <label className="text-[10px] text-muted-foreground">STOCK KEYWORDS</label><Textarea value={prompt.stock_keywords} onChange={e=>update(prompt.number,'stock_keywords',e.target.value)} className="min-h-[52px]"/>
    </div>})}</div>
  </div>;
}

import { Dispatch, SetStateAction, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { ArrowLeft, Copy, Download, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, SceneDirection, T2VPrompt } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useSettings } from './SettingsContext';
import { copyToClipboard } from '@/lib/utils';
import { formatTimestamp } from '../lib/timedTranscript';

interface Props { state: AppState; setState: Dispatch<SetStateAction<AppState>>; }
const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['number','action_description','video_prompt','stock_keywords'], properties: {
  number: { type: Type.INTEGER }, action_description: { type: Type.STRING }, video_prompt: { type: Type.STRING }, stock_keywords: { type: Type.STRING },
  continuity_notes: { type: Type.STRING }, quality_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
}}};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const download = (name: string, text: string, type: string) => { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); };

function applyLocks(prompt: string, direction: SceneDirection, topic: any): string {
  const required = direction.required_visible_features.join(', ');
  const forbidden = [...direction.forbidden_elements, ...(topic?.visual_exclusions || []), topic?.negative_prompt_global].filter(Boolean).join(', ');
  const stateLock = direction.state === 'C' ? String(topic?.visual_lock || topic?.product_identity_lock || '') : `Preserve State ${direction.state} incompleteness: ${direction.product_visual_state}.`;
  return [`Exact ${direction.duration.toFixed(3)}-second shot.`, prompt.trim(), stateLock, required && `Required visible features: ${required}.`, forbidden && `Forbidden elements / global negatives: ${forbidden}.`].filter(Boolean).join(' ');
}

export function Phase4Visuals({ state, setState }: Props) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState<'demo'|'full'|null>(null);
  const directions = state.sceneDirections;

  const generate = async (demo: boolean) => {
    if (!directions.length) return toast.error('Approve valid Phase 2 directions first.');
    const apiKey = settings.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return toast.error('Add a Gemini API key in Settings.');
    const selected = demo ? directions.slice(0, Math.min(3,directions.length)) : directions;
    setLoading(demo ? 'demo' : 'full');
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({ model: settings.model, contents: JSON.stringify({ topic: state.topic, scene_directions: selected }), config: {
        responseMimeType:'application/json', responseSchema,
        systemInstruction:`Create direct text-to-video prompts only. Return exactly one item per supplied scene and copy its number. Do not return or rewrite voiceover. Each video_prompt must cover the exact supplied duration and explicitly use the supplied subject, one primary action, supporting motion, environment, camera scale/lens/angle/movement/speed, lighting/material, transition and continuity. Preserve State A/B incompleteness. Apply State C visual locks verbatim. Include every required visible feature, scene forbidden element, and global negative. Do not invent components or extra actions. Use physical camera-visible language, not abstract narration.`,
      }});
      const raw:any[] = JSON.parse(response.text || '[]');
      const byNumber = new Map(raw.map(item=>[Number(item.number),item]));
      const prompts:T2VPrompt[] = selected.map(direction => { const item=byNumber.get(direction.number); if(!item) throw new Error(`Gemini omitted scene ${direction.number}.`); return {
        number:direction.number, stage_id:direction.stage_id, state:direction.state, action_description:String(item.action_description||direction.primary_action),
        video_prompt:applyLocks(String(item.video_prompt||''),direction,state.topic), voiceover:direction.voiceover,
        stock_keywords:String(item.stock_keywords||''), continuity_notes:String(item.continuity_notes||direction.continuity_from_previous), quality_flags:Array.isArray(item.quality_flags)?item.quality_flags:[],
      }; });
      if (demo) setState(p=>({...p,demoState:'generated',demoScenes:prompts,demoSceneNumbers:prompts.map(x=>x.number)}));
      else setState(p=>({...p,visualPrompts:prompts,demoState:'approved',demoScenes:[],demoSceneNumbers:[]}));
      toast.success(`${demo?'Demo':'Full'} T2V prompts generated.`);
    } catch(error) { toast.error(error instanceof Error?error.message:'T2V generation failed.'); }
    finally { setLoading(null); }
  };
  const shown = state.visualPrompts.length ? state.visualPrompts : state.demoScenes;
  const update = (number:number,field:'video_prompt'|'action_description'|'stock_keywords',value:string) => setState(p=>({ ...p, visualPrompts:p.visualPrompts.map(x=>x.number===number?{...x,[field]:value}:x), demoScenes:p.demoScenes.map(x=>x.number===number?{...x,[field]:value}:x) }));
  const allText = shown.map(p=>`SCENE ${p.number}\n${p.video_prompt}`).join('\n\n');
  const exportCsv = () => download('t2v-prompts.csv', ['number,start,end,duration,stage,state,action,voiceover,t2v_prompt,keywords,continuity,quality_flags',...state.visualPrompts.map(p=>{const d=directions[p.number-1]; return [p.number,d?.start,d?.end,d?.duration,p.stage_id,p.state,p.action_description,p.voiceover,p.video_prompt,p.stock_keywords,p.continuity_notes,(p.quality_flags||[]).join('|')].map(csvCell).join(',')})].join('\n'),'text/csv');
  const exportVo = () => download('timestamped-vo.txt', directions.map(d=>`[${formatTimestamp(d.start)} - ${formatTimestamp(d.end)}] Scene ${d.number}${d.silent?' [SILENT]':''}\n${d.voiceover}`).join('\n\n'),'text/plain');

  return <div className="space-y-6">
    <Button variant="link" className="p-0 text-muted-foreground" onClick={()=>setState(s=>({...s,phase:2}))}><ArrowLeft className="h-3 w-3 mr-1"/>Review Directions</Button>
    <div><h2 className="text-xl font-bold tracking-wider">PHASE 3 — T2V PROMPTS</h2><p className="text-xs text-muted-foreground">Direct timestamped video prompts with exact Whisper VO attached locally.</p></div>
    {!state.visualPrompts.length && <div className="grid md:grid-cols-2 gap-3"><Button variant="outline" className="h-12" disabled={!!loading} onClick={()=>generate(true)}>{loading==='demo'?<Loader2 className="animate-spin mr-2"/>:<Play className="h-4 w-4 mr-2"/>}GENERATE 3-SCENE DEMO</Button><Button className="h-12 font-bold" disabled={!!loading} onClick={()=>generate(false)}>{loading==='full'&&<Loader2 className="animate-spin mr-2"/>}GENERATE ALL T2V PROMPTS</Button></div>}
    {state.demoScenes.length>0&&!state.visualPrompts.length&&<Button className="w-full" disabled={!!loading} onClick={()=>generate(false)}>DEMO APPROVED — GENERATE FULL SET</Button>}
    {shown.length>0 && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={async()=>toast[await copyToClipboard(allText)?'success':'error']('T2V prompts copied')}><Copy className="h-4 w-4 mr-2"/>COPY T2V PROMPTS</Button>{state.visualPrompts.length>0&&<><Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2"/>CSV</Button><Button variant="outline" onClick={exportVo}><Download className="h-4 w-4 mr-2"/>TIMESTAMPED VO</Button></>}</div>}
    <div className="space-y-4">{shown.map(prompt=>{const d=directions[prompt.number-1]; return <div key={prompt.number} className="border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap gap-2"><Badge>SCENE {prompt.number}</Badge><Badge variant="outline">{formatTimestamp(d?.start||0)}–{formatTimestamp(d?.end||0)}</Badge><Badge variant="outline">{prompt.stage_id}</Badge><Badge variant="secondary">STATE {prompt.state}</Badge></div>
      <label className="text-[10px] text-muted-foreground">ACTION</label><Textarea value={prompt.action_description} onChange={e=>update(prompt.number,'action_description',e.target.value)} className="min-h-[65px]"/>
      <label className="text-[10px] text-primary font-bold">T2V PROMPT</label><Textarea value={prompt.video_prompt} onChange={e=>update(prompt.number,'video_prompt',e.target.value)} className="min-h-[180px]"/>
      <div className="bg-muted/40 p-3 rounded text-xs"><div className="text-[10px] text-muted-foreground mb-1">EXACT WHISPER VO {d?.silent?'· SILENT WINDOW':''}</div>{prompt.voiceover||'[SILENT]'}</div>
      <label className="text-[10px] text-muted-foreground">STOCK KEYWORDS</label><Textarea value={prompt.stock_keywords} onChange={e=>update(prompt.number,'stock_keywords',e.target.value)} className="min-h-[52px]"/>
    </div>})}</div>
  </div>;
}

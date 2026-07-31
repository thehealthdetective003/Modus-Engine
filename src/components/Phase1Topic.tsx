import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Download, Copy, ChevronDown, ChevronUp, AlertCircle, AlertTriangle, ArrowRight, FileJson, Factory, Cog } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, HandoffMode, TopicBrief } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn, copyToClipboard } from '@/lib/utils';
import { normalizeTopicBrief, validateAdaptiveBrief, validateAdaptiveWarnings, getLifecycleStageCount, getNegativePromptGlobal } from '../lib/adaptiveSchema';
import { StandardPreview } from './previews/StandardPreview';
import { useSettings } from './SettingsContext';
import { DEFAULT_PRODUCTION_TEMPLATE, normalizeVisualHandoff, productionTemplatePrompt } from '../lib/productionTemplate';
import { HANDOFF_MODE_LABELS, HandoffValidationResult, handoffModeFor, parseAndValidateHandoffJsonForMode, validateHandoffForMode } from '../lib/handoffValidation';
import { EngineeringHandoffInspector } from './previews/EngineeringHandoffInspector';
import type { VisualEngineeringHandoffV3 } from '../types/visualEngineeringV3';
interface Phase1TopicProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}
export function Phase1Topic({ state, setState }: Phase1TopicProps) {
  const { settings } = useSettings();
  const activeProductionTemplate = settings.productionTemplate || DEFAULT_PRODUCTION_TEMPLATE;
  const standardBlankTemplate = JSON.stringify(activeProductionTemplate, null, 2);
  const [jsonInput, setJsonInput] = useState('');
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [showPasteEditor, setShowPasteEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isValid, setIsValid] = useState(false);
  const [parsedBrief, setParsedBrief] = useState<TopicBrief | null>(null);
  const [validationResult, setValidationResult] = useState<HandoffValidationResult | null>(null);
  const [selectedMode, setSelectedMode] = useState<HandoffMode|null>(state.handoffMode);
  const activeTemplateMode=handoffModeFor(activeProductionTemplate);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (isValid && parsedBrief) {
          handleLockTopic();
        } else {
          handleValidate();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isValid, parsedBrief, jsonInput, selectedMode]);
  useEffect(() => {
    if (state.topic && !jsonInput) {
      const mode=state.handoffMode||handoffModeFor(state.rawHandoff||state.topic);
      const source=state.rawHandoff||state.topic._production_handoff||state.topic;
      setSelectedMode(mode);
      setJsonInput(JSON.stringify(source, null, 2));
      setParsedBrief(state.topic);
      const result = mode?validateHandoffForMode(source,mode):null;
      setValidationResult(result);
      setIsValid(Boolean(result?.valid));
    }
  }, [state.topic, state.handoffMode, state.rawHandoff, jsonInput]);
  useEffect(()=>{
    if(!state.topic&&!state.handoffMode&&!state.rawHandoff){
      setSelectedMode(null);setJsonInput('');setShowPasteEditor(false);setValidationResult(null);setParsedBrief(null);setIsValid(false);setError(null);setWarnings([]);
    }
  },[state.topic,state.handoffMode,state.rawHandoff]);
  const chooseMode=(mode:HandoffMode)=>{
    if(mode===selectedMode)return;
    setSelectedMode(mode);
    setValidationResult(null);setParsedBrief(null);setIsValid(false);setError(null);setWarnings([]);
  };
  const handleDownloadTemplate = () => {
    if(!selectedMode){toast.error('Select a handoff type first.');return;}
    if(activeTemplateMode!==selectedMode){toast.error(`The active Settings template is ${activeTemplateMode?HANDOFF_MODE_LABELS[activeTemplateMode]:'not recognized'}. Import a matching template in Settings first.`);return;}
    const template = standardBlankTemplate;
    const blob = new Blob([template], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedMode==='ENGINEERING_V3'?'visual-engineering-handoff-v3-template.json':'visual-production-handoff-v2-template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };
  const handleCopyPrompt = async () => {
    if(!selectedMode){toast.error('Select a handoff type first.');return;}
    if(activeTemplateMode!==selectedMode){toast.error('The active Settings template does not match the selected handoff type.');return;}
    const promptText = productionTemplatePrompt(activeProductionTemplate);
    const success = await copyToClipboard(promptText);
    if (success) {
      toast.success('Research prompt copied to clipboard');
    } else {
      toast.error('Copy failed. Please copy manually.');
    }
  };
  const handleImportBrief = async (file: File) => {
    if(!selectedMode){toast.error('Select a handoff type before importing JSON.');return;}
    try {
      const fileText=await file.text();
      const {data:parsed,result}=parseAndValidateHandoffJsonForMode(fileText,selectedMode);
      if(!parsed){
        setValidationResult(result);setError('Invalid JSON file. Check its syntax and try again.');
        return;
      }
      setJsonInput(JSON.stringify(parsed, null, 2));
      setShowPasteEditor(true);
      setValidationResult(result);
      setIsValid(false); setParsedBrief(null); setError(null); setWarnings([]);
      if (result.valid) toast.success(`${result.status} imported. Validate and load it to continue.`);
      else {
        setError('Invalid handoff JSON. Fix the listed errors before loading it.');
        toast.error('Invalid handoff JSON. The current project was not changed.');
      }
    } catch {
      setValidationResult(validateHandoffForMode(null,selectedMode));
      setError('Invalid JSON file. Check its syntax and try again.');
    }
  };
  const handleValidate = () => {
    setError(null);
    setWarnings([]);
    setIsValid(false);
    setParsedBrief(null);
    setValidationResult(null);
    if(!selectedMode){setError('Select Factory Manufacturing Handoff or Visual Engineering Handoff V3 first.');return;}
    if (!jsonInput.trim()) {
      setError('Please paste some JSON first.');
      return;
    }
    try {
      const {data:parsed,result}=parseAndValidateHandoffJsonForMode(jsonInput,selectedMode);
      setValidationResult(result);
      if (!parsed||!result.valid) {
        setError('Invalid handoff JSON. Fix the listed schema or reference errors before loading it.');
        return;
      }
      const normalized = ['v1','v2','v3'].includes(result.format) ? normalizeVisualHandoff(parsed) : normalizeTopicBrief(parsed);
      const manufacturing=result.mode==='MANUFACTURING_V2';
      const missing = manufacturing?validateAdaptiveBrief(normalized):[];
      const adaptiveWarnings = manufacturing?validateAdaptiveWarnings(normalized):[];
      
      if (missing.length > 0) {
        setWarnings([...missing.map(item => `Missing: ${item}`), ...adaptiveWarnings]);
        // We still allow it if it's valid JSON, but user needs to be aware
        setParsedBrief(normalized as TopicBrief);
        setIsValid(true);
      } else {
        setWarnings(adaptiveWarnings);
        setParsedBrief(normalized as TopicBrief);
        setIsValid(true);
      }
    } catch (e) {
      setValidationResult(validateHandoffForMode(null,selectedMode));
      setError('Invalid JSON. Check your brackets and quotes.');
    }
  };
  const handleLockTopic = () => {
    if (!parsedBrief||!selectedMode||!validationResult?.valid||validationResult.selectedMode!==selectedMode) return;
    
    setState((prev) => ({
      ...prev,
      topic: parsedBrief,
      handoffMode:selectedMode,
      schemaVersion:validationResult?.version||parsedBrief.schema_version||null,
      rawHandoff:parsedBrief._production_handoff||null,
      scenePlanFormatVersion:selectedMode==='ENGINEERING_V3'?3:2,
      masterVoiceoverScript: parsedBrief.master_voiceover_script || '',
      projectName: parsedBrief.topic?.product || parsedBrief.topic?.title || "Untitled",
      plannedScenes: [], sceneDirections: [], visualPrompts: [], demoScenes: [], demoSceneNumbers: [], demoState: 'idle',
      phase: 2,
    }));
  };
  let declaredContractType='—';
  try{declaredContractType=String(JSON.parse(jsonInput)?.schema?.contract_type||'—');}catch{}
  const selectedModeLabel=selectedMode?HANDOFF_MODE_LABELS[selectedMode]:'Not selected';
  return (
    <div className="flex flex-col h-full w-full space-y-6 pb-20">
      {/* 1. TOP SECTION - Instructions */}
      <Collapsible
        open={isHowToOpen}
        onOpenChange={setIsHowToOpen}
        className="bg-muted/10 border border-border rounded-lg overflow-hidden"
      >
        <CollapsibleTrigger className="w-full flex justify-between items-center p-4 h-auto hover:bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 transition-all">
          <span className="font-mono text-amber-500 font-bold tracking-widest text-sm">HOW TO USE</span>
          {isHowToOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 pt-0 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Choose the contract that produced your handoff, then import or paste its JSON. The selected contract controls validation, review, storage, scene planning, and prompt generation.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleDownloadTemplate}
              className="font-mono text-[10px] h-8 bg-muted/20 border-border hover:bg-muted/40"
            >
              <Download className="h-3 w-3 mr-2" />
              Download blank template
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleCopyPrompt}
              className="font-mono text-[10px] h-8 bg-muted/20 border-border hover:bg-muted/40"
            >
              <Copy className="h-3 w-3 mr-2" />
              Copy LLM prompt
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-mono font-bold tracking-widest text-amber-500">SELECT HANDOFF TYPE</p>
          <p className="text-[11px] text-muted-foreground mt-1">Required before JSON input. The app will never silently switch validators.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <button
            type="button"
            aria-pressed={selectedMode==='MANUFACTURING_V2'}
            onClick={()=>chooseMode('MANUFACTURING_V2')}
            className={cn('text-left rounded-xl border p-4 transition-all',selectedMode==='MANUFACTURING_V2'?'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/20':'border-border bg-card hover:border-amber-500/40')}
          >
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-mono font-bold text-sm"><Factory className="h-4 w-4"/>FACTORY MANUFACTURING HANDOFF</span>{selectedMode==='MANUFACTURING_V2'&&<CheckCircle2 className="h-5 w-5 text-amber-500"/>}</div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">Manufacturing stages, factory flow, assembly progression, production environments, and stage transitions.</p>
            <p className="text-[10px] font-mono mt-3 text-amber-500/80">V2 · PRODUCTION STAGES · FACTORY LIFECYCLE</p>
          </button>
          <button
            type="button"
            aria-pressed={selectedMode==='ENGINEERING_V3'}
            onClick={()=>chooseMode('ENGINEERING_V3')}
            className={cn('text-left rounded-xl border p-4 transition-all',selectedMode==='ENGINEERING_V3'?'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20':'border-border bg-card hover:border-violet-500/40')}
          >
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-mono font-bold text-sm"><Cog className="h-4 w-4"/>VISUAL ENGINEERING HANDOFF V3</span>{selectedMode==='ENGINEERING_V3'&&<CheckCircle2 className="h-5 w-5 text-violet-400"/>}</div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">Engineering systems, operational states, evidence boundaries, system relationships, and visual-story chapters.</p>
            <p className="text-[10px] font-mono mt-3 text-violet-400/80">V3.0.0 · EVIDENCE · SYSTEMS · STATES</p>
          </button>
        </div>
      </div>
      {/* 2. MIDDLE SECTION - JSON Paste */}
      <div className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3">
          <Button disabled={!selectedMode} className="relative h-14 bg-amber-500 hover:bg-amber-600 text-amber-950 font-bold tracking-widest disabled:opacity-40">
            <FileJson className="h-5 w-5 mr-2"/>IMPORT HANDOFF JSON
            <input disabled={!selectedMode} type="file" accept=".json,application/json" className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed" onChange={event=>{const file=event.target.files?.[0]; if(file) handleImportBrief(file); event.currentTarget.value='';}}/>
          </Button>
          <Button disabled={!selectedMode} variant="outline" className="h-14" onClick={()=>setShowPasteEditor(value=>!value)}>{showPasteEditor?'HIDE JSON EDITOR':'PASTE JSON (OPTIONAL)'}</Button>
        </div>
        {!selectedMode&&<div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500 font-mono">Select one handoff type to enable import and paste controls.</div>}
        <div className="space-y-2 block">
          {/* Left Column: Existing JSON Blueprint Box */}
          <div className="space-y-2 block">
            {showPasteEditor && <><label className="text-xs font-mono font-bold tracking-wider text-amber-500/80 uppercase">
              PROJECT JSON BLUEPRINT [IMPORT REVIEW / OPTIONAL PASTE]
            </label>
            <div className="relative block">
              <Textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  setIsValid(false);
                  setParsedBrief(null);
                  setError(null);
                  setWarnings([]);
                  setValidationResult(null);
                }}
                placeholder="{ paste your completed topic brief JSON here... }"
                className="h-[500px] overflow-y-auto resize-none font-mono text-xs bg-muted/30 dark:bg-[#040406] border-border/60 hover:border-amber-500/20 focus-visible:ring-amber-500/50 p-4 text-foreground dark:text-amber-100 shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)] focus-visible:border-amber-500/50 rounded-md"
              />
              <div className="absolute top-3 right-3 text-amber-500/20 pointer-events-none">
                <FileJson className="h-8 w-8" />
              </div>
            </div></>}
          </div>
        </div>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-xs font-mono"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </motion.div>
        )}
        {validationResult && (
          <div className={cn('rounded-xl border p-4 font-mono text-xs space-y-4',validationResult.valid?'border-green-500/30 bg-green-500/5':'border-destructive/30 bg-destructive/5')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={cn('font-bold uppercase tracking-wider',validationResult.valid?'text-green-400':'text-destructive')}>{validationResult.status}</div>
              <Badge variant="outline">{selectedModeLabel}</Badge>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                ['JSON SYNTAX',validationResult.syntaxErrors.length?'FAILED':'PASSED'],
                ['SELECTED TYPE',selectedModeLabel],
                ['DECLARED CONTRACT',`${validationResult.schemaName||'Unknown'} · ${validationResult.version||'No version'} · ${declaredContractType}`],
                ['IMPORT READINESS',validationResult.valid?'READY':'BLOCKED'],
              ].map(([label,value])=><div key={label} className="rounded border border-border/50 bg-background/40 p-3"><div className="text-[9px] text-muted-foreground tracking-widest">{label}</div><div className="mt-1 text-[10px] font-bold break-words">{value}</div></div>)}
            </div>
            {validationResult.schemaErrors.length>0&&<div><div className="font-bold text-destructive">SCHEMA / MODE</div><ul className="mt-2 list-disc space-y-1 pl-5">{validationResult.schemaErrors.map((item,index)=><li key={`${item.path}-${item.code}-${index}`}><span className="font-bold">{item.path}</span>: {item.message}{item.suggestedCorrection&&<span className="text-muted-foreground"> — {item.suggestedCorrection}</span>}</li>)}</ul></div>}
            {validationResult.semanticErrors.filter(item=>item.severity==='error').length>0&&<div><div className="font-bold text-destructive">REFERENTIAL & CONTRACT REVIEW</div><ul className="mt-2 list-disc space-y-1 pl-5">{validationResult.semanticErrors.filter(item=>item.severity==='error').map((item,index)=><li key={`${item.path}-${item.code}-${index}`}><span className="font-bold">{item.path}</span>: {item.message}{item.suggestedCorrection&&<span className="text-muted-foreground"> — {item.suggestedCorrection}</span>}</li>)}</ul></div>}
            {validationResult.warnings.length>0&&<div><div className="font-bold text-amber-500">REVIEW WARNINGS · {validationResult.warnings.length}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-amber-500">{validationResult.warnings.map((item,index)=><li key={`${item.path}-${item.code}-${index}`}><span className="font-bold">{item.path}</span>: {item.message}</li>)}</ul></div>}
          </div>
        )}
        {warnings.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-500 text-xs font-mono space-y-1"
          >
            <div className="flex items-center gap-2 font-bold mb-1">
              <AlertTriangle className="h-4 w-4" />
              REVIEW WARNINGS
            </div>
            <ul className="list-disc list-inside grid grid-cols-2 gap-x-4">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </motion.div>
        )}
        <div className="relative">
          <Button
            onClick={handleValidate}
            disabled={!selectedMode}
            className={cn(
              "w-full h-14 font-bold text-lg tracking-widest transition-all duration-300",
              isValid 
                ? "bg-green-600 hover:bg-green-700 text-white" 
                : "bg-amber-500 hover:bg-amber-600 text-amber-950"
            )}
          >
            {isValid ? (
              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="flex items-center">
                <CheckCircle2 className="h-5 w-5 mr-2" />
                VALIDATED
              </motion.div>
            ) : (
              selectedMode?'VALIDATE & LOAD':'SELECT HANDOFF TYPE FIRST'
            )}
          </Button>
          <div className="absolute -bottom-5 inset-x-0 text-center text-[10px] text-muted-foreground/60 hidden md:block">
            Shortcut: Ctrl+Enter
          </div>
        </div>
      </div>
      {/* 3. BOTTOM SECTION - Preview Panel */}
      <AnimatePresence>
        {isValid && parsedBrief && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">
                    {validationResult?.status.toUpperCase() || 'VALID LEGACY V1'}
                  </Badge>
                  {validationResult?.format === 'v2' && (() => {
                    const source = parsedBrief._production_handoff as any;
                    const chapters = source?.visual_story_plan?.chapters || [];
                    const beatCount = chapters.reduce((total: number, chapter: any) => total + (chapter.visual_beats?.length || 0), 0);
                    return <>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">V{validationResult.version}</Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">{chapters.length} CHAPTERS</Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">{beatCount} BEATS</Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">{source?.environments?.length || 0} ENVIRONMENTS</Badge>
                    </>;
                  })()}
                  {validationResult?.format === 'v3' && (() => {
                    const source=parsedBrief._production_handoff as VisualEngineeringHandoffV3;
                    const chapters=source.visual_story_plan.chapters,beatCount=chapters.reduce((total,chapter)=>total+chapter.visual_beats.length,0);
                    return <><Badge variant="outline" className="font-mono text-[10px] border-violet-500/30 text-violet-400 bg-violet-500/5">LOCKED · ENGINEERING V3 · {validationResult.version}</Badge><Badge variant="outline">{source.evidence_boundaries.claims.length} CLAIMS</Badge><Badge variant="outline">{source.engineering_systems.length} SYSTEMS</Badge><Badge variant="outline">{source.operational_states.length} STATES</Badge><Badge variant="outline">{source.system_relationships.length} RELATIONSHIPS</Badge><Badge variant="outline">{source.concept_bridges.length} BRIDGES</Badge><Badge variant="outline">{source.environments.length} ENVIRONMENTS</Badge><Badge variant="outline">{chapters.length} CHAPTERS</Badge><Badge variant="outline">{beatCount} BEATS</Badge></>;
                  })()}
                  {validationResult?.format !== 'v3'&&<Badge variant="outline" className="font-mono text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5">
                    {getLifecycleStageCount(parsedBrief)} STAGES
                  </Badge>}
                  <Badge variant="outline" className={`font-mono text-[10px] ${parsedBrief.visual_lock ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-destructive/30 text-destructive bg-destructive/5'}`}>
                    VISUAL LOCK {parsedBrief.visual_lock ? 'PRESENT' : 'MISSING'}
                  </Badge>
                  <Badge variant="outline" className={`font-mono text-[10px] ${parsedBrief.product_identity_lock ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-amber-500/30 text-amber-400 bg-amber-500/5'}`}>
                    PRODUCT IDENTITY {parsedBrief.product_identity_lock ? 'PRESENT' : 'MISSING'}
                  </Badge>
                  <Badge variant="outline" className={`font-mono text-[10px] ${getNegativePromptGlobal(parsedBrief).length > 0 ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-amber-500/30 text-amber-400 bg-amber-500/5'}`}>
                    GLOBAL NEGATIVES {getNegativePromptGlobal(parsedBrief).length}
                  </Badge>
                </div>
                <div className="p-6 rounded-xl border border-border/20 bg-card">
                  <StandardPreview data={parsedBrief as any} />
                </div>
                {validationResult?.format==='v3'&&<EngineeringHandoffInspector handoff={parsedBrief._production_handoff as VisualEngineeringHandoffV3} validation={validationResult}/>}
            </div>
            <div className="relative">
              <Button 
                size="lg"
                onClick={handleLockTopic}
                className="w-full h-14 bg-amber-500 text-amber-950 hover:bg-amber-600 font-bold xl:text-lg tracking-widest shadow-xl"
              >
                LOCK BRIEF → PHASE 2
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <div className="absolute -top-5 inset-x-0 text-center text-[10px] text-muted-foreground/60 hidden md:block">
                Shortcut: Ctrl+Enter
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

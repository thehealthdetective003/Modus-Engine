import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, Sun, CheckCircle2, FilePlus, FolderOpen, AlertCircle, FileUp, FileDown, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from '@/components/ui/dialog';
import { AppState, PhaseType } from './types';
import { Phase1Topic } from './components/Phase1Topic';
import { Phase2Script } from './components/Phase2Script';
import { Phase4Visuals } from './components/Phase4Visuals';
import { SettingsPanel } from './components/SettingsPanel';
import { useSettings } from './components/SettingsContext';
import { ProjectLibrary } from './components/ProjectLibrary';
import { saveProject, loadProject } from './lib/storageUtils';
import { toast } from 'sonner';
import { resplitTranscription, resetDownstreamForTiming } from './lib/timedTranscript';
import { migrateProject, projectSceneDuration } from './lib/projectMigration';
const PHASES = [
  { id: 1, label: 'TOPIC', description: 'Select Manufacturing Subject' },
  { id: 2, label: 'VO & DIRECTION', description: 'Import Timestamps and Direct Scenes' },
  { id: 3, label: 'T2V PROMPTS', description: 'Generate Timestamped Video Prompts' },
];
export const INITIAL_STATE: AppState = {
  projectSchemaVersion: 6,
  id: undefined,
  projectName: 'Untitled Manufacturing Sequence',
  projectFormat: 'standard-lifecycle',
  phase: 1,
  topic: null,
  plannedScenes: [],
  sceneDirections: [],
  masterVoiceoverScript: '',
  voiceoverTranscription: null,
  t2vPromptProfile: 'omni-flash',
  visualPrompts: [],
  demoState: 'idle',
  demoScenes: [],
  demoSceneNumbers: [],
};

export default function App() {
  const { theme, setTheme } = useTheme();
  const { settings, setSettings, isLoaded } = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStepperOpen, setIsStepperOpen] = useState(true);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'new' | 'load', id?: string } | null>(null);
  const [lastSavedState, setLastSavedState] = useState<string>(JSON.stringify(INITIAL_STATE));
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const [quotaError, setQuotaError] = useState(false);
  
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const activePhase = PHASES.find((p) => p.id === state.phase);
  const isDirty = JSON.stringify(state) !== lastSavedState;
  useEffect(() => {
    setState(prev => {
      const transcript = prev.voiceoverTranscription;
      if (!transcript || transcript.sceneDurationSeconds === settings.sceneDurationSeconds) return prev;
      const reset = resetDownstreamForTiming(prev);
      return { ...reset, voiceoverTranscription: resplitTranscription(transcript, settings.sceneDurationSeconds) } as AppState;
    });
  }, [settings.sceneDurationSeconds, state.voiceoverTranscription?.sceneDurationSeconds]);
  // Smooth scroll to top when phase changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state.phase]);
  // Autofill project name from topic product name
  useEffect(() => {
    if (state.topic?.topic?.product && state.projectName === 'Untitled Manufacturing Sequence') {
      setState(s => ({ ...s, projectName: s.topic?.topic?.product || 'Untitled Manufacturing Sequence' }));
    }
  }, [state.topic]);
  // Restore state from localStorage on mount (Browser Auto-Save Feature)
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('assembly_line_save');
    if (saved) {
      try {
        const raw = JSON.parse(saved);
        const duration = projectSceneDuration(raw, settings.sceneDurationSeconds);
        const migration = migrateProject(raw, INITIAL_STATE, duration);
        if (migration.state) {
          setSettings(previous => ({ ...previous, sceneDurationSeconds: duration }));
          setState(migration.state);
          setLastSavedState(JSON.stringify(migration.state));
        } else {
          toast.error('The auto-saved project uses an unsupported production format. Only Standard Lifecycle is available.');
        }
      } catch (e) {
        console.error('Failed to parse assembly_line_save', e);
      }
    }
    setIsHydrated(true);
  }, [settings.sceneDurationSeconds]);
  // Save state continuously to localStorage on state changes
  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem('assembly_line_save', JSON.stringify(state));
  }, [state, isHydrated]);
  const handleSave = useCallback(() => {
    try {
      const savedId = saveProject(state);
      if (state.id !== savedId) {
        setState(s => ({ ...s, id: savedId }));
      }
      setLastSavedState(JSON.stringify({ ...state, id: savedId }));
      setShowSavedFlash(true);
      setQuotaError(false);
      setTimeout(() => setShowSavedFlash(false), 1500);
    } catch (e) {
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        setQuotaError(true);
      }
      console.error('Save failed', e);
    }
  }, [state]);
  // Autosave when state changes significantly
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isDirty) return;
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    
    // Low frequency autosave (2 seconds debounce)
    saveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 2000);
    
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [state, isDirty, handleSave]);
  const handleNewProject = () => {
    if (isDirty && state.topic) {
      setPendingAction({ type: 'new' });
    } else {
      const resetState: AppState = {
        ...INITIAL_STATE,
      };
      setState(resetState);
      setLastSavedState(JSON.stringify(resetState));
    }
  };
  const confirmNewProject = (saveBefore: boolean) => {
    if (saveBefore) {
      handleSave();
    }
    const resetState: AppState = {
      ...INITIAL_STATE,
    };
    setState(resetState);
    setLastSavedState(JSON.stringify(resetState));
    setPendingAction(null);
  };
  const handleLoadProject = (id: string) => {
    if (isDirty && state.topic) {
      setPendingAction({ type: 'load', id });
    } else {
      executeLoad(id);
    }
  };
  const executeLoad = (id: string) => {
    const loaded = loadProject(id);
    if (loaded) {
      const duration = projectSceneDuration(loaded, settings.sceneDurationSeconds);
      const migration = migrateProject(loaded, INITIAL_STATE, duration);
      const merged = migration.state;
      if (!merged) {
        toast.error('This project uses an unsupported production format. Only Standard Lifecycle projects can be loaded.');
        setPendingAction(null);
        return;
      }
      setState(merged);
      setSettings(previous => ({ ...previous, sceneDurationSeconds: duration }));
      setLastSavedState(JSON.stringify(merged));
      toast.success(`Loaded: ${merged.topic?.topic?.title || merged.projectName}`);
      if (migration.message) toast.info(migration.message);
      setIsLibraryOpen(false);
    } else {
      toast.error("Failed to load project");
    }
    setPendingAction(null);
  };
  const isPhaseComplete = (phaseId: number) => {
    switch (phaseId) {
      case 1: return state.topic !== null;
      case 2: return state.sceneDirections.length > 0 && state.sceneDirections.length === state.voiceoverTranscription?.scenes.length;
      case 3: return state.visualPrompts.length > 0 && state.visualPrompts.length === state.sceneDirections.length;
      default: return false;
    }
  };
  if (!isLoaded) return null;
  return (
    <div className="min-h-screen bg-background text-foreground font-mono flex flex-col relative">
      <SettingsPanel state={state} setState={setState} open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <ProjectLibrary 
        open={isLibraryOpen} 
        onOpenChange={setIsLibraryOpen} 
        currentState={state}
        onLoadProject={handleLoadProject}
        onNewProject={handleNewProject}
      />
      {/* Confirmation Dialog */}
      <Dialog open={pendingAction !== null} onOpenChange={(o) => !o && setPendingAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save progress?</DialogTitle>
            <DialogDescription>
              {pendingAction?.type === 'new' 
                ? "You're about to start a new project. Would you like to save your current work first?"
                : "You have unsaved changes. Would you like to save before loading the selected project?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button 
              variant="default" 
              className="bg-primary text-black font-bold"
              onClick={() => {
                if (pendingAction?.type === 'new') confirmNewProject(true);
                else if (pendingAction?.id) {
                   handleSave();
                   executeLoad(pendingAction.id);
                }
              }}
            >
              SAVE & CONTINUE
            </Button>
            <Button 
              variant="outline"
              onClick={() => {
                if (pendingAction?.type === 'new') confirmNewProject(false);
                else if (pendingAction?.id) executeLoad(pendingAction.id);
              }}
            >
              DISCARD & CONTINUE
            </Button>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>CANCEL</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Quota Error Banner */}
      {quotaError && (
        <div className="bg-red-600 text-white p-3 text-sm font-bold flex items-center justify-center gap-4 z-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>STORAGE FULL. DELETE OLD PROJECTS TO FREE SPACE.</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="bg-white/10 border-white/20 hover:bg-white/20 text-white h-7 px-3 text-xs"
            onClick={() => setIsLibraryOpen(true)}
          >
            OPEN PROJECT LIBRARY →
          </Button>
        </div>
      )}
      {/* Top Bar */}
      <header className="sticky top-0 z-20 border-b border-border/20 bg-background">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-mono font-bold tracking-[0.25em] text-primary uppercase">ASSEMBLY // LINE</span>
            <div className="flex items-center gap-2 ml-2 pl-4 border-l border-border/50">
              <div className={`h-1.5 w-1.5 rounded-full ${isDirty ? 'bg-yellow-500' : 'bg-green-500'}`} />
              <span className="text-[10px] sm:text-xs text-muted-foreground/80 font-mono truncate max-w-[120px] sm:max-w-[200px]">
                {state.id ? (state.topic?.topic?.product || state.projectName) : 'untitled project'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              id="projects-drawer-trigger"
              variant="ghost" 
              size="sm" 
              onClick={() => setIsLibraryOpen(true)} 
              className="flex text-muted-foreground hover:text-foreground h-9"
            >
              <FolderOpen className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">Library</span>
            </Button>
            
            <Button 
              id="new-project-button-header"
              variant="ghost" 
              size="sm" 
              onClick={handleNewProject} 
              className="hidden sm:flex text-muted-foreground hover:text-foreground h-9"
            >
              <FilePlus className="h-4 w-4 mr-1.5" />
              New Draft
            </Button>
            {/* IMPORT PROJECT (LOAD) */}
            <Button 
              id="load-project-file-header"
              variant="outline" 
              size="sm" 
              className="hidden md:flex text-xs font-mono border-primary/20 text-primary hover:bg-primary/10 h-9 relative animate-fade-in"
            >
              <FileUp className="h-4 w-4 mr-1.5" />
              LOAD PROJECT
              <input 
                type="file" 
                accept=".json" 
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    try {
                      const importedData = JSON.parse(event.target?.result as string);
                      
                      // Validation: check for the core fields of AppState
                      if (importedData && typeof importedData === 'object' && 'phase' in importedData) {
                        if (typeof importedData.phase === 'number' && 'projectName' in importedData) {
                          const duration = projectSceneDuration(importedData, settings.sceneDurationSeconds);
                          const migration = migrateProject(importedData, INITIAL_STATE, duration);
                          const merged = migration.state;
                          if (!merged) {
                            toast.error('Unsupported production format. Only Standard Lifecycle projects can be loaded.');
                            return;
                          }
                          setState(merged);
                          setSettings(previous => ({ ...previous, sceneDurationSeconds: duration }));
                          setLastSavedState(JSON.stringify(merged));
                          toast.success("Project file loaded and synchronized.");
                          if (migration.message) toast.info(migration.message);
                        } else {
                          toast.error("Invalid project file format");
                        }
                      } else {
                        toast.error("File is not a valid Assembly Line project");
                      }
                    } catch (error) {
                      toast.error("Failed to parse project file");
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = ''; // Reset file input
                }}
              />
            </Button>
            {/* EXPORT PROJECT (SAVE) */}
            <Button 
              id="save-project-file-header"
              variant="outline" 
              size="sm" 
              onClick={() => {
                const data = JSON.stringify(state, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${(state.topic?.topic?.title || state.projectName || 'Project').replace(/\s+/g, '_')}_AssemblyLine.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast.success("Project JSON downloaded successfully");
              }} 
              className="hidden md:flex text-xs font-mono border-green-500/30 text-green-400 hover:bg-green-500/10 h-9"
            >
              <FileDown className="h-4 w-4 mr-1.5" />
              SAVE PROJECT
            </Button>
            <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
            <Button 
              id="theme-toggle"
              variant="ghost" 
              size="icon" 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
            
            {/* TOOLBOX TRIGGER */}
            <Button 
              id="settings-trigger"
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSettingsOpen(true)} 
              className="h-9 w-9 text-primary hover:text-primary hover:bg-primary/10 rounded-full"
              title="Factory Toolbox"
            >
              <Wrench className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      {/* Main Content */}
      <main className="flex-1 container mx-auto px-6 py-6 flex flex-col max-w-7xl">
        
        {/* Stepper */}
        <div className="sticky top-16 z-10 bg-background -mx-4 px-4 sm:mx-0 sm:px-0 mb-8">
          {/* Toggle handle */}
          <button
            onClick={() => setIsStepperOpen(o => !o)}
            className="w-full flex items-center justify-between pt-3 pb-2 group"
          >
            <span className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase">
              {isStepperOpen
                ? 'PHASES'
                : `PHASE ${activePhase?.id} // ${activePhase?.label} — ${activePhase?.description}`}
            </span>
            <span className={`text-muted-foreground transition-transform duration-300 ${isStepperOpen ? 'rotate-180' : 'rotate-0'}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </button>

          {/* Collapsible content */}
          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: isStepperOpen ? '120px' : '0px', opacity: isStepperOpen ? 1 : 0 }}
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-1 pb-6">
              {PHASES.map((phase, index) => {
                const isActive = state.phase === phase.id;
                const isPast = state.phase > phase.id;
                const completed = isPhaseComplete(phase.id);

                return (
                  <div key={phase.id} className="flex-1 flex items-center w-full group cursor-pointer" onClick={() => setState(s => ({ ...s, phase: phase.id as PhaseType }))}>
                    <div className="flex flex-col relative w-full pr-2">
                      <div className={`text-xs mb-2 transition-colors flex items-center gap-2 ${isActive ? 'text-primary font-medium' : isPast ? 'text-primary/80' : 'text-muted-foreground'}`}>
                        <span className="shrink-0">{phase.id} // {phase.label}</span>
                        {completed && <CheckCircle2 className="h-3 w-3 text-primary" />}
                        {isActive && !completed && (
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </div>

                      <div className="flex items-center w-full">
                        <div className={`h-[2px] flex-1 rounded-l-full transition-colors ${isActive || isPast ? 'bg-primary' : 'bg-muted/40'}`} />
                        {index < PHASES.length - 1 && (
                          <div className={`h-[2px] flex-1 transition-colors ${isPast ? 'bg-primary' : 'bg-muted/40'}`} />
                        )}
                        {index === PHASES.length - 1 && (
                          <div className={`h-[2px] flex-[0.1] rounded-r-full transition-colors ${isPast ? 'bg-primary' : 'bg-muted/40'}`} />
                        )}
                      </div>
                      <div className={`text-xs mt-2 transition-colors line-clamp-1 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {phase.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Bottom border always visible */}
          <div className="h-px bg-border/20" />
        </div>
        {/* Phase Content Area */}
        <div className="flex-1 relative pb-20">
          <AnimatePresence mode="wait">
            <motion.div
              key={state.phase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <Card className="border border-border/40 bg-card shadow-sm rounded-xl relative overflow-hidden">
                <CardHeader className="border-b border-border/20 bg-muted/40 py-5 px-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="text-xl text-primary font-mono font-bold tracking-[0.1em] uppercase flex items-center gap-2">
                        <span>PHASE 0{activePhase?.id} //</span>
                        <span className="text-foreground">{activePhase?.label}</span>
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground uppercase tracking-wider">
                        {activePhase?.description}
                      </CardDescription>
                    </div>
                    {isDirty && (
                      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 font-mono text-[10px] w-fit">
                        UNSAVED CHANGES
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className={`min-h-[400px] ${activePhase?.id !== 1 && activePhase?.id !== 2 && activePhase?.id !== 3 ? "flex items-center justify-center border-y border-border/50 bg-muted/10 mx-6 mb-6 rounded-md border-dashed" : "p-4 sm:p-6 pt-0"}`}>
                  {activePhase?.id === 1 ? (
                    <Phase1Topic state={state} setState={setState} />
                  ) : activePhase?.id === 2 ? (
                    <Phase2Script state={state} setState={setState} />
                  ) : activePhase?.id === 3 ? (
                    <Phase4Visuals state={state} setState={setState} />
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      {/* Persistent Saved Indicator */}
      <AnimatePresence>
        {showSavedFlash && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-6 right-6 z-50 bg-background/80 backdrop-blur-sm border border-border px-3 py-1 rounded-full shadow-lg"
          >
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-500" /> Saved
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

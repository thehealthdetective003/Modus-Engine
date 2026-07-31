import { AppState, T2VPrompt } from '../types';
import { resplitTranscription } from './timedTranscript';
import { mergeDirectionMetadata, validateSceneDirections } from './sceneDirections';
import { deriveGraphicSceneSpec, resolvePlannedState } from './scenePlanner';
import { handoffModeFor, validateHandoffForMode } from './handoffValidation';

export type MigrationResult = { state: AppState | null; message?: string; error?: string };

export function projectSceneDuration(raw: any, fallback: 8 | 10): 8 | 10 {
  const value = Number(raw?.voiceoverTranscription?.sceneDurationSeconds);
  return value === 8 || value === 10 ? value : fallback;
}

export function migrateProject(raw: any, initial: AppState, sceneDuration: 8 | 10): MigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: null, error: 'Invalid project file.' };
  if (raw.projectFormat && raw.projectFormat !== 'standard-lifecycle') return { state: null, error: 'Unsupported production format.' };
  if (raw.creationMode && raw.creationMode !== 'standard-pacing') return { state: null, error: 'Rapid and Hybrid projects are no longer supported.' };
  const rawHandoff=raw.rawHandoff||raw.topic?._production_handoff||null;
  const detectedMode=handoffModeFor(rawHandoff||raw.topic);
  if(raw.handoffMode&&detectedMode&&raw.handoffMode!==detectedMode)return {state:null,error:`Project mode ${raw.handoffMode} conflicts with its detected ${detectedMode} handoff.`};
  const handoffMode=raw.handoffMode||detectedMode||null;
  if(raw.topic&&!handoffMode)return {state:null,error:'This project has handoff data but no safely detectable handoff type. Re-import its source JSON and explicitly select Factory Manufacturing or Visual Engineering V3.'};
  const schemaVersion=raw.schemaVersion||rawHandoff?.schema?.version||raw.topic?.schema_version||null;
  if(handoffMode==='ENGINEERING_V3'){
    const validation=validateHandoffForMode(rawHandoff,'ENGINEERING_V3');
    if(!validation.valid)return {state:null,error:`Invalid Engineering V3 project: ${validation.errors[0]?.path||'/'} ${validation.errors[0]?.message||''}`.trim()};
  }

  sceneDuration = projectSceneDuration(raw, sceneDuration);
  let transcription = raw.voiceoverTranscription || null;
  let timingChanged = false;
  if (transcription && transcription.sceneDurationSeconds !== sceneDuration) {
    transcription = resplitTranscription(transcription, sceneDuration);
    timingChanged = true;
  }
  const rawPlan = Array.isArray(raw.plannedScenes) ? raw.plannedScenes.map((item:any,index:number)=>{
    const base=handoffMode==='ENGINEERING_V3'
      ?{...item,handoff_mode:'ENGINEERING_V3'}
      :{...item,handoff_mode:'MANUFACTURING_V2',state:resolvePlannedState(raw.topic,item?.stage_id,item?.product_visibility)};
    const timed=transcription?.scenes?.[index];
    return {...base,graphic_spec:item?.graphic_spec??(timed?deriveGraphicSceneSpec(raw.topic,timed,base):null)};
  }) : [];
  const showdownRoles=['ANTICIPATION','GROUND_REVEAL','HUMAN_SCALE','PREPARATION','DEPARTURE','AIRBORNE_ESTABLISHMENT','PERFORMANCE_PASS','COCKPIT_IMMERSION','ENVIRONMENTAL_SPECTACLE','OPERATIONAL_RESET','SECOND_PEAK','CONTROLLED_RETURN'];
  const cameraPlatforms=['GROUND_TRIPOD','GROUND_HANDHELD','RUNWAY_LONG_LENS','DISTANT_OBSERVATION','CHASE_AIRCRAFT','COCKPIT_MOUNTED','CANOPY_SIDE','VEHICLE_OR_DECK_MOUNTED'];
  const graphicSubtypes=['COMPONENT_HIGHLIGHT','TECHNICAL_CUTAWAY','PROCESS_FLOW','MECHANICAL_RELATIONSHIP','LAYER_EXPLANATION','SCALE_COMPARISON','SENSOR_SIGNAL','HEAT_OR_ENERGY_FLOW','FACTORY_SCHEMATIC','SYMBOLIC_LOCATION','CONCEPTUAL_TRANSITION'];
  const graphicSpecValid=(item:any)=>item?.graphic_spec===null||(
    graphicSubtypes.includes(item?.graphic_spec?.graphic_subtype)&&item?.graphic_spec?.visual_claim&&item?.graphic_spec?.composition&&item?.graphic_spec?.motion_pattern
    &&Array.isArray(item?.graphic_spec?.annotation_devices)&&[1,2,3].includes(item?.graphic_spec?.maximum_animated_elements)&&item?.graphic_spec?.text_policy==='NO_GENERATED_TEXT'
  );
  // Schema 9 introduces VO-authoritative documentary planning. Earlier plans
  // used fixed variety quotas that could place aerial, graphic, or operational
  // footage over unrelated narration, so they must be rebuilt in Phase 2.
  const planSchemaCompatible=handoffMode==='ENGINEERING_V3'?raw.projectSchemaVersion>=10:raw.projectSchemaVersion>=9;
  const planValid = planSchemaCompatible && !!transcription && rawPlan.length === transcription.scenes.length && rawPlan.every((item:any,index:number)=>{
    const common=item?.number===index+1&&item?.chapter_id&&item?.beat_id&&item?.visual_family&&item?.story_function&&item?.visual_treatment&&item?.product_visibility&&item?.environment_ref
      &&(item?.showdown_role===null||showdownRoles.includes(item?.showdown_role))&&['LOW','MEDIUM','HIGH'].includes(item?.energy_level)
      &&(item?.camera_platform===null||cameraPlatforms.includes(item?.camera_platform))&&graphicSpecValid(item);
    return handoffMode==='ENGINEERING_V3'
      ?common&&item.handoff_mode==='ENGINEERING_V3'&&Array.isArray(item.engineering_system_ids)&&item.engineering_system_ids.length>0&&item.generation_permission&&item.media_route
      :common&&item?.stage_id&&['A','B','C'].includes(item?.state);
  });
  const rawDirections = Array.isArray(raw.sceneDirections) ? raw.sceneDirections : [];
  const repairedDirections = planValid&&transcription ? mergeDirectionMetadata(rawDirections,transcription.scenes,rawPlan) : rawDirections;
  const directionsValid = planValid && !!transcription && validateSceneDirections(repairedDirections, transcription.scenes, rawPlan).length === 0;
  const imageMode = raw.phase4Mode === 'image-animation';
  const profileSupported = raw.projectSchemaVersion >= 4 && (raw.t2vPromptProfile === 'omni-flash' || raw.t2vPromptProfile === 'veo-flow');
  const rawPrompts = Array.isArray(raw.visualPrompts) ? raw.visualPrompts : [];
  const promptNumbers = new Set<number>();
  const promptsCompatible = directionsValid && rawPrompts.every((item:any) => {
    const number = Number(item?.number);
    const valid = Number.isInteger(number) && number >= 1 && number <= transcription.scenes.length && !promptNumbers.has(number) && typeof item?.video_prompt === 'string' && item.video_prompt.trim();
    if (valid) promptNumbers.add(number);
    return Boolean(valid);
  });
  const compatiblePrompts: T2VPrompt[] = directionsValid && !imageMode && profileSupported && promptsCompatible
    ? rawPrompts.map((item: any) => {
        const number=Number(item.number);
        const base:T2VPrompt={
        number,handoff_mode:handoffMode,stage_id:handoffMode==='MANUFACTURING_V2'?(item.stage_id||item.stage_ref):undefined,state:handoffMode==='MANUFACTURING_V2'?item.state:undefined,
        engineering_system_ids:handoffMode==='ENGINEERING_V3'?item.engineering_system_ids:undefined,operational_state_ids:handoffMode==='ENGINEERING_V3'?item.operational_state_ids:undefined,
        evidence_claim_ids:handoffMode==='ENGINEERING_V3'?item.evidence_claim_ids:undefined,relationship_id:handoffMode==='ENGINEERING_V3'?item.relationship_id:undefined,
        concept_bridge_id:handoffMode==='ENGINEERING_V3'?item.concept_bridge_id:undefined,truth_status:handoffMode==='ENGINEERING_V3'?item.truth_status:undefined,
        generation_permission:handoffMode==='ENGINEERING_V3'?item.generation_permission:undefined,media_route:handoffMode==='ENGINEERING_V3'?item.media_route:undefined,
        source_generation_permission:handoffMode==='ENGINEERING_V3'?item.source_generation_permission:undefined,source_media_route:handoffMode==='ENGINEERING_V3'?item.source_media_route:undefined,
        t2v_substitution:handoffMode==='ENGINEERING_V3'?item.t2v_substitution:undefined,
        continuity_notes: item.continuity_notes, quality_flags: item.quality_flags,
        action_description: String(item.action_description || ''), video_prompt: String(item.video_prompt || ''),
        voiceover: transcription.scenes[number - 1]?.text || '', stock_keywords: String(item.stock_keywords || ''),
        omniSections:item.omniSections,
      };
      return base;
    })
    : [];
  const preserveOutput = compatiblePrompts.length > 0;
  const phase = directionsValid ? (Number(raw.phase) >= 3 ? 3 : Math.max(1, Number(raw.phase) || 1)) : (raw.topic ? 2 : 1);
  const state: AppState = {
    ...initial,
    handoffMode,
    schemaVersion,
    rawHandoff,
    scenePlanFormatVersion:handoffMode==='ENGINEERING_V3'?3:Number(raw.scenePlanFormatVersion||2),
    id: raw.id,
    projectName: raw.projectName || initial.projectName,
    projectFormat: 'standard-lifecycle',
    phase: phase as 1 | 2 | 3,
    topic: raw.topic || null,
    masterVoiceoverScript: transcription?.text || '',
    voiceoverTranscription: transcription,
    plannedScenes: planValid ? rawPlan : [],
    sceneDirections: directionsValid ? repairedDirections : [],
    visualPrompts: preserveOutput ? compatiblePrompts.sort((a,b)=>a.number-b.number) : [],
    demoState: 'idle', demoScenes: [], demoSceneNumbers: [],
    t2vPromptProfile: profileSupported ? raw.t2vPromptProfile : 'omni-flash',
    projectSchemaVersion: 10,
  };
  const reset = timingChanged || imageMode || !profileSupported || !directionsValid || !preserveOutput;
  const planningUpgrade = (!planSchemaCompatible||handoffMode==='ENGINEERING_V3'&&raw.scenePlanFormatVersion!==3) && rawPlan.length > 0;
  return { state, message: planningUpgrade
    ? 'Project content and transcript were preserved. Rebuild Phase 2 directions with the new VO-synchronized documentary planner.'
    : reset && raw.topic ? 'Project migrated to the timestamped T2V pipeline; incompatible downstream output was reset.' : undefined };
}

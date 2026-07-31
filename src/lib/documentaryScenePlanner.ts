import type { HandoffMode, PlannedScene, TimedScene, TopicBrief } from '../types';
import { buildEngineeringScenePlan } from './engineeringScenePlanner';
import { buildDocumentaryScenePlan } from './scenePlanner';

export function buildModeAwareScenePlan(mode:HandoffMode|null,topic:TopicBrief,scenes:TimedScene[]):PlannedScene[]{
  if(!mode)throw new Error('Select and import a handoff type before scene planning.');
  return mode==='ENGINEERING_V3'
    ?buildEngineeringScenePlan(topic,scenes)
    :buildDocumentaryScenePlan(topic,scenes).map(item=>({...item,handoff_mode:'MANUFACTURING_V2'}));
}

import type { PlannedScene, TimedScene, TopicBrief } from '../types';
import { handoffModeFor } from './handoffValidation';
import { buildEngineeringScenePlan } from './engineeringScenePlanner';
import { buildDocumentaryScenePlan } from './scenePlanner';

export function buildModeAwareScenePlan(topic:TopicBrief,scenes:TimedScene[]):PlannedScene[]{
  return handoffModeFor(topic)==='ENGINEERING_V3'
    ?buildEngineeringScenePlan(topic,scenes)
    :buildDocumentaryScenePlan(topic,scenes).map(item=>({...item,handoff_mode:'MANUFACTURING_V2'}));
}

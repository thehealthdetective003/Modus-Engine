import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateProject, projectSceneDuration } from './projectMigration';
import type { AppState } from '../types';

const initial = { projectSchemaVersion: 4, projectName: 'Untitled', projectFormat: 'standard-lifecycle', phase: 1, topic: null, sceneDirections: [], masterVoiceoverScript: '', voiceoverTranscription: null, t2vPromptProfile:'omni-flash', visualPrompts: [], demoState: 'idle', demoScenes: [], demoSceneNumbers: [] } as AppState;

test('rejects Hybrid projects', () => assert.equal(migrateProject({ creationMode: 'hybrid-split' }, initial, 10).state, null));
test('moves legacy projects without typed directions to Phase 2', () => {
  const result = migrateProject({ topic: { topic: { title: 'X' } }, phase: 4, phase4Mode: 'image-animation', visualPrompts: [{ image_prompt: 'x' }] }, initial, 10);
  assert.equal(result.state?.phase, 2);
  assert.deepEqual(result.state?.visualPrompts, []);
});

test('round-trips a complete 8-second T2V project without changing its timeline', () => {
  const scene = { number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,stage_id:'S01',state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_ref:'E01',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Cool steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished product'] } as const;
  const raw = { ...initial, phase:3, topic:{topic:{title:'X'}}, voiceoverTranscription:{audioFileName:'vo.json',duration:8,language:'en',languageProbability:1,model:'external',computeType:'external',text:'Hello',segments:[],words:[{text:'Hello',start:0,end:1,probability:1}],sceneDurationSeconds:8,scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}],importedAt:'now'}, sceneDirections:[scene], visualPrompts:[{number:1,action_description:'Moves',video_prompt:'Prompt',voiceover:'Hello',stock_keywords:'steel'}] };
  const parsed = JSON.parse(JSON.stringify(raw));
  assert.equal(projectSceneDuration(parsed, 10), 8);
  const result = migrateProject(parsed, initial, 10);
  assert.equal(result.state?.phase, 3);
  assert.equal(result.state?.voiceoverTranscription?.sceneDurationSeconds, 8);
  assert.equal(result.state?.visualPrompts.length, 1);
  assert.equal('apiKey' in parsed, false);
});

test('clears legacy Phase 3 prompts while preserving valid directions', () => {
  const scene = { number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,stage_id:'S01',state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_ref:'E01',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished'] };
  const raw:any = { ...initial, projectSchemaVersion:3, phase:3, topic:{topic:{title:'X'}}, voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]}, sceneDirections:[scene], visualPrompts:[{number:1,video_prompt:'broken'}] };
  const result = migrateProject(raw, initial, 8);
  assert.equal(result.state?.phase, 3);
  assert.equal(result.state?.sceneDirections.length, 1);
  assert.deepEqual(result.state?.visualPrompts, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateProject, projectSceneDuration } from './projectMigration';
import type { AppState } from '../types';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';

const initial = { projectSchemaVersion: 6, projectName: 'Untitled', projectFormat: 'standard-lifecycle', phase: 1, topic: null, plannedScenes:[], sceneDirections: [], masterVoiceoverScript: '', voiceoverTranscription: null, t2vPromptProfile:'omni-flash', visualPrompts: [], demoState: 'idle', demoScenes: [], demoSceneNumbers: [] } as AppState;
const plan={number:1,chapter_id:'CH01',beat_id:'B01',visual_family:'ASSEMBLY_PROCESS',story_function:'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:'S01',environment_ref:'E01',state:'B'} as const;
const temporal_action={opening_state:'The part rests in its jig',primary_motion:'A worker lowers the tool',physical_interaction:'The tool contacts the part',mid_shot_progression:'The fastener seats progressively',ending_state:'The tool lifts away from the secured part'};

test('rejects Hybrid projects', () => assert.equal(migrateProject({ creationMode: 'hybrid-split' }, initial, 10).state, null));
test('moves legacy projects without typed directions to Phase 2', () => {
  const result = migrateProject({ topic: { topic: { title: 'X' } }, phase: 4, phase4Mode: 'image-animation', visualPrompts: [{ image_prompt: 'x' }] }, initial, 10);
  assert.equal(result.state?.phase, 2);
  assert.deepEqual(result.state?.visualPrompts, []);
});

test('round-trips a complete 8-second T2V project without changing its timeline', () => {
  const scene = { ...plan,number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Cool steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action } as const;
  const raw = { ...initial, phase:3, topic:{topic:{title:'X'}}, voiceoverTranscription:{audioFileName:'vo.json',duration:8,language:'en',languageProbability:1,model:'external',computeType:'external',text:'Hello',segments:[],words:[{text:'Hello',start:0,end:1,probability:1}],sceneDurationSeconds:8,scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}],importedAt:'now'}, plannedScenes:[plan],sceneDirections:[scene], visualPrompts:[{number:1,action_description:'Moves',video_prompt:'Prompt',voiceover:'Hello',stock_keywords:'steel'}] };
  const parsed = JSON.parse(JSON.stringify(raw));
  assert.equal(projectSceneDuration(parsed, 10), 8);
  const result = migrateProject(parsed, initial, 10);
  assert.equal(result.state?.phase, 3);
  assert.equal(result.state?.voiceoverTranscription?.sceneDurationSeconds, 8);
  assert.equal(result.state?.visualPrompts.length, 1);
  assert.equal(result.state?.projectSchemaVersion, 6);
  assert.equal('apiKey' in parsed, false);

  const partial = JSON.parse(JSON.stringify(raw));
  partial.voiceoverTranscription.duration=16;
  partial.voiceoverTranscription.scenes.push({number:2,start:8,end:16,duration:8,text:'Next',silent:false});
  partial.plannedScenes.push({...plan,number:2});partial.sceneDirections.push({...scene,number:2,start:8,end:16,voiceover:'Next'});
  const partialResult=migrateProject(partial,initial,8);
  assert.equal(partialResult.state?.sceneDirections.length,2);
  assert.equal(partialResult.state?.visualPrompts.length,1);
});

test('clears legacy Phase 3 prompts and unplanned directions', () => {
  const scene = { number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,stage_id:'S01',state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_ref:'E01',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished'] };
  const raw:any = { ...initial, projectSchemaVersion:3, phase:3, topic:{topic:{title:'X'}}, voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]}, sceneDirections:[scene], visualPrompts:[{number:1,video_prompt:'broken'}] };
  const result = migrateProject(raw, initial, 8);
  assert.equal(result.state?.phase, 2);
  assert.equal(result.state?.sceneDirections.length, 0);
  assert.deepEqual(result.state?.visualPrompts, []);
});

test('repairs blank immutable environment metadata from a stored scene plan',()=>{
  const scene={...plan,number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_ref:'',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished'],temporal_action};
  const raw:any={...initial,phase:2,topic:{topic:{title:'X'}},plannedScenes:[plan],voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]},sceneDirections:[scene]};
  const result=migrateProject(raw,initial,8);
  assert.equal(result.state?.sceneDirections[0]?.environment_ref,'E01');
  assert.equal(result.state?.sceneDirections[0]?.stage_id,'S01');
  assert.equal(result.state?.sceneDirections[0]?.state,'B');
});

test('preserves the complete V2 handoff through project JSON migration', () => {
  const topic = normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const exported = JSON.parse(JSON.stringify({ ...initial, topic, phase: 1 }));
  const result = migrateProject(exported, initial, 10);
  assert.deepEqual(result.state?.topic?._production_handoff, template);
  assert.deepEqual(result.state?.topic?._production_handoff?.visual_story_plan, template.visual_story_plan);
});

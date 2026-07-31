import assert from 'node:assert/strict';
import test from 'node:test';
import { makeValidEngineeringHandoff } from '../testFixtures/engineeringV3';
import { normalizeEngineeringHandoff } from './productionTemplate';
import { validateVisualProductionHandoff } from './handoffValidation';
import { buildEngineeringScenePlan, resolveEngineeringMediaRoute } from './engineeringScenePlanner';
import { buildEngineeringPromptContext, compileEngineeringOmniPrompt } from './engineeringPromptComposer';
import { importTranscriptionJson } from './transcriptionImport';
import { mergeDirectionMetadata, validateSceneDirections } from './sceneDirections';
import { buildModeAwareScenePlan } from './documentaryScenePlanner';
import { engineeringT2VSubstitutionCount, prepareEngineeringSceneForT2V } from './engineeringT2V';
import { missingDirections } from './promptBatch';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const generatedDirection=(number:number)=>({number,subject:'The exact EX-1 test aircraft',product_visual_state:'Complete EX-1 test configuration',primary_action:'One external control surface deflects once',supporting_motion:'Light dust responds to the crosswind',environment_description:'A generic non-identifying paved test range',camera:{shot_scale:'medium-wide',lens:'normal',angle:'rear three-quarter',movement:'locked camera',movement_speed:'none'},lighting_and_material:'Neutral daylight on matte aircraft surfaces',continuity_from_previous:'Opening engineering clue',transition_to_next:'Hold on the returned neutral surface',required_visible_features:['two outward-canted tails','one external control surface'],forbidden_elements:['unknown internal actuator layout','readable text'],temporal_action:{opening_state:'The aircraft rests stationary',primary_motion:'One control surface begins to deflect',physical_interaction:'The surface responds to one control command',mid_shot_progression:'The surface reaches its commanded angle',ending_state:'The surface returns to neutral'}});

test('routes Engineering V3 beats according to generation and evidence permissions',()=>{
  const handoff=makeValidEngineeringHandoff(),beat=handoff.visual_story_plan.chapters[0].visual_beats[0];
  assert.equal(resolveEngineeringMediaRoute(handoff,beat).route,'GENERATED_T2V');
  const reference=clone(beat);reference.generation_permission='REFERENCE_REQUIRED';reference.preferred_media_routes=['REFERENCE_IMAGE_I2V'];
  assert.equal(resolveEngineeringMediaRoute(handoff,reference).route,'REFERENCE_IMAGE_I2V');
  const editor=clone(beat);editor.generation_permission='EDITOR_ONLY';editor.preferred_media_routes=['EDITOR_NATIVE_GRAPHIC'];
  assert.equal(resolveEngineeringMediaRoute(handoff,editor).route,'EDITOR_NATIVE_GRAPHIC');
  const blocked=clone(beat);blocked.generation_permission='NOT_ALLOWED';blocked.preferred_media_routes=['NO_VALID_ROUTE'];
  assert.equal(resolveEngineeringMediaRoute(handoff,blocked).route,'NO_VALID_ROUTE');
});

test('plans V3 scenes with systems, state, relationship, evidence, route, and no V2 stage metadata',()=>{
  const handoff=makeValidEngineeringHandoff(),topic=normalizeEngineeringHandoff(handoff);
  const scenes=[{number:1,start:0,end:10,duration:10,text:'A command moves one external control surface, revealing the relationship between control and geometry.',silent:false}];
  const plan=buildEngineeringScenePlan(topic,scenes);
  assert.equal(plan[0].handoff_mode,'ENGINEERING_V3');
  assert.deepEqual(plan[0].engineering_system_ids,['SYS_GEOMETRY','SYS_CONTROL']);
  assert.deepEqual(plan[0].operational_state_ids,['OPS_TEST']);
  assert.deepEqual(plan[0].evidence_claim_ids,['CLM_EXTERNAL']);
  assert.equal(plan[0].relationship_id,'REL_CONTROL_GEOMETRY');
  assert.equal(plan[0].media_route,'GENERATED_T2V');
  assert.equal(plan[0].stage_id,undefined);
  assert.equal(plan[0].state,undefined);
});

test('stored handoff mode controls downstream planner dispatch',()=>{
  const topic=normalizeEngineeringHandoff(makeValidEngineeringHandoff());
  const scenes=[{number:1,start:0,end:10,duration:10,text:'A command moves one external control surface.',silent:false}];
  const plan=buildModeAwareScenePlan('ENGINEERING_V3',topic,scenes);
  assert.equal(plan[0].handoff_mode,'ENGINEERING_V3');
  assert.throws(()=>buildModeAwareScenePlan(null,topic,scenes),/Select and import a handoff type/);
});

test('Engineering prompt context is focused and excludes transcript wording',()=>{
  const handoff=makeValidEngineeringHandoff(),topic=normalizeEngineeringHandoff(handoff);
  const timed={number:1,start:0,end:10,duration:10,text:'Secret transcript wording must not enter the generation context.',silent:false};
  const plan=buildEngineeringScenePlan(topic,[timed]);
  const [direction]=mergeDirectionMetadata([generatedDirection(1)],[timed],plan);
  const context:any=buildEngineeringPromptContext(topic,[direction]);
  const serialized=JSON.stringify(context);
  assert.equal(serialized.includes('Secret transcript wording'),false);
  assert.equal(context.scenes[0].engineering_systems.length,2);
  assert.equal(context.scenes[0].geometry_modules.length,1);
  assert.equal('engineering_systems' in context.scenes[0],true);
  assert.equal('production_stages' in context,false);
});

test('compiles a truthful Engineering V3 Omni prompt with locked identity and no narration',()=>{
  const handoff=makeValidEngineeringHandoff(),topic=normalizeEngineeringHandoff(handoff);
  const timed={number:1,start:0,end:10,duration:10,text:'Narrator describes the engineering relationship.',silent:false};
  const plan=buildEngineeringScenePlan(topic,[timed]);
  const [direction]=mergeDirectionMetadata([generatedDirection(1)],[timed],plan);
  const compiled=compileEngineeringOmniPrompt({cinematography:'Use a stable rear three-quarter camera.',action:'Show the visible control response.'},direction,topic);
  assert.match(compiled.prompt,/10-second continuous shot/);
  assert.match(compiled.prompt,/EX-1 test configuration/);
  assert.match(compiled.prompt,/two outward-canted tails/);
  assert.match(compiled.prompt,/generic non-identifying/);
  assert.doesNotMatch(compiled.prompt,/Narrator describes/);
  assert.doesNotMatch(compiled.prompt,/internal actuator layout.*confirmed/i);
  assert.equal((compiled.prompt.match(/10-second continuous shot/g)||[]).length,1);
});

test('runs the V3 import-to-plan-to-prompt path while preserving exact VO locally',()=>{
  const handoff=makeValidEngineeringHandoff(),validation=validateVisualProductionHandoff(handoff);
  assert.equal(validation.valid,true);
  const topic=normalizeEngineeringHandoff(handoff);
  const transcript=importTranscriptionJson({duration:10,scenes:[{start:0,end:10,text:'A visible control surface responds to one command.'}]},'engineering.json',10);
  const plan=buildEngineeringScenePlan(topic,transcript.scenes);
  const directions=mergeDirectionMetadata([generatedDirection(1)],transcript.scenes,plan);
  assert.deepEqual(validateSceneDirections(directions,transcript.scenes,plan),[]);
  const compiled=compileEngineeringOmniPrompt({},directions[0],topic);
  assert.equal(directions[0].voiceover,'A visible control surface responds to one command.');
  assert.ok(compiled.prompt.length>100);
  assert.equal(directions[0].media_route,'GENERATED_T2V');
});

test('converts editor and reference routes into truthful generated T2V substitutes',()=>{
  const handoff=makeValidEngineeringHandoff(),beat=handoff.visual_story_plan.chapters[0].visual_beats[0];
  beat.visual_family='TECHNICAL_GRAPHIC';beat.product_visibility='NONE';beat.generation_permission='EDITOR_ONLY';beat.preferred_media_routes=['EDITOR_NATIVE_GRAPHIC'];
  const topic=normalizeEngineeringHandoff(handoff);
  const scenes=Array.from({length:99},(_,index)=>({number:index+1,start:index*10,end:(index+1)*10,duration:10,text:'A qualitative control relationship is shown without readable data.',silent:false}));
  const plan=buildEngineeringScenePlan(topic,scenes);
  assert.equal(plan.length,99);
  assert.equal(plan.every(item=>item.media_route==='GENERATED_T2V'&&item.generation_permission==='T2V_ALLOWED'),true);
  assert.equal(engineeringT2VSubstitutionCount(plan),99);
  assert.equal(plan[0].source_media_route,'EDITOR_NATIVE_GRAPHIC');
  assert.equal(plan[0].t2v_substitution,'EDITOR_DATA_TO_TEXT_FREE_GRAPHIC');
  const existing=Array.from({length:57},(_,index)=>({number:index+1,video_prompt:'existing'} as any));
  assert.equal(missingDirections(plan as any,existing).length,42);
});

test('compiles a restricted saved direction as a text-free T2V prompt instead of rejecting it',()=>{
  const handoff=makeValidEngineeringHandoff(),topic=normalizeEngineeringHandoff(handoff);
  const timed={number:1,start:0,end:10,duration:10,text:'The report compares exact numeric test results.',silent:false};
  const [planned]=buildEngineeringScenePlan(topic,[timed]);
  const [direction]=mergeDirectionMetadata([{...generatedDirection(1),required_visible_features:['three grey hull blocks','one cyan band']}],[timed],[planned]);
  const restricted={...direction,generation_permission:'EDITOR_ONLY' as const,media_route:'EDITOR_NATIVE_GRAPHIC' as const,visual_treatment:'STATIC_GRAPHIC_T2V' as const,product_visibility:'NONE' as const};
  const effective=prepareEngineeringSceneForT2V(restricted);
  const compiled=compileEngineeringOmniPrompt({action:'Show 96.23 percent with readable labels.'},restricted,topic);
  assert.equal(effective.media_route,'GENERATED_T2V');
  assert.equal(effective.t2v_substitution,'EDITOR_DATA_TO_TEXT_FREE_GRAPHIC');
  assert.match(compiled.prompt,/qualitative relationship/i);
  assert.doesNotMatch(compiled.prompt,/96\.23/);
  assert.match(compiled.prompt,/Exclude .*readable labels/i);
});

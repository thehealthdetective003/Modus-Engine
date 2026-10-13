import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, SceneDirection, TopicBrief } from '../types';
import { buildI2VPrompt, classifyMotionArchetype, compileAnimationPrompt, compileImagePrompt, normalizeI2VSections, recompileI2VPrompts, stillFrameText } from './i2vPromptCompiler';
import { migrateProject } from './projectMigration';

const temporal_action={opening_state:'The incomplete airframe rests in its assembly jig with a technician holding a torque wrench at the hinge',primary_motion:'The technician turns the torque wrench a quarter turn',physical_interaction:'The wrench seats the hinge fastener',mid_shot_progression:'the fastener seats fully',ending_state:'the technician lifts the wrench away'};
const direction:SceneDirection={number:1,start:0,end:10,duration:10,voiceover:'VO',silent:false,visual_family:'ASSEMBLY_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:'S02',state:'B',subject:'Incomplete KJ-600 airframe',product_visual_state:'Structurally joined airframe',primary_action:'A technician checks the exposed wing-fold hinge',supporting_motion:'A metrology light sweeps slowly',environment_ref:'E01',environment_description:'Bright aircraft assembly hall',camera:{shot_scale:'medium-wide',lens:'short telephoto',angle:'rear three-quarter',movement:'slow lateral dolly',movement_speed:'slow'},lighting_and_material:'Realistic industrial light on bare metal',continuity_from_previous:'Fuselage joined',transition_to_next:'Engine integration',required_visible_features:['broad horizontal stabilizer','exactly four vertical fins'],forbidden_elements:['engines','rotodome','final paint'],temporal_action};
const handoff={product:{official_name:'KJ-600',exact_variant:'carrier AEW',product_class:'carrier-based AEW aircraft',immutable_identity_features:['compact fuselage','high-mounted wing','exactly two engine nacelles','large circular rotodome','exactly four vertical fins']},geometry_modules:[{module_id:'FULL_PRODUCT',required_visible_features:['large circular rotodome','exactly four vertical fins']}],environments:[{environment_id:'E01',facility_type:'assembly hall',forbidden_elements:['passenger windows']}],reference_assets:[],production_stages:[{stage_id:'S02',environment_id:'E01',present_now:['fuselage','centre wing','tail'],not_yet_installed:['engines','rotodome','final paint'],geometry_control:{primary_geometry_module_id:'FULL_PRODUCT',negative_constraints:['generic airliner geometry']},camera_guidance:{},visual_evidence:{}}],stage_transitions:[]};
const topic={topic:{title:'KJ-600 production',product:'KJ-600',category:'aircraft'},global_visual_constants:'',environments:[],_production_handoff:handoff} as unknown as TopicBrief;
const flight:SceneDirection={...direction,number:2,visual_family:'OPERATIONAL_CONTEXT',product_visibility:'FULL',state:'C',showdown_role:'AIRBORNE_ESTABLISHMENT',energy_level:'MEDIUM',camera_platform:'CHASE_AIRCRAFT',stage_id:'S08',environment_ref:'SKY',environment_description:'Open sky above the sea',primary_action:'The aircraft cruises in stable flight',supporting_motion:'Propellers turn',camera:{shot_scale:'wide',lens:'long telephoto',angle:'side profile',movement:'restrained tracking',movement_speed:'slow'},temporal_action:{opening_state:'The aircraft is in level flight above broken clouds',primary_motion:'It holds its heading',physical_interaction:'Propellers bite the air',mid_shot_progression:'it banks gently',ending_state:'level flight again'},forbidden_elements:[]};
const imageBody=(prompt:string)=>prompt.split(/\bExclude\b/)[0];

test('classifies motion archetypes from plan metadata and narration',()=>{
  assert.equal(classifyMotionArchetype(direction,topic),'ASSEMBLY_INTERACTION');
  assert.equal(classifyMotionArchetype(flight,topic),'AIRBORNE_FLIGHT');
  assert.equal(classifyMotionArchetype({...flight,showdown_role:'COCKPIT_IMMERSION',camera_platform:'COCKPIT_MOUNTED'},topic),'COCKPIT_IMMERSION');
  assert.equal(classifyMotionArchetype({...flight,showdown_role:'DEPARTURE'},topic),'AIRBORNE_DEPARTURE');
  assert.equal(classifyMotionArchetype({...flight,showdown_role:null,camera_platform:null,visual_family:'DELIVERY_AND_ROLLOUT',primary_action:'A tractor tows the aircraft across the deck',temporal_action:undefined},topic),'GROUND_MOVEMENT');
  assert.equal(classifyMotionArchetype({...direction,visual_family:'MACHINERY_ACTION'},topic),'MACHINERY_CYCLE');
  assert.equal(classifyMotionArchetype({...direction,visual_family:'FACTORY_AERIAL'},topic),'ESTABLISHING_ENVIRONMENT');
  assert.equal(classifyMotionArchetype({...direction,visual_treatment:'MOTION_GRAPHIC_T2V'},topic),'MOTION_GRAPHIC');
  assert.equal(classifyMotionArchetype({...direction,visual_treatment:'STATIC_GRAPHIC_T2V'},topic),'STATIC_GRAPHIC');
});

test('strips camera movement and blur language from still-frame text',()=>{
  assert.equal(stillFrameText('The jet is banked left. The camera pans across the deck. Motion blur streaks the sky.'),'The jet is banked left.');
});

test('image prompt is a frozen still with no camera moves while animation is motion-only',()=>{
  const raw={image:{subject:'The KJ-600 is banked ten degrees with gear retracted. The camera tracks alongside.',frozen_moment:'A single instant of level cruise',environment:'Broken cumulus over a dark sea',lighting_and_materials:'Low warm sun raking across gray paint'},animation:{primary_motion:'The aircraft holds its heading and banks gently to the left',secondary_motion:'Propellers spin at cruise speed',environment_motion:'Clouds slide beneath the wing'}};
  const sections=normalizeI2VSections(raw,flight,topic);
  const image=compileImagePrompt(sections);
  const animation=compileAnimationPrompt(sections,flight,'omni-flash');
  assert.doesNotMatch(imageBody(image),/camera tracks|tracking|dolly|pans?\b|motion blur/i);
  assert.match(image,/fast shutter/i);assert.match(image,/tack-sharp/i);
  assert.match(image,/exactly four vertical fins/i);
  assert.match(image,/Exclude .*motion blur/i);
  assert.match(animation,/^Animate the provided image as one 10-second continuous shot\./);
  assert.equal((animation.match(/\b\d+(?:\.\d+)?-second\b/g)||[]).length,1);
  assert.match(animation,/restrained tracking movement/i);assert.match(animation,/chase aircraft/i);
  assert.doesNotMatch(animation,/exactly four vertical fins|rotodome|gray paint/i);
  assert.match(animation,/same geometry, proportions, configuration/i);
  assert.match(animation,/propulsion, airflow/i);
});

test('partial assembly states guard against completing the product in both prompts',()=>{
  const sections=normalizeI2VSections(undefined,direction,topic);
  const image=compileImagePrompt(sections);
  const animation=compileAnimationPrompt(sections,direction,'veo-flow');
  assert.match(image,/Do not show engines, rotodome, and final paint/i);
  assert.match(image,/rests in its assembly jig/i);
  assert.match(sections.image.composition,/open space on one side/i);
  assert.match(animation,/Do not complete, install, or reveal any component/i);
  assert.match(animation,/turns the torque wrench/i);
  assert.match(animation,/By mid-shot, the fastener seats fully/i);
  assert.match(animation,/Negative prompt: .*extra fingers/i);
});

test('graphic scenes compile a complete vector frame and a held motion',()=>{
  const graphic_spec={graphic_subtype:'HEAT_OR_ENERGY_FLOW' as const,visual_claim:'Show airflow through one stable engine cross-section',composition:'ORTHOGRAPHIC_CUTAWAY' as const,motion_pattern:'HEAT_ZONE_PROGRESSION' as const,annotation_devices:['FLOW_LINES' as const],palette_profile:'PREMIUM_TECHNICAL_VECTOR' as const,maximum_animated_elements:2 as const,transition_anchor:null,text_policy:'NO_GENERATED_TEXT' as const};
  const fixture={...direction,visual_treatment:'MOTION_GRAPHIC_T2V' as const,product_visibility:'DETAIL_ONLY' as const,graphic_spec};
  const sections=normalizeI2VSections(undefined,fixture,topic);
  assert.match(compileImagePrompt(sections),/flat vector composition with a clear orthographic cutaway/i);
  const animation=compileAnimationPrompt(sections,fixture,'omni-flash');
  assert.match(animation,/cool-to-warm energy zone/i);assert.match(animation,/final quarter/i);assert.doesNotMatch(animation,/factory ambience/i);
});

test('local recompiles are deterministic and preserve user-facing fields',()=>{
  const base={number:1,stage_id:'S02',state:'B' as const,action_description:'Action',voiceover:'old',stock_keywords:'kw',continuity_notes:'c',quality_flags:[]};
  const first=buildI2VPrompt(base,{image:{subject:'An incomplete airframe in a jig'},animation:{primary_motion:'The technician turns the wrench'}},direction,topic,'omni-flash');
  const once=recompileI2VPrompts([first],[direction],topic,'omni-flash');
  const twice=recompileI2VPrompts(once,[direction],topic,'omni-flash');
  assert.equal(once[0].image_prompt,first.image_prompt);
  assert.equal(twice[0].animation_prompt,first.animation_prompt);
  assert.equal(once[0].voiceover,'VO');assert.equal(once[0].stock_keywords,'kw');
  assert.equal(first.video_prompt,first.animation_prompt);
});

test('migration keeps complete image-to-video output and drops incomplete output',()=>{
  const plan={number:1,chapter_id:'CH01',beat_id:'B01',visual_family:'ASSEMBLY_PROCESS',story_function:'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:'S01',environment_ref:'E01',state:'B',showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null};
  const scene={...plan,start:0,end:8,duration:8,voiceover:'Hello',silent:false,state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Cool steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action};
  const initial={projectSchemaVersion:9,projectName:'Untitled',projectFormat:'standard-lifecycle',phase:1,topic:null,plannedScenes:[],sceneDirections:[],masterVoiceoverScript:'',voiceoverTranscription:null,t2vPromptProfile:'omni-flash',phase3Mode:'text-to-video',visualPrompts:[],demoState:'idle',demoScenes:[],demoSceneNumbers:[]} as AppState;
  const raw={...initial,phase:3,phase3Mode:'image-to-video',topic:{topic:{title:'X'}},voiceoverTranscription:{audioFileName:'vo.json',duration:8,language:'en',languageProbability:1,model:'external',computeType:'external',text:'Hello',segments:[],words:[{text:'Hello',start:0,end:1,probability:1}],sceneDurationSeconds:8,scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}],importedAt:'now'},plannedScenes:[plan],sceneDirections:[scene],visualPrompts:[{number:1,action_description:'Moves',video_prompt:'Anim',image_prompt:'Still',animation_prompt:'Anim',voiceover:'Hello',stock_keywords:'steel'}]};
  const kept=migrateProject(JSON.parse(JSON.stringify(raw)),initial,8).state!;
  assert.equal(kept.phase3Mode,'image-to-video');
  assert.equal(kept.visualPrompts[0].image_prompt,'Still');assert.equal(kept.visualPrompts[0].animation_prompt,'Anim');
  const broken=JSON.parse(JSON.stringify(raw));delete broken.visualPrompts[0].image_prompt;
  assert.deepEqual(migrateProject(broken,initial,8).state!.visualPrompts,[]);
  const legacy=JSON.parse(JSON.stringify(raw));delete legacy.phase3Mode;
  assert.equal(migrateProject(legacy,initial,8).state!.phase3Mode,'text-to-video');
});

test('still-frame exclusions omit motion-only terms and every sentence starts capitalized',()=>{
  const sections=normalizeI2VSections(undefined,flight,topic);
  const image=compileImagePrompt(sections);
  const animation=compileAnimationPrompt(sections,flight,'omni-flash');
  const exclusions=image.slice(image.lastIndexOf('Exclude'));
  assert.doesNotMatch(exclusions,/camera|sliding|aerobatics|morphing/i);
  assert.match(exclusions,/weapon discharge/i);
  assert.doesNotMatch(exclusions,/, and [^,]+, /);
  for(const prompt of [image,animation]) assert.doesNotMatch(prompt,/(?:^|[.!?]\s)[a-z]/);
});

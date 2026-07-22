import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneDirection, TopicBrief } from '../types';
import { compileOmniPrompt, normalizeOmniSections, resolveProductionScene } from './omniPromptCompiler';

const direction:SceneDirection={number:1,start:0,end:10,duration:10,voiceover:'',silent:false,stage_id:'S02',state:'B',subject:'Incomplete KJ-600 airframe',product_visual_state:'Structurally joined airframe',primary_action:'A technician checks the exposed wing-fold hinge',supporting_motion:'A metrology light sweeps slowly',environment_ref:'E01',environment_description:'Bright aircraft assembly hall',camera:{shot_scale:'medium-wide',lens:'short telephoto',angle:'rear three-quarter',movement:'slow lateral dolly',movement_speed:'slow'},lighting_and_material:'Realistic industrial light on bare metal',continuity_from_previous:'Fuselage joined',transition_to_next:'Engine integration',required_visible_features:['broad horizontal stabilizer','exactly four vertical fins'],forbidden_elements:['engines','rotodome','final paint']};
const handoff={product:{official_name:'KJ-600',exact_variant:'carrier AEW',immutable_identity_features:['compact fuselage','high-mounted wing','exactly two engine nacelles','large circular rotodome','broad horizontal stabilizer','exactly four vertical fins','tricycle landing gear']},geometry_modules:[{module_id:'AIRFRAME',required_visible_features:['broad horizontal stabilizer','exactly four vertical fins','arresting-hook region'],forbidden_geometry_changes:['changing fin count']}],environments:[{environment_id:'E01',facility_type:'assembly hall',forbidden_elements:['passenger windows']}],reference_assets:[{asset_id:'R1',confidence:'HIGH'}],production_stages:[{stage_id:'S02',environment_id:'E01',present_now:['fuselage','centre wing','tail'],not_yet_installed:['engines','rotodome','landing gear','final paint'],temporarily_exposed:['wing-fold interface'],geometry_control:{primary_geometry_module_id:'AIRFRAME',required_visible_anchors:['four-fin tail'],negative_constraints:['generic airliner geometry'],forbidden_transformations:['automatic panel closure']},stage_actions:[{forbidden_actions:['engine operation']}],camera_guidance:{},visual_evidence:{confirmed_visual_details:['joined fuselage'],analyst_inferred_visual_details:['tool placement'],reference_asset_ids:['R1']},continuity:{}}],stage_transitions:[{from_stage_id:'S02',to_stage_id:'S03',components_added:['engines']}]};
const topic={topic:{title:'KJ-600 production',product:'KJ-600',category:'aircraft'},global_visual_constants:'',environments:[],_production_handoff:handoff} as unknown as TopicBrief;

test('compiles complete natural prose with one duration and explicit incomplete state',()=>{const {sections}=normalizeOmniSections({cinematography:'medium-wide rear three-quarter view and',subject:'incomplete KJ-600 airframe',action:'a technician checks the hinge',environment:'bright assembly hall',style_lighting:'restrained documentary light',product_state:'ignored malformed state',sound:'factory hum',exclusions:['engines','','engines']},direction,topic);const prompt=compileOmniPrompt(sections,direction);assert.equal((prompt.match(/10-second continuous shot/gi)||[]).length,1);assert.doesNotMatch(prompt,/\[object Object\]|undefined|prompt_sections| and\./i);assert.match(prompt,/Do not show engines, rotodome, landing gear, and final paint/i);assert.equal((prompt.match(/Exclude dialogue, narration, music/gi)||[]).length,1);});
test('selects rear-view geometry and preserves exact counts',()=>{const resolved=resolveProductionScene(topic,direction);assert.ok(resolved.identity.some(value=>/exactly four vertical fins/i.test(value)));assert.ok(resolved.identity.some(value=>/stabilizer/i.test(value)));assert.ok(!resolved.identity.some(value=>/compact fuselage/i.test(value)));});
test('compiles structural, mechanical-test, and operational scene fixtures',()=>{const fixtures=[direction,{...direction,number:2,primary_action:'The outer wing panel rotates slowly through a small range around its rigid hinge'},{...direction,number:3,stage_id:'S08',state:'C' as const,environment_ref:'DECK',environment_description:'Carrier deck at sea',product_visual_state:'Operational carrier configuration',primary_action:'A tow tractor slowly repositions the aircraft',forbidden_elements:['extra aircraft','jet engines'],camera:{...direction.camera,angle:'front three-quarter'}}];for(const fixture of fixtures){const {sections}=normalizeOmniSections({},fixture,topic);const prompt=compileOmniPrompt(sections,fixture);assert.equal((prompt.match(/10-second continuous shot/gi)||[]).length,1);assert.doesNotMatch(prompt,/\[object Object\]|undefined|\b(?:and|of|for|on|the)\.$/i);}const operational=compileOmniPrompt(normalizeOmniSections({},fixtures[2],topic).sections,fixtures[2]);assert.match(operational,/maritime deck ambience/i);});
test('resolves contradictory camera metadata to one coherent instruction',()=>{
  const resolve=(camera:Partial<SceneDirection['camera']>,customTopic=topic)=>resolveProductionScene(customTopic,{...direction,camera:{...direction.camera,...camera}}).camera;
  assert.equal(resolve({movement:'static tracking pan'}).behavior,'locked camera');
  assert.equal(resolve({movement:'static dolly'}).behavior,'locked camera');
  assert.equal(resolve({lens:'wide-angle 50 mm'}).lens,'normal');
  assert.equal(resolve({shot_scale:'wide macro'}).shotScale,'close-up');
  assert.equal(resolve({movement:'slow pan then tracking'}).behavior,'locked camera');
  const guided=JSON.parse(JSON.stringify(handoff));guided.production_stages[0].camera_guidance={preferred_camera_movements:['slow lateral dolly'],forbidden_camera_movements:[]};
  assert.equal(resolve({movement:'static tracking'}, {...topic,_production_handoff:guided} as any).behavior,'slow lateral dolly');
  guided.production_stages[0].camera_guidance.forbidden_camera_movements=['dolly'];
  assert.equal(resolve({movement:'tracking'}, {...topic,_production_handoff:guided} as any).behavior,'locked camera');
});
test('ranks exact counts, viewpoint anchors, and scene exclusions by relevance',()=>{
  const extended=JSON.parse(JSON.stringify(handoff));extended.product.immutable_identity_features.push('interior mission bay','overhead wing planform','generic low-priority feature');
  const localTopic={...topic,_production_handoff:extended} as any;
  const front=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'front three-quarter'}});
  const rear=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'rear three-quarter'}});
  const interior=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'interior-oblique'}});
  const overhead=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'overhead'}});
  assert.ok(front.identity.some(value=>/exactly two engine nacelles/i.test(value)));
  assert.ok(rear.identity.some(value=>/exactly four vertical fins/i.test(value)));
  assert.ok(interior.identity.some(value=>/interior mission bay/i.test(value)));
  assert.ok(overhead.identity.some(value=>/overhead wing planform/i.test(value)));
  const {sections}=normalizeOmniSections({exclusions:'generic vehicle, passenger windows, generic vehicle'},direction,localTopic);
  assert.doesNotMatch(sections.exclusions,/engines|rotodome|final paint/i);
  assert.equal((sections.exclusions.match(/generic vehicle/gi)||[]).length,1);
  assert.match(sections.exclusions,/automatic panel closure|generic airliner geometry/i);
});

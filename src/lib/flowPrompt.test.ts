import test from 'node:test';
import assert from 'node:assert/strict';
import { compactIdentity, finalizeFlowPrompt, normalizeConstraintList, profileInstruction } from './flowPrompt';
import type { SceneDirection, TopicBrief } from '../types';

const direction = { number:1,start:0,end:10,duration:10,voiceover:'',silent:false,stage_id:'S01',state:'C',subject:'KJ-600',product_visual_state:'Complete',primary_action:'Taxis',supporting_motion:'Crew signals',environment_ref:'deck',environment_description:'Carrier deck',camera:{shot_scale:'medium-wide',lens:'35mm',angle:'low three-quarter',movement:'tracking',movement_speed:'slow'},lighting_and_material:'Daylight grey paint',continuity_from_previous:'None',transition_to_next:'Cut',required_visible_features:['rotodome'],forbidden_elements:['Jet engines','Weapons'] } satisfies SceneDirection;
const topic = { topic:{title:'KJ-600',category:'aircraft'},global_visual_constants:'',environments:[],visual_lock:'Compact high-wing twin-turboprop | circular dorsal rotodome | exactly four vertical tail surfaces',product_identity_lock:{core_geometry:'high wing and four-fin tail',surface_finish:'naval grey',markings:'restrained',scale_reference:'crew scale',distinctive_features:['two turboprops','rotodome'],must_remain_consistent_across_all_scenes:true},visual_exclusions:'Northrop Grumman E-2 Hawkeye, Jet engines',negative_prompt_global:['Weapons','Readable text'] } as TopicBrief;

test('normalizes nested constraints without spreading strings into characters', () => assert.deepEqual(normalizeConstraintList(['Jet engines',['Weapons','jet engines'],'Northrop Grumman E-2']), ['Jet engines','Weapons','Northrop Grumman E-2']));
test('serializes identity objects without object coercion', () => assert.doesNotMatch(compactIdentity(topic), /\[object Object\]/));
test('produces a compact clean Flow prompt with one duration and deduplicated guards', () => {
  const result = finalizeFlowPrompt('Exact 10.000-second shot. A completed aircraft taxis while a camera tracks beside it. Visual Lock verbatim: duplicated junk.', direction, topic, 'omni-flash');
  assert.doesNotMatch(result, /\[object Object\]|N, o, r, t, h/);
  assert.equal((result.match(/10-second continuous shot/gi)||[]).length, 1);
  assert.equal((result.match(/Jet engines/gi)||[]).length, 1);
  assert.ok(result.split(/\s+/).length <= 160);
  assert.match(result, /ambient sound\. Exclude dialogue, narration, music/);
});
test('profile instructions are materially different', () => assert.notEqual(profileInstruction('omni-flash'), profileInstruction('veo-flow')));
test('Veo uses descriptive negative-prompt grammar instead of no/don’t commands', () => {
  const result = finalizeFlowPrompt('A camera tracks the aircraft across the deck.', direction, topic, 'veo-flow');
  assert.match(result, /Negative prompt: Jet engines, Weapons/);
  assert.doesNotMatch(result, /Negative prompt: (?:No|Avoid|Do not)/i);
});

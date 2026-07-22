import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { buildDocumentaryScenePlan } from './scenePlanner';

const scenes=(count:number,duration=10)=>Array.from({length:count},(_,i)=>({number:i+1,start:i*duration,end:(i+1)*duration,duration,text:i%4===0?'factory scale and logistics':i%4===1?'assembly workers install component':i%4===2?'precision testing and measurement':'mechanical system relationship',silent:false}));

test('enforces documentary variety for the opening and full timeline',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const plan=buildDocumentaryScenePlan(topic,scenes(75));
  assert.equal(plan.length,75);
  assert.ok(new Set(plan.slice(0,10).map(x=>x.visual_family)).size>=5);
  assert.ok(plan.slice(0,10).filter(x=>x.product_visibility==='FULL').length<=3);
  assert.ok(plan.slice(0,10).some(x=>['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH'].includes(x.visual_family)));
  assert.ok(plan.slice(0,10).some(x=>['ASSEMBLY_PROCESS','COMPONENT_MACRO','WORKER_POV','MACHINERY_ACTION'].includes(x.visual_family)));
  assert.ok(plan.slice(0,10).some(x=>['STATIC_GRAPHIC_T2V','MOTION_GRAPHIC_T2V'].includes(x.visual_treatment)||x.visual_family==='ATMOSPHERIC_INTERSTITIAL'));
  for(let i=2;i<plan.length;i++)assert.ok(!(plan[i].visual_family===plan[i-1].visual_family&&plan[i].visual_family===plan[i-2].visual_family));
  for(let i=2;i<plan.length;i++)assert.ok(!(plan[i].product_visibility==='FULL'&&plan[i-1].product_visibility==='FULL'&&plan[i-2].product_visibility==='FULL'));
});

test('substitutes a reference-only beat with a T2V-safe plan item',()=>{
  const raw:any=JSON.parse(JSON.stringify(template)); const beat=raw.visual_story_plan.chapters[0].visual_beats[0];
  beat.generation_permission='REFERENCE_REQUIRED';beat.preferred_media_routes=['REFERENCE_IMAGE_I2V'];
  const plan=buildDocumentaryScenePlan(normalizeProductionHandoff(raw),scenes(1));
  assert.equal(plan.length,1);assert.notEqual(plan[0].beat_id,beat.beat_id);assert.ok(['LIVE_ACTION_T2V','STATIC_GRAPHIC_T2V','MOTION_GRAPHIC_T2V'].includes(plan[0].visual_treatment));
});

test('plans 8-second and partial-duration windows without changing scene numbers',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const input=[...scenes(3,8),{number:4,start:24,end:29.75,duration:5.75,text:'final payoff',silent:false}];
  assert.deepEqual(buildDocumentaryScenePlan(topic,input).map(x=>x.number),[1,2,3,4]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { buildDocumentaryScenePlan, isOperationallyMobileProduct } from './scenePlanner';

const scenes=(count:number,duration=10)=>Array.from({length:count},(_,i)=>({number:i+1,start:i*duration,end:(i+1)*duration,duration,text:i%4===0?'factory scale and logistics':i%4===1?'assembly workers install component':i%4===2?'precision testing and measurement':'mechanical system relationship',silent:false}));
const operationalTopic=(productClass='combat helicopter',restricted=false)=>{
  const raw:any=JSON.parse(JSON.stringify(template));raw.product.official_name='HX-1';raw.product.exact_variant='HX-1 operational configuration';raw.product.product_class=productClass;raw.product.immutable_identity_features=['five-blade main rotor','broad utility cabin','single tail rotor'];
  const env={...raw.environments[1],environment_id:'ENV_OPERATIONAL',environment_name:'Generic flight-test range',setting_scope:'OPERATIONAL',facility_type:'non-identifying operational test environment'};raw.environments.push(env);
  const finalStage=JSON.parse(JSON.stringify(raw.production_stages[0]));finalStage.stage_id='STG_07';finalStage.stage_number=7;finalStage.stage_name='Operational testing and deployment';finalStage.product_state_code='C';finalStage.product_state.recognizable_as_final_product=true;finalStage.environment_ids=['ENV_OPERATIONAL'];finalStage.stage_visual_summary='Complete aircraft performs controlled operational flight';raw.production_stages.push(finalStage);
  const base=raw.visual_story_plan.chapters[0].visual_beats[0];
  const beat=(id:string,family:string,fn:string,purpose:string)=>({...base,beat_id:id,beat_order:raw.visual_story_plan.chapters[0].visual_beats.length+1,beat_name:purpose,story_function:fn,visual_family:family,narrative_purpose:purpose,semantic_alignment_terms:['flight','hover','maneuver','deployment'],applicable_stage_ids:['STG_07'],environment_ids:['ENV_OPERATIONAL'],product_visibility:'FULL',required_product_state_code:'C',preferred_media_routes:restricted?['AUTHENTIC_VIDEO']:['GENERATED_T2V'],generation_permission:restricted?'REFERENCE_REQUIRED':'T2V_ALLOWED',must_show:['single HX-1','five-blade main rotor','stable configuration'],must_not_show:['weapon discharge','invented markings']});
  raw.visual_story_plan.chapters[0].visual_beats.push(beat('OP_HOOK','OPERATIONAL_CONTEXT','OPENING_HOOK','Controlled low hover in a generic flight drill'),beat('OP_PAYOFF','DYNAMIC_TESTING','PREVIEW_PAYOFF','Banked operational transit over a generic test range'));
  return normalizeProductionHandoff(raw);
};

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

test('guarantees operational footage in the opening and at recurring intervals for aircraft',()=>{
  const topic=operationalTopic(),plan=buildDocumentaryScenePlan(topic,scenes(75));const operational=(item:any)=>['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(item.visual_family);
  assert.equal(isOperationallyMobileProduct(topic),true);
  assert.ok(plan.slice(0,3).some(operational));assert.ok(plan.slice(0,10).filter(operational).length>=2);
  assert.ok(plan.slice(0,10).some(item=>['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH'].includes(item.visual_family)));
  assert.ok(plan.slice(0,10).some(item=>['ASSEMBLY_PROCESS','COMPONENT_MACRO','MACHINERY_ACTION','QUALITY_CONTROL'].includes(item.visual_family)));
  const numbers=plan.filter(operational).map(item=>item.number);for(let i=1;i<numbers.length;i++)assert.ok(numbers[i]-numbers[i-1]<=9);
  for(let i=2;i<plan.length;i++)assert.ok(!(operational(plan[i])&&operational(plan[i-1])&&operational(plan[i-2])));
  assert.ok(plan.filter(operational).every(item=>item.state==='C'));
});

test('creates T2V-safe contextual alternatives for reference-only operational events',()=>{
  const plan=buildDocumentaryScenePlan(operationalTopic('fighter aircraft',true),scenes(12));const opening=plan.find(item=>item.visual_family==='OPERATIONAL_CONTEXT');
  assert.ok(opening);assert.match(opening!.beat_id,/__T2V_SAFE$/);assert.ok(opening!.number<=3);
});

test('detects aircraft but does not classify a stationary industrial product as mobile',()=>{
  assert.equal(isOperationallyMobileProduct(operationalTopic('fighter aircraft')),true);
  const stationary=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));assert.equal(isOperationallyMobileProduct(stationary),false);
});

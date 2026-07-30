import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { LEGACY_PRODUCTION_TEMPLATE, normalizeProductionHandoff } from './productionTemplate';
import { parseAndValidateHandoffJson, validateVisualProductionHandoff } from './handoffValidation';
import { makeValidEngineeringHandoff } from '../testFixtures/engineeringV3';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('bundled V2 template validates with two environments and one stage', () => {
  const result = validateVisualProductionHandoff(template);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'Valid Manufacturing V2');
  assert.equal(template.environments.length, 2);
  assert.equal(template.production_stages.length, 1);
});

test('V2 schema reports missing, enum, additional-property, ID, and version errors', () => {
  const missing: any = clone(template); delete missing.visual_story_plan;
  assert.ok(validateVisualProductionHandoff(missing).schemaErrors.some(error => error.path === '/visual_story_plan'));

  const invalidEnum: any = clone(template); invalidEnum.production_stages[0].product_state_code = 'D';
  assert.ok(validateVisualProductionHandoff(invalidEnum).schemaErrors.some(error => error.path.includes('product_state_code')));

  const additional: any = clone(template); additional.unexpected = true;
  assert.ok(validateVisualProductionHandoff(additional).schemaErrors.some(error => error.message.includes('additional')));

  const malformed: any = clone(template); malformed.production_stages[0].stage_id = 'bad id';
  assert.ok(validateVisualProductionHandoff(malformed).schemaErrors.some(error => error.path.includes('stage_id')));

  const unsupported: any = clone(template); unsupported.schema.version = '3.0.0';
  const unsupportedResult = validateVisualProductionHandoff(unsupported);
  assert.equal(unsupportedResult.valid, false);
  assert.equal(unsupportedResult.format, 'mixed');
});

test('V2 semantic validation detects every duplicate ID family', () => {
  const value: any = clone(template);
  value.geometry_modules.push(clone(value.geometry_modules[0]));
  value.reference_assets.push(clone(value.reference_assets[0]));
  value.environments.push(clone(value.environments[0]));
  value.production_stages.push(clone(value.production_stages[0]));
  value.visual_story_plan.chapters.push(clone(value.visual_story_plan.chapters[0]));
  value.visual_story_plan.chapters[0].visual_beats.push(clone(value.visual_story_plan.chapters[0].visual_beats[0]));
  const result = validateVisualProductionHandoff(value);
  assert.equal(result.valid, false);
  for (const id of ['FULL_PRODUCT', 'REF_001', 'ENV_ASSEMBLY_INTERIOR', 'STG_01', 'CH01']) {
    assert.ok(result.semanticErrors.some(error => error.message.includes(`"${id}"`)), `missing duplicate ${id}`);
  }
  assert.ok(result.semanticErrors.some(error => error.path.includes('visual_beats')));
});

test('V2 semantic validation reports all cross-reference categories with readable paths', () => {
  const value: any = clone(template);
  const stage = value.production_stages[0];
  stage.environment_ids = ['ENV_MISSING'];
  stage.geometry_control.primary_geometry_module_id = 'MOD_MISSING';
  stage.geometry_control.secondary_geometry_module_ids = ['MOD_SECONDARY_MISSING'];
  stage.visual_evidence.reference_asset_ids = ['REF_MISSING'];
  value.stage_transitions = [{
    from_stage_id: 'STG_FROM_MISSING', to_stage_id: 'STG_TO_MISSING', components_added: [],
    components_enclosed_or_hidden: [], surface_changes: [], marking_changes: [],
    geometry_that_must_not_change: [], continuity_risks: [], recommended_bridge_visual_families: [],
  }];
  const chapter = value.visual_story_plan.chapters[0];
  chapter.applicable_production_stage_ids = ['STG_CHAPTER_MISSING'];
  const beat = chapter.visual_beats[0];
  beat.applicable_stage_ids = ['STG_BEAT_MISSING'];
  beat.environment_ids = ['ENV_BEAT_MISSING'];
  beat.reference_asset_ids = ['REF_BEAT_MISSING'];
  const result = validateVisualProductionHandoff(value);
  assert.equal(result.schemaErrors.length, 0);
  for (const id of ['ENV_MISSING', 'MOD_MISSING', 'MOD_SECONDARY_MISSING', 'REF_MISSING', 'STG_FROM_MISSING', 'STG_TO_MISSING', 'STG_CHAPTER_MISSING', 'STG_BEAT_MISSING', 'ENV_BEAT_MISSING', 'REF_BEAT_MISSING']) {
    assert.ok(result.semanticErrors.some(error => error.message.includes(`"${id}"`) && error.path.startsWith('/')), `missing broken reference ${id}`);
  }
});

test('legacy V1 and adaptive briefs remain accepted', () => {
  assert.equal(validateVisualProductionHandoff(LEGACY_PRODUCTION_TEMPLATE).status, 'Valid Legacy V1');
  assert.equal(validateVisualProductionHandoff({ topic: { title: 'Legacy topic' } }).status, 'Valid Legacy V1');
});

test('normalization uses first V2 environment and preserves complete raw handoff', () => {
  const value: any = clone(template);
  value.production_stages[0].environment_ids = ['ENV_FACTORY_AERIAL', 'ENV_ASSEMBLY_INTERIOR'];
  const normalized = normalizeProductionHandoff(value);
  assert.equal(normalized.lifecycle_stages?.[0].environment_ref, 'ENV_FACTORY_AERIAL');
  assert.deepEqual(normalized._production_handoff, value);
  assert.equal(validateVisualProductionHandoff(normalized).status, 'Valid Manufacturing V2');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized))._production_handoff.visual_story_plan, value.visual_story_plan);
});

test('detects and validates a complete Engineering V3 handoff independently',()=>{
  const value=makeValidEngineeringHandoff(),result=validateVisualProductionHandoff(value);
  assert.equal(result.valid,true);
  assert.equal(result.format,'v3');
  assert.equal(result.mode,'ENGINEERING_V3');
  assert.equal(result.status,'Valid Engineering V3');
  assert.equal(result.schemaErrors.length,0);
});

test('reports syntax, unknown version, mixed-mode, and missing V3 fields separately',()=>{
  const syntax=parseAndValidateHandoffJson('{"schema":');
  assert.equal(syntax.result.syntaxErrors[0].code,'syntax');
  const unknown:any=clone(makeValidEngineeringHandoff());unknown.schema.version='4.0.0';
  assert.equal(validateVisualProductionHandoff(unknown).format,'unsupported');
  const mixed:any=clone(makeValidEngineeringHandoff());mixed.production_stages=[];
  assert.equal(validateVisualProductionHandoff(mixed).format,'mixed');
  const missing:any=clone(makeValidEngineeringHandoff());delete missing.operational_states;
  assert.ok(validateVisualProductionHandoff(missing).schemaErrors.some(error=>error.path==='/operational_states'));
});

test('V3 semantic validation rejects duplicate IDs, broken references, endpoints, order, and duration',()=>{
  const value:any=clone(makeValidEngineeringHandoff());
  value.engineering_systems.push(clone(value.engineering_systems[0]));
  value.operational_states[0].environment_ids=['ENV_MISSING'];
  value.system_relationships[0].to_system_id='SYS_MISSING';
  value.concept_bridges[0].to_system_id='SYS_MISSING_BRIDGE';
  value.visual_story_plan.chapters[0].visual_beats[0].preferred_duration_seconds=12;
  value.visual_story_plan.chapters[0].visual_beats[0].maximum_duration_seconds=10;
  const result=validateVisualProductionHandoff(value);
  assert.equal(result.valid,false);
  for(const expected of ['Duplicate system_id','ENV_MISSING','SYS_MISSING','SYS_MISSING_BRIDGE','minimum ≤ preferred ≤ maximum'])
    assert.ok(result.errors.some(error=>error.message.includes(expected)),`missing ${expected}`);
});

test('V3 evidence and routing rules block unsupported exact and forbidden generation',()=>{
  const referenceRequired:any=clone(makeValidEngineeringHandoff());
  const beat=referenceRequired.visual_story_plan.chapters[0].visual_beats[0];
  beat.generation_permission='REFERENCE_REQUIRED';beat.preferred_media_routes=['GENERATED_T2V'];
  assert.ok(validateVisualProductionHandoff(referenceRequired).errors.some(error=>error.code==='routing'));

  const notAllowed:any=clone(makeValidEngineeringHandoff());
  notAllowed.evidence_boundaries.claims[0].visualization_permission='NOT_ALLOWED';
  assert.ok(validateVisualProductionHandoff(notAllowed).errors.some(error=>error.message.includes('not allowed')));

  const exact:any=clone(makeValidEngineeringHandoff());
  exact.visual_story_plan.chapters[0].visual_beats[0].exact_event_or_location_claim_allowed=true;
  assert.ok(validateVisualProductionHandoff(exact).errors.some(error=>error.message.includes('Exact event/location')));

  const cutaway:any=clone(makeValidEngineeringHandoff());
  cutaway.visual_story_plan.chapters[0].visual_beats[0].visual_family='SYSTEM_CUTAWAY';
  cutaway.visual_story_plan.chapters[0].visual_beats[0].reference_asset_ids=[];
  assert.ok(validateVisualProductionHandoff(cutaway).errors.some(error=>error.message.includes('internal cutaway')));
});

test('V3 requires four systems and meaningful beat alignment',()=>{
  const value:any=clone(makeValidEngineeringHandoff());
  value.engineering_systems=value.engineering_systems.slice(0,3);
  value.visual_story_plan.chapters[0].visual_beats[0].semantic_alignment_terms=[];
  const result=validateVisualProductionHandoff(value);
  assert.ok(result.errors.some(error=>error.message.includes('at least four')));
  assert.ok(result.errors.some(error=>error.message.includes('semantic-alignment')));
});

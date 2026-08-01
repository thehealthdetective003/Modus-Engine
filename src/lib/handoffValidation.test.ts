import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { LEGACY_PRODUCTION_TEMPLATE, normalizeProductionHandoff } from './productionTemplate';
import { validateVisualProductionHandoff } from './handoffValidation';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('bundled V2 template validates with two environments and one stage', () => {
  const result = validateVisualProductionHandoff(template);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'Valid V2');
  assert.equal(template.environments.length, 2);
  assert.equal(template.production_stages.length, 1);
});

test('recoverable V2 schema differences warn without blocking import', () => {
  const missing: any = clone(template); delete missing.visual_story_plan;
  const missingResult=validateVisualProductionHandoff(missing);
  assert.equal(missingResult.valid,true);
  assert.ok(missingResult.warnings.some(error => error.path === '/visual_story_plan'));

  const invalidEnum: any = clone(template); invalidEnum.production_stages[0].product_state_code = 'D';
  const invalidEnumResult=validateVisualProductionHandoff(invalidEnum);
  assert.equal(invalidEnumResult.valid,true);
  assert.ok(invalidEnumResult.warnings.some(error => error.path.includes('product_state_code')));

  const additional: any = clone(template); additional.unexpected = true;
  const additionalResult=validateVisualProductionHandoff(additional);
  assert.equal(additionalResult.valid,true);
  assert.ok(additionalResult.warnings.some(error => error.path==='/unexpected'));

  const malformed: any = clone(template); malformed.production_stages[0].stage_id = 'bad id';malformed.visual_story_plan.chapters[0].applicable_production_stage_ids=['bad id'];
  const malformedResult=validateVisualProductionHandoff(malformed);
  assert.equal(malformedResult.valid,true);
  assert.ok(malformedResult.warnings.some(error => error.path.includes('stage_id')));

  const compatible: any=clone(template);compatible.schema.version='2.4.0';compatible.product.official_name='Future product';
  const compatibleResult=validateVisualProductionHandoff(compatible);
  assert.equal(compatibleResult.valid,true);
  assert.equal(compatibleResult.format,'v2');
  assert.ok(compatibleResult.warnings.some(error=>error.path==='/schema/version'));

  const unsupported: any = clone(template); unsupported.schema.version = '3.0.0';
  const unsupportedResult = validateVisualProductionHandoff(unsupported);
  assert.equal(unsupportedResult.valid, false);
  assert.equal(unsupportedResult.format, 'unsupported');
});

test('missing core data remains blocking',()=>{
  const product:any=clone(template);delete product.product;
  assert.equal(validateVisualProductionHandoff(product).valid,false);
  const stages:any=clone(template);stages.production_stages=[];
  assert.equal(validateVisualProductionHandoff(stages).valid,false);
  const environments:any=clone(template);environments.environments={};
  assert.equal(validateVisualProductionHandoff(environments).valid,false);
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
  assert.equal(result.valid,false);
  for (const id of ['ENV_MISSING', 'MOD_MISSING', 'MOD_SECONDARY_MISSING', 'STG_FROM_MISSING', 'STG_TO_MISSING', 'STG_CHAPTER_MISSING', 'STG_BEAT_MISSING', 'ENV_BEAT_MISSING']) {
    assert.ok(result.semanticErrors.some(error => error.message.includes(`"${id}"`) && error.path.startsWith('/')), `missing broken reference ${id}`);
  }
  for(const id of ['REF_MISSING','REF_BEAT_MISSING'])assert.ok(result.warnings.some(error=>error.message.includes(`"${id}"`)&&error.code==='asset-reference'));
});

test('unavailable reference assets warn while generated T2V remains importable',()=>{
  const value:any=clone(template);value.product.official_name='Example product';
  value.production_stages[0].visual_evidence.reference_asset_ids=['REF_UNAVAILABLE'];
  value.visual_story_plan.chapters[0].visual_beats[0].reference_asset_ids=['REF_BEAT_UNAVAILABLE'];
  const result=validateVisualProductionHandoff(value);
  assert.equal(result.valid,true);
  assert.ok(result.warnings.filter(error=>error.code==='asset-reference').length===2);
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
  assert.equal(validateVisualProductionHandoff(normalized).status, 'Valid V2');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized))._production_handoff.visual_story_plan, value.visual_story_plan);
});

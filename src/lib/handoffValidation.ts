import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import v2Schema from '../schemas/Modus_Visual_Production_Handoff_V2_Schema.json';
import v2Template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import type { VisualProductionHandoffV2 } from '../types/visualProductionV2';

export type HandoffFormat='v2'|'v1'|'legacy'|'unsupported'|'invalid';
export type HandoffStatusLabel='Valid V2'|'Valid V2 \u00b7 warnings'|'Valid Legacy V1'|'Invalid';
export type HandoffIssueSeverity='error'|'warning';
export type HandoffIssueCode='schema'|'compatibility'|'duplicate-id'|'broken-reference'|'asset-reference'|'unsupported-version'|'legacy';
export interface HandoffValidationIssue { path:string; message:string; code:HandoffIssueCode; severity:HandoffIssueSeverity; }
export interface HandoffValidationResult {
  valid:boolean;
  format:HandoffFormat;
  status:HandoffStatusLabel;
  version?:string;
  issues:HandoffValidationIssue[];
  errors:HandoffValidationIssue[];
  warnings:HandoffValidationIssue[];
  schemaErrors:HandoffValidationIssue[];
  semanticErrors:HandoffValidationIssue[];
}

const ajv=new Ajv2020({allErrors:true,strict:false});
const validateV2Schema=ajv.compile(v2Schema);
export const DEFAULT_V2_PRODUCTION_TEMPLATE=v2Template as VisualProductionHandoffV2;

const array=(value:unknown):any[]=>Array.isArray(value)?value:[];
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const issue=(path:string,message:string,code:HandoffIssueCode,severity:HandoffIssueSeverity='error'):HandoffValidationIssue=>({path,message,code,severity});
const ids=(items:unknown,field:string)=>new Set(array(items).map(item=>String(record(item)[field]||'')).filter(Boolean));

export function detectHandoffFormat(value:any):HandoffFormat {
  if(!value||typeof value!=='object'||Array.isArray(value))return 'invalid';
  const version=String(value.schema?.version||'');
  if(/^2\.\d+\.\d+$/.test(version))return 'v2';
  if(value.schema?.name&&version&&version!=='1.0.0')return 'unsupported';
  if(value.product&&Array.isArray(value.production_stages))return 'v1';
  if(value.topic&&typeof value.topic==='object')return 'legacy';
  return 'invalid';
}

function schemaIssue(error:ErrorObject):HandoffValidationIssue{
  const missing=error.keyword==='required'?`/${String((error.params as any).missingProperty||'')}`:'';
  const additional=error.keyword==='additionalProperties'?`/${String((error.params as any).additionalProperty||'')}`:'';
  const path=`${error.instancePath||'/'}${missing}${additional}`.replace(/\/+/g,'/');
  const versionMismatch=path==='/schema/version'&&(error.keyword==='const'||error.keyword==='enum');
  const message=error.keyword==='additionalProperties'
    ?'Unrecognized field is preserved but is not part of the V2 reference schema.'
    :versionMismatch
      ?'Compatible V2 minor version differs from the bundled 2.0.0 reference schema.'
      :error.message||'Reference-schema validation warning.';
  return issue(path,message,'schema','warning');
}

function coreV2Issues(data:any):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  const warnings:HandoffValidationIssue[]=[];
  if(!data.schema||typeof data.schema!=='object'||Array.isArray(data.schema))errors.push(issue('/schema','schema must be an object.','compatibility'));
  if(!data.product||typeof data.product!=='object'||Array.isArray(data.product))errors.push(issue('/product','product must be an object.','compatibility'));
  if(!Array.isArray(data.production_stages)||data.production_stages.length===0)errors.push(issue('/production_stages','At least one production stage is required.','compatibility'));
  else data.production_stages.forEach((stage:any,index:number)=>{
    if(!stage||typeof stage!=='object'||Array.isArray(stage))errors.push(issue(`/production_stages/${index}`,'Production stage must be an object.','compatibility'));
    else if(!String(stage.stage_id||'').trim())warnings.push(issue(`/production_stages/${index}/stage_id`,'Missing stage ID will be replaced by a stable positional ID for runtime use.','compatibility','warning'));
  });
  for(const [field,value] of Object.entries(data)){
    if(['geometry_modules','reference_assets','environments','stage_transitions'].includes(field)&&value!==undefined&&!Array.isArray(value))errors.push(issue(`/${field}`,`${field} must be an array when provided.`,'compatibility'));
  }
  if(data.visual_story_plan!==undefined&&(!data.visual_story_plan||typeof data.visual_story_plan!=='object'||Array.isArray(data.visual_story_plan)))warnings.push(issue('/visual_story_plan','Invalid visual story plan will be ignored and rebuilt from lifecycle stages.','compatibility','warning'));
  else if(!Array.isArray(data.visual_story_plan?.chapters)||data.visual_story_plan.chapters.length===0)warnings.push(issue('/visual_story_plan/chapters','No usable chapters were found; documentary beats will be synthesized from lifecycle stages.','compatibility','warning'));
  if(!Array.isArray(data.environments)||data.environments.length===0)warnings.push(issue('/environments','No environments were supplied; a conservative industrial environment will be derived.','compatibility','warning'));
  return [...errors,...warnings];
}

function duplicateIssues(items:unknown,field:string,path:string):HandoffValidationIssue[]{
  const seen=new Set<string>(),duplicates=new Set<string>();
  array(items).forEach(item=>{const id=String(record(item)[field]||'');if(!id)return;if(seen.has(id))duplicates.add(id);else seen.add(id);});
  return [...duplicates].map(id=>issue(path,`Duplicate ${field} "${id}".`, 'duplicate-id'));
}

function referenceIssues(values:unknown,path:string,known:Set<string>,kind:string,severity:HandoffIssueSeverity='error'):HandoffValidationIssue[]{
  const list=(Array.isArray(values)?values:values!==undefined&&values!==null?[values]:[]).filter(value=>typeof value==='string'||typeof value==='number');
  const code=kind==='reference asset'?'asset-reference':'broken-reference';
  return list.map(String).filter(Boolean).filter(id=>!known.has(id)).map(id=>issue(path,`Unknown ${kind} reference "${id}".`,code,severity));
}

export function validateV2Semantics(data:any):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  const modules=ids(data.geometry_modules,'module_id'),assets=ids(data.reference_assets,'asset_id'),environments=ids(data.environments,'environment_id'),stages=ids(data.production_stages,'stage_id');
  errors.push(...duplicateIssues(data.geometry_modules,'module_id','/geometry_modules'));
  errors.push(...duplicateIssues(data.reference_assets,'asset_id','/reference_assets'));
  errors.push(...duplicateIssues(data.environments,'environment_id','/environments'));
  errors.push(...duplicateIssues(data.production_stages,'stage_id','/production_stages'));
  const actions=array(data.production_stages).flatMap(stage=>array(record(stage).stage_actions));
  errors.push(...duplicateIssues(actions,'action_id','/production_stages/*/stage_actions'));
  const chapters=array(data.visual_story_plan?.chapters);
  errors.push(...duplicateIssues(chapters,'chapter_id','/visual_story_plan/chapters'));
  const beats=chapters.flatMap(chapter=>array(record(chapter).visual_beats));
  errors.push(...duplicateIssues(beats,'beat_id','/visual_story_plan/chapters/*/visual_beats'));
  array(data.production_stages).forEach((rawStage,index)=>{
    const stage=record(rawStage),base=`/production_stages/${index}`;
    errors.push(...referenceIssues(stage.environment_ids??stage.environment_id,`${base}/environment_ids`,environments,'environment'));
    errors.push(...referenceIssues(stage.geometry_control?.primary_geometry_module_id,`${base}/geometry_control/primary_geometry_module_id`,modules,'geometry module'));
    errors.push(...referenceIssues(stage.geometry_control?.secondary_geometry_module_ids,`${base}/geometry_control/secondary_geometry_module_ids`,modules,'geometry module'));
    errors.push(...referenceIssues(stage.visual_evidence?.reference_asset_ids,`${base}/visual_evidence/reference_asset_ids`,assets,'reference asset','warning'));
  });
  array(data.stage_transitions).forEach((rawTransition,index)=>{
    const transition=record(rawTransition);
    errors.push(...referenceIssues(transition.from_stage_id,`/stage_transitions/${index}/from_stage_id`,stages,'production stage'));
    errors.push(...referenceIssues(transition.to_stage_id,`/stage_transitions/${index}/to_stage_id`,stages,'production stage'));
  });
  chapters.forEach((rawChapter,chapterIndex)=>{
    const chapter=record(rawChapter),base=`/visual_story_plan/chapters/${chapterIndex}`;
    errors.push(...referenceIssues(chapter.applicable_production_stage_ids,`${base}/applicable_production_stage_ids`,stages,'production stage'));
    array(chapter.visual_beats).forEach((rawBeat,beatIndex)=>{
      const beat=record(rawBeat),beatBase=`${base}/visual_beats/${beatIndex}`;
      errors.push(...referenceIssues(beat.applicable_stage_ids,`${beatBase}/applicable_stage_ids`,stages,'production stage'));
      errors.push(...referenceIssues(beat.environment_ids,`${beatBase}/environment_ids`,environments,'environment'));
      errors.push(...referenceIssues(beat.reference_asset_ids,`${beatBase}/reference_asset_ids`,assets,'reference asset','warning'));
    });
  });
  return errors;
}

function legacyIssues(data:any,format:'v1'|'legacy'):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  if(format==='v1'){
    if(!data.schema?.name)errors.push(issue('/schema/name','schema.name is required.','legacy'));
    if(!data.product||typeof data.product!=='object')errors.push(issue('/product','product is required.','legacy'));
    if(!Array.isArray(data.environments))errors.push(issue('/environments','environments must be an array.','legacy'));
    if(!Array.isArray(data.production_stages)||data.production_stages.length===0)errors.push(issue('/production_stages','production_stages must contain at least one stage.','legacy'));
    if(!data.global_prompt_rules||typeof data.global_prompt_rules!=='object')errors.push(issue('/global_prompt_rules','global_prompt_rules is required.','legacy','warning'));
  }else if(!data.topic?.title)errors.push(issue('/topic/title','topic.title is required.','legacy'));
  return errors;
}

function deduplicateIssues(issues:HandoffValidationIssue[]):HandoffValidationIssue[]{
  const seen=new Set<string>();
  return issues.filter(item=>{const key=`${item.path}|${item.message}|${item.severity}`;if(seen.has(key))return false;seen.add(key);return true;});
}

export function validateVisualProductionHandoff(data:any):HandoffValidationResult {
  const source=data?._production_handoff||data;
  const format=detectHandoffFormat(source);
  let schemaErrors:HandoffValidationIssue[]=[],semanticErrors:HandoffValidationIssue[]=[];
  if(format==='v2'){
    validateV2Schema(source);
    schemaErrors=(validateV2Schema.errors||[]).map(schemaIssue);
    semanticErrors=[...coreV2Issues(source),...validateV2Semantics(source)];
  }else if(format==='v1'||format==='legacy')semanticErrors=legacyIssues(source,format);
  else if(format==='unsupported')semanticErrors=[issue('/schema/version',`Unsupported schema version "${String(source?.schema?.version||'')}".`,'unsupported-version')];
  else semanticErrors=[issue('/','File is not a recognized Modus production handoff or legacy topic brief.','schema')];
  const issues=deduplicateIssues([...schemaErrors,...semanticErrors]);
  const errors=issues.filter(item=>item.severity==='error');
  const warnings=issues.filter(item=>item.severity==='warning');
  const valid=errors.length===0;
  const status:HandoffStatusLabel=!valid?'Invalid':format==='v2'?(warnings.length?'Valid V2 \u00b7 warnings':'Valid V2'):'Valid Legacy V1';
  return {valid,format,status,version:source?.schema?.version,issues,errors,warnings,schemaErrors,semanticErrors};
}

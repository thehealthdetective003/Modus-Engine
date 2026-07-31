import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import v2Schema from '../schemas/Modus_Visual_Production_Handoff_V2_Schema.json';
import v2Template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import v3Schema from '../schemas/Modus_Visual_Engineering_Handoff_V3_Schema.json';
import type { HandoffMode } from '../types';
import type { VisualProductionHandoffV2 } from '../types/visualProductionV2';
import type { V3EvidenceClaim, V3MediaRoute, V3VisualBeat, VisualEngineeringHandoffV3 } from '../types/visualEngineeringV3';

export type HandoffFormat='v3'|'v2'|'v1'|'legacy'|'mixed'|'unsupported'|'invalid';
export type HandoffStatusLabel='Valid Engineering V3'|'Valid Manufacturing V2'|'Valid Legacy V1'|'Invalid';
export type HandoffIssueSeverity='error'|'warning';
export type HandoffIssueCode='syntax'|'schema'|'duplicate-id'|'broken-reference'|'unsupported-version'|'mixed-mode'|'mode-mismatch'|'legacy'|'semantic'|'observability'|'evidence'|'routing'|'order'|'duration';
export interface HandoffValidationIssue {
  path:string;
  message:string;
  code:HandoffIssueCode;
  severity:HandoffIssueSeverity;
  rule:string;
  suggestedCorrection?:string;
}
export interface HandoffValidationResult {
  valid:boolean;
  format:HandoffFormat;
  mode:HandoffMode|null;
  status:HandoffStatusLabel;
  version?:string;
  schemaName?:string;
  selectedMode:HandoffMode|null;
  declaredMode:HandoffMode|null;
  syntaxErrors:HandoffValidationIssue[];
  schemaErrors:HandoffValidationIssue[];
  semanticErrors:HandoffValidationIssue[];
  warnings:HandoffValidationIssue[];
  errors:HandoffValidationIssue[];
}

const ajv=new Ajv2020({allErrors:true,strict:false});
const validateV2Schema=ajv.compile(v2Schema);
const validateV3Schema=ajv.compile(v3Schema);
export const DEFAULT_V2_PRODUCTION_TEMPLATE=v2Template as VisualProductionHandoffV2;

const V2_EXCLUSIVE=['production_stages','stage_transitions'];
const V3_EXCLUSIVE=['engineering_systems','operational_states','system_relationships','concept_bridges','evidence_boundaries'];
const hasAny=(value:any,fields:string[])=>fields.some(field=>Object.prototype.hasOwnProperty.call(value||{},field));

export function detectHandoffFormat(value:any):HandoffFormat {
  if(!value||typeof value!=='object'||Array.isArray(value))return 'invalid';
  const version=String(value.schema?.version||'');
  const v2Fields=hasAny(value,V2_EXCLUSIVE),v3Fields=hasAny(value,V3_EXCLUSIVE);
  if(v2Fields&&v3Fields)return 'mixed';
  if(version==='3.0.0'&&v2Fields||version==='2.0.0'&&v3Fields)return 'mixed';
  if(version==='3.0.0')return 'v3';
  if(version==='2.0.0')return 'v2';
  if(value.schema?.name&&version&&version!=='1.0.0')return 'unsupported';
  if(value.product&&Array.isArray(value.production_stages))return 'v1';
  if(value.topic&&typeof value.topic==='object')return 'legacy';
  return 'invalid';
}

export function handoffModeFor(value:any):HandoffMode|null {
  const format=detectHandoffFormat(value?._production_handoff||value);
  return format==='v3'?'ENGINEERING_V3':format==='v2'||format==='v1'||format==='legacy'?'MANUFACTURING_V2':null;
}

const issue=(path:string,message:string,code:HandoffIssueCode,severity:HandoffIssueSeverity='error',suggestedCorrection?:string):HandoffValidationIssue=>({
  path,message,code,severity,rule:code,suggestedCorrection,
});
const schemaIssue=(error:ErrorObject):HandoffValidationIssue=>{
  const missing=error.keyword==='required'?`/${String((error.params as any).missingProperty||'')}`:'';
  const additional=error.keyword==='additionalProperties'?`/${String((error.params as any).additionalProperty||'')}`:'';
  return issue(`${error.instancePath||'/'}${missing}${additional}`.replace(/\/+/g,'/'),error.message||'Schema validation failed.','schema','error',
    error.keyword==='required'?'Add the required field using the authoritative schema.':error.keyword==='additionalProperties'?'Remove the unsupported field; do not modify the schema.':undefined);
};
const ids=(items:any[],field:string)=>new Set((items||[]).map(item=>String(item?.[field]||'')).filter(Boolean));
function duplicateIssues(items:any[],field:string,path:string):HandoffValidationIssue[]{
  const seen=new Set<string>(),duplicates=new Set<string>();
  (items||[]).forEach(item=>{const id=String(item?.[field]||'');if(!id)return;if(seen.has(id))duplicates.add(id);else seen.add(id);});
  return [...duplicates].map(id=>issue(path,`Duplicate ${field} "${id}".`,'duplicate-id','error',`Assign a unique ${field} to every item.`));
}
function duplicateOrderIssues(items:any[],field:string,path:string):HandoffValidationIssue[]{
  const seen=new Set<number>(),duplicates=new Set<number>();
  items.forEach(item=>{const order=Number(item?.[field]);if(!Number.isFinite(order))return;if(seen.has(order))duplicates.add(order);else seen.add(order);});
  return [...duplicates].map(order=>issue(path,`Duplicate ${field} ${order}.`,'order','error',`Use a unique sortable ${field} within this collection.`));
}
function referenceIssues(values:unknown,path:string,known:Set<string>,kind:string):HandoffValidationIssue[]{
  const list=Array.isArray(values)?values:values?[values]:[];
  return list.map(String).filter(Boolean).filter(id=>!known.has(id)).map(id=>issue(path,`Unknown ${kind} reference "${id}".`,'broken-reference','error',`Reference an existing ${kind} ID or remove the reference.`));
}

export function validateV2Semantics(data:VisualProductionHandoffV2):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  const modules=ids(data.geometry_modules,'module_id'),assets=ids(data.reference_assets,'asset_id'),environments=ids(data.environments,'environment_id'),stages=ids(data.production_stages,'stage_id');
  errors.push(...duplicateIssues(data.geometry_modules,'module_id','/geometry_modules'));
  errors.push(...duplicateIssues(data.reference_assets,'asset_id','/reference_assets'));
  errors.push(...duplicateIssues(data.environments,'environment_id','/environments'));
  errors.push(...duplicateIssues(data.production_stages,'stage_id','/production_stages'));
  const actions=data.production_stages.flatMap(stage=>stage.stage_actions||[]);
  errors.push(...duplicateIssues(actions,'action_id','/production_stages/*/stage_actions'));
  const chapters=data.visual_story_plan.chapters||[];
  errors.push(...duplicateIssues(chapters,'chapter_id','/visual_story_plan/chapters'));
  const beats=chapters.flatMap(chapter=>chapter.visual_beats||[]);
  errors.push(...duplicateIssues(beats,'beat_id','/visual_story_plan/chapters/*/visual_beats'));
  data.production_stages.forEach((stage,index)=>{
    const base=`/production_stages/${index}`;
    errors.push(...referenceIssues(stage.environment_ids,`${base}/environment_ids`,environments,'environment'));
    errors.push(...referenceIssues(stage.geometry_control.primary_geometry_module_id,`${base}/geometry_control/primary_geometry_module_id`,modules,'geometry module'));
    errors.push(...referenceIssues(stage.geometry_control.secondary_geometry_module_ids,`${base}/geometry_control/secondary_geometry_module_ids`,modules,'geometry module'));
    errors.push(...referenceIssues(stage.visual_evidence.reference_asset_ids,`${base}/visual_evidence/reference_asset_ids`,assets,'reference asset'));
  });
  data.stage_transitions.forEach((transition,index)=>{
    errors.push(...referenceIssues(transition.from_stage_id,`/stage_transitions/${index}/from_stage_id`,stages,'production stage'));
    errors.push(...referenceIssues(transition.to_stage_id,`/stage_transitions/${index}/to_stage_id`,stages,'production stage'));
  });
  chapters.forEach((chapter,chapterIndex)=>{
    const base=`/visual_story_plan/chapters/${chapterIndex}`;
    errors.push(...referenceIssues(chapter.applicable_production_stage_ids,`${base}/applicable_production_stage_ids`,stages,'production stage'));
    chapter.visual_beats.forEach((beat,beatIndex)=>{
      const beatBase=`${base}/visual_beats/${beatIndex}`;
      errors.push(...referenceIssues(beat.applicable_stage_ids,`${beatBase}/applicable_stage_ids`,stages,'production stage'));
      errors.push(...referenceIssues(beat.environment_ids,`${beatBase}/environment_ids`,environments,'environment'));
      errors.push(...referenceIssues(beat.reference_asset_ids,`${beatBase}/reference_asset_ids`,assets,'reference asset'));
    });
  });
  return errors;
}

const exactRoutes=new Set<V3MediaRoute>(['REFERENCE_IMAGE_I2V','AUTHENTIC_VIDEO','REFERENCE_LOCKED_GRAPHIC','STATIC_IMAGE_WITH_MOTION']);
const readableGraphic=/\b(map|timeline|dimension|label|number|table|formula|interface|precise data|measurement)\b/i;
const concreteTokens=new Set([
  'aircraft','airframe','arrow','beam','block','boat','bubble','cable','camera','circle','cloud','component','console','control','cradle','deck','deckhouse','door','edge','engine','exhaust','fin','flap','frame','gear','hand','hatch','helicopter','hull','intake','line','mast','nose','operator','outrigger','pallet','panel','particle','post','rectangle','rotor','rudder','sensor','shadow','ship','silhouette','spray','stern','structure','surface','tail','tank','technician','track','vehicle','wake','waterline','wave','wheel','wing','wire',
]);
const visiblePropertyTokens=new Set(['black','blue','broad','brown','charcoal','curved','dark','dashed','flat','grey','gray','level','narrow','open','orange','pale','pointed','red','sealed','separated','symmetric','vertical','white','wide','yellow']);
const visibleActionTokens=new Set(['advance','bend','change','converge','descend','fade','fall','flex','lengthen','lift','move','point','rise','rotate','separate','settle','stop','tilt','touch','turn','widen']);
const forbiddenMustShowTokens=new Set([
  'accuracy','accurate','authentic','autonomy','avoid','capability','compliance','constraint','correct','ensure','evaluation','evidence','generic','highlighted','identity','logic','maintain','maturity','milestone','mission','operational','precedent','preserve','proof','reference','reliability','resistance','route','safe','safety','should','show','source','status','subject','support','system','tradeoff','transfer','trial','uncertainty','verified',
]);
const negativeMustShowTokens=new Set(['avoid','no','not','without']);
const singularize=(token:string)=>token.endsWith('ies')&&token.length>4?`${token.slice(0,-3)}y`:/(ches|shes|xes|zes)$/.test(token)?token.slice(0,-2):token.endsWith('sses')?token.slice(0,-2):token.endsWith('s')&&token.length>3&&!token.endsWith('ss')?token.slice(0,-1):token;
const mustShowTokens=(value:string)=>Array.from(value.toLowerCase().matchAll(/[a-z0-9]+/g),match=>singularize(match[0]));

export function reviewMustShowEntry(value:string,path:string):HandoffValidationIssue|null {
  const tokens=mustShowTokens(value.trim());
  if(!tokens.length)return issue(path,`must_show entry ${JSON.stringify(value)} is empty.`,'observability','warning','Replace it with one concrete object, visible property, graphic primitive, count, position, shape, color, change, or physical action.');
  const forbidden=tokens.find(token=>forbiddenMustShowTokens.has(token));
  const beginsNegative=negativeMustShowTokens.has(tokens[0])||(tokens[0]==='do'&&tokens[1]==='not');
  if(forbidden||beginsNegative)return issue(path,`must_show entry ${JSON.stringify(value)} contains non-observable or instructional term ${JSON.stringify(forbidden||tokens[0])}.`,'observability','warning','Move interpretation, provenance, correctness, or negative instructions to narrative_purpose, must_not_show, or negative_constraints.');
  const hasConcrete=tokens.some(token=>concreteTokens.has(token));
  const hasVisibleAction=tokens.some(token=>visibleActionTokens.has(token));
  const hasVisibleProperty=tokens.some(token=>visiblePropertyTokens.has(token));
  const hasCount=tokens.some(token=>/^\d+$/.test(token)||['one','two','three','four','five','six','seven','eight','nine','ten'].includes(token));
  if(!hasConcrete||(!hasCount&&!hasVisibleAction&&!hasVisibleProperty))return issue(path,`must_show entry ${JSON.stringify(value)} may not identify a concrete, camera-visible primitive or action.`,'observability','warning','Rewrite it as a count plus physical object, a visible property, or a physical action.');
  return null;
}
function claimMap(data:VisualEngineeringHandoffV3){return new Map(data.evidence_boundaries.claims.map(claim=>[claim.claim_id,claim]));}
function referencedClaims(beat:V3VisualBeat,claims:Map<string,V3EvidenceClaim>){return beat.evidence_claim_ids.map(id=>claims.get(id)).filter(Boolean) as V3EvidenceClaim[];}
function forbiddenClaimReferenceIssues(values:string[],path:string,claims:Map<string,V3EvidenceClaim>):HandoffValidationIssue[]{
  return values.flatMap((id,index)=>{
    const claim=claims.get(id);
    return claim&&(claim.claim_type==='UNKNOWN'||claim.wording_permission==='EXCLUDE'||claim.visualization_permission==='NOT_ALLOWED')
      ?[issue(`${path}/${index}`,`Claim ${JSON.stringify(id)} is ${claim.claim_type} with ${claim.wording_permission}/${claim.visualization_permission} permission and cannot be used by a visual object.`,'evidence','error','Keep this claim only in evidence_boundaries.claims and reference a separate permitted contextual claim.')]
      :[];
  });
}

export function validateV3Semantics(data:VisualEngineeringHandoffV3):HandoffValidationIssue[]{
  const issues:HandoffValidationIssue[]=[];
  const claims=ids(data.evidence_boundaries.claims,'claim_id'),modules=ids(data.geometry_modules,'module_id');
  const assets=ids(data.reference_assets,'asset_id'),environments=ids(data.environments,'environment_id');
  const systems=ids(data.engineering_systems,'system_id'),states=ids(data.operational_states,'state_id');
  const relationships=ids(data.system_relationships,'relationship_id'),bridges=ids(data.concept_bridges,'bridge_id');
  const claimsById=claimMap(data);
  const chapters=data.visual_story_plan.chapters||[],beats=chapters.flatMap(chapter=>chapter.visual_beats||[]);
  [
    [data.evidence_boundaries.claims,'claim_id','/evidence_boundaries/claims'],
    [data.geometry_modules,'module_id','/geometry_modules'],
    [data.reference_assets,'asset_id','/reference_assets'],
    [data.environments,'environment_id','/environments'],
    [data.engineering_systems,'system_id','/engineering_systems'],
    [data.operational_states,'state_id','/operational_states'],
    [data.system_relationships,'relationship_id','/system_relationships'],
    [data.concept_bridges,'bridge_id','/concept_bridges'],
    [chapters,'chapter_id','/visual_story_plan/chapters'],
    [beats,'beat_id','/visual_story_plan/chapters/*/visual_beats'],
  ].forEach(([items,field,path])=>issues.push(...duplicateIssues(items as any[],String(field),String(path))));
  issues.push(...duplicateOrderIssues(chapters,'chapter_order','/visual_story_plan/chapters'));
  const meaningfulSystems=data.engineering_systems.filter(system=>system.system_name.trim()&&system.engineering_question.trim()&&system.engineering_problem.trim());
  if(meaningfulSystems.length<4)issues.push(issue('/engineering_systems',`A final Engineering V3 handoff requires at least four meaningful engineering systems; found ${meaningfulSystems.length}.`,'semantic','error','Add distinct explanatory systems with real engineering questions and constraints.'));
  data.geometry_modules.forEach((module,index)=>issues.push(...referenceIssues(module.reference_asset_ids,`/geometry_modules/${index}/reference_asset_ids`,assets,'reference asset')));
  data.engineering_systems.forEach((system,index)=>{
    const base=`/engineering_systems/${index}`;
    issues.push(...referenceIssues(system.interacting_system_ids,`${base}/interacting_system_ids`,systems,'engineering system'));
    issues.push(...referenceIssues(system.geometry_module_ids,`${base}/geometry_module_ids`,modules,'geometry module'));
    issues.push(...referenceIssues(system.operational_state_ids,`${base}/operational_state_ids`,states,'operational state'));
    issues.push(...referenceIssues(system.reference_asset_ids,`${base}/reference_asset_ids`,assets,'reference asset'));
    issues.push(...referenceIssues(system.evidence_claim_ids,`${base}/evidence_claim_ids`,claims,'evidence claim'));
    issues.push(...forbiddenClaimReferenceIssues(system.evidence_claim_ids,`${base}/evidence_claim_ids`,claimsById));
  });
  data.operational_states.forEach((state,index)=>{
    const base=`/operational_states/${index}`;
    issues.push(...referenceIssues(state.environment_ids,`${base}/environment_ids`,environments,'environment'));
    issues.push(...referenceIssues(state.geometry_module_ids,`${base}/geometry_module_ids`,modules,'geometry module'));
    issues.push(...referenceIssues(state.reference_asset_ids,`${base}/reference_asset_ids`,assets,'reference asset'));
    issues.push(...referenceIssues(state.evidence_claim_ids,`${base}/evidence_claim_ids`,claims,'evidence claim'));
    issues.push(...forbiddenClaimReferenceIssues(state.evidence_claim_ids,`${base}/evidence_claim_ids`,claimsById));
  });
  data.system_relationships.forEach((relationship,index)=>{
    const base=`/system_relationships/${index}`;
    issues.push(...referenceIssues(relationship.from_system_id,`${base}/from_system_id`,systems,'engineering system'));
    issues.push(...referenceIssues(relationship.to_system_id,`${base}/to_system_id`,systems,'engineering system'));
    issues.push(...referenceIssues(relationship.evidence_claim_ids,`${base}/evidence_claim_ids`,claims,'evidence claim'));
    issues.push(...forbiddenClaimReferenceIssues(relationship.evidence_claim_ids,`${base}/evidence_claim_ids`,claimsById));
    if(relationship.from_system_id===relationship.to_system_id)issues.push(issue(base,'A system relationship must connect two distinct systems.','semantic','error','Choose a different valid endpoint.'));
  });
  data.concept_bridges.forEach((bridge,index)=>{
    const base=`/concept_bridges/${index}`;
    issues.push(...referenceIssues(bridge.from_system_id,`${base}/from_system_id`,systems,'engineering system'));
    issues.push(...referenceIssues(bridge.to_system_id,`${base}/to_system_id`,systems,'engineering system'));
    if(bridge.from_system_id===bridge.to_system_id)issues.push(issue(base,'A concept bridge must connect two distinct systems.','semantic','error','Choose a different valid endpoint.'));
  });
  const verifiedAssets=new Set(data.reference_assets.filter(asset=>asset.visual_verification==='PASS'&&asset.exact_event_or_location_verified&&['EXACT_EVENT_VERIFIED','EXACT_LOCATION_VERIFIED'].includes(asset.context_truth_status)).map(asset=>asset.asset_id));
  const productSpecificReference=new Set(data.reference_assets.filter(asset=>asset.visual_verification==='PASS'&&asset.exact_variant_or_configuration.trim()&&asset.visible_geometry_features.length).map(asset=>asset.asset_id));
  chapters.forEach((chapter,chapterIndex)=>{
    const base=`/visual_story_plan/chapters/${chapterIndex}`;
    issues.push(...referenceIssues(chapter.applicable_engineering_system_ids,`${base}/applicable_engineering_system_ids`,systems,'engineering system'));
    issues.push(...referenceIssues(chapter.applicable_operational_state_ids,`${base}/applicable_operational_state_ids`,states,'operational state'));
    issues.push(...referenceIssues(chapter.evidence_claim_ids,`${base}/evidence_claim_ids`,claims,'evidence claim'));
    issues.push(...forbiddenClaimReferenceIssues(chapter.evidence_claim_ids,`${base}/evidence_claim_ids`,claimsById));
    issues.push(...duplicateOrderIssues(chapter.visual_beats,'beat_order',`${base}/visual_beats`));
    chapter.visual_beats.forEach((beat,beatIndex)=>{
      const beatBase=`${base}/visual_beats/${beatIndex}`;
      issues.push(...referenceIssues(beat.applicable_engineering_system_ids,`${beatBase}/applicable_engineering_system_ids`,systems,'engineering system'));
      issues.push(...referenceIssues(beat.applicable_operational_state_ids,`${beatBase}/applicable_operational_state_ids`,states,'operational state'));
      issues.push(...referenceIssues(beat.evidence_claim_ids,`${beatBase}/evidence_claim_ids`,claims,'evidence claim'));
      issues.push(...referenceIssues(beat.environment_ids,`${beatBase}/environment_ids`,environments,'environment'));
      issues.push(...referenceIssues(beat.geometry_module_ids,`${beatBase}/geometry_module_ids`,modules,'geometry module'));
      issues.push(...referenceIssues(beat.reference_asset_ids,`${beatBase}/reference_asset_ids`,assets,'reference asset'));
      if(!(beat.minimum_usable_duration_seconds<=beat.preferred_duration_seconds&&beat.preferred_duration_seconds<=beat.maximum_duration_seconds))
        issues.push(issue(beatBase,'Duration values must satisfy minimum ≤ preferred ≤ maximum.','duration','error','Correct the three duration values without changing their meaning.'));
      if(!beat.semantic_alignment_terms.some(term=>term.trim()))issues.push(issue(`${beatBase}/semantic_alignment_terms`,'Every visual beat requires meaningful semantic-alignment terms.','semantic'));
      if(!beat.narrative_purpose.trim())issues.push(issue(`${beatBase}/narrative_purpose`,'Every visual beat requires a narrative purpose.','semantic'));
      if(!beat.preferred_media_routes.length)issues.push(issue(`${beatBase}/preferred_media_routes`,'Every visual beat requires at least one media route.','routing'));
      beat.must_show.forEach((item,itemIndex)=>{const review=reviewMustShowEntry(item,`${beatBase}/must_show/${itemIndex}`);if(review)issues.push(review);});
      const beatClaims=referencedClaims(beat,claimsById);
      issues.push(...forbiddenClaimReferenceIssues(beat.evidence_claim_ids,`${beatBase}/evidence_claim_ids`,claimsById));
      if(beatClaims.some(claim=>claim.visualization_permission==='REFERENCE_REQUIRED')){
        const referenceRoute=beat.preferred_media_routes.some(route=>exactRoutes.has(route));
        if(!beat.reference_asset_ids.length||!referenceRoute)issues.push(issue(beatBase,'A REFERENCE_REQUIRED claim needs a supporting reference asset and reference-capable media route.','routing','error','Add a valid reference asset and use REFERENCE_IMAGE_I2V, AUTHENTIC_VIDEO, REFERENCE_LOCKED_GRAPHIC, or STATIC_IMAGE_WITH_MOTION.'));
      }
      if(beat.generation_permission==='REFERENCE_REQUIRED'&&beat.preferred_media_routes.includes('GENERATED_T2V'))
        issues.push(issue(`${beatBase}/preferred_media_routes`,'REFERENCE_REQUIRED content cannot be routed to GENERATED_T2V.','routing','error','Use a reference-supported route.'));
      if(beat.generation_permission==='NOT_ALLOWED'&&!beat.preferred_media_routes.every(route=>route==='NO_VALID_ROUTE'))
        issues.push(issue(`${beatBase}/preferred_media_routes`,'NOT_ALLOWED content must not have a generative or production route.','routing','error','Route only to NO_VALID_ROUTE.'));
      const genericOnly=beatClaims.some(claim=>claim.claim_type==='GENERAL_PRINCIPLE'||claim.visualization_permission==='GENERIC_PRINCIPLE_ONLY');
      if(genericOnly&&beat.product_visibility==='FULL'&&beat.visual_family==='SYSTEM_CUTAWAY')
        issues.push(issue(beatBase,'A general principle cannot be presented as an exact product-specific internal implementation.','evidence','error','Use a separate generic principle graphic with product visibility NONE.'));
      if(beat.visual_family==='SYSTEM_CUTAWAY'&&!genericOnly&&!beat.reference_asset_ids.some(id=>productSpecificReference.has(id)))
        issues.push(issue(`${beatBase}/reference_asset_ids`,'An exact product internal cutaway requires a verified product-specific reference.','evidence','error','Add a verified reference asset or change the beat to a generic principle graphic.'));
      if(beat.exact_event_or_location_claim_allowed){
        const exactTruth=['EXACT_EVENT_VERIFIED','EXACT_LOCATION_VERIFIED'].includes(beat.context_truth_status);
        const verified=beat.reference_asset_ids.some(id=>verifiedAssets.has(id));
        const properRoute=beat.preferred_media_routes.some(route=>exactRoutes.has(route));
        if(!exactTruth||!verified||!properRoute)issues.push(issue(beatBase,'Exact event/location claims require exact truth status, a verified supporting asset, and an authentic or reference-locked route.','evidence','error','Use a contextual non-identifying alternative or supply verified reference evidence.'));
      }
      const requiresReadableGraphic=readableGraphic.test(`${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')} ${beat.must_show.join(' ')}`);
      if(requiresReadableGraphic&&(beat.generation_permission!=='EDITOR_ONLY'||beat.preferred_media_routes.length!==1||beat.preferred_media_routes[0]!=='EDITOR_NATIVE_GRAPHIC'))
        issues.push(issue(`${beatBase}/preferred_media_routes`,'Readable maps, timelines, labels, dimensions, formulas, interfaces, or precise data require EDITOR_NATIVE_GRAPHIC with EDITOR_ONLY permission.','routing','error','Use preferred_media_routes ["EDITOR_NATIVE_GRAPHIC"] and generation_permission "EDITOR_ONLY".'));
    });
  });
  data.evidence_boundaries.claims.forEach((claim,index)=>{
    if(claim.claim_type==='GENERAL_PRINCIPLE'&&claim.claim_scope==='PRODUCT_SPECIFIC'&&claim.wording_permission==='DIRECT')
      issues.push(issue(`/evidence_boundaries/claims/${index}`,'A general principle cannot be promoted to a direct product-specific fact.','evidence','error','Use GENERAL_ENGINEERING scope or qualified wording.'));
    if(claim.claim_type==='UNKNOWN'&&(claim.wording_permission!=='EXCLUDE'||claim.visualization_permission!=='NOT_ALLOWED'))
      issues.push(issue(`/evidence_boundaries/claims/${index}`,'UNKNOWN claims require wording_permission EXCLUDE and visualization_permission NOT_ALLOWED.','evidence','error','Set wording_permission to EXCLUDE and visualization_permission to NOT_ALLOWED, then keep the claim out of visual-object references.'));
    if(claim.confidence==='UNKNOWN'&&claim.wording_permission==='DIRECT')
      issues.push(issue(`/evidence_boundaries/claims/${index}/wording_permission`,'Unknown information cannot use DIRECT wording permission.','evidence','error','Use EXCLUDE for UNKNOWN claims; use QUALIFIED or CONTEXT_ONLY only for supported non-UNKNOWN claims.'));
    if(claim.claim_type==='PRODUCT_INFERENCE'&&claim.wording_permission!=='QUALIFIED')
      issues.push(issue(`/evidence_boundaries/claims/${index}/wording_permission`,'PRODUCT_INFERENCE claims require QUALIFIED wording.','evidence','error','Set wording_permission to QUALIFIED and preserve the qualifier in downstream visual metadata.'));
  });
  if(!relationships.size)issues.push(issue('/system_relationships','No system relationships are defined; engineering cause-and-effect coverage may be weak.','semantic','warning'));
  if(!bridges.size&&data.engineering_systems.length>1)issues.push(issue('/concept_bridges','No concept bridges connect the engineering systems.','semantic','warning'));
  return issues;
}

function legacyErrors(data:any,format:'v1'|'legacy'):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  if(format==='v1'){
    if(!data.schema?.name)errors.push(issue('/schema/name','schema.name is required.','legacy'));
    if(!data.product||typeof data.product!=='object')errors.push(issue('/product','product is required.','legacy'));
    if(!Array.isArray(data.environments))errors.push(issue('/environments','environments must be an array.','legacy'));
    if(!Array.isArray(data.production_stages))errors.push(issue('/production_stages','production_stages must be an array.','legacy'));
    if(!data.global_prompt_rules||typeof data.global_prompt_rules!=='object')errors.push(issue('/global_prompt_rules','global_prompt_rules is required.','legacy'));
  }else if(!data.topic?.title)errors.push(issue('/topic/title','topic.title is required.','legacy'));
  return errors;
}

export const HANDOFF_MODE_LABELS:Record<HandoffMode,string>={
  MANUFACTURING_V2:'Factory Manufacturing Handoff',
  ENGINEERING_V3:'Visual Engineering Handoff V3',
};

function resultFor(source:any,syntaxErrors:HandoffValidationIssue[]=[],selectedMode:HandoffMode|null=null,enforceSelection=false):HandoffValidationResult{
  const format=syntaxErrors.length?'invalid':detectHandoffFormat(source);
  let schemaErrors:HandoffValidationIssue[]=[],semanticErrors:HandoffValidationIssue[]=[];
  const declaredMode=format==='v3'?'ENGINEERING_V3':format==='v2'||format==='v1'||format==='legacy'?'MANUFACTURING_V2':null;
  const mismatch=enforceSelection&&selectedMode&&declaredMode&&selectedMode!==declaredMode;
  if(mismatch){
    schemaErrors=[issue('/schema',`This file declares ${HANDOFF_MODE_LABELS[declaredMode]}, but ${HANDOFF_MODE_LABELS[selectedMode]} is selected. Select ${HANDOFF_MODE_LABELS[declaredMode]} and validate again.`,'mode-mismatch','error',`Select ${HANDOFF_MODE_LABELS[declaredMode]}.`)];
  }else if(format==='v3'&&(!enforceSelection||selectedMode==='ENGINEERING_V3')){
    if(source.schema?.name!=='Modus Assembly Visual Engineering Handoff')schemaErrors.push(issue('/schema/name','Engineering V3 requires schema.name "Modus Assembly Visual Engineering Handoff".','schema'));
    if(source.schema?.version!=='3.0.0')schemaErrors.push(issue('/schema/version','Engineering V3 requires schema.version "3.0.0".','schema'));
    if(source.schema?.contract_type!=='VISUAL_ONLY_ENGINE_TO_APP_HANDOFF')schemaErrors.push(issue('/schema/contract_type','Engineering V3 requires contract_type "VISUAL_ONLY_ENGINE_TO_APP_HANDOFF".','schema'));
    if(!validateV3Schema(source))schemaErrors.push(...(validateV3Schema.errors||[]).map(schemaIssue));
    else semanticErrors=validateV3Semantics(source as VisualEngineeringHandoffV3);
  }else if(format==='v2'&&(!enforceSelection||selectedMode==='MANUFACTURING_V2')){
    if(hasAny(source,V3_EXCLUSIVE))schemaErrors.push(issue('/','The payload mixes Manufacturing V2 and Engineering V3 fields.','mixed-mode'));
    else if(!validateV2Schema(source))schemaErrors=(validateV2Schema.errors||[]).map(schemaIssue);
    else semanticErrors=validateV2Semantics(source as VisualProductionHandoffV2);
  }else if((format==='v1'||format==='legacy')&&(!enforceSelection||selectedMode==='MANUFACTURING_V2'))schemaErrors=legacyErrors(source,format);
  else if(format==='mixed')schemaErrors=[issue('/','The payload mixes Manufacturing V2 and Engineering V3 exclusive fields.','mixed-mode','error','Export one complete handoff mode only.')];
  else if(format==='unsupported')schemaErrors=[issue('/schema/version',`Unsupported schema version "${String(source?.schema?.version||'')}".`,'unsupported-version')];
  else if(!syntaxErrors.length)schemaErrors=[issue('/schema',selectedMode?`The file does not declare the required ${HANDOFF_MODE_LABELS[selectedMode]} contract.`:'File is not a recognized Modus handoff or legacy topic brief.','schema','error',selectedMode?`Choose a ${HANDOFF_MODE_LABELS[selectedMode]} file or change the selected handoff type.`:undefined)];
  const all=[...syntaxErrors,...schemaErrors,...semanticErrors],errors=all.filter(item=>item.severity==='error'),warnings=all.filter(item=>item.severity==='warning');
  const valid=errors.length===0&&(!enforceSelection||selectedMode===declaredMode),mode=declaredMode;
  const status:HandoffStatusLabel=valid?(format==='v3'?'Valid Engineering V3':format==='v2'?'Valid Manufacturing V2':'Valid Legacy V1'):'Invalid';
  return {valid,format,mode,status,version:source?.schema?.version,schemaName:source?.schema?.name,selectedMode,declaredMode,syntaxErrors,schemaErrors,semanticErrors,warnings,errors};
}

export function validateVisualProductionHandoff(data:any):HandoffValidationResult {
  return resultFor(data?._production_handoff||data);
}

export function validateHandoffForMode(data:any,selectedMode:HandoffMode):HandoffValidationResult {
  return resultFor(data?._production_handoff||data,[],selectedMode,true);
}

export function parseAndValidateHandoffJson(text:string):{data:any|null;result:HandoffValidationResult}{
  try{
    const data=JSON.parse(text);
    return {data,result:resultFor(data)};
  }catch(error){
    const message=error instanceof Error?error.message:'Invalid JSON syntax.';
    return {data:null,result:resultFor(null,[issue('/','JSON syntax error: '+message,'syntax','error','Correct the JSON syntax before schema validation.')])};
  }
}

export function parseAndValidateHandoffJsonForMode(text:string,selectedMode:HandoffMode):{data:any|null;result:HandoffValidationResult}{
  try{
    const data=JSON.parse(text);
    return {data,result:resultFor(data,[],selectedMode,true)};
  }catch(error){
    const message=error instanceof Error?error.message:'Invalid JSON syntax.';
    return {data:null,result:resultFor(null,[issue('/','JSON syntax error: '+message,'syntax','error','Correct the JSON syntax before schema validation.')],selectedMode,true)};
  }
}

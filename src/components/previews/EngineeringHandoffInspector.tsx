import type { ReactNode } from 'react';
import type { HandoffValidationResult } from '../../lib/handoffValidation';
import type { VisualEngineeringHandoffV3 } from '../../types/visualEngineeringV3';
import { Badge } from '@/components/ui/badge';

interface Props {handoff:VisualEngineeringHandoffV3;validation:HandoffValidationResult}
const Section=({title,children}:{title:string;children:ReactNode})=><details className="rounded-md border border-border/50 bg-muted/10 p-3"><summary className="cursor-pointer text-xs font-bold tracking-wider">{title}</summary><div className="mt-3 space-y-2 text-xs text-muted-foreground">{children}</div></details>;

export function EngineeringHandoffInspector({handoff,validation}:Props){
  const beats=handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats);
  const routeCounts=new Map<string,number>();beats.forEach(beat=>beat.preferred_media_routes.forEach(route=>routeCounts.set(route,(routeCounts.get(route)||0)+1)));
  return <div className="grid gap-3 md:grid-cols-2">
    <Section title={`EVIDENCE BOUNDARIES · ${handoff.evidence_boundaries.claims.length} CLAIMS`}>
      <p>{handoff.evidence_boundaries.overall_evidence_ceiling}</p>
      <div className="flex flex-wrap gap-1">{handoff.evidence_boundaries.claims.map(claim=><Badge key={claim.claim_id} variant="outline">{claim.claim_id} · {claim.confidence} · {claim.visualization_permission}</Badge>)}</div>
    </Section>
    <Section title={`ENGINEERING SYSTEMS · ${handoff.engineering_systems.length}`}>
      {handoff.engineering_systems.map(system=><div key={system.system_id}><span className="font-bold text-foreground">{system.system_id} · {system.system_name}</span><p>{system.engineering_question}</p></div>)}
    </Section>
    <Section title={`OPERATIONAL STATES · ${handoff.operational_states.length}`}>
      {handoff.operational_states.map(state=><div key={state.state_id}><span className="font-bold text-foreground">{state.state_id} · {state.state_name}</span><p>{state.product_configuration}</p></div>)}
    </Section>
    <Section title={`SYSTEM RELATIONSHIPS · ${handoff.system_relationships.length}`}>
      {handoff.system_relationships.map(item=><div key={item.relationship_id}><span className="font-bold text-foreground">{item.relationship_id} · {item.from_system_id} → {item.to_system_id}</span><p>{item.relationship_summary}</p></div>)}
    </Section>
    <Section title={`CONCEPT BRIDGES · ${handoff.concept_bridges.length}`}>
      {handoff.concept_bridges.map(item=><div key={item.bridge_id}><span className="font-bold text-foreground">{item.bridge_id} · {item.from_system_id} → {item.to_system_id}</span><p>{item.bridge_logic}</p></div>)}
    </Section>
    <Section title={`CHAPTERS & VISUAL BEATS · ${handoff.visual_story_plan.chapters.length} / ${beats.length}`}>
      {handoff.visual_story_plan.chapters.map(chapter=><div key={chapter.chapter_id}><span className="font-bold text-foreground">{chapter.chapter_order}. {chapter.chapter_name}</span><p>{chapter.visual_beats.length} beats · {chapter.applicable_engineering_system_ids.join(', ')}</p></div>)}
    </Section>
    <Section title="MEDIA ROUTING">
      <div className="flex flex-wrap gap-1">{[...routeCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([route,count])=><Badge key={route} variant="outline">{route}: {count}</Badge>)}</div>
    </Section>
    <Section title={`VALIDATION ISSUES · ${validation.errors.length} ERRORS / ${validation.warnings.length} WARNINGS`}>
      {!validation.errors.length&&!validation.warnings.length?<p className="text-green-500">No schema, reference, evidence, or routing issues.</p>:[...validation.errors,...validation.warnings].map((item,index)=><p key={`${item.path}-${index}`} className={item.severity==='error'?'text-destructive':'text-amber-500'}><span className="font-bold">{item.path}</span>: {item.message}</p>)}
    </Section>
  </div>;
}

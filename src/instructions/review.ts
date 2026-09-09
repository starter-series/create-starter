import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { InstructionDuplicate, InstructionSurfaceOverlap } from '../audit-instructions.js';
import type { SourceReport } from './topology.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = z.iso.date();
const scopedPath = z.string().min(1).refine(p => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..'), 'Expected a repo-relative instruction path');
const decisionSchema = z.object({
  id: z.string().min(1), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), scope: z.array(scopedPath).min(1),
  reason: z.string().trim().min(1), approvedBy: z.string().trim().min(1), approvedAt: date,
  reviewAfter: date.optional(), expiresAt: date.optional(), reviewReason: z.string().trim().min(1).optional(),
}).strict().refine(d => !!(d.reviewAfter || d.expiresAt || d.reviewReason), 'Provide reviewAfter, expiresAt or a reviewReason');
const configSchema = z.object({schemaVersion:z.literal(1), canonical:scopedPath.optional(), decisions:z.array(decisionSchema).default([])}).strict();
export type InstructionConfig = z.infer<typeof configSchema>;
export interface InstructionOptions { updateState?: boolean; now?: Date; }
export interface InstructionFinding {
  id:string; kind:'duplicate'|'overlap'|'topology'; paths:string[]; evidenceHash:string;
  decision:'pending'|'accepted'|'stale'; reason?:string;
}
const stateSchema = z.object({schemaVersion:z.literal(1), items:z.array(z.object({id:z.string(), evidenceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict())}).strict();
export interface InstructionReview {
  findings:InstructionFinding[];
  delta:{new:string[];changed:string[];resolved:string[];known:string[]};
  stateUpdated:boolean;
}
function dataPath(root:string, name:string):string {
  const dir=join(root,'.starter-series');
  const path=join(dir,name);
  for (const item of [dir,path]) if (existsSync(item) && lstatSync(item).isSymbolicLink()) throw new Error(`Instruction metadata must not be a symlink: ${item}`);
  return path;
}
export function loadInstructionConfig(root:string):InstructionConfig {
  const path=dataPath(root,'instructions.json');
  return existsSync(path) ? configSchema.parse(JSON.parse(readFileSync(path,'utf8'))) : {schemaVersion:1,decisions:[]};
}
export function calculateDelta(current:{id:string;evidenceHash:string}[], previous:{id:string;evidenceHash:string}[]):InstructionReview['delta'] {
  const before=new Map(previous.map(f=>[f.id,f.evidenceHash]));
  const ids=new Set(current.map(f=>f.id));
  return {
    new:current.filter(f=>!before.has(f.id)).map(f=>f.id),
    changed:current.filter(f=>before.has(f.id)&&before.get(f.id)!==f.evidenceHash).map(f=>f.id),
    known:current.filter(f=>before.get(f.id)===f.evidenceHash).map(f=>f.id),
    resolved:previous.filter(f=>!ids.has(f.id)).map(f=>f.id),
  };
}
export function reviewInstructions(root:string, report:{duplicates:InstructionDuplicate[];surfaceOverlaps:InstructionSurfaceOverlap[];topology:SourceReport}, config:InstructionConfig, options:InstructionOptions):InstructionReview {
  const findings:InstructionFinding[]=[];
  function add(kind:InstructionFinding['kind'], paths:string[], identity:unknown, evidence:unknown):void {
    const scope=[...new Set(paths)].sort();
    findings.push({id:'INS_'+hash([kind,scope,identity]).slice(0,16),kind,paths:scope,evidenceHash:hash(evidence),decision:'pending'});
  }
  for (const d of report.duplicates) add('duplicate',[d.path],d.text,[d.text,d.occurrences,d.risks]);
  for (const s of report.surfaceOverlaps) add('overlap',s.paths,'exact-overlap',s.examples);
  for (const w of report.topology.warnings) {
    const f=report.topology.files.find(f=>f.path===w.path);
    const canonical=report.topology.files.find(f=>f.path===report.topology.canonicalPath);
    add('topology',[w.path],w.code,[w.message,f,canonical?.sha256]);
  }
  const today=(options.now??new Date()).toISOString().slice(0,10);
  if (new Set(config.decisions.map(d=>d.id)).size!==config.decisions.length) throw new Error('Duplicate instruction decision identities');
  for (const f of findings) {
    const d=config.decisions.find(d=>d.id===f.id);
    if (!d) continue;
    const valid=d.evidenceHash===f.evidenceHash && hash([...d.scope].sort())===hash(f.paths) && d.approvedAt<=today &&
      (!d.reviewAfter || (d.reviewAfter>d.approvedAt && today<d.reviewAfter)) && (!d.expiresAt || (d.expiresAt>d.approvedAt && today<d.expiresAt));
    f.decision=valid?'accepted':'stale';f.reason=d.reason;
  }
  findings.sort((a,b)=>a.id.localeCompare(b.id));
  const path=dataPath(root,'instructions-state.json');
  const previous=existsSync(path)?stateSchema.parse(JSON.parse(readFileSync(path,'utf8'))).items:[];
  if (new Set(previous.map(f=>f.id)).size!==previous.length) throw new Error('Duplicate instruction state identities');
  const items=findings.map(({id,evidenceHash})=>({id,evidenceHash}));
  const delta=calculateDelta(items,previous);
  if(options.updateState){
    mkdirSync(join(root,'.starter-series'),{recursive:true});
    const temporary=path+'.'+process.pid+'.tmp';
    writeFileSync(temporary,JSON.stringify({schemaVersion:1,items},null,2)+'\n',{flag:'wx',mode:0o600});
    renameSync(temporary,path);
  }
  return {findings,delta,stateUpdated:!!options.updateState};
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {auditInstructions} from '../src/audit-instructions.ts';
const fixture=()=>mkdtempSync(join(tmpdir(),'starter-instructions-'));
function put(root:string,path:string,text:string){mkdirSync(resolve(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text);}
const rule='- Keep module boundaries intact and keep every change scoped to the requested behavior.\n';
// Ported topology scenarios from RuleMeter's source tests, through the shared audit entry point.
test('discovers supported surfaces, nested layers and symlink aliases in one check',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule);put(r,'CLAUDE.md','@AGENTS.md\n');
 put(r,'.github/copilot-instructions.md',rule);put(r,'GEMINI.md','- A different root policy.\n');
 mkdirSync(join(r,'.agents'),{recursive:true});
 symlinkSync('../AGENTS.md',join(r,'.agents/agents.md'));
 for(const p of ['.claude/rules/style.md','.agents/workflows/check.md','.cursor/rules/style.mdc','packages/api/CLAUDE.md','.github/instructions/test.instructions.md'])put(r,p,'- Contextual guidance.\n');
 put(r,'node_modules/AGENTS.md',rule);
 const a=await auditInstructions(r);
 assert.equal(a.topology.canonicalPath,'AGENTS.md');
 const roles=Object.fromEntries(a.topology.files.map(f=>[f.path,f.role]));
 assert.equal(roles['CLAUDE.md'],'import_alias');assert.equal(roles['.agents/agents.md'],'symlink_alias');
 assert.equal(roles['.github/copilot-instructions.md'],'verbatim_mirror');assert.equal(roles['GEMINI.md'],'local_override');
 assert.equal(roles['packages/api/CLAUDE.md'],'contextual_layer');assert.ok(!a.files.includes('node_modules/AGENTS.md'));
 assert.ok(a.surfaceOverlaps.every(s=>!s.paths.includes('.agents/agents.md')));
});
test('imports in fences and inline code do not establish canonical relationships',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule);put(r,'CLAUDE.md','```md\n@AGENTS.md\n```\n`@AGENTS.md`\n');
 const a=await auditInstructions(r);assert.equal(a.topology.files.find(f=>f.path==='CLAUDE.md')!.imports.length,0);
});
test('owner canonical selection and import-only alias produce a clean single source',async()=>{
 const r=fixture();put(r,'CLAUDE.md','- Prefer named exports.\n');put(r,'AGENTS.md','@CLAUDE.md\n');
 put(r,'.starter-series/instructions.json',JSON.stringify({schemaVersion:1,canonical:'CLAUDE.md'}));
 const a=await auditInstructions(r);assert.equal(a.topology.canonicalPath,'CLAUDE.md');assert.equal(a.topology.sourceStrategy,'single_source');assert.equal(a.overall.verdict,'clean');
});
test('exact duplicates are found in every file and overlap is emitted once per surface set',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule+rule);put(r,'CLAUDE.md',rule+rule);
 const a=await auditInstructions(r);assert.equal(a.duplicates.length,2);assert.equal(a.surfaceOverlaps.length,1);
});
test('approved evidence and scope are honored, changed evidence and expired review are stale',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule+rule);const first=await auditInstructions(r);
 const f=first.review.findings[0];const decision={id:f.id,evidenceHash:f.evidenceHash,scope:f.paths,reason:'Intentional repetition for this surface',approvedBy:'owner',approvedAt:'2026-09-09',reviewAfter:'2026-10-09'};
 put(r,'.starter-series/instructions.json',JSON.stringify({schemaVersion:1,decisions:[decision]}));
 const opts={now:new Date('2026-09-10')};assert.equal((await auditInstructions(r,opts)).overall.verdict,'clean');
 assert.equal((await auditInstructions(r,{now:new Date('2026-10-09')})).review.findings[0].decision,'stale');
 put(r,'AGENTS.md',rule+rule+rule);assert.equal((await auditInstructions(r,opts)).review.findings[0].decision,'stale');
});
test('new changed known and resolved delta share stable identities and explicit state writes',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule+rule);
 const a=await auditInstructions(r);assert.equal(a.review.delta.new.length,1);assert.ok(!existsSync(join(r,'.starter-series')));
 await auditInstructions(r,{updateState:true});assert.equal((await auditInstructions(r)).review.delta.known.length,1);
 put(r,'AGENTS.md',rule+rule+rule);assert.equal((await auditInstructions(r)).review.delta.changed.length,1);
 put(r,'AGENTS.md',rule);assert.equal((await auditInstructions(r)).review.delta.resolved.length,1);
});
test('malformed metadata and evidence scope do not silently approve',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule+rule);put(r,'.starter-series/instructions.json','{broken');
 await assert.rejects(auditInstructions(r));
 put(r,'.starter-series/instructions.json',JSON.stringify({schemaVersion:1,decisions:[]}));
 put(r,'.starter-series/instructions-state.json','{}');await assert.rejects(auditInstructions(r));
});
test('CLI route, compatibility alias and explicit baseline operate on an installed build',()=>{
 const r=fixture();put(r,'AGENTS.md',rule+rule);const cli=resolve('dist/index.js');
 const run=(...args:string[])=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
 const a=run('check','--instructions',r,'--json');assert.equal(a.status,1);assert.equal(JSON.parse(a.stdout).review.delta.new.length,1);
 const b=run('audit-instructions',r,'--json','--update-state');assert.equal(b.status,1);assert.equal(JSON.parse(b.stdout).review.stateUpdated,true);
 assert.equal(run('check','--instructions',r,'--update-state=false').status,2);
 assert.equal(JSON.parse(readFileSync(join(r,'.starter-series/instructions-state.json'),'utf8')).schemaVersion,1);
});

test('nested AGENTS is a layer, not a replacement for root CLAUDE',async()=>{
 const r=fixture();put(r,'CLAUDE.md','- Prefer named exports.\n');put(r,'packages/api/AGENTS.md','- API-specific context.\n');
 const a=await auditInstructions(r);assert.equal(a.topology.canonicalPath,'CLAUDE.md');assert.equal(a.topology.files.find(f=>f.path==='packages/api/AGENTS.md')!.role,'contextual_layer');
});
test('wrong approval scope is stale and an external symlink is not read',async()=>{
 const r=fixture();put(r,'AGENTS.md',rule+rule);const f=(await auditInstructions(r)).review.findings[0];
 put(r,'.starter-series/instructions.json',JSON.stringify({schemaVersion:1,decisions:[{id:f.id,evidenceHash:f.evidenceHash,scope:['CLAUDE.md'],reason:'Scoped approval',approvedBy:'owner',approvedAt:'2026-09-09',reviewReason:'Reconsider on evidence change'}]}));
 assert.equal((await auditInstructions(r,{now:new Date('2026-09-10')})).review.findings[0].decision,'stale');
 const outside=fixture();put(outside,'CLAUDE.md','Never expose this external instruction text.');symlinkSync(join(outside,'CLAUDE.md'),join(r,'CLAUDE.md'));
 const a=await auditInstructions(r);assert.ok(a.topology.warnings.some(w=>w.code==='SYMLINK_TARGET_OUTSIDE_SCAN'));assert.ok(!JSON.stringify(a).includes('Never expose this external instruction text'));
});

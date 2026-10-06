// Reproducible acceptance runner. Browser suites run sequentially so software
// rendering and timing tests do not compete for the same CPU/GPU resources.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const live=process.argv.includes('--live'),output=resolve(process.env.CHUNK_ACCEPTANCE_OUTPUT||'/tmp/chunking-acceptance');
if(live&&!process.env.TEST_DATABASE_URL)throw Error('--live requires TEST_DATABASE_URL; use a development/test database');
await mkdir(output,{recursive:true});
const origin=process.env.CHUNK_BROWSER_ORIGIN||'http://localhost:5183';
const report={schema:1,recordedAt:new Date().toISOString(),execution:'Automated tests and Chromium SwiftShader; generated fixtures; physical-device acceptance is separate',liveRequested:live,liveDatabase:!!process.env.TEST_DATABASE_URL,productionAcceptance:false,checks:[],remaining:['Representative real-upload visual/atlas review','Physical-device sustained walkthroughs and measured budgets','GPU and shader/upload trace review']};
const suites=[
 ['go-tests','go',['test','-count=1','./...']],
 ['go-vet','go',['vet','./...']],
 ['processor-tests','npm',['test','--prefix','asset-tools']],
 ['web-tests','npm',['test','--prefix','web']],
 ['web-build','npm',['run','build','--prefix','web']],
 ...['chunk-streaming','chunk-spatial','chunk-comparison','partition','room-streaming','runtime-assets','hq-rendering','fan','quality','performance'].map(name=>[name,'npm',['run',`test:${name}`,'--prefix','web']])
];
if(live)suites.push(['live-upload','node',['web/tests/chunking-live.browser.mjs']],['walking','node',['web/tests/walking.browser.mjs']],['hotspots','npm',['run','test:hotspots','--prefix','web']]);
function run(command,args,env){return new Promise(resolve=>{const child=spawn(command,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});child.on('error',err=>{log+=err.message;});child.on('close',code=>resolve({code,log}));});}
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
if(only?.some(name=>!suites.some(s=>s[0]===name)))throw Error('Unknown acceptance suite');
for(const [name,command,args] of suites.filter(s=>!only||only.includes(s[0]))){
 console.log(`Checking ${name}…`);const started=Date.now();
 const env={TOUR_ORIGIN:origin,ROOM_OUTPUT:output+'/room-streaming.json',HQ_OUTPUT:output+'/hq-rendering.json',RUNTIME_OUTPUT:output+'/runtime-assets',QUALITY_OUTPUT:output+'/quality',PERFORMANCE_OUTPUT:output+'/performance',CHUNK_STREAM_OUTPUT:output+`/${name}.json`,CHUNK_COMPARISON_OUTPUT:output+'/comparison.json',CHUNK_LIVE_OUTPUT:output+'/live.json'};
 if(['live-upload','walking','hotspots'].includes(name)){env.TOUR_ORIGIN=process.env.TOUR_ORIGIN||'http://localhost:5173';env.TOUR_FRONTEND_ORIGIN=process.env.TOUR_FRONTEND_ORIGIN||origin;}
 const result=await run(command,args,env);
 const scrubbed=result.log.replace(/https?:\/\/\S+/g,'[URL redacted]');await writeFile(output+`/${name}.log`,scrubbed);
 report.checks.push({name,status:result.code===0?'passed':'failed',elapsedMs:Date.now()-started,log:`${name}.log`});
 await writeFile(output+'/acceptance.json',JSON.stringify(report,null,2)+'\n');
 if(result.code!==0){console.error(`${name} failed; see ${output}/${name}.log`);process.exitCode=1;break;}
}
console.log(`Acceptance evidence: ${output}/acceptance.json`);

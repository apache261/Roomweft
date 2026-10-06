import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {processChunks} from '../../asset-tools/chunks.mjs';
import {createAcceptanceFixture} from '../scripts/chunking-acceptance-fixture.mjs';
import {template} from '../src/layout.ts';

const origin=process.env.TOUR_ORIGIN||'http://localhost:5183',dir=await mkdtemp(tmpdir()+'/chunk-compare-');
const fixture=await createAcceptanceFixture(dir),parent='00000000-0000-4000-9000-000000000097';
const manifest=await processChunks(fixture.source,dir+'/out',{parent_asset_id:parent,revision:1,source_sha256:fixture.inventory.source_sha256,document:fixture.partition});
const files=new Map([['original.glb',fixture.bytes]]);
for(const p of [...manifest.chunks.flatMap(c=>Object.values(c.variants)),...manifest.dependencies.map(d=>d.variants.low),manifest.navigation.payload,manifest.occlusion.payload])files.set(p.key,await readFile(`${dir}/out/${p.key}`));
const project={id:'00000000-0000-4000-9000-000000000001',slug:'chunking-comparison',name:'Same-source comparison',published:true};
const scene={id:'00000000-0000-4000-9000-000000000098',project_id:project.id,asset_id:parent,type:'3D',name:'Reviewed rooms',settings:fixture.settings,start_camera:fixture.start};
const alternate={id:'00000000-0000-4000-9000-000000000096',project_id:project.id,type:'LAYOUT',name:'Warm-cache transition',layout_revision:1,layout:{version:1,elements:[template('LOBBY')],doors:[]},settings:fixture.settings,start_camera:fixture.start};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const records=[];
function measurements(run){
 const downloads=run.assetLoads.flatMap(l=>l.events.filter(e=>e.stage==='downloaded'));
 return {firstRenderedViewMs:run.firstRenderedViewMs,firstSafelyUsableWalkingViewMs:run.firstSafelyUsableWalkingViewMs,startupPayloadBytes:downloads.filter(e=>e.atMs<=run.firstSafelyUsableWalkingViewMs).reduce((n,e)=>n+(e.bytes||0),0),visitedPayloadBytes:downloads.reduce((n,e)=>n+(e.bytes||0),0),frameMs:run.frameMs,cpuSubmissionMs:run.cpuSubmissionMs,preparation:run.timings.filter(t=>['gltf-decode','collision-preparation','model-preparation','layout-preparation'].includes(t.stage)),resources:run.resources,shaderUploadStalls:null,gpuTimeMs:null};
}
try{
 for(const latencyMs of [0,120])for(const mode of ['complete','chunked']){
  const context=await browser.newContext({viewport:{width:900,height:650}}),errors=[];
  await context.addInitScript(()=>localStorage.setItem('tour-render-quality','balanced'));
  await context.route(origin+'/compare-files/**',async route=>{if(latencyMs)await new Promise(r=>setTimeout(r,latencyMs));const key=decodeURIComponent(new URL(route.request().url()).pathname.slice('/compare-files/'.length));await route.fulfill({body:files.get(key),contentType:'model/gltf-binary'});});
  await context.route(origin+'/api/v1/**',async route=>{
   const u=new URL(route.request().url()),path=u.pathname.slice('/api/v1'.length),base=`/public/tours/${project.slug}/assets/${parent}`;
   const delivered=p=>{const {key,...rest}=p;return {...rest,url:origin+'/compare-files/'+encodeURIComponent(key)};};
   let data;
   if(path===`/public/tours/${project.slug}`)data={...project,start_scene_id:scene.id,scenes:[scene,alternate]};
   else if(path===base)data={url:origin+'/compare-files/original.glb',streaming:{state:'ready',processor_version:'chunks-v1',delivery:'scoped-descriptors',manifest_url:origin+'/api/v1'+base+'/chunks'}};
   else if(path===base+'/chunks'){
    const m=structuredClone(manifest),endpoint=(p,path)=>{const {key,...rest}=p;return {...rest,url:origin+'/api/v1'+base+path};};
    for(const c of m.chunks)for(const t of ['low','balanced','hq'])c.variants[t]=endpoint(c.variants[t],'/chunks/'+c.id+'?tier='+t);
    for(const d of m.dependencies)for(const t of ['low','balanced','hq'])d.variants[t]=endpoint(d.variants[t],'/chunk-dependencies/'+d.id+'?tier='+t);
    m.navigation.payload=endpoint(m.navigation.payload,'/chunk-indexes/navigation');m.occlusion.payload=endpoint(m.occlusion.payload,'/chunk-indexes/occlusion');data={delivery:'scoped-descriptors',manifest:m};
   }else if(path.startsWith(base+'/chunks/'))data=delivered(manifest.chunks.find(c=>c.id===path.split('/').at(-1)).variants[u.searchParams.get('tier')]);
   else if(path.startsWith(base+'/chunk-dependencies/'))data=delivered(manifest.dependencies.find(d=>d.id===path.split('/').at(-1)).variants[u.searchParams.get('tier')]);
   else if(path.startsWith(base+'/chunk-indexes/'))data=delivered(manifest[path.split('/').at(-1)].payload);
   else if(path.endsWith('/hotspots'))data=[];
   else if(path.endsWith('/layout'))data={document:alternate.layout,revision:1};
   else throw Error('Unexpected comparison route '+path);
   await route.fulfill({json:data});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>window.__tourPerformance?.firstSafelyUsableWalkingViewMs>0);
  const snapshot=()=>page.evaluate(()=>window.__tourPerformance);
  await page.goto(origin+'/t/'+project.slug+'?perf=1&streaming='+(mode==='complete'?'0':'1'));await ready();
  for(const cache of ['cold','warm']){
   await page.waitForTimeout(300);const poses=[];
   for(let visit=0;visit<2;visit++){
    await page.locator('canvas').focus();await page.keyboard.down('s');
    try{await page.waitForFunction(()=>window.__tourPerformance.metadata.cameraPosition[2]<-10,null,{timeout:30000});}catch(error){console.error(JSON.stringify({mode,cache,latencyMs,visit,metadata:(await snapshot()).metadata,errors,body:await page.locator('body').innerText()}));throw error;}finally{await page.keyboard.up('s');}
    poses.push((await snapshot()).metadata.cameraPosition);
    await page.getByRole('button',{name:'Reset view',exact:true}).click();await page.waitForFunction(()=>Math.abs(window.__tourPerformance.metadata.cameraPosition[2])<.1);
   }
   const run=await snapshot();assert.ok(run.frameMs.samples>0);assert.ok(run.firstSafelyUsableWalkingViewMs>=run.firstRenderedViewMs);
   assert.ok(run.resources.residentGeometryBytes>0);
   if(mode==='complete')assert.ok(!run.assetLoads.some(l=>l.kind==='chunk'),'rollback must bypass chunks');
   if(cache==='warm')assert.equal(run.assetLoads.filter(l=>l.events.some(e=>e.stage==='downloaded')).length,0,'warm route reuses decoded models');
   records.push({mode,cache,latencyMs,source_sha256:fixture.inventory.source_sha256,partition_revision:1,quality:'balanced',viewport:[900,650],route:{visits:2,poses,return:'Reset view',turn:'separate correctness suites'},...measurements(run)});
   if(cache==='cold'){await page.getByLabel('Scene',{exact:true}).selectOption(alternate.id);await ready();await page.getByLabel('Scene',{exact:true}).selectOption(scene.id);await ready();}
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const comparisons=[0,120].map(latencyMs=>{const complete=records.find(r=>r.mode==='complete'&&r.cache==='cold'&&r.latencyMs===latencyMs),chunked=records.find(r=>r.mode==='chunked'&&r.cache==='cold'&&r.latencyMs===latencyMs);return {latencyMs,startupPayloadByteDifference:chunked.startupPayloadBytes-complete.startupPayloadBytes,startupSavingObserved:chunked.startupPayloadBytes<complete.startupPayloadBytes,firstWalkingMsDifference:chunked.firstSafelyUsableWalkingViewMs-complete.firstSafelyUsableWalkingViewMs,visitedPayloadByteDifference:chunked.visitedPayloadBytes-complete.visitedPayloadBytes};});
 const report={schema:1,execution:'Chromium SwiftShader; generated same-source GLB; scoped API mocks; not physical-device acceptance',network:'Artificial per-binary-response latency; no throughput shaping. Successful measured binary bodies exclude failed bodies, HTTP overhead and descriptors.',sourceBytes:fixture.bytes.length,comparisons,records,productionAcceptance:false,limitations:['Complete authored occlusion and exact navigation remain startup-global; the small fixture may cost more than the complete source.','GPU time and shader/upload stalls require separate browser traces.','Real uploaded buildings, reviewed silhouettes/atlases and sustained physical-device budgets remain pending.']};
 await writeFile(process.env.CHUNK_COMPARISON_OUTPUT||'/tmp/chunking-phase10-comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:'cold/warm same-source complete/chunked tours and revisits passed',comparisons}));
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}

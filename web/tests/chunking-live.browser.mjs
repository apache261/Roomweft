import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createAcceptanceFixture} from '../scripts/chunking-acceptance-fixture.mjs';
const api=process.env.TOUR_API_ORIGIN||'http://localhost:8082',origin=process.env.TOUR_ORIGIN||'http://localhost:5173',frontend=process.env.TOUR_FRONTEND_ORIGIN||'http://localhost:5183';
const dir=await mkdtemp(tmpdir()+'/chunk-live-'),fixture=await createAcceptanceFixture(dir),report={execution:'Chromium SwiftShader plus live PostgreSQL, Node worker and local S3-compatible storage; generated upload; not real-building or physical-device acceptance',checks:[]};
let project,browser;
async function request(path,method='GET',body){const r=await fetch(api+'/api/v1'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`Local API ${method} ${path}: ${r.status} ${await r.text()}`);return r.status===204?null:r.json();}
async function upload(bytes,name){const ticket=await request(`/projects/${project.id}/uploads`,'POST',{name,size:bytes.length}),form=new FormData();for(const [k,v]of Object.entries(ticket.upload.fields))form.append(k,v);form.append('file',new Blob([bytes],{type:'model/gltf-binary'}),name);const r=await fetch(ticket.upload.url,{method:'POST',body:form});assert.ok(r.ok,'storage upload succeeds');return request(`/assets/${ticket.asset.id}/complete`,'POST');}
try{
 project=await request('/projects','POST',{name:'Disposable Phase 10 chunk acceptance'});
 const asset=await upload(fixture.bytes,'phase10-reviewed.glb'),scene=await request(`/projects/${project.id}/scenes`,'POST',{asset_id:asset.id,name:'Reviewed static source'});
 await request(`/scenes/${scene.id}`,'PATCH',{settings:fixture.settings});
 await request(`/scenes/${scene.id}`,'PATCH',{start_camera:fixture.start});
 await request(`/projects/${project.id}`,'PATCH',{start_scene_id:scene.id});
 const inventory=await request(`/assets/${asset.id}/partition/inventory`,'POST');assert.equal(inventory.inventory.source_sha256,fixture.inventory.source_sha256);
 const reviewed=await request(`/assets/${asset.id}/partition`,'PUT',{revision:inventory.revision,source_sha256:fixture.inventory.source_sha256,document:fixture.partition});
 let descriptor;const deadline=Date.now()+120000;
 while(Date.now()<deadline){descriptor=await request(`/assets/${asset.id}`);if(descriptor.streaming?.state==='ready')break;if(descriptor.streaming?.state==='failed')throw Error(descriptor.streaming.error);await new Promise(r=>setTimeout(r,400));}
 assert.equal(descriptor.streaming?.state,'ready','worker publishes a complete set');report.checks.push('actual upload/inventory/review/job/publication');
 const manifestResponse=await fetch(new URL(descriptor.streaming.manifest_url,api)),delivered=(await manifestResponse.json()).manifest;assert.ok(manifestResponse.ok);assert.equal(delivered.partition_revision,reviewed.revision);assert.ok(delivered.dependencies.length);
 const privatePayloads=[delivered.navigation.payload,delivered.occlusion.payload,...delivered.chunks.flatMap(c=>Object.values(c.variants)),...delivered.dependencies.map(d=>d.variants.balanced)];
 let verified=0;
 for(const p of privatePayloads){const r=await fetch(p.url),signed=await r.json();assert.ok(r.ok);assert.equal(signed.sha256,p.sha256);const binary=await fetch(signed.url);assert.ok(binary.ok);const bytes=Buffer.from(await binary.arrayBuffer());assert.equal(bytes.length,p.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);verified+=bytes.length;}
 report.checks.push('all tiers, exact indexes and shared-image objects verified from storage');report.generatedPayloadBytes=verified;
 const publicBase=`/public/tours/${project.slug}/assets/${asset.id}`;
 assert.equal((await fetch(api+'/api/v1'+publicBase+'/chunks')).status,404);
 await request(`/projects/${project.id}/publish`,'POST');
 const publicManifest=await request(publicBase+'/chunks');const publicURL=publicManifest.manifest.chunks[0].variants.balanced.url;assert.ok(publicURL.includes('/public/tours/'));
 const signedA=await (await fetch(publicURL)).json();await new Promise(r=>setTimeout(r,1100));const signedB=await (await fetch(publicURL)).json();assert.equal(signedA.sha256,signedB.sha256);assert.notEqual(signedA.url,signedB.url,'fresh signing retains immutable identity');report.checks.push('public scope and refreshed signed descriptors');
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:900,height:650},permissions:['local-network-access']});await context.addInitScript(()=>localStorage.setItem('tour-render-quality','balanced'));
 if(frontend!==origin)await context.route(origin+'/**',async route=>{const response=await route.fetch({url:frontend+route.request().url().slice(origin.length)});await route.fulfill({response});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const path of ['/t/','/embed/']){
  await page.goto(origin+path+project.slug+'?perf=1');await page.waitForFunction(()=>window.__tourPerformance?.firstSafelyUsableWalkingViewMs>0,null,{timeout:45000});
  const run=await page.evaluate(()=>window.__tourPerformance);assert.equal(run.metadata.chunkStreaming?.parents,1);assert.ok(!run.assetLoads.some(l=>l.kind==='original'));report.checks.push('live '+path+' streamed usable view');
 }
 await page.goto(origin+'/projects/'+project.id+'?perf=1');await page.getByRole('button',{name:'Preview tour',exact:true}).waitFor();await page.waitForFunction(()=>window.__tourPerformance?.firstUsableViewMs>0);assert.equal((await page.evaluate(()=>window.__tourPerformance)).metadata.chunkStreaming,undefined,'builder uses complete source');
 await page.getByRole('button',{name:'Preview tour',exact:true}).click();await page.waitForFunction(()=>window.__tourPerformance?.metadata.chunkStreaming?.parents===1,null,{timeout:45000});report.checks.push('builder complete tree and private preview chunks');
 await page.goto(origin+'/t/'+project.slug+'?perf=1&streaming=0');await page.waitForFunction(()=>window.__tourPerformance?.firstSafelyUsableWalkingViewMs>0,null,{timeout:45000});assert.equal((await page.evaluate(()=>window.__tourPerformance)).metadata.chunkStreaming,undefined);report.checks.push('complete-view rollback');
 // An animation upload cannot be reviewed into static chunks and stays readable.
 const fan=await upload(await readFile(new URL('../../assets/prefabs/practice-house/room-fan.glb',import.meta.url)),'phase10-animated.glb');const fanInventory=await request(`/assets/${fan.id}/partition/inventory`,'POST');assert.ok(fanInventory.inventory.conservative_reasons.length);assert.equal(fanInventory.document.policy,'complete');assert.equal((await request(`/assets/${fan.id}`)).streaming,undefined);report.checks.push('animation complete-original fallback');
 await request(`/projects/${project.id}/unpublish`,'POST');assert.equal((await fetch(publicURL)).status,404);report.checks.push('unpublication blocks descriptor refresh');
 // Partition rollback invalidates old descriptors without modifying source bytes.
 const complete={...fixture.partition,policy:'complete',visibility:'conservative',rooms:[],global_node_paths:fixture.inventory.nodes.filter(n=>n.renderable).map(n=>n.path),openings:[]};
 await request(`/assets/${asset.id}/partition`,'PUT',{revision:reviewed.revision,source_sha256:fixture.inventory.source_sha256,document:complete});assert.equal((await fetch(privatePayloads[2].url)).status,404);assert.equal((await request(`/assets/${asset.id}`)).streaming,undefined);report.checks.push('partition rollback hides retired manifest');
 assert.deepEqual(errors,[]);await writeFile(process.env.CHUNK_LIVE_OUTPUT||'/tmp/chunking-phase10-live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(project)await request(`/projects/${project.id}`,'DELETE');await rm(dir,{recursive:true,force:true});}

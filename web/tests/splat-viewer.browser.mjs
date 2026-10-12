import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {PNG} from 'pngjs';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({deviceScaleFactor:2});let project;
const ready='Gaussian splat ready: 441 splats. Inspection only.';
try {
 const api=async(path,data,method=data?'POST':'GET')=>{const r=await context.request.fetch(origin+'/api/v1'+path,{method,...data?{data}:{}});assert.ok(r.ok(),`API ${method} ${path}: ${r.status()}`);return r.status()===204?undefined:r.json();};
 project=await api('/projects',{name:'Shared splat viewer'});
 async function upload(name,path){const bytes=readFileSync(new URL(path,import.meta.url));const ticket=await api(`/projects/${project.id}/uploads`,{name,size:bytes.length});const form=new FormData();for(const [key,value] of Object.entries(ticket.upload.fields))form.append(key,value);form.append('file',new Blob([bytes]),name);assert.ok((await fetch(ticket.upload.url,{method:'POST',body:form})).ok);await api(`/assets/${ticket.asset.id}/complete`,{});return api(`/projects/${project.id}/scenes`,{name,asset_id:ticket.asset.id});}
 const scene=await upload('room.splat','../public/splat-fixtures/small.splat');
 const panorama=await upload('panorama.png','../../tests/testdata/panorama-a.png');
 const glb=await upload('house.glb','../../tests/testdata/house.glb');
 await api(`/projects/${project.id}/publish`,{});
 await context.addInitScript(()=>{window.workers=0;const Original=Worker;window.Worker=class extends Original{constructor(...args){super(...args);window.workers++;}terminate(){if(!this.closed){window.workers--;this.closed=true;}super.terminate();}};});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let reads=0,failNext=false;
 await page.route('**/api/v1/public/tours/*/assets/*',async route=>{
  reads++;if(reads===1)await route.fulfill({json:{url:origin+'/expired-splat'}});else if(failNext){failNext=false;await route.fulfill({json:{url:origin+'/failed-splat'}});}else await route.continue();
 });
 await page.route('**/expired-splat',route=>route.fulfill({status:403}));await page.route('**/failed-splat',route=>route.fulfill({status:500}));
 await page.goto(origin+'/t/'+project.slug+'?perf=1');await page.getByText(ready,{exact:true}).waitFor();assert.ok(reads>=2);assert.equal(await page.evaluate(()=>window.workers),1);
 await page.waitForFunction(()=>window.__tourPerformance?.resources.splat?.sortMs.samples>0&&window.__tourPerformance?.firstUsableViewMs!==null);
 const diagnostic=await page.evaluate(()=>window.__tourPerformance);assert.equal(diagnostic.resources.splat.count,441);assert.equal(diagnostic.resources.splat.sourceBytes,14112);assert.ok(diagnostic.resources.splat.decodeMs>=0);assert.ok(diagnostic.resources.splat.sortMs.samples>0);assert.ok(diagnostic.resources.splat.sortBacklog<=1);assert.equal(diagnostic.resources.splat.resident.renderers,1);assert.ok(diagnostic.firstUsableViewMs!==null);assert.ok(diagnostic.assetLoads.some(l=>l.kind==='splat'&&l.events.some(e=>e.stage==='downloaded'&&e.bytes===14112)));
 const qualityEvidence=[];
 for(const tier of ['low','balanced','hq','auto']){await page.getByLabel('Rendering quality',{exact:true}).selectOption(tier);assert.equal(await page.evaluate(()=>window.workers),1);await page.waitForTimeout(100);const snapshot=await page.evaluate(()=>window.__tourPerformance);assert.deepEqual(snapshot.metadata.cameraPosition,diagnostic.metadata.cameraPosition);if(tier!=='auto')assert.equal(snapshot.metadata.pixelRatio,{low:1,balanced:1.5,hq:2}[tier]);qualityEvidence.push({tier,pixelRatio:snapshot.metadata.pixelRatio,frameMs:snapshot.frameMs,resources:snapshot.resources.splat});}
 mkdirSync(new URL('../../test-results/',import.meta.url),{recursive:true});writeFileSync(new URL('../../test-results/splat-viewing-acceptance.json',import.meta.url),JSON.stringify({execution:'Chromium ANGLE SwiftShader; synthetic 441-splat fixture; no physical-device acceptance',diagnostic,qualityEvidence},null,2));

 const beforeIdle=await page.evaluate(()=>window.__tourPerformance.renderedFrames);await page.waitForTimeout(500);assert.ok((await page.evaluate(()=>window.__tourPerformance.renderedFrames))-beforeIdle<5,'Splat idle rendering must settle');
 const pixels=PNG.sync.read(await page.locator('canvas').screenshot()),colors=new Set();for(let i=0;i<pixels.data.length;i+=80)colors.add(pixels.data.subarray(i,i+3).toString('hex'));assert.ok(colors.size>20,'Splat canvas must contain rendered color, not only background');
 assert.equal(await page.getByRole('button',{name:'Walk inside',exact:true}).count(),0);
 for(let i=0;i<12;i++){await page.getByRole('button',{name:'Reload scene',exact:true}).click();await page.getByText(ready,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.workers),1);}
 failNext=true;await page.getByRole('button',{name:'Reload scene',exact:true}).click();await page.getByRole('button',{name:'Retry scene',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.workers),0);await page.getByRole('button',{name:'Retry scene',exact:true}).click();await page.getByText(ready,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.workers),1);
 const box=await page.locator('canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+10,{steps:5});await page.mouse.up();
 await page.evaluate(()=>{const extension=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');extension.loseContext();setTimeout(()=>extension.restoreContext(),200);});await page.getByText('Graphics context lost. Waiting for restoration…',{exact:true}).waitFor();await page.getByText(ready,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.workers),1);
 await page.getByLabel('Scene',{exact:true}).selectOption(panorama.id);await page.getByRole('button',{name:'Reset view',exact:true}).waitFor();await page.waitForFunction(()=>window.workers===0);
 await page.getByLabel('Scene',{exact:true}).selectOption(glb.id);await page.locator('canvas[aria-label^="3D scene"]').waitFor();assert.equal(await page.evaluate(()=>window.workers),0);
 await page.getByLabel('Scene',{exact:true}).selectOption(scene.id);await page.getByText(ready,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.workers),1);
 // Runtime rollback leaves the persisted scene and mixed-tour navigation available.
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{splat_viewer:false,splat_authoring:false}}));
 await page.getByRole('button',{name:'Reload scene',exact:true}).click();await page.getByText('Gaussian splat support is unavailable. Choose another scene or retry later.',{exact:false}).waitFor();assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.evaluate(()=>window.workers),0);
 await page.getByLabel('Scene',{exact:true}).selectOption(panorama.id);await page.locator('canvas[aria-label^="360 panorama"]').waitFor();await page.getByLabel('Scene',{exact:true}).selectOption(scene.id);await page.getByRole('button',{name:'Retry scene',exact:true}).waitFor();
 await page.unroute('**/api/v1/capabilities');await page.getByRole('button',{name:'Retry scene',exact:true}).click();await page.getByText(ready,{exact:true}).waitFor();
 const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(origin+'/embed/'+project.slug);await second.getByText(ready,{exact:true}).waitFor();assert.equal(await second.evaluate(()=>window.workers),1);
 await page.goto(origin+'/projects/'+project.id);await page.getByText(ready,{exact:true}).waitFor();await page.getByRole('button',{name:'Save start view',exact:true}).click();await page.getByText('Start view saved.',{exact:true}).waitFor();const stored=await api(`/scenes/${scene.id}`);assert.equal(stored.start_camera.position.length,3);
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{splat_viewer:true,splat_authoring:false}}));await page.reload();await page.getByText(ready,{exact:true}).waitFor();await page.getByRole('button',{name:'+ New scene',exact:true}).last().click();const dialog=page.getByRole('dialog',{name:'New scene',exact:true});await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'Gaussian splat Inspect a capture',exact:false}).count(),0);await page.getByRole('button',{name:'Close new scene',exact:true}).click();assert.equal(await page.locator('#splat-upload').count(),0);await page.unroute('**/api/v1/capabilities');
 await page.goto('about:blank');await second.goto('about:blank');assert.deepEqual(errors,[]);console.log('Shared splat viewer passed: scoped URL renewal, builder/public/embed, GLB/panorama transitions, camera save, motion, reload ownership, independent viewers, context recovery, diagnostics, DPR/camera preservation, idle settling and disabled/re-enable mixed-tour rollback.');
}finally{if(project)await context.request.delete(origin+'/api/v1/projects/'+project.id);await browser.close();}

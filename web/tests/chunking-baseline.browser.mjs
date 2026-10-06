import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chunkingFixtures } from '../scripts/chunking-fixtures.mjs';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const output=process.env.CHUNKING_OUTPUT||'/tmp/chunking-phase0';
const {manifest,files,assets,project,scenes,hotspots}=await chunkingFixtures();
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir(output,{recursive:true});
try {
 for(const scene of scenes){
  const context=await browser.newContext({viewport:{width:900,height:650}});
  await context.addInitScript(()=>localStorage.setItem('tour-render-quality','balanced'));
  const requests=[];
  await context.route(origin+'/phase0-assets/**',r=>{
   const name=new URL(r.request().url()).pathname.split('/').at(-1),bytes=files.get(name);requests.push({name,bytes:bytes.length});
   return r.fulfill({body:bytes,contentType:'model/gltf-binary'});
  });
  await context.route(origin+'/api/v1/**',async r=>{
   const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
   if(path===`/public/tours/${project.slug}`)data={...project,start_scene_id:scene.id,scenes};
   else if(path.endsWith('/assets'))data=assets;
   else if(assets.some(a=>path.endsWith('/assets/'+a.id))){const a=assets.find(a=>path.endsWith('/assets/'+a.id));data={...a,url:origin+'/phase0-assets/'+a.name,runtime:{state:'unavailable',error:'Phase 0 complete original reference'}};}
   else if(path.endsWith('/hotspots'))data=hotspots.filter(h=>path.includes('/scenes/'+h.scene_id+'/'));
   else if(path.endsWith('/layout')){const s=scenes.find(s=>path.includes('/scenes/'+s.id+'/'));data={document:s.layout,revision:1};}
   else throw Error('Unexpected '+path);
   await r.fulfill({json:data});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const snapshot=()=>page.evaluate(()=>window.__tourPerformance);
  async function ready(){try{await page.waitForFunction(()=>window.__tourPerformance?.firstSafelyUsableWalkingViewMs>0);}catch(error){console.log(await page.locator('body').innerText(),await snapshot(),errors);throw error;}}
  async function record(cache){
   await ready();await page.waitForTimeout(1100);
   const initial=await snapshot(),requestStart=requests.length;
   // Start a sustained movement sample after startup inventory; walk through
   // the authored doorway, turn, return and revisit. This is a smoke route.
   await page.getByText('Performance diagnostics (development)',{exact:true}).click();
   await page.getByRole('button',{name:'Start new frame sample',exact:true}).click();
   await page.getByText('Performance diagnostics (development)',{exact:true}).click();
   const poses=[];
   for(let visit=0;visit<2;visit++){
    await page.locator('canvas').focus();await page.keyboard.down('w');
    try{await page.waitForFunction(()=>window.__tourPerformance?.metadata.cameraPosition?.[2]<-2,{},{timeout:20000});}catch(error){console.log('Route failure',cache,visit,(await snapshot()).metadata);throw error;}finally{await page.keyboard.up('w');}
    await page.getByRole('button',{name:'Exit: Enter Room B',exact:true}).click();
    await page.locator('canvas').focus();await page.keyboard.down('w');
    try{await page.waitForFunction(()=>window.__tourPerformance?.metadata.cameraPosition?.[2]<-5.5,{},{timeout:20000});}catch(error){console.log('Route failure',cache,visit,(await snapshot()).metadata);throw error;}finally{await page.keyboard.up('w');}
    poses.push((await snapshot()).metadata.cameraPosition);
    const box=await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+box.height/2,{steps:6});await page.mouse.up();
    await page.keyboard.press('Escape');await page.waitForTimeout(250);
    await page.getByRole('button',{name:'Reset view',exact:true}).click();await page.waitForTimeout(250);
   }
   const report=await snapshot();
   assert.ok(report.firstRenderedViewMs>0);assert.ok(report.firstSafelyUsableWalkingViewMs>=report.firstRenderedViewMs);
   assert.ok(report.frameMs.samples>0);assert.ok(report.resources.residentGeometryBytes>0);
   if(scene.type==='3D'&&cache==='cold'){
    const load=report.assetLoads.find(l=>l.kind==='original');assert.ok(load);
    assert.deepEqual(load.events.map(e=>e.stage),['requested','downloaded','decode-started','decoded']);
    assert.ok(report.timings.some(t=>t.stage==='collision-preparation'));
   }
   if(scene.type==='3D'&&cache==='warm')assert.equal(report.assetLoads.filter(l=>l.kind==='original').length,0,'decoded model reused');
   assert.equal(requests.length,requestStart,'tour and revisits do not refetch complete source');
   assert.ok(!JSON.stringify(report).includes('/phase0-assets/'));
   const evidence={...report,fixtureVersion:manifest.version,sourceFixtures:manifest.fixtures,execution:'Chromium SwiftShader software renderer; instrumentation/correctness smoke, not physical-device acceptance',cache:{state:cache,definition:cache==='cold'?'new browser context and empty decoded caches':'same page A → alternate scene → A; decoded model and navigation caches retained'},route:{poses,visits:2,turnPixels:60,return:'Reset view to supported saved start'},payload:{beforeRoute:requests.slice(0,requestStart),duringRoute:requests.slice(requestStart),note:'Mock-server payload bytes are separate from browser Resource Timing transfer sizes; no real network throttling or HTTP cache measurement.'},startupResources:initial.resources,profiling:{shaderUploadStalls:'unavailable; browser trace required',gpuTime:'unavailable'},physicalDeviceMeasurements:'pending'};
   await writeFile(`${output}/${scene.id}-${cache}.json`,JSON.stringify(evidence,null,2)+'\n');
  }
  await page.goto(origin+'/t/'+project.slug+'?perf=1&device=chromium-swiftshader-phase0');await record('cold');
  const alternate=scenes.find(s=>s.id!==scene.id);
  await page.getByLabel('Scene',{exact:true}).selectOption(alternate.id);await ready();
  await page.getByLabel('Scene',{exact:true}).selectOption(scene.id);await record('warm');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Phase 0 cold/warm complete-file baselines passed: '+output);
}finally{await browser.close();}

import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.workerCount=0;const Original=window.Worker;
  window.Worker=class extends Original {constructor(...args){super(...args);window.workerCount++;}terminate(){if(!this.ended){this.ended=true;window.workerCount--;}super.terminate();}};
 });
 await page.goto(origin+'/dev/splat');
 await page.waitForFunction(()=>window.splatBaseline?.count===441);
 const small=await page.evaluate(()=>window.splatBaseline);assert.equal(await page.evaluate(()=>window.workerCount),1);
 const canvas=page.locator('canvas');await canvas.screenshot({path:'/tmp/splat-small.png'});
 for(let i=0;i<5;i++){await page.getByRole('button',{name:'Toggle capture'}).click();assert.equal(await page.evaluate(()=>window.workerCount),0);await page.getByRole('button',{name:'Toggle capture'}).click();await page.waitForFunction(()=>window.workerCount===1);}
 await page.evaluate(()=>window.splatBaseline=null);await page.getByLabel('Fixture').selectOption('indoor');await page.waitForFunction(()=>window.splatBaseline?.count===39204);
 const indoor=await page.evaluate(()=>window.splatBaseline);
 const times=[];const bounds=await canvas.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
 for(let i=0;i<20;i++){const start=performance.now();await page.mouse.move(bounds.x+bounds.width/2+i*6,bounds.y+bounds.height/2+i*2);await page.evaluate(()=>new Promise(requestAnimationFrame));times.push(performance.now()-start);}
 await page.mouse.up();await canvas.screenshot({path:'/tmp/splat-indoor.png'});
 await page.setViewportSize({width:700,height:800});await page.evaluate(()=>new Promise(requestAnimationFrame));
 // Verify context restoration rebuilds both worker and GPU resources.
 await page.evaluate(()=>{window.splatBaseline=null;const ext=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');ext.loseContext();setTimeout(()=>ext.restoreContext(),200);});
 await page.waitForFunction(()=>window.splatBaseline?.count===39204);assert.equal(await page.evaluate(()=>window.workerCount),1);
 await page.goto('about:blank');assert.deepEqual(errors,[]);
 const result={device:'Headless Chromium / ANGLE SwiftShader; synthetic captures',small,indoor,cameraMotionRoundTripMs:times,limitations:'Not physical-device frame times; no real reconstructed indoor capture provided. Visual review and device acceptance remain pending.'};
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/splat-baseline.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}

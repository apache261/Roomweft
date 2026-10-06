import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {performanceFixtures} from '../scripts/performance-fixtures.mjs';
import {template} from '../src/layout.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5174';
const {project,scenes}=performanceFixtures(),scene={...scenes[1],name:'Room streaming fixture'};
const rooms=Array.from({length:6},(_,i)=>({...template(i?'ROOM':'LOBBY',0,-i*4),name:'Room '+i,width:4,depth:4}));
const assets=rooms.map((_,i)=>({id:crypto.randomUUID(),project_id:project.id,name:`chunk-${i}.glb`,file_type:'GLB',upload_status:'ready'}));
scene.layout={version:1,elements:[...rooms,...rooms.map((room,i)=>({...template('INSTANCE',1,-i*4),room_id:room.id,asset_id:assets[i].id,collidable:false}))],doors:rooms.slice(1).map((room,i)=>({id:crypto.randomUUID(),a:rooms[i].id,b:room.id,at:0,width:1.2,height:2.2}))};
// Face away from the chain: load occupied room + one adjacent room, not all six.
scene.start_camera={position:[0,1.65,0],yaw:Math.PI,pitch:0};
const bytes=await readFile(new URL('../../tests/testdata/layout-table.glb',import.meta.url));
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const context=await browser.newContext({viewport:{width:900,height:650}}),requests=[],errors=[];let fail=true,delay=0;
 await context.route(origin+'/chunks/**',async r=>{const name=new URL(r.request().url()).pathname.split('/').at(-1);requests.push(name);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(fail&&name==='chunk-1.glb')return r.fulfill({status:503,body:'offline'});return r.fulfill({body:bytes,contentType:'model/gltf-binary'});});
 await context.route(origin+'/api/v1/**',async r=>{
  const p=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(p===`/projects/${project.id}`)data={...project,start_scene_id:scene.id};
  else if(p.endsWith('/assets'))data=assets;
  else if(assets.some(a=>p.endsWith('/assets/'+a.id))){const a=assets.find(a=>p.endsWith('/assets/'+a.id));data={...a,url:origin+'/chunks/'+a.name};}
  else if(p.endsWith('/scenes'))data=[scene];else if(p.endsWith('/hotspots'))data=[];else if(p.endsWith('/layout'))data={document:scene.layout,revision:1};
  else if(p===`/public/tours/${project.slug}`)data={...project,start_scene_id:scene.id,scenes:[scene]};else throw Error('Unexpected '+p);
  await r.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/t/'+project.slug+'?perf=1');await page.waitForFunction(()=>window.__tourPerformance?.firstUsableViewMs>0);
 await page.getByRole('button',{name:'Retry room loading',exact:true}).waitFor({timeout:10000}).catch(async e=>{console.log({requests,errors,body:await page.locator('body').innerText(),perf:await page.evaluate(()=>window.__tourPerformance?.metadata)});throw e;});await page.waitForTimeout(500);
 const first=[...new Set(requests)];assert.deepEqual(first.sort(),['chunk-0.glb','chunk-1.glb']);
 const position=()=>page.evaluate(()=>window.__tourPerformance.metadata.cameraPosition);
 const canvas=page.locator('canvas');await canvas.focus();await page.keyboard.down('s');await page.waitForTimeout(2200);await page.keyboard.up('s');await page.waitForTimeout(600);
 const blocked=await position();assert.ok(blocked[2]>-1.8,'failed room blocks entry: '+blocked);
 fail=false;delay=400;await page.getByRole('button',{name:'Retry room loading',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.viewer-notice')?.textContent?.includes('Entry opens')!==true);await page.waitForTimeout(1000);
 await canvas.focus();await page.keyboard.down('s');await page.waitForTimeout(3200);await page.keyboard.up('s');await page.waitForTimeout(600);const entered=await position();assert.ok(entered[2]<-2.1,'ready room allows entry: '+entered);
 assert.ok(!requests.includes('chunk-5.glb'),'distant area still undownloaded: '+JSON.stringify({requests,entered,streaming:await page.evaluate(()=>window.__tourPerformance.metadata.roomStreaming)}));
 await page.getByRole('button',{name:'Inspect model',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.viewer-notice')?.textContent?.includes('Entry opens')!==true);await page.waitForTimeout(2200);
 assert.equal(new Set(requests).size,6,'inspection loads every room');
 for(const prefix of ['/embed/','/t/']){await page.goto(origin+prefix+project.slug+'?perf=1&streaming=0');await page.waitForFunction(()=>window.__tourPerformance?.firstUsableViewMs>0);}
 await page.goto(origin+'/projects/'+project.id+'?perf=1');await page.getByRole('button',{name:'Walk inside',exact:true}).waitFor();await page.getByRole('button',{name:'Preview tour',exact:true}).click();await page.waitForFunction(()=>window.__tourPerformance?.firstUsableViewMs>0);
 assert.deepEqual(errors,[]);
 const report={execution:'Chromium SwiftShader, mocked GLB delivery with failed/400ms room requests; not physical-device evidence',totalChunks:6,startingChunks:first.length,initialDeliveredBytes:bytes.length,fullDeliveredBytes:bytes.length*6,failedBoundaryPosition:blocked,readyRoomPosition:entered,inspectionChunks:6,checks:['starting-area priority','failed-room boundary','retry','delayed requests','progressive doorway entry','inspection loads all','builder preview','public and embed fallback']};
 await writeFile(process.env.ROOM_OUTPUT||'../docs/performance-baselines/phase6-room-streaming.json',JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{await browser.close();}

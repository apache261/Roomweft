import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {defaultSettings} from '../src/sceneSettings.ts';
import {template} from '../src/layout.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Walking effects checks',slug:'walking-effects',published:true,start_scene_id:crypto.randomUUID()};
let scene={id:project.start_scene_id,project_id:project.id,name:'Lobby',type:'LAYOUT',layout_revision:1,layout:{version:1,elements:[template('LOBBY')],doors:[]},settings:structuredClone(defaultSettings),start_camera:{position:[0,1.65,1],yaw:0,pitch:0}};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets')||path.endsWith('/hotspots'))data=[];
  else if(path===`/projects/${project.id}/scenes`)data=[scene];
  else if(path===`/scenes/${scene.id}`){if(r.request().method()==='PATCH')scene={...scene,...r.request().postDataJSON()};data=scene;}
  else if(path.endsWith('/layout'))data={document:scene.layout,revision:1};
  else if(path===`/public/tours/${project.slug}`)data={...project,scenes:[scene]};
  else throw new Error('Unexpected route '+path);
  await r.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 async function pose(){await button('Save start view').click();await page.getByText('Start view saved.',{exact:true}).waitFor();return structuredClone(scene.start_camera);}
 await page.goto(origin+'/projects/'+project.id);await button('Walk inside').waitFor();await button('Walk inside').click();
 assert.equal(await button('Head bob').getAttribute('aria-pressed'),'false');assert.equal(await button('Smooth movement').getAttribute('aria-pressed'),'false');
 const before=await pose();await button('Head bob').click();await button('Smooth movement').click();
 assert.equal(await button('Head bob').getAttribute('aria-pressed'),'true');assert.equal(await button('Smooth movement').getAttribute('aria-pressed'),'true');assert.deepEqual((await pose()).position,before.position,'Toggles preserve the standing position');
 const forward=button('Move forward');await forward.scrollIntoViewIfNeeded();const box=await forward.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(400);await page.mouse.up();
 const moved=await pose();assert.ok(moved.position[2]<before.position[2]-.1);assert.ok(Math.abs(moved.position[1]-1.65)<1e-6,'Head bob never enters the saved physical start position');
 await page.reload();await button('Walk inside').waitFor();await button('Walk inside').click();assert.equal(await button('Head bob').getAttribute('aria-pressed'),'true');assert.equal(await button('Smooth movement').getAttribute('aria-pressed'),'true');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Head bob'&&b.disabled));assert.equal(await button('Head bob').getAttribute('aria-pressed'),'false');assert.ok(Math.abs((await pose()).position[1]-1.65)<1e-6);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Head bob'&&!b.disabled));assert.equal(await button('Head bob').getAttribute('aria-pressed'),'true');
 await button('Head bob').click();await button('Smooth movement').click();await button('Inspect model').click();assert.equal(await button('Head bob').count(),0);
 for(const route of ['/t/','/embed/']){
  await page.goto(origin+route+project.slug);await button('Inspect model').waitFor();assert.equal(await button('Head bob').getAttribute('aria-pressed'),'false');assert.equal(await button('Smooth movement').getAttribute('aria-pressed'),'false');
  await page.setViewportSize({width:390,height:844});const group=page.getByRole('group',{name:'Walking effects'});assert.ok(await group.isVisible());const b=await group.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=390,'Effects controls fit mobile');await page.setViewportSize({width:1440,height:1000});
 }
 assert.deepEqual(errors,[]);console.log('Walking effects passed: independent toggles, movement, physical saved heights, browser persistence, reduced motion, walking on/off and mobile public/embed controls.');
} finally {await browser.close();}

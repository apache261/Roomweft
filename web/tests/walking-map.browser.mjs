import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {defaultSettings} from '../src/sceneSettings.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Draw practice house',slug:'drawing-test',start_scene_id:crypto.randomUUID(),published:false};
const asset={id:crypto.randomUUID(),project_id:project.id,name:'house.glb',file_type:'GLB',upload_status:'ready'};
let scene={id:project.start_scene_id,project_id:project.id,asset_id:asset.id,name:'House',type:'3D',settings:structuredClone(defaultSettings),start_camera:{}};
const bytes=await readFile(new URL('../../assets/prefabs/practice-house/house-assembled.glb',import.meta.url));
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route(origin+'/house.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets'))data=[asset];
  else if(path.endsWith('/scenes'))data=[scene];
  else if(path===`/assets/${asset.id}`)data={...asset,url:origin+'/house.glb'};
  else if(path.endsWith('/hotspots'))data=[];
  else if(path===`/scenes/${scene.id}`){if(r.request().method()==='PATCH')scene={...scene,...r.request().postDataJSON()};data=scene;}
  else throw new Error('Unexpected route '+path);
  await r.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'&&/same key|unique.*key/.test(message.text()))errors.push(message.text());});
 await page.goto(origin+'/projects/'+project.id);await page.getByText(/Prepared dimensions:/).waitFor();
 await page.getByRole('button',{name:'Set up walking',exact:true}).click();await page.getByRole('button',{name:'Add walking region',exact:true}).click();
 await page.getByRole('button',{name:'Choose floor meshes',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'Approved floor meshes',exact:true});
 await picker.getByLabel('Search meshes',{exact:true}).fill('_Floor');
 assert.equal(await picker.getByRole('checkbox').count(),5);
 await picker.getByRole('button',{name:'Select shown',exact:true}).click();
 await picker.getByRole('button',{name:'Apply selection',exact:true}).click();
 await page.getByRole('button',{name:'Choose floor meshes',exact:true}).click();
 assert.equal(await picker.locator('input[type="checkbox"]:checked').count(),5);
 await picker.getByLabel('Search meshes',{exact:true}).fill('Room_1_Floor');
 await picker.getByRole('button',{name:'Clear shown',exact:true}).click();
 await picker.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Choose floor meshes',exact:true}).click();
 assert.equal(await picker.locator('input[type="checkbox"]:checked').count(),5);
 await picker.getByLabel('Search meshes',{exact:true}).fill('no-matching-mesh');await picker.getByText('No meshes match your search.').waitFor();
 await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='Choose floor meshes');
 await page.getByRole('button',{name:'Fit area to selected floors',exact:true}).click();
 for(const [key,value] of Object.entries({left:-6,right:6,top:-3,bottom:3,min_y:-.01,max_y:.01}))assert.ok(Math.abs(Number(await page.getByLabel(`Region ${key} (m)`,{exact:true}).inputValue())-value)<.0001,key);
 const map=page.getByRole('img',{name:'Top-down walking area map'});await map.scrollIntoViewIfNeeded();
 async function draw(a,b,cancel=false){
  await page.getByRole('button',{name:'Draw area',exact:true}).click();
  const points=await map.evaluate((svg,pairs)=>{const matrix=svg.getScreenCTM();return pairs.map(([x,y])=>{const p=svg.createSVGPoint();p.x=x;p.y=y;const t=p.matrixTransform(matrix);return {x:t.x,y:t.y};});},[a,b]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:4});
  if(cancel){await map.dispatchEvent('pointercancel');await page.mouse.up();await page.getByRole('button',{name:'Cancel drawing',exact:true}).click();}else await page.mouse.up();
 }
 await draw([2,2],[-2,-2]);
 for(const [key,value] of Object.entries({left:-2,right:2,top:-2,bottom:2}))assert.ok(Math.abs(Number(await page.getByLabel(`Region ${key} (m)`,{exact:true}).inputValue())-value)<=.02,key);
 assert.equal(Number(await page.getByLabel('Region max_y (m)',{exact:true}).inputValue()),.01);
 await draw([-1,-1],[1,1],true);assert.ok(Math.abs(Number(await page.getByLabel('Region left (m)',{exact:true}).inputValue())+2)<=.02);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Settings saved.',{exact:true}).waitFor();
 assert.equal(scene.settings.navigation.regions[0].floor_meshes.length,5);
 await page.reload();await page.getByText(/Standing floor found/).waitFor();await page.getByRole('tab',{name:'Walking',exact:true}).click();assert.ok(Math.abs(Number(await page.getByLabel('Region left (m)',{exact:true}).inputValue())+2)<=.02);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByRole('button',{name:'Choose floor meshes',exact:true}).click();assert.ok(await picker.isVisible());const box=await picker.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);await picker.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(errors,[]);
 console.log('Walking map passed: searchable floor dialog, bulk selection, cancel/Escape, practice floors fit, reverse drawing, cancellation, unchanged heights, save/reload and mobile sizing.');
}finally{await browser.close();}

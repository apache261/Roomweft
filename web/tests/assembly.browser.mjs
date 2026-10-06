import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {defaultSettings} from '../src/sceneSettings.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Assemble my house',slug:'assembled-house',start_scene_id:null,published:true};
const parts=['lobby','room-1','room-2','kitchen','cr'];
const assets=parts.map(name=>({id:crypto.randomUUID(),project_id:project.id,name:name+'.glb',file_type:'GLB',upload_status:'ready'}));
let scene;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route(origin+'/models/**',async r=>{const name=new URL(r.request().url()).pathname.split('/').pop();await r.fulfill({body:await readFile(new URL(`../../assets/prefabs/practice-house/${name}`,import.meta.url)),contentType:'model/gltf-binary'});});
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length),method=r.request().method();let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets'))data=assets;
  else if(path===`/projects/${project.id}/scenes`){if(method==='POST'){scene={...r.request().postDataJSON(),id:crypto.randomUUID(),project_id:project.id,layout_revision:1,settings:structuredClone(defaultSettings),start_camera:{}};project.start_scene_id=scene.id;data=scene;}else data=scene?[scene]:[];}
  else if(path.includes('/assets/')){const asset=assets.find(a=>path.endsWith(a.id));data={...asset,url:origin+'/models/'+asset.name};}
  else if(path.endsWith('/hotspots'))data=[];
  else if(path.endsWith('/layout')){if(method==='PUT'){const body=r.request().postDataJSON();assert.equal(body.revision,scene.layout_revision);scene={...scene,layout:body.document,layout_revision:scene.layout_revision+1,start_camera:{}};data=scene;}else data={document:scene.layout,revision:scene.layout_revision};}
  else if(scene&&path===`/scenes/${scene.id}`){if(method==='PATCH')scene={...scene,...r.request().postDataJSON()};data=scene;}
  else if(path===`/public/tours/${project.slug}`)data={...project,scenes:[scene]};
  else throw new Error('Unexpected route '+path);
  await r.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/same key|unique.*key/.test(m.text()))errors.push(m.text());});
 await page.goto(origin+'/projects/'+project.id);await page.getByRole('button',{name:'+ New scene',exact:true}).first().click();await page.getByLabel('Starting layout',{exact:true}).selectOption('assembly');await page.getByRole('button',{name:'Build layout',exact:true}).click();await page.getByRole('region',{name:'Layout editor'}).waitFor();assert.equal(scene.layout.elements.length,0);
 for(const [i,name] of parts.entries()){
  await page.getByRole('button',{name:`Place ${name}.glb`,exact:true}).click();await page.getByRole('button',{name:'Choose floor meshes',exact:true}).waitFor();
  const pickerButton=page.getByRole('button',{name:'Choose floor meshes',exact:true});await pickerButton.click();const dialog=page.getByRole('dialog',{name:'Approved floor meshes',exact:true});await dialog.getByLabel('Search meshes',{exact:true}).fill('_Floor');await dialog.getByRole('checkbox').waitFor();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Apply selection',exact:true}).click();
  if(i){const selector=page.getByLabel('Selected layout element',{exact:true});const lobby=await selector.locator('option').filter({hasText:'lobby (instance)'}).getAttribute('value');await page.getByLabel('Align with room',{exact:true}).selectOption(lobby);await page.getByLabel('Doorway offset (m)',{exact:true}).fill(String([0,-1.5,1.5,-1,2][i]));await page.getByRole('button',{name:i<3?'Align west':'Align east',exact:true}).click();}
 }
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Layout saved. Walk inside and save a new start view.',{exact:true}).waitFor();
 assert.equal(scene.layout.elements.length,5);assert.ok(scene.layout.elements.every(e=>e.floor_meshes.length===1));for(const [i,[x,z]] of [[0,0],[-4,-1.5],[-4,1.5],[4,-1],[3.5,2]].entries()){assert.ok(Math.abs(scene.layout.elements[i].x-x)<.01);assert.ok(Math.abs(scene.layout.elements[i].z-z)<.01);}
 await page.reload();await page.getByText(/Standing floor found/).waitFor();await page.getByRole('button',{name:'Walk inside',exact:true}).click();
 async function pose(){await page.getByRole('button',{name:'Save start view',exact:true}).click();await page.getByText('Start view saved.',{exact:true}).waitFor();return scene.start_camera;}
 async function hold(direction){const button=page.getByRole('button',{name:'Move '+direction,exact:true});await button.scrollIntoViewIfNeeded();const b=await button.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(150);await page.mouse.up();return pose();}
 let view=await pose();for(let i=0;i<15&&view.position[2]>-1.2;i++)view=await hold('forward');assert.ok(view.position[2]<-1.2,JSON.stringify(view));for(let i=0;i<30&&view.position[0]>-2.7;i++)view=await hold('left');assert.ok(view.position[0]<-2.7,'Walked into Room 1 without a scene switch');assert.equal(scene.id,project.start_scene_id);
 const saved=structuredClone(view);
 await page.reload();await page.getByText(/Standing floor found/).waitFor();await page.getByRole('button',{name:'Walk inside',exact:true}).click();
 const restored=await pose();for(let i=0;i<3;i++)assert.ok(Math.abs(restored.position[i]-saved.position[i])<1e-5,'Reload restores the saved position inside an imported room');assert.ok(Math.abs(restored.yaw-saved.yaw)<1e-5);assert.ok(Math.abs(restored.pitch-saved.pitch)<1e-5);
 for(const route of ['/t/','/embed/']){await page.goto(origin+route+project.slug);await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Layout editor'}).count(),0);}
 assert.deepEqual(errors,[]);console.log('Assembly browser passed: empty assembly creation, five independent GLBs, per-module floor dialogs, offsets and alignment, saved start restoration after reload, continuous doorway walking and public/embed.');
}finally{await browser.close();}

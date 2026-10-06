import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {starterLayout} from '../src/layout.ts';
import {defaultSettings} from '../src/sceneSettings.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Practice house',slug:'client-test',description:'House tour',start_scene_id:crypto.randomUUID(),published:true};
let scene={id:project.start_scene_id,project_id:project.id,name:'Lobby and rooms',type:'LAYOUT',layout:starterLayout(),layout_revision:1,settings:structuredClone(defaultSettings),start_camera:{}};
const hotspot={id:crypto.randomUUID(),scene_id:scene.id,type:'INFO',title:'Welcome home',description:'Explore each room.',position:{x:0,y:1.4,z:-2.8}};
let saves=0;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets'))data=[];
  else if(path===`/projects/${project.id}/scenes`)data=[scene];
  else if(path.endsWith('/layout')){if(r.request().method()==='PUT'){saves++;scene={...scene,layout:r.request().postDataJSON().document,layout_revision:scene.layout_revision+1};data=scene;}else data={document:scene.layout,revision:scene.layout_revision};}
  else if(path.endsWith('/hotspots'))data=[hotspot];
  else if(path===`/scenes/${scene.id}`){if(r.request().method()==='PATCH'){saves++;scene={...scene,...r.request().postDataJSON()};}data=scene;}
  else if(path===`/public/tours/${project.slug}`)data={...project,scenes:[scene]};
  else throw new Error('Unexpected route '+path);
  await r.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/projects/'+project.id);await page.getByText(/Standing floor found/).waitFor();
 const save=page.getByRole('button',{name:'Save changes',exact:true});assert.ok(await save.isEnabled());await save.click();await page.getByText('All changes are saved.',{exact:true}).waitFor();assert.equal(saves,0);
 await page.getByLabel('Element name',{exact:true}).fill('My lobby');await save.click();await page.getByText('Layout saved. Walk inside and save a new start view.',{exact:true}).waitFor();assert.equal(scene.layout.elements[0].name,'My lobby');assert.equal(saves,1);assert.ok(await save.isEnabled());
 await page.getByLabel('Selected layout element',{exact:true}).selectOption(scene.layout.elements[2].id);await page.getByLabel('Position X (m)',{exact:true}).fill('0');await page.getByLabel('Position Z (m)',{exact:true}).fill('0');assert.ok(await save.isEnabled());await save.click();await page.getByText(/^Cannot save yet:/).waitFor();assert.equal(saves,1);
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const route of ['/t/','/embed/']){
   await page.goto(origin+route+project.slug);await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();
   const canvas=await page.locator('canvas').boundingBox();assert.ok(Math.abs(canvas.width-viewport.width)<2&&Math.abs(canvas.height-viewport.height)<2,JSON.stringify(canvas));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const pad=await page.getByLabel('Movement controls',{exact:true}).boundingBox();assert.ok(pad.x>=0&&pad.y>=0&&pad.x+pad.width<=viewport.width&&pad.y+pad.height<=viewport.height);
   assert.ok(await page.getByRole('complementary',{name:'Explore scene'}).isHidden());await page.getByRole('button',{name:'Hotspots',exact:true}).click();await page.getByRole('button',{name:'Show hotspot',exact:true}).click();assert.ok(await page.getByRole('complementary',{name:'Explore scene'}).isHidden());await page.getByRole('button',{name:'Hotspots',exact:true}).click();await page.getByRole('button',{name:'Open information',exact:true}).click();await page.getByRole('dialog',{name:hotspot.title}).waitFor();await page.getByRole('button',{name:'Close information',exact:true}).click();await page.getByRole('button',{name:'Close hotspot list',exact:true}).click();assert.ok(await page.getByRole('complementary',{name:'Explore scene'}).isHidden());
   if(route==='/t/')await page.screenshot({path:viewport.width>700?'/tmp/client-viewer-desktop.png':'/tmp/client-viewer-mobile.png'});
  }
 }
 assert.deepEqual(errors,[]);console.log('Client viewer passed: available Save changes, persistence, invalid draft feedback, full-screen desktop/mobile/embed, overlay controls and hotspot toggles/popups.');
}finally{await browser.close();}

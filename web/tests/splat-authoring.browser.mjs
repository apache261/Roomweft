import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});let project;
const ready='Gaussian splat ready: 441 splats. Inspection only.';
try {
 const created=await context.request.post(origin+'/api/v1/projects',{data:{name:'Splat authoring acceptance'}});assert.equal(created.status(),201);project=await created.json();
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/projects/'+project.id);await page.getByRole('button',{name:'+ New scene',exact:true}).last().click();const dialog=page.getByRole('dialog',{name:'New scene',exact:true});
 await dialog.getByRole('button',{name:'Gaussian splat Inspect a capture',exact:false}).click();await dialog.getByLabel('Scene name',{exact:true}).fill('Captured room');await dialog.getByLabel('Upload and create scene').setInputFiles(fileURLToPath(new URL('../public/splat-fixtures/small.splat',import.meta.url)));await page.getByText(ready,{exact:true}).waitFor();
 for(const tab of ['Walking','Materials','Partition'])assert.equal(await page.getByRole('tab',{name:tab,exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Place hotspot',exact:true}).count(),0);
 await page.getByRole('button',{name:'Save start view',exact:true}).click();await page.getByText('Start view saved.',{exact:true}).waitFor();
 const scenes=await (await context.request.get(origin+`/api/v1/projects/${project.id}/scenes`)).json();const scene=scenes[0];assert.equal(scene.type,'SPLAT');const originalCamera=scene.start_camera;
 await page.getByRole('button',{name:'+ Add hotspot',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Welcome to the capture');await page.getByLabel('Description',{exact:true}).fill('World-positioned information.');
 for(const [axis,value] of [['X','1'],['Y','2'],['Z','3']])await page.getByLabel(`Hotspot position ${axis} (m)`,{exact:true}).fill(value);
 await page.getByRole('button',{name:'Save hotspot',exact:true}).click();await page.getByText('Hotspot saved.',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'Capture',exact:true}).click();await page.getByLabel('Capture scale (metres per source unit)',{exact:true}).fill('2');await page.getByLabel('Capture position X (m)',{exact:true}).fill('5');assert.equal(await page.getByRole('button',{name:'Save start view',exact:true}).isEnabled(),false);
 await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved. Hotspots moved with the capture. Save a new inspection start view.',{exact:true}).waitFor();
 const hotspots=await (await context.request.get(origin+`/api/v1/scenes/${scene.id}/hotspots`)).json();assert.deepEqual(hotspots[0].position,{x:7,y:4,z:6});const changed=await (await context.request.get(origin+`/api/v1/scenes/${scene.id}`)).json();assert.deepEqual(changed.start_camera,{});assert.equal(changed.settings.model.scale,2);assert.deepEqual(changed.settings.splat.position,[5,0,0]);
 await page.getByLabel('Exposure',{exact:true}).fill('1.4');await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved.',{exact:true}).last().waitFor();await page.getByRole('button',{name:'Save start view',exact:true}).click();await page.getByText('Start view saved.',{exact:true}).waitFor();
 const saved=await (await context.request.get(origin+`/api/v1/scenes/${scene.id}`)).json();await page.reload();await page.getByText(ready,{exact:true}).waitFor();await page.getByRole('button',{name:'Save start view',exact:true}).click();await page.getByText('Start view saved.',{exact:true}).waitFor();const restored=await (await context.request.get(origin+`/api/v1/scenes/${scene.id}`)).json();for(let i=0;i<3;i++)assert.ok(Math.abs(saved.start_camera.position[i]-restored.start_camera.position[i])<1e-6);assert.ok(Math.abs(saved.start_camera.yaw-restored.start_camera.yaw)<1e-6);assert.ok(Math.abs(saved.start_camera.pitch-restored.start_camera.pitch)<1e-6);
 await page.getByRole('button',{name:'Test hotspot',exact:true}).click();await page.getByRole('dialog',{name:'Welcome to the capture',exact:true}).waitFor();await page.getByRole('button',{name:'Close information',exact:true}).click();
 async function upload(name,path){const bytes=readFileSync(new URL(path,import.meta.url));const ticket=await (await context.request.post(origin+`/api/v1/projects/${project.id}/uploads`,{data:{name,size:bytes.length}})).json();const form=new FormData();for(const [key,value] of Object.entries(ticket.upload.fields))form.append(key,value);form.append('file',new Blob([bytes]),name);assert.ok((await fetch(ticket.upload.url,{method:'POST',body:form})).ok);assert.equal((await context.request.post(origin+`/api/v1/assets/${ticket.asset.id}/complete`)).status(),200);return (await context.request.post(origin+`/api/v1/projects/${project.id}/scenes`,{data:{name,asset_id:ticket.asset.id}})).json();}
 const panorama=await upload('photo-room.png','../../tests/testdata/panorama-a.png');
 const glb=await upload('mesh-room.glb','../../tests/testdata/house.glb');
 // Reload authoring to include the new same-project navigation destinations.
 await page.reload();await page.getByText(ready,{exact:true}).waitFor();await page.getByRole('button',{name:'+ Add hotspot',exact:true}).click();await page.getByLabel('Hotspot type',{exact:true}).selectOption('NAVIGATION');await page.getByLabel('Title',{exact:true}).fill('Visit photo');await page.getByLabel('Destination scene',{exact:true}).selectOption(panorama.id);await page.getByRole('button',{name:'Place 2 m in front of camera',exact:true}).click();await page.getByRole('button',{name:'Save hotspot',exact:true}).click();await page.getByText('Hotspot saved.',{exact:true}).waitFor();
 for(const [from,to,title,position] of [[panorama,glb,'Visit mesh',{yaw:0,pitch:0}],[glb,scene,'Return to capture',{x:0,y:1,z:0}]]){const r=await context.request.post(origin+`/api/v1/scenes/${from.id}/hotspots`,{data:{type:'NAVIGATION',title,position,destination_scene_id:to.id}});assert.equal(r.status(),201);}
 await page.getByRole('button',{name:'Preview tour',exact:true}).click();await page.getByText(ready,{exact:true}).waitFor();
 await page.getByRole('button',{name:'Hotspots',exact:true}).click();await page.getByRole('button',{name:'Go to scene',exact:true}).click();await page.locator('canvas[aria-label^="360 panorama"]').waitFor();
 await page.getByRole('button',{name:'Hotspots',exact:true}).click();await page.getByRole('button',{name:'Go to scene',exact:true}).click();await page.locator('canvas[aria-label^="3D scene"]').waitFor();
 await page.getByRole('button',{name:'Hotspots',exact:true}).click();await page.getByRole('button',{name:'Go to scene',exact:true}).click();await page.getByText(ready,{exact:true}).waitFor();
 assert.equal(originalCamera.position.length,3);assert.deepEqual(errors,[]);console.log('Splat authoring passed: upload/create dialog, supported controls, saved camera restoration, explicit world hotspot, atomic scale/translation updates information popup and splat → panorama → GLB → splat preview navigation.');
}finally{if(project)await context.request.delete(origin+'/api/v1/projects/'+project.id);await browser.close();}

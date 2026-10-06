import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {prepareModel,defaultSettings} from '../src/sceneSettings.ts';
import {template} from '../src/layout.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Small stairs room',slug:'stairs-room',published:true};
const assets=[],bytes=new Map(),floors=new Map();
for(const name of ['room-stairs','lobby']){
 const asset={id:crypto.randomUUID(),name:name+'.glb',file_type:'GLB',upload_status:'ready',project_id:project.id};assets.push(asset);
 const data=await readFile(new URL(`../../assets/prefabs/practice-house/${name}.glb`,import.meta.url));bytes.set(asset.id,data);
 const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 const prepared=prepareModel(gltf.scene,defaultSettings);floors.set(asset.id,prepared.surfaces.filter(s=>s.label.endsWith('_Floor')).map(s=>s.path));prepared.dispose();
}
const stairs=assets[0],lobby=assets[1];
const scenes=[
 {id:crypto.randomUUID(),project_id:project.id,name:'Standalone stairs',type:'3D',asset_id:stairs.id,settings:{...structuredClone(defaultSettings),navigation:{regions:[{id:'floor',name:'Stairs floors',left:-2,right:2,top:-1.5,bottom:1.5,min_y:-.01,max_y:.46,floor_meshes:floors.get(stairs.id)}]}},start_camera:{position:[1,1.65,0],yaw:0,pitch:0}},
 {id:crypto.randomUUID(),project_id:project.id,name:'Stairs assembly',type:'LAYOUT',layout_revision:1,layout:{version:1,elements:[{...template('INSTANCE'),asset_id:lobby.id,floor_meshes:floors.get(lobby.id)},{...template('INSTANCE',-4,-1.5),asset_id:stairs.id,floor_meshes:floors.get(stairs.id)}],doors:[]},settings:structuredClone(defaultSettings),start_camera:{position:[-3,1.65,-1.5],yaw:0,pitch:0}},
];
project.start_scene_id=scenes[1].id;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
 await context.route(origin+'/models/**',r=>r.fulfill({body:bytes.get(new URL(r.request().url()).pathname.split('/').pop()),contentType:'model/gltf-binary'}));
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets'))data=assets;
  else if(path.includes('/assets/')){const asset=assets.find(a=>path.endsWith(a.id));data={...asset,url:origin+'/models/'+asset.id};}
  else if(path.endsWith('/scenes'))data=scenes;
  else if(path.endsWith('/hotspots'))data=[];
  else if(path.endsWith('/layout')){const scene=scenes.find(s=>path.includes(s.id));data={document:scene.layout,revision:1};}
  else if(path.startsWith('/scenes/')){const scene=scenes.find(s=>path.endsWith(s.id));if(r.request().method()==='PATCH')Object.assign(scene,r.request().postDataJSON());data=scene;}
  else if(path===`/public/tours/${project.slug}`)data={...project,scenes};
  else throw new Error('Unexpected route '+path);
  await r.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('THREE.Clock'))errors.push(m.text());});await page.goto(origin+'/projects/'+project.id);
 async function save(scene){assert.equal(await page.locator('.scene-select select').inputValue(),scene.id);await page.getByRole('button',{name:'Save start view',exact:true}).click();await page.getByText('Start view saved.',{exact:true}).waitFor();return structuredClone(scene.start_camera);}
 async function hold(direction){await page.locator('canvas').focus();const key=direction==='left'?'a':'d';await page.keyboard.down(key);await page.waitForTimeout(1600);await page.keyboard.up(key);}
 for(const scene of scenes){
  await page.locator('.scene-select select').selectOption(scene.id);await page.getByText(/Standing floor found/).waitFor();
  if(scene.type==='3D'&&process.env.STAIRS_PREVIEW_PATH){const canvas=page.locator('canvas'),b=await canvas.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height*.58,{steps:15});await page.mouse.up();await page.waitForTimeout(500);await canvas.screenshot({path:process.env.STAIRS_PREVIEW_PATH});}
  await page.getByRole('button',{name:'Walk inside',exact:true}).click();let top;
  for(let i=0;i<4;i++){await hold('left');top=await save(scene);if(Math.abs(top.position[1]-2.1)<1e-5)break;}
  assert.ok(Math.abs(top.position[1]-2.1)<1e-5,'Walking climbs to the raised floor in '+scene.type+': '+JSON.stringify(top));
  await page.reload();await page.locator('.scene-select select').selectOption(scene.id);await page.getByText(/Standing floor found/).waitFor();await page.getByRole('button',{name:'Walk inside',exact:true}).click();
  const restored=await save(scene);for(let i=0;i<3;i++)assert.ok(Math.abs(top.position[i]-restored.position[i])<1e-5,'Raised start restores after reload');
  let lower;for(let i=0;i<4;i++){await hold('right');lower=await save(scene);if(Math.abs(lower.position[1]-1.65)<1e-5)break;}
  assert.ok(Math.abs(lower.position[1]-1.65)<1e-5,'Walking descends in '+scene.type+': '+JSON.stringify(lower));
 }
 for(const route of ['/t/','/embed/']){await page.goto(origin+route+project.slug);await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();}
 assert.deepEqual(errors,[]);console.log('Stairs browser passed: standalone and assembled stairs, climb/descent, raised start save/reload, public/embed.');
}finally{await browser.close();}

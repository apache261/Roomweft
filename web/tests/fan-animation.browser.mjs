import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {defaultSettings} from '../src/sceneSettings.ts';
import {template} from '../src/layout.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Ceiling fan room',slug:'fan-room',published:true};
const asset={id:crypto.randomUUID(),name:'room-fan.glb',file_type:'GLB',upload_status:'ready',project_id:project.id};
const pose={position:[0,1.65,.8],yaw:0,pitch:.7};
const scenes=[
 {id:crypto.randomUUID(),project_id:project.id,name:'Animated room',type:'3D',asset_id:asset.id,settings:{...structuredClone(defaultSettings),navigation:{regions:[{id:'floor',name:'Fan room floor',left:-2,right:2,top:-1.5,bottom:1.5,min_y:-.01,max_y:.01,floor_meshes:['0/0/0']}] }},start_camera:pose},
 {id:crypto.randomUUID(),project_id:project.id,name:'Animated assembly',type:'LAYOUT',layout_revision:1,layout:{version:1,elements:[{...template('INSTANCE'),asset_id:asset.id,floor_meshes:['0/0/0']}],doors:[]},settings:structuredClone(defaultSettings),start_camera:pose},
];
project.start_scene_id=scenes[0].id;
const bytes=await readFile(new URL('../../assets/prefabs/practice-house/room-fan.glb',import.meta.url));
function changedPixels(a,b){const pa=PNG.sync.read(a),pb=PNG.sync.read(b);let count=0;for(let i=0;i<pa.data.length;i+=4)if(Math.abs(pa.data[i]-pb.data[i])+Math.abs(pa.data[i+1]-pb.data[i+1])+Math.abs(pa.data[i+2]-pb.data[i+2])>30)count++;return count;}
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
 await context.route(origin+'/fan-room.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets'))data=[asset];
  else if(path.endsWith(`/assets/${asset.id}`))data={...asset,url:origin+'/fan-room.glb'};
  else if(path.endsWith('/scenes'))data=scenes;
  else if(path.endsWith('/hotspots'))data=[];
  else if(path.endsWith('/layout')){const scene=scenes.find(s=>path.includes(s.id));data={document:scene.layout,revision:1};}
  else if(path===`/public/tours/${project.slug}`)data={...project,scenes};
  else throw new Error('Unexpected route '+path);
  await r.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('THREE.Clock'))errors.push(m.text());});
 async function spinning(label){
  await page.waitForTimeout(700);const canvas=page.locator('canvas');const first=await canvas.screenshot();let changed=0;
  for(let i=0;i<3;i++){await page.waitForTimeout(170);changed=Math.max(changed,changedPixels(first,await canvas.screenshot()));}
  assert.ok(changed>100,`${label}: fan should visibly rotate with a stationary camera (${changed} pixels changed)`);
  console.log(label+': rotating fan visible.');
 }
 await page.goto(origin+'/projects/'+project.id);await page.getByRole('button',{name:'Walk inside',exact:true}).waitFor();await page.getByRole('button',{name:'Walk inside',exact:true}).click();await spinning('Standalone room');
 if(process.env.FAN_PREVIEW_PATH){await page.getByRole('button',{name:'Inspect model',exact:true}).click();await page.waitForTimeout(700);await page.locator('canvas').screenshot({path:process.env.FAN_PREVIEW_PATH});}
 await page.locator('.scene-select select').selectOption(scenes[1].id);await page.getByRole('button',{name:'Walk inside',exact:true}).waitFor();await page.getByRole('button',{name:'Walk inside',exact:true}).click();await spinning('Imported layout room');
 for(const route of ['/t/','/embed/']){await page.goto(origin+route+project.slug);await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();await spinning(route);}
 assert.deepEqual(errors,[]);
} finally {await browser.close();}

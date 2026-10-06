import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { processAsset } from '../../asset-tools/process.mjs';
import { defaultSettings } from '../src/sceneSettings.ts';
import { reviewedInterior } from '../scripts/reviewed-interior.mjs';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5174',output=process.env.RUNTIME_OUTPUT||'/tmp/phase4-runtime-browser';
await mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function rebuild(json,bin){const metadata=Buffer.from(JSON.stringify(json)),padding=(4-metadata.length%4)%4,binaryPadding=(4-bin.length%4)%4;const bytes=Buffer.alloc(28+metadata.length+padding+bin.length+binaryPadding);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(metadata.length+padding,12);bytes.writeUInt32LE(0x4e4f534a,16);metadata.copy(bytes,20);bytes.fill(32,20+metadata.length,20+metadata.length+padding);bytes.writeUInt32LE(bin.length+binaryPadding,20+metadata.length+padding);bytes.writeUInt32LE(0x004e4942,24+metadata.length+padding);bin.copy(bytes,28+metadata.length+padding);return bytes;}
const textureSource=await readFile(new URL('../../tests/testdata/textured-interior.glb',import.meta.url));
const jsonLength=textureSource.readUInt32LE(12),json=JSON.parse(textureSource.subarray(20,20+jsonLength)),binary=textureSource.subarray(28+jsonLength);
const png=new PNG({width:2048,height:2048});for(let i=0;i<png.data.length;i+=4){png.data[i]=i%255;png.data[i+1]=110;png.data[i+2]=180;png.data[i+3]=255;}
const image=PNG.sync.write(png),offset=binary.length;
json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:image.length});json.images[0]={bufferView:json.bufferViews.length-1,mimeType:'image/png'};json.buffers[0].byteLength=offset+image.length;
const textured=rebuild(json,Buffer.concat([binary,image]));
const ktx=await readFile(new URL('../../tests/testdata/runtime-uastc.ktx2',import.meta.url)),basisJSON=structuredClone(json);
basisJSON.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:ktx.length});basisJSON.images[0]={bufferView:basisJSON.bufferViews.length-1,mimeType:'image/ktx2'};basisJSON.textures[0]={...basisJSON.textures[0],extensions:{KHR_texture_basisu:{source:0}}};delete basisJSON.textures[0].source;basisJSON.extensionsUsed=[...(basisJSON.extensionsUsed||[]),'KHR_texture_basisu'];basisJSON.extensionsRequired=[...(basisJSON.extensionsRequired||[]),'KHR_texture_basisu'];basisJSON.buffers[0].byteLength=binary.length+ktx.length;
// Remove the unused appended PNG buffer view from the KTX2 fixture.
basisJSON.bufferViews.splice(basisJSON.bufferViews.length-2,1);basisJSON.images[0].bufferView--;
const basis=rebuild(basisJSON,Buffer.concat([binary,ktx]));
const files=new Map(),manifests=new Map();
for(const [name,bytes] of [['textured',textured],['fan',await readFile(new URL('../../assets/prefabs/practice-house/room-fan.glb',import.meta.url))]]){
 const source=output+'/'+name+'.glb';await writeFile(source,bytes);files.set(name+'/original.glb',bytes);
 const manifest=await processAsset(source,output+'/'+name);manifests.set(name,manifest);
 for(const file of ['low.glb','balanced.glb','hq.glb','collision.glb'])files.set(name+'/'+file,await readFile(output+'/'+name+'/'+file));
}
files.set('basis/original.glb',basis);
const project={id:crypto.randomUUID(),name:'Runtime assets',slug:'runtime-assets',published:true},names=['textured','fan','basis'];
const assets=names.map(name=>({id:crypto.randomUUID(),project_id:project.id,name:name+'.glb',file_type:'GLB',upload_status:'ready'}));
const scenes=assets.map((asset,i)=>({id:crypto.randomUUID(),project_id:project.id,asset_id:asset.id,name:names[i],type:'3D',settings:{...structuredClone(defaultSettings),navigation:reviewedInterior(files.get(names[i]+'/original.glb'))},start_camera:{position:[0,1.65,0],yaw:0,pitch:0}}));
project.start_scene_id=scenes[0].id;
let active=scenes[0],failVariant=false,corrupt=false,proxyFailure=false;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1100,height:800}}),page=await context.newPage(),errors=[],downloads=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route(origin+'/runtime-files/**',r=>{const key=new URL(r.request().url()).pathname.slice('/runtime-files/'.length);downloads.push(key);if((failVariant&&!key.endsWith('original.glb'))||(proxyFailure&&key.endsWith('collision.glb')))return r.fulfill({status:404});return r.fulfill({body:corrupt&&!key.endsWith('original.glb')?Buffer.from('invalid'):files.get(key),contentType:'model/gltf-binary'});});
 await context.route(origin+'/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;
  else if(path.endsWith('/assets'))data=assets;
  else if(assets.some(a=>path.endsWith('/assets/'+a.id))){const asset=assets.find(a=>path.endsWith('/assets/'+a.id)),name=names[assets.indexOf(asset)],m=manifests.get(name),manifest=m&&structuredClone(m);if(manifest){for(const [tier,v]of Object.entries(manifest.variants))v.url=origin+'/runtime-files/'+name+'/'+tier+'.glb';manifest.collision.url=origin+'/runtime-files/'+name+'/collision.glb';}data={...asset,url:origin+'/runtime-files/'+name+'/original.glb',runtime:manifest?{state:'ready',manifest}:{state:'unavailable'}};}
  else if(path.endsWith('/scenes'))data=scenes;
  else if(path.endsWith('/hotspots'))data=[];
  else if(path===`/public/tours/${project.slug}`)data={...project,start_scene_id:active.id,scenes:[active]};
  else throw new Error('Unexpected API route '+path);
  await r.fulfill({json:data});
 });
 const snapshot=()=>page.evaluate(()=>window.__tourPerformance);
 async function open(scene,mode='/t/'){active=scene;await page.goto(origin+mode+project.slug+'?perf=1'+(process.env.SPATIAL_RENDERING==='0'?'&spatial=0':''));await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();await page.waitForFunction(()=>window.__tourPerformance?.firstUsableViewMs>0);}
 await open(scenes[0]);
 const before=(await snapshot()).metadata.cameraPosition;
 for(const tier of ['low','balanced','hq']){await page.getByLabel('Rendering quality',{exact:true}).selectOption(tier);await page.waitForFunction(t=>window.__tourPerformance?.metadata.qualityTier===t,tier);await page.waitForTimeout(500);const after=(await snapshot()).metadata.cameraPosition;assert.ok(Math.hypot(...before.map((v,i)=>v-after[i]))<1e-4,'tier swap preserves standing pose');assert.ok(downloads.includes('textured/'+tier+'.glb'));}
 await page.getByLabel('Rendering quality',{exact:true}).selectOption('low');await page.waitForTimeout(1400);
 const low=await snapshot();assert.ok(low.resources.textureInventory.some(t=>t.width===1024),'Low downsizes embedded 2048 texture');
 await page.getByRole('button',{name:'Inspect model',exact:true}).click();await page.waitForTimeout(500);
 const canvas=page.locator('canvas'),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2+25,{steps:8});await page.mouse.up();
 // Wait for actual damping settlement; software-renderer frame rates vary.
 let lastOrbit=(await snapshot()).metadata.cameraPosition,stableOrbit=0;for(let i=0;i<40&&stableOrbit<3;i++){await page.waitForTimeout(1000);const next=(await snapshot()).metadata.cameraPosition;stableOrbit=Math.hypot(...lastOrbit.map((v,j)=>v-next[j]))<.001?stableOrbit+1:0;lastOrbit=next;}assert.equal(stableOrbit,3,'orbit damping settles before tier comparison');
 const orbitBefore=(await snapshot()).metadata.cameraPosition;await page.getByLabel('Rendering quality',{exact:true}).selectOption('balanced');await page.waitForTimeout(800);const orbitAfter=(await snapshot()).metadata.cameraPosition;
 assert.ok(Math.hypot(...orbitBefore.map((v,i)=>v-orbitAfter[i]))<.05,'tier swap preserves orbit pose: '+JSON.stringify({orbitBefore,orbitAfter}));
 await open(scenes[0],'/embed/');assert.ok(downloads.includes('textured/collision.glb'));
 // Failed/corrupt variants and failed proxies preserve the original/visual collision paths.
 failVariant=true;await open(scenes[0]);assert.ok(downloads.includes('textured/original.glb'));failVariant=false;
 corrupt=true;await open(scenes[0]);corrupt=false;
 proxyFailure=true;await open(scenes[0]);proxyFailure=false;
 await open(scenes[1]);const fanBefore=await snapshot(),frame=fanBefore.renderedFrames;await page.waitForTimeout(700);const fanAfter=await snapshot();assert.ok(fanAfter.renderedFrames>frame+2,'compressed fan animation remains active: '+JSON.stringify({before:frame,after:fanAfter.renderedFrames,activeTasks:fanAfter.metadata.activeRenderTasks,intervals:fanAfter.frameMs,spatialDisabled:process.env.SPATIAL_RENDERING==='0'}));
 await open(scenes[2]);assert.ok((await snapshot()).resources.textureInventory.length>0,'Basis transcoding loads embedded KTX2 textures');
 await page.goto(origin+'/projects/'+project.id+'?perf=1');await page.getByRole('button',{name:'Walk inside',exact:true}).waitFor();await page.getByRole('button',{name:'Preview tour',exact:true}).click();await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 await writeFile(output+'/evidence.json',JSON.stringify({execution:'Headless Chromium / ANGLE SwiftShader; API mocked; not physical-device acceptance',downloads,lowTextureInventory:low.resources.textureInventory,manifests:Object.fromEntries(manifests),checks:['Meshopt','tier texture resize','standing pose','orbit pose','exact collision proxy','missing/corrupt variant fallback','missing proxy fallback','fan animation','Basis KTX2','builder','preview','public','embed']},null,2));
 console.log('PASS Meshopt, texture variants, quality pose, proxies, fallbacks, fan, KTX2 and all viewer modes. Evidence: '+output+'/evidence.json');
}finally{await browser.close();}

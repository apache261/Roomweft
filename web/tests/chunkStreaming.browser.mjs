import {chromium} from 'playwright';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {Document,NodeIO}=await import(createRequire(new URL('../../asset-tools/package.json',import.meta.url)).resolve('@gltf-transform/core'));
import {BoxGeometry} from 'three';
import {processChunks} from '../../asset-tools/chunks.mjs';
import sharp from '../../asset-tools/node_modules/sharp/lib/index.js';
import {sourceInventory} from '../../asset-tools/inventory.mjs';
import {performanceFixtures} from '../scripts/performance-fixtures.mjs';
import {defaultSettings} from '../src/sceneSettings.ts';
import {template} from '../src/layout.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5183',dir=await mkdtemp(tmpdir()+'/chunk-viewer-');
const doc=new Document(),buffer=doc.createBuffer(),root=doc.createScene(),material=doc.createMaterial('Floor').setBaseColorFactor([.6,.5,.3,1]);
const image=await sharp(Buffer.from([220,100,50,255,50,150,220,255,120,220,100,255,200,80,150,255]),{raw:{width:2,height:2,channels:4}}).png().toBuffer();material.setBaseColorTexture(doc.createTexture('shared floor image').setImage(image).setMimeType('image/png'));
const addBox=(name,size,position)=>{const geometry=new BoxGeometry(...size),p=doc.createPrimitive().setMaterial(material);for(const [attribute,semantic,type]of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2']])p.setAttribute(semantic,doc.createAccessor().setType(type).setArray(geometry.getAttribute(attribute).array).setBuffer(buffer));p.setIndices(doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(buffer));root.addChild(doc.createNode(name).setTranslation(position).setMesh(doc.createMesh().addPrimitive(p)));geometry.dispose();};
for(let i=0;i<6;i++)addBox('Floor '+i,[4,.2,4],[0,-.1,-i*4]);
addBox('Global beam',[.1,.1,24],[1.8,2.9,-10]);
const source=dir+'/source.glb';await writeFile(source,await new NodeIO().writeBinary(doc));const inventory=await sourceInventory(source);
const parent='00000000-0000-4000-9000-000000000099',partition={schema:'partition-v1',source_sha256:inventory.source_sha256,policy:'reviewed-rooms',visibility:'reviewed-openings',rooms:Array.from({length:6},(_,i)=>({id:'area-'+i,name:'Area '+i,bounds:{min:[-2,-.2,-i*4-2],max:[2,3,-i*4+2]},node_paths:['0/'+i]})),global_node_paths:['0/6'],openings:Array.from({length:5},(_,i)=>({id:'door-'+i,from:'area-'+i,to:'area-'+(i+1),kind:'doorway',reviewed:true,corners:[[-.7,0,-i*4-2],[.7,0,-i*4-2],[.7,2.2,-i*4-2],[-.7,2.2,-i*4-2]]}))};
if(process.env.CHUNK_SPATIAL==='1'){partition.visibility='conservative';partition.spatial_cell_size=4;}
const manifest=await processChunks(source,dir+'/out',{parent_asset_id:parent,revision:1,source_sha256:inventory.source_sha256,document:partition});
const files=new Map();for(const p of [...manifest.dependencies.map(d=>d.variants.low),...manifest.chunks.flatMap(c=>Object.values(c.variants)),manifest.navigation.payload,manifest.occlusion.payload])files.set(p.key,await readFile(dir+'/out/'+p.key));files.set('original.glb',await readFile(source));
const {project,scenes}=performanceFixtures();const asset={id:parent,project_id:project.id,name:'Reviewed rooms.glb',file_type:'GLB',upload_status:'ready'};
const scene={...scenes[0],name:'Chunked imported rooms',type:'3D',asset_id:parent,settings:{...defaultSettings,appearance:{...defaultSettings.appearance,hq_shadows:true},navigation:{regions:[{id:'inside',name:'Inside',left:-2,right:2,top:-22,bottom:2,min_y:-.21,max_y:.01,floor_meshes:Array.from({length:6},(_,i)=>'0/'+i)}]}},start_camera:{position:[0,1.65,0],yaw:Math.PI,pitch:0}};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:900,height:650}});await context.addInitScript(()=>localStorage.setItem('tour-render-quality','balanced'));
 let failNeighbor=true,malformed=false,delay=0;const requests=[],errors=[];
 await context.route(origin+'/chunk-fixture/**',async route=>{const key=decodeURIComponent(new URL(route.request().url()).pathname.slice('/chunk-fixture/'.length));requests.push(key);if(delay)await new Promise(r=>setTimeout(r,delay));if(failNeighbor&&manifest.regions[1].chunks.some(id=>key===id+'/balanced.glb'))return route.fulfill({status:503,body:'offline'});const bytes=files.get(key);if(!bytes)throw Error('Missing '+key);await route.fulfill({body:bytes,contentType:'model/gltf-binary'});});
 await context.route(origin+'/api/v1/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.slice('/api/v1'.length),base=path.includes('/public/')?`/public/tours/${project.slug}/assets/${parent}`:`/assets/${parent}`;let data;
  const descriptor=(p)=>{const {key,...rest}=p;return {...rest,url:origin+'/chunk-fixture/'+encodeURIComponent(key)};};
  if(path===`/public/tours/${project.slug}`)data={...project,start_scene_id:scene.id,scenes:[scene]};
  else if(path===`/projects/${project.id}`)data={...project,start_scene_id:scene.id};
  else if(path.endsWith('/assets'))data=[asset];
  else if(path===base)data={...asset,url:origin+'/chunk-fixture/original.glb',streaming:{state:'ready',processor_version:'chunks-v1',delivery:'scoped-descriptors',manifest_url:'/api/v1'+base+'/chunks'}};
  else if(path===base+'/chunks'){
   const m=structuredClone(manifest),endpoint=(p,suffix)=>{const {key,...rest}=p;return {...rest,url:origin+'/api/v1'+base+suffix};};
   for(const c of m.chunks)for(const tier of ['low','balanced','hq'])c.variants[tier]=endpoint(c.variants[tier],'/chunks/'+c.id+'?tier='+tier+'&revision=1');
   for(const d of m.dependencies)for(const tier of ['low','balanced','hq'])d.variants[tier]=endpoint(d.variants[tier],'/chunk-dependencies/'+d.id+'?tier='+tier);
   m.navigation.payload=endpoint(m.navigation.payload,'/chunk-indexes/navigation');m.occlusion.payload=endpoint(m.occlusion.payload,'/chunk-indexes/occlusion');data={delivery:'scoped-descriptors',manifest:malformed?{}:m};
  }else if(path.startsWith(base+'/chunks/')){const id=path.split('/').at(-1);data=descriptor(manifest.chunks.find(c=>c.id===id).variants[url.searchParams.get('tier')||'balanced']);}
  else if(path.startsWith(base+'/chunk-dependencies/'))data=descriptor(manifest.dependencies.find(d=>d.id===path.split('/').at(-1)).variants[url.searchParams.get('tier')||'balanced']);
  else if(path.startsWith(base+'/chunk-indexes/'))data=descriptor(manifest[path.split('/').at(-1)].payload);
  else if(path.endsWith('/scenes'))data=[scene];else if(path.endsWith('/hotspots'))data=[];else if(path.endsWith('/layout'))data={document:scene.layout,revision:1};else throw Error('Unexpected '+path);
  await route.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const ready=async()=>{try{await page.waitForFunction(()=>window.__tourPerformance?.firstSafelyUsableWalkingViewMs>0,{},{timeout:20000});}catch(error){console.log({requests,errors,body:await page.locator('body').innerText(),perf:await page.evaluate(()=>window.__tourPerformance)});throw error;}};
 await page.goto(origin+'/t/'+project.slug+'?perf=1');await ready();await page.getByRole('button',{name:'Retry room loading',exact:true}).waitFor();const initialRun=await page.evaluate(()=>window.__tourPerformance);const verifiedBytesBefore=ms=>initialRun.assetLoads.flatMap(l=>l.events).filter(e=>e.stage==='downloaded'&&e.atMs<=ms).reduce((sum,e)=>sum+(e.bytes||0),0);
 assert.ok(requests.includes('exact/collision.glb')&&requests.includes('exact/occlusion.glb'));assert.ok(!requests.includes('original.glb'));assert.ok(!requests.some(p=>manifest.regions[5].chunks.some(id=>p.startsWith(id+'/'))));
 const position=()=>page.evaluate(()=>window.__tourPerformance.metadata.cameraPosition),canvas=page.locator('canvas');await canvas.focus();await page.keyboard.down('s');await page.waitForTimeout(1800);await page.keyboard.up('s');await page.waitForTimeout(200);const blocked=await position();assert.ok(blocked[2]>-1.78,'incomplete neighbor blocks capsule: '+blocked);
 failNeighbor=false;delay=150;await page.getByRole('button',{name:'Retry room loading',exact:true}).click();await page.waitForFunction(()=>!document.body.textContent.includes('Room could not load'));await page.waitForTimeout(700);
 await canvas.focus();await page.keyboard.down('s');await page.waitForTimeout(1900);await page.keyboard.up('s');await page.waitForTimeout(250);const entered=await position();assert.ok(entered[2]<-2.2,'ready neighbor admits movement: '+entered);
 assert.ok(manifest.dependencies.length);for(const d of manifest.dependencies)assert.ok(requests.filter(key=>key===d.variants.balanced.key).length<=1,'active neighboring chunks share one image transfer');
 const sharing=await page.evaluate(()=>window.__tourPerformance.metadata.chunkStreaming.sharedImages);assert.ok(sharing.images>=1);assert.ok(sharing.samplers>=1&&sharing.samplerOwners>sharing.samplers,'compatible active chunk samplers share actual texture objects');
 const beforeQuality=await position();await page.getByRole('combobox',{name:'Rendering quality'}).selectOption('low');await page.waitForFunction(()=>window.__tourPerformance?.metadata.assetTier==='low');await page.waitForTimeout(1200);const afterQuality=await position();assert.ok(Math.hypot(beforeQuality[0]-afterQuality[0],beforeQuality[2]-afterQuality[2])<.1,'quality replacement retains pose');
 await page.getByRole('combobox',{name:'Rendering quality'}).selectOption('hq');await page.waitForFunction(count=>window.__tourPerformance?.metadata.chunkStreaming?.wanted===count,manifest.chunks.length);try{await page.waitForFunction(()=>window.__tourPerformance?.metadata.hqRendering?.waitingForContributors===false,{},{timeout:12000});}catch(error){console.log('HQ pending',await page.evaluate(()=>window.__tourPerformance?.metadata),requests,errors);throw error;}
 await page.getByRole('button',{name:'Reset view',exact:true}).click();await page.waitForFunction(()=>Math.abs(window.__tourPerformance.metadata.cameraPosition[2])<.1);
 await page.getByRole('button',{name:'Inspect model',exact:true}).click();await page.waitForFunction(count=>window.__tourPerformance?.metadata.chunkStreaming?.wanted===count,manifest.chunks.length);await page.waitForTimeout(1300);assert.ok(requests.some(p=>manifest.regions[5].chunks.some(id=>p.startsWith(id+'/'))));
 // Layout placements use parent chunks internally; no invented asset UUIDs.
 scene.type='LAYOUT';scene.layout={version:1,elements:[{...template('INSTANCE',0,0),id:'placement',asset_id:parent,collidable:true,floor_meshes:Array.from({length:6},(_,i)=>'0/'+i)}],doors:[]};scene.layout_revision=1;scene.start_camera={position:[0,1.65,0],yaw:Math.PI,pitch:0};requests.length=0;
 await page.goto(origin+'/embed/'+project.slug+'?perf=1');await ready();await page.waitForTimeout(500);assert.ok(requests.some(p=>manifest.regions[0].chunks.some(id=>p.startsWith(id+'/'))));assert.ok(!requests.includes('original.glb'));
 scene.type='3D';scene.start_camera={position:[0,1.65,-100],yaw:0,pitch:0};await page.goto(origin+'/t/'+project.slug+'?perf=1');await ready();const recovered=await position();assert.ok(recovered[2]>=-22&&recovered[2]<=2,'invalid saved start uses a supported loaded region');
 scene.start_camera={position:[0,1.65,0],yaw:Math.PI,pitch:0};malformed=true;await page.goto(origin+'/t/'+project.slug+'?perf=1');await ready();assert.ok(requests.includes('original.glb'),'invalid manifest uses controlled complete-source fallback');
 assert.deepEqual(errors,[]);
 const report={spatialCells:!!partition.spatial_cell_size,generatedChunks:manifest.chunks.length,sharedImageMetrics:JSON.parse(await readFile(dir+'/out/image-metrics.json')),execution:'Chromium SwiftShader with actual generated GLBs and mocked scoped API; not physical-device evidence',checks:['shared-image single transfer','compatible GPU sampler ownership','exact bootstrap','starting visuals only','parent-scoped payloads','failed-neighbor capsule boundary','targeted retry','quality pose retention','HQ full contributors','reset target readiness','invalid saved start recovery','inspection full contributors','layout parent chunks','embed','malformed-manifest fallback'],blocked,entered,beforeQuality,afterQuality,originalBytes:inventory.source_bytes,firstSafelyUsableWalkingViewMs:initialRun.firstSafelyUsableWalkingViewMs,startupVerifiedPayloadBytes:verifiedBytesBefore(initialRun.firstSafelyUsableWalkingViewMs),startupBytesDefinition:'Successful verified payload bodies completed before walking readiness, including exact indexes; excludes failed bodies/HTTP overhead',exactStartupBytes:manifest.navigation.payload.bytes+manifest.occlusion.payload.bytes,sourceFallbackReason:'malformed manifest'};
 await writeFile(process.env.CHUNK_STREAM_OUTPUT||'/tmp/chunk-streaming-phase56.json',JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}

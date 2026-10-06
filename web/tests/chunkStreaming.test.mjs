import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,Vector3} from 'three';
import {admitsChunks,startingChunks,planChunks,mapChunkSurfaces,descriptorEndpoint,fetchStreamingManifest,validateChunkContainer} from '../src/chunkStreaming.ts';
import {prepareModel,defaultSettings,modelMatrix} from '../src/sceneSettings.ts';
import {WalkWorld} from '../src/navigation.ts';
import {HotspotVisibility,visibilityResult} from '../src/hotspotVisibility.ts';
import {ChunkStreamSession} from '../src/ChunkStreamSession.ts';
import {RoomChunkCache} from '../src/roomStreaming.ts';
import {registerChunkPayload,loadModel,registerAsset,retainModels,readModel,assetCacheStats} from '../src/runtimeAssetCache.ts';
const reference=JSON.parse(await readFile(new URL('../../tests/testdata/chunking/contracts/manifest.json',import.meta.url)));
const manifest=()=>{const m=structuredClone(reference);m.dependencies=[];m.chunks.forEach(c=>c.dependencies=[]);return m;};
const camera=()=>{const c=new PerspectiveCamera(65,1,.05,100);c.position.set(0,1.65,0);c.lookAt(0,1.65,10);c.updateMatrixWorld();return c;};
test('capsule entry, saved starts and arrivals remain blocked despite exact global floor knowledge',()=>{
 const m=manifest(),root=new Group();for(const z of [0,-6]){const mesh=new Mesh(new BoxGeometry(6,.2,6),new MeshStandardMaterial());mesh.position.set(0,-.1,z);root.add(mesh);}
 const settings={...defaultSettings,navigation:{regions:[{id:'inside',name:'Inside',left:-3,right:3,top:-9,bottom:3,min_y:-.21,max_y:.01,floor_meshes:['0/0','0/1']}]}};
 const prepared=prepareModel(root,settings),ready=new Set(['global-beam','room-a-geometry','navigation','occlusion']);
 prepared.root.userData.admitsMovement=(p,r,h)=>admitsChunks(m,p,new Matrix4(),ready,r,h);
 const world=new WalkWorld(prepared.root);
 assert.ok(world.validStart(new Vector3(0,1.65,0)));
 assert.equal(world.validStart(new Vector3(0,1.65,-6)),undefined);
 assert.ok(world.move(new Vector3(0,1.65,0),new Vector3(0,0,-5)).z>-2.78);
 const portal={destination_region_id:'inside',arrival:{position:[0,1.65,-6],yaw:0,pitch:0}};assert.equal(world.enter(portal),undefined);
 ready.add('room-b-geometry');assert.ok(world.enter(portal));assert.ok(world.move(new Vector3(0,1.65,0),new Vector3(0,0,-5)).z<-4.9);
 ready.delete('occlusion');assert.equal(world.validStart(new Vector3(0,1.65,0)),undefined);
 world.dispose();prepared.dispose();
});
test('source-space capsule readiness and bootstrap apply transformed placement once',()=>{
 const m=manifest(),transform=new Matrix4().makeTranslation(12,0,8).multiply(modelMatrix({scale:2,rotation:37,up_axis:'Y'}));
 const a=new Vector3(0,1.65,0).applyMatrix4(transform),b=new Vector3(0,1.65,-6).applyMatrix4(transform),ready=new Set(['global-beam','room-a-geometry','navigation','occlusion']);
 assert.ok(admitsChunks(m,a,transform,ready,.22,3.3));assert.equal(admitsChunks(m,b,transform,ready,.22,3.3),false);
 assert.deepEqual([...startingChunks(m,a,transform)].sort(),['global-beam','room-a-geometry']);
 assert.ok(admitsChunks(m,new Vector3(100,1.65,100),transform,ready,.22,1.65,true),'unrelated layout placements do not block template floors');
});
test('doorway priority is independent of look; windows do not become walking neighbors',()=>{
 const m=manifest(),c=camera(),plan=planChunks(m,c,new Matrix4());
 assert.ok(plan.movement.has('room-b-geometry'));assert.equal(plan.visible.has('room-b-geometry'),false);assert.ok(plan.priority.includes('room-b-geometry'));
 m.partition.openings[0].kind='window';assert.equal(planChunks(m,c,new Matrix4()).movement.has('room-b-geometry'),false);
 const full=planChunks(m,c,new Matrix4(),{shadows:true});assert.equal(full.wanted.size,m.chunks.length);
 assert.equal(planChunks(m,c,new Matrix4(),{inspection:true}).visible.size,m.chunks.length);
 const transform=new Matrix4().makeTranslation(10,0,3).multiply(modelMatrix({scale:2,rotation:37,up_axis:'Y'}));c.matrixWorld.premultiply(transform);c.matrixWorldInverse.copy(c.matrixWorld).invert();
 m.partition.openings[0].kind='doorway';assert.equal(planChunks(m,c,transform).visible.has('room-b-geometry'),false,'rotated room AABBs must not invent room membership');
});
test('chunk-local paths preserve material assignments, floor identities and UV1 after cloning',()=>{
 const root=new Group(),mesh=new Mesh(new BoxGeometry(2,.2,2),new MeshStandardMaterial());mesh.position.y=-.1;root.add(mesh);
 const chunk={primitive_count:1,surface_map:[{chunk_path:'0/0',source_path:'0/9',source_triangle_start:0,chunk_triangle_start:0,triangle_count:12}]};
 mapChunkSurfaces(root,chunk);const prepared=prepareModel(root,{...defaultSettings,navigation:{regions:[{id:'r',name:'R',left:-1,right:1,top:-1,bottom:1,min_y:-.21,max_y:.01,floor_meshes:['0/9']}]}});
 assert.equal(prepared.surfaces[0].path,'0/9');const world=new WalkWorld(prepared.root);assert.ok(world.start());world.dispose();prepared.dispose();
 assert.throws(()=>mapChunkSurfaces(root,{...chunk,primitive_count:2}),/inventory/);
});
test('unloaded authored wall still occludes a hotspot while the resident render tree is empty',()=>{
 const exact=new Group(),wall=new Mesh(new BoxGeometry(5,5,.2),new MeshStandardMaterial());wall.position.set(0,1.65,4);exact.add(wall);
 const visual=new Group();visual.userData.runtimeOcclusionRoot=exact;const c=camera(),visibility=new HotspotVisibility();visibility.begin(c,[visual],false);
 assert.equal(visibility.evaluate(visibilityResult(new Vector3(0,1.65,8))).visible,false);
});
test('queued movement replaces stale prefetch order and targeted retry preserves other failures',async()=>{
 const calls=[],pending=new Map(),released=[];const cache=new RoomChunkCache(id=>{calls.push(id);let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});pending.set(id,{resolve,reject});return {promise,release:()=>released.push(id)}},()=>{},12,1);
 cache.request(['active','prefetch1','prefetch2']);cache.request(['active','prefetch2','movement'],['movement','active']);pending.get('active').resolve('ok');await new Promise(setImmediate);assert.deepEqual(calls,['active','movement']);
 pending.get('movement').reject(Error('offline'));await new Promise(setImmediate);pending.get('prefetch2').reject(Error('offline'));await new Promise(setImmediate);cache.retry(['movement']);assert.equal(cache.entries.get('prefetch2').status,'failed');assert.equal(calls.at(-1),'movement');
 cache.dispose();pending.get('movement').resolve('late');await new Promise(setImmediate);assert.equal(released.length,calls.length);assert.ok(!calls.includes('prefetch1'));
});
test('descriptor renewal binds parent, source, revision, tier and expected hash without whole-source fallback',async()=>{
 const m=manifest(),bytes=await readFile(new URL('../../tests/testdata/house.glb',import.meta.url)),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const payload={url:'http://api.internal/api/v1/assets/'+m.parent_asset_id+'/chunks/room-a-geometry?tier=low&revision=1',sha256:hash,bytes:bytes.length,texture_rgba8_bytes:0,max_texture:0};
 // Use the runtime's actual table hierarchy for this loader-only test.
 m.chunks[0].variants.low=payload;m.chunks[0].surface_map=[];
 const original=globalThis.fetch,requests=[];let binaryFailures=1;
 globalThis.fetch=async url=>{requests.push(String(url));if(String(url).includes('/chunks/'))return Response.json({...payload,url:'http://storage.example/payload?renewal='+requests.length});if(binaryFailures-->0)return new Response('',{status:403});return new Response(bytes);};
 try{
 const key=registerChunkPayload('/assets/'+m.parent_asset_id,m,m.chunks[0].id,'low');await assert.rejects(loadModel(key),/mapping/);
 assert.equal(requests.filter(u=>u.includes('/chunks/')).length,2);assert.ok(requests.every(u=>!u.includes('/original')));
 assert.throws(()=>descriptorEndpoint('http://api/api/v1/assets/other/chunks/c','/assets/'+m.parent_asset_id),/scope/);
 const other=registerChunkPayload('/public/tours/demo/assets/'+m.parent_asset_id,m,m.chunks[0].id,'low');assert.notEqual(key,other);
 }finally{globalThis.fetch=original;}
});


test('speculative transfer reserves a slot so a stalled prefetch cannot starve movement',async()=>{
 const calls=[],pending=new Map();const cache=new RoomChunkCache(id=>{calls.push(id);let resolve;const promise=new Promise(r=>resolve=r);pending.set(id,resolve);return {promise,release:()=>{}}},()=>{},12,2);
 cache.request(['prefetch-a','prefetch-b'],[]);assert.deepEqual(calls,['prefetch-a']);
 cache.request(['prefetch-a','prefetch-b','movement'],['movement']);assert.deepEqual(calls,['prefetch-a','movement']);
 pending.get('movement')('ready');await new Promise(setImmediate);assert.equal(cache.entries.get('movement').status,'ready');cache.dispose();pending.get('prefetch-a')('late');await new Promise(setImmediate);
});


test('verified chunk payloads cannot enable arbitrary external GLB fetches',()=>{
 const json=new TextEncoder().encode(JSON.stringify({buffers:[{uri:'https://unrelated.example/buffer.bin'}]})),bytes=new ArrayBuffer(20+json.length),view=new DataView(bytes);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);view.setUint32(12,json.length,true);view.setUint32(16,0x4e4f534a,true);new Uint8Array(bytes,20).set(json);
 assert.throws(()=>validateChunkContainer(bytes),/External/);assert.throws(()=>validateChunkContainer(new ArrayBuffer(4)),/container/);
});


test('untrusted uploaded extras cannot impersonate an approved source floor path',()=>{
 const source=new Group(),mesh=new Mesh(new BoxGeometry(2,.2,2),new MeshStandardMaterial());mesh.position.y=-.1;mesh.userData.sourcePath='0/9';source.add(mesh);
 const prepared=prepareModel(source,{...defaultSettings,navigation:{regions:[{id:'r',name:'R',left:-1,right:1,top:-1,bottom:1,min_y:-.21,max_y:.01,floor_meshes:['0/9']}]}}),world=new WalkWorld(prepared.root);
 assert.equal(prepared.surfaces[0].path,'0/0');assert.equal(world.start(),undefined);world.dispose();prepared.dispose();
});


test('uploaded room extras cannot hide a committed chunk or change its trusted render owner',()=>{
 const m=manifest(),source=new Group(),mesh=new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial());mesh.userData.roomIds=['unrelated-upload-room'];source.add(mesh);
 mapChunkSurfaces(source,m.chunks[0]);
 const session=new ChunkStreamSession({[m.parent_asset_id]:'unused'},{},()=>{});session.manifests.set(m.parent_asset_id,m);
 session.cache.entries.set(`${m.parent_asset_id}/${m.chunks[0].id}`,{status:'ready',value:{scene:source},release:()=>{}});
 const aggregate=session.visualSources().get(m.parent_asset_id);let copied;aggregate.traverse(o=>{if(o.isMesh)copied=o});
 assert.deepEqual(copied.userData.roomIds,[`${m.parent_asset_id}/${m.chunks[0].id}`]);assert.deepEqual(mesh.userData.roomIds,['unrelated-upload-room']);
 const prepared=prepareModel(aggregate,defaultSettings);assert.equal(prepared.surfaces[0].path,'0/0');prepared.dispose();session.dispose();
});

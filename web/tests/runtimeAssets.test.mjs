import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerAsset, loadModel, disposeModel } from '../src/runtimeAssetCache.ts';
import { createHash } from 'node:crypto';
import { prepareModel, defaultSettings } from '../src/sceneSettings.ts';
import { WalkWorld } from '../src/navigation.ts';
import { navigationCacheStats } from '../src/navigationCache.ts';
import { reviewFixture } from './reviewedWorld.mjs';
import { Vector3 } from 'three';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class extends Event { constructor(type, options) { super(type); Object.assign(this, options); } };

test('asset keys ignore signed URL expiry, honor scope/tier, and corrupt or missing variants use originals', async () => {
 const bytes=await readFile(new URL('../../tests/testdata/runtime-house.glb',import.meta.url)),original=await readFile(new URL('../../tests/testdata/house.glb',import.meta.url)),calls=[];
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;calls.push(String(url));return String(url).startsWith('https://missing')?new Response('',{status:404}):new Response(String(url).startsWith('https://original')?original:bytes);};
 const response={url:'https://original/?signature=1',runtime:{state:'ready',manifest:{version:'runtime-v1',source_sha256:hash(original),variants:Object.fromEntries(['low','balanced','hq'].map(t=>[t,{url:'https://runtime/'+t,sha256:hash(bytes)}]))}}};
 try{
  const key=registerAsset('asset','/api/v1/assets/asset',response,'low');
  assert.equal(key,registerAsset('asset','/api/v1/assets/asset',{...response,url:'https://original/?signature=2'},'low'));
  assert.notEqual(key,registerAsset('asset','/api/v1/public/tours/example/assets/asset',response,'low'));
  assert.notEqual(key,registerAsset('asset','/api/v1/assets/asset',response,'hq'));
  const gltf=await loadModel(key);assert.ok(gltf.scene.children.length);assert.equal(calls.at(-1),'https://runtime/low');disposeModel(gltf);
  const broken=structuredClone(response);broken.runtime.manifest.variants.low.sha256='0'.repeat(64);
  const fallback=await loadModel(registerAsset('asset','/api/v1/assets/asset',broken,'low'));assert.ok(calls.at(-1).startsWith('https://original'));disposeModel(fallback);
  broken.runtime.manifest.variants.low.url='https://missing/low';
  const unavailable=await loadModel(registerAsset('asset','/api/v1/assets/asset',broken,'low'));assert.ok(calls.at(-1).startsWith('https://original'));disposeModel(unavailable);
 }finally{globalThis.fetch=originalFetch;}
});
test('exact collision proxy and shared navigation data retain authored approvals and independent ownership', async () => {
 const originalFetch=globalThis.fetch;
 const source=await readFile(new URL('../../tests/testdata/house.glb',import.meta.url)),visual=await readFile(new URL('../../tests/testdata/runtime-house.glb',import.meta.url)),proxy=await readFile(new URL('../../tests/testdata/runtime-house-collision.glb',import.meta.url));
 globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return new Response(String(url).endsWith('collision')?proxy:String(url).endsWith('low')?visual:source);};
 const response={url:'https://fixture/original',runtime:{state:'ready',manifest:{version:'runtime-v1',source_sha256:hash(source),variants:{low:{url:'https://fixture/low',sha256:hash(visual)}},collision:{url:'https://fixture/collision',sha256:hash(proxy),strategy:'verified-exact-geometry',floor_approval:'authored-only'}}}};
 let model,prepared,world,second;
 try{
  model=await loadModel(registerAsset('house','/assets/house',response,'low'));prepared=prepareModel(model.scene,defaultSettings);world=new WalkWorld(prepared.root);assert.equal(world.start(),undefined,'derivatives cannot approve floors');world.dispose();
  reviewFixture(prepared.root);world=new WalkWorld(prepared.root);second=new WalkWorld(prepared.root);
  assert.equal(world.collision,second.collision);assert.equal(world.floors,second.floors);assert.ok(world.start());
  const spawn=new Vector3(...world.start().position);world.dispose();assert.ok(second.grounded(spawn),'releasing one owner preserves shared triangles');
  assert.ok(navigationCacheStats().owners>0);
  const old=second.collision;prepared.root.matrix.makeTranslation(10,0,0);prepared.root.updateMatrixWorld(true);const transformed=new WalkWorld(prepared.root);assert.notEqual(transformed.collision,old);transformed.dispose();
 }finally{world?.dispose();second?.dispose();prepared?.dispose();if(model)disposeModel(model);globalThis.fetch=originalFetch;}
});

import { readModel, retainModels, assetCacheStats, pruneAssetCache } from '../src/runtimeAssetCache.ts';
test('matching renderer capabilities reuse decoded assets and eviction never disposes an active owner', async () => {
 const bytes=await readFile(new URL('../../tests/testdata/runtime-house.glb',import.meta.url)),originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async input=>{calls.push(typeof input==='string'?input:input.url);return new Response(bytes);};
 const renderer={capabilities:{maxTextureSize:4096},extensions:{has:()=>false}},otherRenderer={capabilities:{maxTextureSize:4096},extensions:{has:()=>false}};
 const releases=[];
 try{
  const key=registerAsset('persistent','/assets/persistent',{url:'https://cache/source?signature=1'},'low');
  const entry=readModel(key,renderer);await entry.promise;releases.push(retainModels([entry],renderer));
  registerAsset('persistent','/assets/persistent',{url:'https://cache/source?signature=2'},'low');
  assert.equal(readModel(key,otherRenderer),entry);assert.equal(calls.length,1,'signed URL refresh and Canvas remount reuse decoded identity');
  let disposed=0;entry.model.scene.traverse(o=>o.geometry?.addEventListener('dispose',()=>disposed++));
  for(let i=0;i<14;i++){const k=registerAsset('eviction-'+i,'/assets/eviction-'+i,{url:'https://cache/'+i},'low');await readModel(k,renderer).promise;}
  const now=Date.now;Date.now=()=>now()+31_000;try{pruneAssetCache(renderer);}finally{Date.now=now;}
  assert.ok(assetCacheStats(renderer).entries<=12);assert.equal(disposed,0,'active source geometry remains owned');
 }finally{releases.forEach(release=>release());globalThis.fetch=originalFetch;}
});

test('a streamed revisit refreshes expired delivery URLs through the scoped API endpoint',async()=>{
 const originalFetch=globalThis.fetch,bytes=await readFile(new URL('../../tests/testdata/house.glb',import.meta.url)),calls=[];
 globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;calls.push(String(url));if(url==='https://expired/room')return new Response('',{status:403});if(url==='/api/v1/public/tours/streaming/assets/room')return Response.json({url:'https://renewed/room'});return new Response(bytes);};
 try{const model=await loadModel(registerAsset('room','/public/tours/streaming/assets/room',{url:'https://expired/room'},'low'));assert.deepEqual(calls,['https://expired/room','/api/v1/public/tours/streaming/assets/room','https://renewed/room']);disposeModel(model);}finally{globalThis.fetch=originalFetch;}
});

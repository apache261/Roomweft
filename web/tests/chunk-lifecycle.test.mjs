import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture,Matrix4,Vector3} from 'three';
import {leaseChunkImage,shareChunkSamplers,releaseChunkSamplers} from '../src/sharedChunkImages.ts';
import {RoomChunkCache} from '../src/roomStreaming.ts';
import {mapChunkSurfaces,startingChunks,admitsChunks,planChunks} from '../src/chunkStreaming.ts';
import {readFile} from 'node:fs/promises';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('shared image transfer aborts only after its last owner and releases idempotently',async()=>{
 let signal,resolve,loads=0;const load=s=>{signal=s;loads++;return new Promise(r=>resolve=r);},p={sha256:'a'.repeat(64)};
 const a=leaseChunkImage('scope',p,load),b=leaseChunkImage('scope',p,load);assert.equal(loads,1);a.release();a.release();assert.equal(signal.aborted,false);b.release();assert.equal(signal.aborted,true);resolve(new ArrayBuffer(20));await settle();
 const c=leaseChunkImage('scope',p,async()=>new ArrayBuffer(20));await c.promise;c.release();
});
test('GPU sampler ownership preserves color space, UV channel, wrapping and transforms',()=>{
 const make=(channel=0)=>{const root=new Group(),texture=new Texture();texture.channel=channel;texture.colorSpace='srgb';texture.repeat.set(2,3);root.add(new Mesh(new BoxGeometry(),new MeshStandardMaterial({map:texture})));return {scene:root,parser:{associations:new Map([[texture,{textures:0}]]),json:{textures:[{source:0}],images:[{uri:'blob:image'}]}}};};
 const a=make(),b=make(),c=make(1),urls=new Map([['blob:image','hash']]);shareChunkSamplers(a,'scope',urls);shareChunkSamplers(b,'scope',urls);shareChunkSamplers(c,'scope',urls);
 const t=a.scene.children[0].material.map;assert.equal(b.scene.children[0].material.map,t);assert.notEqual(c.scene.children[0].material.map,t);let disposed=0;t.addEventListener('dispose',()=>disposed++);
 assert.ok(releaseChunkSamplers(a).has(t));assert.equal(disposed,0);releaseChunkSamplers(b);assert.equal(disposed,1);releaseChunkSamplers(b);assert.equal(disposed,1);releaseChunkSamplers(c);
});
test('obsolete in-flight chunk leases release once without deleting a newer request',async()=>{
 const pending=[],releases=[],cache=new RoomChunkCache(id=>({promise:new Promise(resolve=>pending.push(resolve)),release:()=>releases.push(id)}),()=>{},1,2);
 cache.request(['a']);cache.request(['b']);assert.deepEqual(releases,['a']);pending[0]('late');await settle();assert.equal(cache.entries.has('a'),false);pending[1]('B');await settle();cache.dispose();cache.dispose();assert.deepEqual(releases,['a','b']);
});
test('inactive resident chunks expire after hysteresis while required chunks remain',async()=>{
 let changes=0;const released=[],cache=new RoomChunkCache(id=>({promise:Promise.resolve(id),release:()=>released.push(id)}),()=>changes++,1,2,20);cache.request(['a']);await settle();cache.request(['b']);await settle();assert.ok(cache.entries.has('a'));await new Promise(r=>setTimeout(r,45));assert.equal(cache.entries.has('a'),false);assert.equal(cache.entries.get('b').value,'b');assert.deepEqual(released,['a']);assert.ok(changes>=3);cache.dispose();
});
test('noncontiguous split mappings retain source identities and block missing capsule cells',async()=>{
 const root=new Group(),mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial());root.add(mesh);const count=mesh.geometry.index.count/3,c={primitive_count:1,surface_map:[{source_path:'0/7',chunk_path:'0/0',source_triangle_start:10,chunk_triangle_start:0,triangle_count:4},{source_path:'0/7',chunk_path:'0/0',source_triangle_start:25,chunk_triangle_start:4,triangle_count:count-4}]};mapChunkSurfaces(root,c);assert.equal(mesh.userData.materialPath,'0/7');assert.equal(mesh.userData.sourceTriangleRanges[1].source_triangle_start,25);
 const m=JSON.parse(await readFile(new URL('../../tests/testdata/chunking/contracts/manifest.json',import.meta.url)));m.partition.spatial_cell_size=4;m.chunks[0].bounds={min:[-1,-.2,-1],max:[1,2,1]};m.chunks[1].bounds={min:[10,-.2,-1],max:[11,2,1]};m.chunks=m.chunks.slice(0,2);m.global_chunks=[];m.regions[0].display_requires=m.chunks.map(c=>c.id);
 const pos=new Vector3(0,1.65,0),start=startingChunks(m,pos,new Matrix4());assert.ok(start.has(m.chunks[0].id));assert.equal(start.has(m.chunks[1].id),false);const ready=new Set(['navigation','occlusion']);assert.equal(admitsChunks(m,pos,new Matrix4(),ready,.3,1.65),false);ready.add(m.chunks[0].id);assert.equal(admitsChunks(m,pos,new Matrix4(),ready,.3,1.65),true);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateInventory,validatePartition,defaultPartition,validateChunkManifest,validateManifestAgainst,validateDeliveredChunkManifest,parseChunkManifest,sourceIdentity} from '../src/chunkingContracts.ts';
import {preparedPartitionBounds,assignPartitionNode,removePartitionRoom} from '../src/partitionMetadata.ts';
import {modelMatrix} from '../src/sceneSettings.ts';
import {bakeAssetIdentity} from '../src/bakeAssetIdentity.ts';
import {bakeContext,bakeRevision} from '../src/hqRendering.ts';
import {sourceInventory} from '../../asset-tools/inventory.mjs';
const fixture=async name=>JSON.parse(await readFile(new URL('../../tests/testdata/chunking/contracts/'+name+'.json',import.meta.url),'utf8'));
test('Go/TS fixtures preserve full source coverage, scoped payload identity and readiness',async()=>{
 const m=await fixture('manifest');validateChunkManifest(m);
 assert.deepEqual(sourceIdentity(m,'room-b-geometry','0/0',0,11),{path:'0/1',primitive:0,triangle:11});assert.equal(sourceIdentity(m,'room-b-geometry','0/0',0,12),undefined);
 for(const mutate of [
 m=>m.schema='runtime-v1',m=>m.schema='streaming-v2',m=>m.coordinates='prepared-world',m=>m.chunks[0].surface_map[0].triangle_count--,m=>m.chunks[1].surface_map[0].source_path='0/0',m=>m.chunks[0].surface_map[0].source_triangle_start=1,m=>m.dependencies[0].requires=['room-a-geometry'],m=>m.chunks[0].dependencies=['missing'],m=>m.regions[0].movement_requires=m.regions[0].display_requires,m=>m.regions[0].display_requires=['global-beam'],m=>m.regions[0].chunks=['room-b-geometry'],m=>m.navigation.floor_source_paths=['0/99'],m=>m.occlusion.strategy='verified-exact-geometry',m=>m.chunks[0].variants.low.key='https://example.invalid/source',m=>delete m.coordinates,m=>m.chunks[0].local_to_source=[1,0],m=>m.extra=true
 ]){const bad=structuredClone(m);mutate(bad);assert.throws(()=>validateChunkManifest(bad));assert.equal(parseChunkManifest(bad),undefined);}
 const mapping=m.chunks[0].surface_map[0];m.chunks[0].surface_map=[{...mapping,triangle_count:5},{...mapping,source_triangle_start:5,chunk_triangle_start:5,triangle_count:7}];validateChunkManifest(m);assert.equal(sourceIdentity(m,'room-a-geometry','0/0',0,6).triangle,6);
});
test('reviewed rooms reject stale, duplicate, crossing, unknown and unreviewed ownership/openings',async()=>{
 const i=await fixture('inventory'),p=await fixture('partition');validateInventory(i);validatePartition(p,i);
 for(const mutate of [p=>p.source_sha256='bad',p=>p.global_node_paths=[],p=>p.global_node_paths.push('0/0'),p=>{p.global_node_paths=[];p.rooms[0].node_paths.push('0/2');},p=>{p.global_node_paths=[];p.rooms[0].node_paths.push('0/2');p.rooms[0].bounds.min[2]=-9;},p=>p.openings[0].to='unknown',p=>p.openings[0].reviewed=false,p=>p.openings[0].corners[3][2]++,p=>p.openings[0].corners[2]=[0,.1,-3],p=>p.openings[0].to=p.openings[0].from,p=>p.openings[0].corners.forEach(c=>c[2]=99)]){const bad=structuredClone(p);mutate(bad);assert.throws(()=>validatePartition(bad,i));}
 const dependent=structuredClone(i);dependent.conservative_reasons=['animated hierarchy'];assert.throws(()=>validatePartition(p,dependent));validatePartition(defaultPartition(dependent),dependent);
 const assigned=assignPartitionNode(p,i,'0/0','global');assert.ok(assigned.global_node_paths.includes('0/0'));assert.ok(!assigned.rooms[0].node_paths.length);const removed=removePartitionRoom(p,'room-a');assert.ok(removed.global_node_paths.includes('0/0'));assert.equal(removed.openings.length,0);
});
test('source inventory uses actual runtime child paths and keeps skin/clip dependencies complete',async()=>{
 const i=await sourceInventory(new URL('../../tests/testdata/chunking/authored-rooms.glb',import.meta.url));validateInventory(i);
 assert.equal(i.nodes.find(n=>n.path==='0/0/0/0').name,'Reviewed_floor');
 assert.ok(i.conservative_reasons.some(r=>r.includes('Skin')));assert.ok(i.conservative_reasons.some(r=>r.includes('Animation')));
 assert.ok(i.nodes.filter(n=>n.renderable).every(n=>n.dependency_group==='authored-hierarchy'));validatePartition(defaultPartition(i),i);
 const staticInventory=await sourceInventory(new URL('../../tests/testdata/chunking/giant-static.glb',import.meta.url));validateInventory(staticInventory);assert.equal(staticInventory.conservative_reasons.length,0);assert.equal(staticInventory.nodes.filter(n=>n.renderable).length,1);
});
test('prepared bounds apply wrapper once and partition publication does not enter bake identity',async()=>{
 const i=await fixture('inventory'),before=JSON.stringify(i),b=i.bounds;
 const transform=modelMatrix({scale:2,up_axis:'Y',rotation:90});const prepared=preparedPartitionBounds(b,transform);
 assert.ok(Math.abs(prepared.max[0]-6)<1e-6);assert.equal(JSON.stringify(i),before);
 const lighting={environment_intensity:1,light_intensity:1,tint:'',roughness:null};
 const original={url:'/original',runtime:{manifest:{source_sha256:i.source_sha256}}};
 const key=bakeRevision(bakeContext(bakeAssetIdentity('immutable-parent-id',original),{scale:1},[],{},lighting));
 const published={...original,streaming:{manifest:{source_sha256:'b'.repeat(64),partition_revision:9,schema:'streaming-v1'}},partition:await fixture('partition')};
 assert.equal(bakeRevision(bakeContext(bakeAssetIdentity('immutable-parent-id',published),{scale:1},[],{},lighting)),key);
 assert.notEqual(bakeRevision(bakeContext(bakeAssetIdentity('immutable-parent-id',published),{scale:2},[],{},lighting)),key);
});

test('delivery retains metadata/mappings and uses URL-only descriptors with stable hashes',async()=>{
 const stored=await fixture('manifest'),delivered=structuredClone(stored);
 const convert=p=>{const {key,...rest}=p;return{...rest,url:'https://assets.example/'+key+'?expires=1'};};
 for(const c of [...delivered.chunks,...delivered.dependencies])for(const tier of Object.keys(c.variants))c.variants[tier]=convert(c.variants[tier]);
 delivered.navigation.payload=convert(delivered.navigation.payload);delivered.occlusion.payload=convert(delivered.occlusion.payload);
 validateDeliveredChunkManifest(delivered);assert.throws(()=>validateChunkManifest(delivered));
 delivered.chunks[0].variants.low.url+='&renewed=true';validateDeliveredChunkManifest(delivered);
 delivered.chunks[0].variants.low.key='private-key';assert.throws(()=>validateDeliveredChunkManifest(delivered));delete delivered.chunks[0].variants.low.key;
 delivered.chunks[0].variants.low.url='javascript:invalid';assert.throws(()=>validateDeliveredChunkManifest(delivered));
});

test('self-consistent output cannot invent authoritative source or partition revisions',async()=>{
 const m=await fixture('manifest'),i=await fixture('inventory'),p=await fixture('partition');
 validateManifestAgainst(m,i,p,m.parent_asset_id,1);assert.throws(()=>validateManifestAgainst(m,i,p,m.parent_asset_id,2));
 m.source_surfaces[0].triangles++;m.chunks[0].triangle_count++;m.chunks[0].surface_map[0].triangle_count++;
 validateChunkManifest(m);assert.throws(()=>validateManifestAgainst(m,i,p,m.parent_asset_id,1));
});

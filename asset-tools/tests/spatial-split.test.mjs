import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Document,NodeIO} from '@gltf-transform/core';
import {processChunks} from '../chunks.mjs';
import {sourceInventory} from '../inventory.mjs';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {runtimeInventory} from '../process.mjs';

test('opt-in triangle cells preserve noncontiguous source ranges, UV1 and exact navigation',async()=>{
 const dir=await mkdtemp(tmpdir()+'/spatial-test-');try{
 const d=new Document(),b=d.createBuffer(),scene=d.createScene(),positions=new Float32Array([0,0,0,1,0,0,0,0,1, 10,0,0,11,0,0,10,0,1, 0,0,2,1,0,2,0,0,3]);
 const p=d.createPrimitive().setAttribute('POSITION',d.createAccessor().setType('VEC3').setArray(positions).setBuffer(b)).setAttribute('TEXCOORD_1',d.createAccessor().setType('VEC2').setArray(new Float32Array(18).fill(.75)).setBuffer(b)).setMaterial(d.createMaterial().setDoubleSided(true));
 p.setAttribute('TEXCOORD_0',p.getAttribute('TEXCOORD_1').clone());
 scene.addChild(d.createNode('giant').setMesh(d.createMesh().addPrimitive(p)));const source=dir+'/source.glb';await writeFile(source,await new NodeIO().writeBinary(d));
 const i=await sourceInventory(source),partition={schema:'partition-v1',source_sha256:i.source_sha256,policy:'reviewed-rooms',visibility:'conservative',spatial_cell_size:4,rooms:[{id:'room',name:'Room',bounds:i.bounds,node_paths:i.nodes.filter(n=>n.renderable).map(n=>n.path)}],global_node_paths:[],openings:[]};
 const m=await processChunks(source,dir+'/out',{parent_asset_id:'00000000-0000-4000-9000-000000000002',revision:1,source_sha256:i.source_sha256,document:partition});assert.equal(m.chunks.length,2);
 assert.deepEqual(m.chunks[0].surface_map.map(s=>[s.source_triangle_start,s.chunk_triangle_start,s.triangle_count]),[[0,0,1],[2,1,1]]);
 assert.equal(m.chunks.reduce((n,c)=>n+c.triangle_count,0),3);
 const original=(await runtimeInventory(await readFile(source))).orderedGeometry;
 assert.deepEqual((await runtimeInventory(await readFile(dir+'/out/exact/collision.glb'))).orderedGeometry,original);
 const c=await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(dir+'/out/'+m.chunks[0].variants.low.key),primitive=c.getRoot().listMeshes()[0].listPrimitives()[0];assert.equal(primitive.getAttribute('POSITION').getCount(),6);assert.ok(primitive.getAttribute('TEXCOORD_1'));assert.equal(primitive.getMaterial().getDoubleSided(),true);
 assert.ok(m.chunks[0].variants.low.bytes+m.chunks[1].variants.low.bytes>0);
 await assert.rejects(processChunks(source,dir+'/bad',{parent_asset_id:m.parent_asset_id,revision:1,source_sha256:i.source_sha256,document:{...partition,spatial_cell_size:.1}}),/cell size/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

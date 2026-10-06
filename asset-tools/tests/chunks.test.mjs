import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Document, NodeIO } from '@gltf-transform/core';
import { processChunks } from '../chunks.mjs';
import { sourceInventory } from '../inventory.mjs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

test('intact chunks preserve nested transforms, primitive identity, UV1 and independent bytes',async()=>{
 const dir=await mkdtemp(tmpdir()+'/chunks-test-');
 try{
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();
 const parent=doc.createNode('parent').setExtras({__tour_chunk_source:'authored-value'}).setTranslation([5,0,0]);scene.addChild(parent);
 const image=await sharp({create:{width:2,height:2,channels:4,background:{r:30,g:80,b:150,alpha:1}}}).png().toBuffer();
 const texture=doc.createTexture('shared').setImage(image).setMimeType('image/png');
 const material=doc.createMaterial('two-sided').setDoubleSided(true).setBaseColorTexture(texture);
 for(let i=0;i<3;i++){
  const p=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,0,1])).setBuffer(buffer)).setAttribute('TEXCOORD_1',doc.createAccessor().setType('VEC2').setArray(new Float32Array([0,0,1,0,0,1])).setBuffer(buffer)).setMaterial(material);
  p.setAttribute('TEXCOORD_0',p.getAttribute('TEXCOORD_1').clone());
  const mesh=doc.createMesh().addPrimitive(p);
  // Include a multi-primitive node to check runtime group paths.
  if(i===0)mesh.addPrimitive(p.clone().setMaterial(doc.createMaterial('other')));
  parent.addChild(doc.createNode('surface-'+i).setTranslation([i*3,0,0]).setMesh(mesh));
 }
 const source=dir+'/source.glb';
 const bytes=Buffer.from(await new NodeIO().writeBinary(doc)),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length).toString()),nodeCount=json.nodes.length;
 // Deliberately reverse the node table without changing hierarchy semantics.
 json.nodes.reverse();for(const node of json.nodes)if(node.children)node.children=node.children.map(i=>nodeCount-1-i);
 for(const sc of json.scenes)sc.nodes=sc.nodes.map(i=>nodeCount-1-i);
 const jsonBytes=Buffer.from(JSON.stringify(json)),chunk=Buffer.concat([jsonBytes,Buffer.alloc((4-jsonBytes.length%4)%4,32)]),header=Buffer.from(bytes.subarray(0,20));header.writeUInt32LE(chunk.length,12);
 const shuffled=Buffer.concat([header,chunk,bytes.subarray(20+length)]);shuffled.writeUInt32LE(shuffled.length,8);await writeFile(source,shuffled);
 const inventory=await sourceInventory(source),nodes=inventory.nodes.filter(n=>n.renderable);
 const roomNodes=nodes.filter(n=>n.path.startsWith('0/0/0'));
 const partition={schema:'partition-v1',source_sha256:inventory.source_sha256,policy:'reviewed-rooms',visibility:'conservative',rooms:[{id:'a',name:'A',bounds:{min:[4,-1,-1],max:[7,2,2]},node_paths:roomNodes.map(n=>n.path)}],global_node_paths:nodes.filter(n=>!roomNodes.includes(n)).map(n=>n.path),openings:[]};
 const review={parent_asset_id:'00000000-0000-4000-9000-000000000002',revision:3,source_sha256:inventory.source_sha256,document:partition};
 const m=await processChunks(source,dir+'/out',review);
 assert.equal(m.chunks.length,2);
 assert.ok(m.dependencies.length>0);const metrics=JSON.parse(await readFile(dir+'/out/image-metrics.json'));assert.ok(metrics.saved_image_bytes>0);
 const hashes=new Set(m.dependencies.map(d=>d.variants.low.sha256));assert.equal(hashes.size,m.dependencies.length);
 for(const c of m.chunks)for(const p of Object.values(c.variants)){const bytes=await readFile(dir+'/out/'+p.key),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));for(const image of json.images||[])if(image.uri)assert.ok(c.dependencies.includes(image.uri.slice(11)));}
 assert.ok(m.chunks.reduce((sum,c)=>sum+c.variants.low.texture_rgba8_bytes,0)>m.occlusion.payload.texture_rgba8_bytes,'self-contained chunks disclose repeated image residency');assert.equal(m.source_surfaces.length,nodes.length);
 assert.equal(m.chunks.flatMap(c=>c.surface_map).length,nodes.length);
 for(const c of m.chunks)for(const p of Object.values(c.variants)){const bytes=await readFile(dir+'/out/'+p.key);assert.equal(bytes.length,p.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);}
 assert.deepEqual(m.chunks[0].bounds,{min:[5,0,0],max:[6,0,1]});
 assert.equal(m.chunks[0].surface_map[1].source_primitive,1);
 const chunkDoc=await new NodeIO().read(dir+'/out/room-0-source.glb');
 assert.equal(chunkDoc.getRoot().listNodes().find(n=>n.getName()==='parent').getExtras().__tour_chunk_source,'authored-value');
 assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),inventory.source_sha256);
 await assert.rejects(processChunks(source,dir+'/bad',{...review,source_sha256:'a'.repeat(64)}),/identity/);
 await assert.rejects(processChunks(source,dir+'/bad',{...review,document:{...partition,policy:'complete'}}),/fallback/);
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('animated authored room fixture retains complete-original fallback',async()=>{
 const source=new URL('../../tests/testdata/chunking/authored-rooms.glb',import.meta.url).pathname;
 const inventory=await sourceInventory(source);
 assert.ok(inventory.conservative_reasons.length);
 await assert.rejects(processChunks(source,'unused',{source_sha256:inventory.source_sha256,document:{source_sha256:inventory.source_sha256,policy:'reviewed-rooms'}}),/fallback/);
});

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import validator from 'gltf-validator';
import { runtimeInventory } from './process.mjs';

// Remove only exclusive image ranges. Geometry/compression ranges keep their
// exact bytes and offsets; overlapping buffer views conservatively stay embedded.
export async function externalizeImages(output, manifest) {
 const dependencies=new Map(),usage=new Map();let embedded=0,shared=0;
 for(const chunk of manifest.chunks)for(const [tier,payload]of Object.entries(chunk.variants)){
  const bytes=await readFile(`${output}/${payload.key}`),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length);
  for(const image of json.images||[]){if(image.bufferView===undefined)continue;const v=json.bufferViews[image.bufferView];if(v.buffer!==0)continue;const hash=createHash('sha256').update(bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)).digest('hex'),key=`${hash}:${tier}`;if(!usage.has(key))usage.set(key,new Set());usage.get(key).add(chunk.id);}
 }
 const worthSharing=new Set([...usage].filter(([,chunks])=>chunks.size>1).map(([key])=>key.split(':')[0]));
 await mkdir(`${output}/images`,{recursive:true});
 for(const chunk of manifest.chunks){
  const requires=new Set();
  for(const payload of Object.values(chunk.variants)){
   const file=`${output}/${payload.key}`,bytes=await readFile(file),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),start=28+length,bin=bytes.subarray(start),removed=[];
   for(const image of json.images||[]){
    if(image.bufferView===undefined)continue;
    const view=json.bufferViews[image.bufferView],lo=view.byteOffset||0,hi=lo+view.byteLength;
    if((json.images||[]).filter(i=>i.bufferView===image.bufferView).length>1 || view.buffer!==0 || (json.bufferViews||[]).some((v,i)=>i!==image.bufferView&&v.buffer===0&&(v.byteOffset||0)<hi&&(v.byteOffset||0)+v.byteLength>lo) || (json.bufferViews||[]).some(v=>{const e=v.extensions?.EXT_meshopt_compression;return e&&e.buffer===0&&(e.byteOffset||0)<hi&&(e.byteOffset||0)+e.byteLength>lo;}))continue;
    const data=bin.subarray(lo,hi),hash=createHash('sha256').update(data).digest('hex'),id=`image-${hash}`;
    if(!worthSharing.has(hash))continue;
    embedded+=data.length;
    if(!dependencies.has(id)){
     const metadata=await sharp(data).metadata(),p={key:`images/${hash}.bin`,sha256:hash,bytes:data.length,texture_rgba8_bytes:Math.ceil(metadata.width*metadata.height*4*4/3),max_texture:Math.max(metadata.width,metadata.height)};
     await writeFile(`${output}/${p.key}`,data);shared+=data.length;
     dependencies.set(id,{id,kind:'texture',requires:[],source_node_paths:[],source_clip_indices:[],source_skin_indices:[],variants:{low:p,balanced:p,hq:p}});
    }
    image.uri=`tour-image:${id}`;delete image.bufferView;
    // Retain an empty view to avoid renumbering every extension reference.
    view.byteLength=0;removed.push([lo,lo+Math.ceil((hi-lo)/4)*4]);requires.add(id);
   }
   removed.sort((a,b)=>a[0]-b[0]);
   const offset=n=>n-removed.reduce((sum,[lo,hi])=>sum+(hi<=n?hi-lo:0),0);
   for(const v of json.bufferViews||[]){if(v.buffer===0)v.byteOffset=offset(v.byteOffset||0);const e=v.extensions?.EXT_meshopt_compression;if(e?.buffer===0)e.byteOffset=offset(e.byteOffset||0);}
   const parts=[];let cursor=0;for(const [lo,hi]of removed){parts.push(bin.subarray(cursor,lo));cursor=hi;}parts.push(bin.subarray(cursor));const binary=Buffer.concat(parts);json.buffers[0].byteLength=binary.length;
   // Empty placeholder views are legal only when unreferenced. Remove them and
   // remap the core references (images/accessors) and compression views.
   const mapping=new Map(),views=[];for(const [i,v]of json.bufferViews.entries())if(v.byteLength){mapping.set(i,views.length);views.push(v);}json.bufferViews=views;
   for(const a of json.accessors||[]){if(a.bufferView!==undefined)a.bufferView=mapping.get(a.bufferView);if(a.sparse){a.sparse.indices.bufferView=mapping.get(a.sparse.indices.bufferView);a.sparse.values.bufferView=mapping.get(a.sparse.values.bufferView);}}
   for(const image of json.images||[])if(image.bufferView!==undefined)image.bufferView=mapping.get(image.bufferView);
   const text=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),header=Buffer.alloc(20),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+binary.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);
   const result=Buffer.concat([header,padded,bh,binary]);
   const validation=await validator.validateBytes(new Uint8Array(result),{maxIssues:50,externalResourceFunction:async uri=>{if(!uri.startsWith('tour-image:')||!dependencies.has(uri.slice(11)))throw Error('Untrusted runtime resource');return new Uint8Array(await readFile(`${output}/${dependencies.get(uri.slice(11)).variants.low.key}`));}});
   if(validation.issues.numErrors)throw Error(`Shared-image GLB validation failed: ${validation.issues.messages.filter(m=>m.severity===0).map(m=>m.message).join('; ')}`);
   if(JSON.stringify((await runtimeInventory(bytes)).orderedGeometry)!==JSON.stringify((await runtimeInventory(result)).orderedGeometry))throw Error('Shared image extraction changed decoded geometry');
   await writeFile(file,result);payload.bytes=result.length;payload.sha256=createHash('sha256').update(result).digest('hex');
  }
  chunk.dependencies=[...requires];
 }
 manifest.dependencies=[...dependencies.values()];
 return {embedded_image_bytes:embedded,unique_image_bytes:shared,saved_image_bytes:embedded-shared};
}

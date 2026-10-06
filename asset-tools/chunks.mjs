import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import { triangleCells, subsetPrimitive, triangleRuns } from './spatial-split.mjs';
import { externalizeImages } from './shared-images.mjs';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { sourceInventory } from './inventory.mjs';
import { processAsset, runtimeInventory } from './process.mjs';

const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
// Intact static mesh groups retain the complete transform hierarchy. Empty nodes
// preserve authored attachment transforms, while unused resources are pruned.
export async function processChunks(source, output, review) {
 const inventory = await sourceInventory(source), partition = review.document;
 if (inventory.source_sha256 !== review.source_sha256 || partition.source_sha256 !== inventory.source_sha256) throw Error('Reviewed source identity changed');
 if (partition.policy !== 'reviewed-rooms' || inventory.conservative_reasons.length || inventory.dependencies.length) throw Error('Source requires complete-original fallback');
 if (!partition.rooms.length || partition.rooms.length > 128) throw Error('Chunk processing requires 1–128 reviewed rooms');
 const owners = new Map(), nodes = inventory.nodes.filter(n=>n.renderable);
 let groups = [...partition.rooms.map((r,i)=>({id:`room-${i}`,paths:r.node_paths,room:r.id})),{id:'global',paths:partition.global_node_paths}].filter(g=>g.paths.length);
 for(const g of groups) for(const path of g.paths) { if(owners.has(path))throw Error('Duplicate source ownership');owners.set(path,g.id); }
 if(owners.size!==nodes.length || nodes.some(n=>!owners.has(n.path)))throw Error('Incomplete source ownership');
 const sourceDoc = await io.readBinary(await readFile(source));
 // Keep multi-primitive meshes intact. Independently reviewed primitive owners
 // require a future extractor; do not duplicate a shared mesh contribution.
 const meshOwners = new Map();
 for(const n of nodes){if(n.source_node===undefined)throw Error('Unsupported runtime hierarchy');const id=owners.get(n.path);if(meshOwners.has(n.source_node)&&meshOwners.get(n.source_node)!==id)throw Error('Mesh primitives must have one intact owner');meshOwners.set(n.source_node,id);}
 await mkdir(output,{recursive:true});
 const manifest={schema:'streaming-v1',processor_version:'chunks-v1',parent_asset_id:review.parent_asset_id,source_sha256:inventory.source_sha256,partition_revision:review.revision,coordinates:'source-space',partition,source_node_paths:inventory.nodes.map(n=>n.path),source_clip_count:inventory.clip_count,source_skin_count:inventory.skin_count,source_surfaces:nodes.map(n=>({path:n.path,primitive:n.source_primitive??0,triangles:n.triangles,bounds:n.bounds})),global_chunks:groups.filter(g=>!g.room).map(g=>g.id),regions:[],chunks:[],dependencies:[],fallback:'complete-original'};
 // Tag the original glTF node indices before import. A NodeIO rewrite may
 // reorder its node table, so its output indices cannot identify source nodes.
 const sourceBytes=await readFile(source),jsonLength=sourceBytes.readUInt32LE(12);
 const originalJSON=JSON.parse(sourceBytes.subarray(20,20+jsonLength).toString());
 let tagKey='__tour_chunk_source';
 while((originalJSON.nodes||[]).some(n=>Object.hasOwn(n.extras||{},tagKey)))tagKey+='_';
 for(const [i,node] of (originalJSON.nodes||[]).entries())node.extras={...node.extras,[tagKey]:i};
 const jsonBytes=Buffer.from(JSON.stringify(originalJSON)),padding=(4-jsonBytes.length%4)%4;
 const jsonChunk=Buffer.concat([jsonBytes,Buffer.alloc(padding,32)]);
 const header=Buffer.from(sourceBytes.subarray(0,20));header.writeUInt32LE(jsonChunk.length,12);
 const taggedBytes=Buffer.concat([header,jsonChunk,sourceBytes.subarray(20+jsonLength)]);taggedBytes.writeUInt32LE(taggedBytes.length,8);
 const tagged=await io.readBinary(taggedBytes);
 if(partition.spatial_cell_size)groups=triangleCells(tagged,nodes,owners,groups,partition.spatial_cell_size,tagKey);
 manifest.global_chunks=groups.filter(g=>!g.room).map(g=>g.id);
 const fullGeometry = new Map((await runtimeInventory(await readFile(source))).orderedGeometry);
 let totalBytes=0;
 const payload = (v,key)=>({key,sha256:v.sha256,bytes:v.bytes,texture_rgba8_bytes:v.texture_rgba8_bytes??0,max_texture:v.max_texture??0});
 for(const group of groups){
  console.error(`Generating ${group.id} (${group.paths.length} surfaces)`);
  const doc=cloneDocument(tagged);
  for(const node of doc.getRoot().listNodes()){
   const index=node.getExtras()[tagKey];
   node.setExtras(Object.fromEntries(Object.entries(node.getExtras()).filter(([k])=>k!==tagKey)));
   if(group.triangles){const original=node.getMesh();if(!original)continue;const mesh=doc.createMesh(original.getName());for(const source of nodes.filter(n=>n.source_node===index)){const triangles=group.triangles.get(source.path);if(triangles)mesh.addPrimitive(subsetPrimitive(doc,original.listPrimitives()[source.source_primitive??0],triangles));}node.setMesh(mesh.listPrimitives().length?mesh:null);}else if(meshOwners.get(index)!==group.id)node.setMesh(null);
  }
  await doc.transform(prune({keepLeaves:true,keepAttributes:true,keepExtras:true,keepSolidTextures:true}));
  const chunkSource=`${output}/${group.id}-source.glb`, dir=`${output}/${group.id}`;
  await writeFile(chunkSource,await io.writeBinary(doc));
  const local=await sourceInventory(chunkSource);
  const selected=nodes.filter(n=>group.paths.includes(n.path));
  // Retaining the graph allows names/paths to move only where a multi-primitive
  // mesh wrapper disappears. Match each mesh by ordered authored traversal.
  const localSurfaces=local.nodes.filter(n=>n.renderable);
  if(localSurfaces.length!==selected.length)throw Error('Chunk surface count changed');
  const geometry=new Map((await runtimeInventory(await readFile(chunkSource))).orderedGeometry);
  for(let i=0;!group.triangles&&i<selected.length;i++)if(fullGeometry.get(selected[i].path)!==geometry.get(localSurfaces[i].path))throw Error('Chunk world geometry changed');
  const result=await processAsset(chunkSource,dir,{preserveTriangles:true});
  const variants={};for(const [tier,v]of Object.entries(result.variants)){variants[tier]=payload(v,`${group.id}/${v.file}`);totalBytes+=v.bytes;}
  manifest.chunks.push({id:group.id,bounds:result.bounds,primitive_count:selected.length,triangle_count:selected.reduce((sum,n)=>sum+(group.triangles?.get(n.path).length??n.triangles),0),local_to_source:identity,dependencies:[],surface_map:selected.flatMap((n,i)=>{let localStart=0;return (group.triangles?triangleRuns(group.triangles.get(n.path)):[{start:0,count:n.triangles}]).map(run=>{const start=localStart;localStart+=run.count;return ({source_path:n.path,source_primitive:n.source_primitive??0,source_triangle_start:run.start,chunk_path:localSurfaces[i].path,chunk_primitive:localSurfaces[i].source_primitive??0,chunk_triangle_start:start,triangle_count:run.count});});}),variants});
  if(totalBytes>1024**3)throw Error('Chunk products exceed the 1 GiB aggregate output limit');
 }
 // Full exact indexes count toward startup bytes. Occlusion retains authored
 // materials and sidedness; the material-stripped navigation proxy cannot do so.
 const exact=await processAsset(source,`${output}/exact`,{preserveTriangles:true});
 manifest.navigation={payload:payload(exact.collision,'exact/collision.glb'),strategy:'verified-exact-geometry',floor_source_paths:nodes.map(n=>n.path),authored_semantics:'authored-only-floors'};
 let textureBytes=0,maxTexture=0;
 for(const texture of sourceDoc.getRoot().listTextures()){const metadata=await sharp(texture.getImage()).metadata();textureBytes+=Math.ceil(metadata.width*metadata.height*4*4/3);maxTexture=Math.max(maxTexture,metadata.width,metadata.height);}
 await writeFile(`${output}/exact/occlusion.glb`,await readFile(source));
 manifest.occlusion={payload:{key:'exact/occlusion.glb',sha256:inventory.source_sha256,bytes:inventory.source_bytes,texture_rgba8_bytes:textureBytes,max_texture:maxTexture},strategy:'verified-authored-occluders',floor_source_paths:[],authored_semantics:'authored-material-visibility-sidedness'};
 for(const room of partition.rooms){const chunks=groups.filter(g=>g.room===room.id).map(g=>g.id),display=[...chunks,...manifest.global_chunks];manifest.regions.push({id:room.id,chunks,display_requires:display,movement_requires:[...display,'navigation','occlusion']});}
 totalBytes+=manifest.navigation.payload.bytes+manifest.occlusion.payload.bytes;
 const imageMetrics=await externalizeImages(output,manifest);
 await writeFile(`${output}/image-metrics.json`,JSON.stringify(imageMetrics));
 totalBytes=manifest.chunks.reduce((sum,c)=>sum+Object.values(c.variants).reduce((n,p)=>n+p.bytes,0),0)+manifest.navigation.payload.bytes+manifest.occlusion.payload.bytes+manifest.dependencies.reduce((n,d)=>n+d.variants.low.bytes,0);
 const json=JSON.stringify(manifest);if(totalBytes>1024**3 || Buffer.byteLength(json)>4*1024**2 || manifest.chunks.length*3+manifest.dependencies.length+2>512)throw Error('Chunk output limits exceeded');
 await writeFile(`${output}/manifest.json`,json);
 return manifest;
}

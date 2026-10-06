import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'meshoptimizer';
import {Box3,Mesh,Texture} from 'three';
export async function sourceInventory(file){
 const bytes=await readFile(file);
 if(bytes.length>256*1024**2)throw Error('Source exceeds 256 MiB inspection limit; complete original remains available');
 if(bytes.length<20||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Expected a complete GLB 2.0');
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 if([...json.buffers||[],...json.images||[]].some(r=>r.uri&&!r.uri.startsWith('data:')))throw Error('External resources cannot be inventoried');
 if((json.extensionsUsed||[]).includes('KHR_draco_mesh_compression'))throw Error('Draco geometry needs an uncompressed or Meshopt source for inspection');
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 loader.register(parser=>({name:'TOUR_source_inventory',beforeRoot(){
  const get=parser.getDependency.bind(parser),textures=new Map();
  parser.getDependency=(type,index)=>{if(type!=='texture')return get(type,index);if(!textures.has(index))textures.set(index,Promise.resolve(new Texture()));return textures.get(index);};
 }}));
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 gltf.scene.updateMatrixWorld(true);
 const nodes=[],reasons=[];
 if((json.skins||[]).length)reasons.push('Skin joints require the complete authored hierarchy');
 if(gltf.animations.length)reasons.push('Animation clips require the complete authored hierarchy');
 const bounds=box=>box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()};
 function imagesFor(mesh){
  const images=new Set(),association=gltf.parser.associations.get(mesh);
  const primitive=json.meshes?.[association?.meshes]?.primitives?.[association?.primitives??0];
  function scan(value){if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){if((key.endsWith('Texture')||key==='texture')&&Number.isInteger(v?.index)){
   const t=json.textures?.[v.index],index=t?.source??t?.extensions?.KHR_texture_basisu?.source??t?.extensions?.EXT_texture_webp?.source??t?.extensions?.EXT_texture_avif?.source;if(Number.isInteger(index))images.add(index);
  }else scan(v);}}
  scan(json.materials?.[primitive?.material]);
  return [...images].reduce((sum,i)=>{const image=json.images?.[i];let size=json.bufferViews?.[image?.bufferView]?.byteLength||0;if(image?.uri?.startsWith('data:')){const comma=image.uri.indexOf(',');const data=image.uri.slice(comma+1);size=image.uri.slice(0,comma).endsWith(';base64')?Buffer.from(data,'base64').length:Buffer.byteLength(data.replace(/%[a-f0-9]{2}/gi,'_'));}return sum+size;},0);
 }
 function visit(object,path,parent,sourceNode){
  if(nodes.length>=10000)throw Error('Source hierarchy exceeds 10000 inspector records; complete original remains available');
  const association=gltf.parser.associations.get(object),mesh=object instanceof Mesh;
  sourceNode=association?.nodes??sourceNode;
  if(mesh&&object.isSkinnedMesh&&!reasons.includes('Skin joints require the complete authored hierarchy'))reasons.push('Skin joints require the complete authored hierarchy');
  if(mesh&&object.morphTargetInfluences?.length&&!reasons.includes('Morph targets require the complete authored hierarchy'))reasons.push('Morph targets require the complete authored hierarchy');
  if(mesh&&object.isInstancedMesh&&!reasons.includes('Instancing requires conservative complete-source ownership'))reasons.push('Instancing requires conservative complete-source ownership');
  if(object.geometry&&!mesh)reasons.push('Non-mesh authored contributors require complete-source ownership');
  if(object.isLight)reasons.push('Authored lights require the complete source hierarchy');
  const geometry=mesh?object.geometry:null;
  if(geometry&&(geometry.index?.count||geometry.getAttribute('position')?.count||0)%3)reasons.push('Non-triangle geometry requires complete-source ownership');
  nodes.push({path,name:object.name||object.type,...parent?{parent}:{},...sourceNode!==undefined?{source_node:sourceNode}:{},...association?.primitives!==undefined?{source_primitive:association.primitives}:{},bounds:bounds(new Box3().setFromObject(object)),matrix:object.matrixWorld.toArray(),renderable:mesh,triangles:geometry?Math.floor((geometry.index?.count||geometry.getAttribute('position')?.count||0)/3):0,geometry_bytes:geometry?Object.values(geometry.attributes).reduce((sum,a)=>sum+a.array.byteLength,geometry.index?.array.byteLength||0):0,embedded_image_bytes:mesh?imagesFor(object):0});
  object.children.forEach((child,i)=>visit(child,path+'/'+i,path,sourceNode));
 }
 visit(gltf.scene,'0');
 if(!nodes.some(n=>n.renderable)||!bounds(new Box3().setFromObject(gltf.scene)))throw Error('Source has no supported mesh bounds');
 // Until verified dependency extraction exists, any animation/skin/morph uncertainty
 // pins the complete source once. We never infer separability from node names.
 const dependencies=reasons.length?[{id:'authored-hierarchy',kind:'authored-hierarchy',node_paths:nodes.filter(n=>n.renderable).map(n=>n.path)}]:[];
 if(reasons.length)for(const n of nodes)if(n.renderable)n.dependency_group='authored-hierarchy';
 return {clip_count:(json.animations||[]).length,skin_count:(json.skins||[]).length,schema:'source-inventory-v1',coordinates:'source-space',source_sha256:createHash('sha256').update(bytes).digest('hex'),source_bytes:bytes.length,bounds:bounds(new Box3().setFromObject(gltf.scene)),nodes,dependencies,conservative_reasons:[...new Set(reasons)]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await writeFile(process.argv[3],JSON.stringify(await sourceInventory(process.argv[2])));}catch(error){console.error(error.message);process.exitCode=1;}
}

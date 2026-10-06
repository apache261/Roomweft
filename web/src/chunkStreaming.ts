import { Box3, Camera, Frustum, Matrix4, Vector3, type Object3D } from 'three';
import { registerSourceSurfacePath } from './materials.ts';
import { validateDeliveredChunkManifest, type ChunkManifest, type DeliveredPayload } from './chunkingContracts.ts';
import { visibleRooms, type VisibilityRoom, type VisibilityOpening } from './roomVisibility.ts';
import type { QualityTier } from './viewerQuality.ts';

export type StreamingManifest = ChunkManifest<DeliveredPayload>;
export function scopedEndpoint(endpoint:string){return endpoint.startsWith('/api/')?endpoint:endpoint.startsWith('/')?`/api/v1${endpoint}`:endpoint;}
export function descriptorEndpoint(url:string,parentEndpoint:string){
 const parent=new URL(scopedEndpoint(parentEndpoint),globalThis.location?.origin||'http://localhost');
 const target=new URL(url,parent);
 if(!target.pathname.startsWith(parent.pathname+'/')||!['http:','https:'].includes(target.protocol)||target.username||target.password||target.hash)throw Error('Chunk descriptor escaped parent scope');
 // Preserve the browser-facing origin when the API sits behind the Vite/proxy origin.
 return new URL(target.pathname+target.search,parent.origin).href;
}
export async function fetchStreamingManifest(endpoint:string,url:string,parent:string):Promise<StreamingManifest>{
 const response=await fetch(descriptorEndpoint(url,endpoint));if(!response.ok)throw Error('Chunk manifest unavailable');
 const body=await response.json();if(body.delivery!=='scoped-descriptors')throw Error('Unsupported chunk delivery');
 validateDeliveredChunkManifest(body.manifest);const m:StreamingManifest=body.manifest;
 if(m.parent_asset_id!==parent||m.partition.policy!=='reviewed-rooms'||m.dependencies.some(d=>d.kind!=='texture'||d.requires.length)||m.source_clip_count||m.source_skin_count)throw Error('Unsupported chunk source; use complete original');
 for(const p of [m.navigation.payload,m.occlusion.payload,...m.dependencies.flatMap(d=>Object.values(d.variants)),...m.chunks.flatMap((c:StreamingManifest['chunks'][number])=>Object.values(c.variants))])descriptorEndpoint(p.url,endpoint);
 return m;
}
export function chunkTier(m:StreamingManifest,tier:QualityTier,maxTexture:number):QualityTier{
 const choices:QualityTier[]=tier==='hq'?['hq','balanced','low']:tier==='balanced'?['balanced','low']:['low'];
 const chosen=choices.find(t=>m.chunks.every(c=>c.variants[t].max_texture<=maxTexture));if(!chosen)throw Error('Chunk textures exceed renderer capabilities');
 if(m.occlusion.payload.max_texture>maxTexture)throw Error('Exact authored occlusion exceeds renderer capabilities');return chosen;
}
export function chunkMetadata(m:StreamingManifest,transform:Matrix4){
 const rooms:VisibilityRoom[]=m.partition.rooms.map(r=>({id:r.id,box:new Box3(new Vector3(...r.bounds.min),new Vector3(...r.bounds.max)).applyMatrix4(transform)}));
 const openings:VisibilityOpening[]=m.partition.openings.filter(o=>o.to!==null).map(o=>({a:o.from,b:o.to!,vertices:o.corners.map(v=>new Vector3(...v).applyMatrix4(transform))}));
 // Exterior views and uncertain openings require conservative frustum selection.
 return {rooms,openings,conservative:m.partition.visibility!=='reviewed-openings'||m.partition.openings.some(o=>o.to===null)};
}
export function startingChunks(m:StreamingManifest,position:Vector3,transform:Matrix4,eyeHeight=1.65){
 const capsule=new Box3(new Vector3(position.x-.3,position.y-eyeHeight,position.z-.3),new Vector3(position.x+.3,position.y+.1,position.z+.3)).applyMatrix4(transform.clone().invert());
 const rooms=m.partition.rooms.filter(r=>capsule.intersectsBox(new Box3(new Vector3(...r.bounds.min),new Vector3(...r.bounds.max))));
 const selected=new Set([...m.global_chunks,...(rooms.length?m.regions.filter(r=>rooms.some(room=>room.id===r.id)):m.regions).flatMap(r=>r.display_requires)]);
 if(!m.partition.spatial_cell_size||!rooms.length)return selected;
 return new Set(m.chunks.filter(c=>selected.has(c.id)&&capsule.clone().expandByScalar(1).intersectsBox(new Box3(new Vector3(...c.bounds.min),new Vector3(...c.bounds.max)))).map(c=>c.id));
}
export type ChunkSelection={pinned:Set<string>;movement:Set<string>;visible:Set<string>;prefetch:Set<string>;priority:string[];wanted:Set<string>};
export function planChunks(m:StreamingManifest,camera:Camera,transform:Matrix4,options:{inspection?:boolean;shadows?:boolean;velocity?:Vector3;latency?:number}={}):ChunkSelection{
 const metadata=chunkMetadata(m,transform),eye=new Vector3().setFromMatrixPosition(camera.matrixWorld),frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const inverse=transform.clone().invert(),localEye=eye.clone().applyMatrix4(inverse),scale=Math.min(...new Vector3().setFromMatrixScale(transform).toArray().map(Math.abs));
 const localMetadata=chunkMetadata(m,new Matrix4());
 const occupied=new Set(localMetadata.rooms.filter(r=>r.box.clone().expandByScalar(.3/scale).containsPoint(localEye)).map(r=>r.id));
 const parentBox=metadata.rooms.reduce((box,r)=>box.union(r.box),new Box3());
 let visible:Set<string>;
 if(options.inspection||options.shadows)visible=new Set(metadata.rooms.map(r=>r.id));
 else if(!metadata.conservative&&occupied.size) {const localCamera=camera.clone();localCamera.matrixWorld.multiplyMatrices(inverse,camera.matrixWorld);localCamera.matrixWorldInverse.copy(localCamera.matrixWorld).invert();visible=visibleRooms(localCamera,localMetadata.rooms,localMetadata.openings);}
 else if(parentBox.containsPoint(eye)&&!occupied.size)visible=new Set(metadata.rooms.map(r=>r.id));
 else visible=new Set(metadata.rooms.filter(r=>frustum.intersectsBox(r.box)).map(r=>r.id));
 const movement=new Set(occupied),prefetch=new Set<string>();
 // An immediate doorway ring loads independently of look direction. Windows
 // convey visibility only; they do not imply walking permission.
 for(const opening of m.partition.openings)if(opening.kind==='doorway'&&opening.to&&(occupied.has(opening.from)||occupied.has(opening.to))){movement.add(opening.from);movement.add(opening.to);}
 const distance=Math.min(4,Math.max(.5,(options.velocity?.length()||0)*Math.min(2,Math.max(.25,options.latency||.5))));
 const ahead=eye.clone().addScaledVector(options.velocity?.clone().normalize()||new Vector3(),distance);
 const sweep=new Box3().setFromPoints([eye,ahead]).expandByScalar(.4);
 for(const r of metadata.rooms)if(r.box.intersectsBox(sweep)&&!movement.has(r.id))prefetch.add(r.id);
 // No reviewed adjacency is invented for conservative room metadata.
 for(const p of metadata.openings)if(visible.has(p.a)||visible.has(p.b)){if(!movement.has(p.a))prefetch.add(p.a);if(!movement.has(p.b))prefetch.add(p.b);}
 const chunks=(ids:Set<string>)=>new Set(m.regions.filter(r=>ids.has(r.id)).flatMap(r=>r.display_requires));
 const pin=new Set(m.partition.spatial_cell_size?[]:m.global_chunks),move=chunks(movement),view=chunks(visible),future=chunks(prefetch);
 if(m.partition.spatial_cell_size){
  const doorwayHalos=m.partition.openings.filter(o=>o.kind==='doorway'&&o.to&&(occupied.has(o.from)||occupied.has(o.to))).map(o=>new Box3().setFromPoints(o.corners.map(v=>new Vector3(...v).applyMatrix4(transform))).expandByScalar(.6));
  const full=options.inspection||options.shadows,halo=new Box3(eye.clone().add(new Vector3(-1,-2,-1)),eye.clone().add(new Vector3(1,1,1)));
  for(const c of m.chunks){const box=new Box3(new Vector3(...c.bounds.min),new Vector3(...c.bounds.max)).applyMatrix4(transform);
   if(halo.intersectsBox(box)||doorwayHalos.some(halo=>halo.intersectsBox(box)))move.add(c.id);else move.delete(c.id);
   if(full||frustum.intersectsBox(box))view.add(c.id);else view.delete(c.id);
   if(sweep.intersectsBox(box))future.add(c.id);else future.delete(c.id);
  }
 }
 const priority=[...new Set([...pin,...move,...view])],wanted=new Set([...priority,...future]);
 return {pinned:pin,movement:move,visible:view,prefetch:future,priority,wanted};
}
const admissionInventory=new WeakMap<StreamingManifest,{sourceBounds:Box3;rooms:{id:string;box:Box3}[]}>();
const inverseTransforms=new WeakMap<Matrix4,{source:Matrix4;inverse:Matrix4}>();
// Test the capsule footprint in source space. World axis-aligned bounds alone
// must not certify readiness after a rotated/scaled model placement.
export function admitsChunks(m:StreamingManifest,position:Vector3,transform:Matrix4,ready:ReadonlySet<string>,radius:number,eyeHeight:number,allowOutside=false){
 let inventory=admissionInventory.get(m);if(!inventory){inventory={sourceBounds:m.source_surfaces.reduce((box,s)=>box.union(new Box3(new Vector3(...s.bounds.min),new Vector3(...s.bounds.max))),new Box3()),rooms:m.partition.rooms.map(r=>({id:r.id,box:new Box3(new Vector3(...r.bounds.min),new Vector3(...r.bounds.max))}))};admissionInventory.set(m,inventory);}
 let inverse=inverseTransforms.get(transform);if(!inverse||!inverse.source.equals(transform)){inverse={source:transform.clone(),inverse:transform.clone().invert()};inverseTransforms.set(transform,inverse);}
 const capsule=new Box3(new Vector3(position.x-radius,position.y-eyeHeight,position.z-radius),new Vector3(position.x+radius,position.y+.1,position.z+radius)).applyMatrix4(inverse.inverse);
 if(allowOutside&&!capsule.intersectsBox(inventory.sourceBounds))return true;
 const touched=inventory.rooms.filter(r=>capsule.intersectsBox(r.box));
 const regions=touched.length?m.regions.filter(r=>touched.some(room=>room.id===r.id)):m.regions;
 if(m.partition.spatial_cell_size&&touched.length){return ready.has('navigation')&&ready.has('occlusion')&&m.chunks.filter(c=>capsule.clone().expandByScalar(.1).intersectsBox(new Box3(new Vector3(...c.bounds.min),new Vector3(...c.bounds.max)))).every(c=>ready.has(c.id));}
 return [...m.global_chunks,...regions.flatMap(r=>r.movement_requires)].every(id=>ready.has(id));
}
export function mapChunkSurfaces(root:Object3D,chunk:StreamingManifest['chunks'][number]){
 const mappings=new Map<string,typeof chunk.surface_map>();for(const s of chunk.surface_map){const list=mappings.get(s.chunk_path)||[];list.push(s);mappings.set(s.chunk_path,list);}let found=0;
 const visit=(object:Object3D,path:string)=>{if('isMesh' in object&&object.isMesh){const ranges=mappings.get(path);if(!ranges?.length)throw Error('Decoded chunk lacks source mapping');const mesh=object as import('three').Mesh,count=(mesh.geometry.index?.count||mesh.geometry.getAttribute('position')?.count||0)/3;const ordered=[...ranges].sort((a,b)=>a.chunk_triangle_start-b.chunk_triangle_start);let end=0;for(const s of ordered){if(s.chunk_triangle_start!==end||s.source_path!==ordered[0].source_path)throw Error('Invalid split triangle mapping');end+=s.triangle_count;}if(end!==count)throw Error('Decoded triangle inventory changed');registerSourceSurfacePath(object,ordered[0].source_path);object.userData.materialPath=ordered[0].source_path;object.userData.sourceTriangleRanges=ordered;found++;}object.children.forEach((child,i)=>visit(child,`${path}/${i}`));};visit(root,'0');
 if(found!==chunk.primitive_count)throw Error('Decoded chunk inventory differs from manifest');
}

export function validateChunkContainer(bytes:ArrayBuffer,allowedImages:ReadonlySet<string>=new Set()){
 const view=new DataView(bytes);if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw Error('Invalid chunk GLB container');
 const length=view.getUint32(12,true);if(length>bytes.byteLength-20)throw Error('Invalid chunk GLB JSON');
 const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
 if((json.buffers||[]).some((r:{uri?:string})=>r.uri&&!r.uri.startsWith('data:'))||(json.images||[]).some((r:{uri?:string})=>r.uri&&!r.uri.startsWith('data:')&&!allowedImages.has(r.uri)))throw Error('External chunk resources are unsupported');
 return json;
}

import { Texture, Mesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DeliveredPayload } from './chunkingContracts';

// Encoded bytes and compatible sampler objects have independent ownership.
const images=new Map<string,{owners:number;promise:Promise<string>;controller:AbortController}>();
const samplers=new Map<string,{owners:number;texture:Texture}>();
const modelSamplers=new WeakMap<GLTF,Set<string>>();
export function leaseChunkImage(scope:string,p:DeliveredPayload,load:(signal:AbortSignal)=>Promise<ArrayBuffer>){
 const key=`${scope}:${p.sha256}`;let entry=images.get(key);
 if(!entry){const controller=new AbortController();entry={owners:0,controller,promise:load(controller.signal).then(bytes=>URL.createObjectURL(new Blob([bytes])))};images.set(key,entry);}
 entry.owners++;let released=false;const current=entry;
 return {promise:entry.promise,release:()=>{if(released)return;released=true;if(--current.owners===0){images.delete(key);current.controller.abort();void current.promise.then(url=>URL.revokeObjectURL(url),()=>{});}}};
}
export function shareChunkSamplers(model:GLTF,scope:string,urls:Map<string,string>){
 const retained=new Set<string>(),discarded=new Set<Texture>();
 model.scene.traverse(object=>{if(!(object instanceof Mesh))return;for(const material of Array.isArray(object.material)?object.material:[object.material])for(const [slot,value]of Object.entries(material)){
  if(!(value instanceof Texture))continue;
  const association=model.parser.associations.get(value),index=association?.textures;
  const texture=index===undefined?undefined:model.parser.json.textures[index],image=texture&&model.parser.json.images[texture.source??texture.extensions?.KHR_texture_basisu?.source];
  const hash=image&&urls.get(image.uri);if(!hash)continue;
  const key=JSON.stringify([scope,hash,value.colorSpace,value.channel,value.wrapS,value.wrapT,value.magFilter,value.minFilter,value.anisotropy,value.flipY,value.premultiplyAlpha,value.unpackAlignment,value.generateMipmaps,value.mapping,value.format,value.type,value.offset.toArray(),value.repeat.toArray(),value.center.toArray(),value.rotation,value.matrixAutoUpdate,value.matrix.toArray()]);
  let shared=samplers.get(key);if(!shared){shared={owners:0,texture:value};samplers.set(key,shared);}
  if(!retained.has(key)){shared.owners++;retained.add(key);}
  if(value!==shared.texture){(material as unknown as Record<string,unknown>)[slot]=shared.texture;discarded.add(value);}
 }});
 discarded.forEach(t=>t.dispose());modelSamplers.set(model,retained);
}
export function releaseChunkSamplers(model:GLTF):Set<Texture>{
 const shared=new Set<Texture>();for(const key of modelSamplers.get(model)||[]){const entry=samplers.get(key);if(!entry)continue;shared.add(entry.texture);if(--entry.owners===0){samplers.delete(key);entry.texture.dispose();}}
 modelSamplers.delete(model);return shared;
}
export function sharedChunkImageStats(){return {images:images.size,imageOwners:[...images.values()].reduce((n,e)=>n+e.owners,0),samplers:samplers.size,samplerOwners:[...samplers.values()].reduce((n,e)=>n+e.owners,0)};}

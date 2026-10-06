import { Group, type WebGLRenderer, type Object3D } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readModel, registerChunkPayload, resolveAssetSource, retainModels, retainAssetSource, type ModelEntry } from './runtimeAssetCache.ts';
import { fetchStreamingManifest, chunkTier, type StreamingManifest } from './chunkStreaming.ts';
import { copySourceSurfacePaths } from './materials.ts';
import { RoomChunkCache } from './roomStreaming.ts';
import { assetLoadMeasurement } from './performanceMetrics.ts';

export class ChunkStreamSession {
 readonly manifests=new Map<string,StreamingManifest>();
 readonly committed=new Set<string>();
 readonly visible=new Set<string>();
 private transitions=new Map<string,number>();private readyByParent=new Map<string,Set<string>>();private admittedRegions=new Set<string>();private requested=new Set<string>();
 readonly events=new Map<string,ReturnType<typeof assetLoadMeasurement>>();
 readonly cache:RoomChunkCache<GLTF>;
 private modelEntries=new Map<string,ModelEntry>();
 private releases:(()=>void)[]=[];private waiters:(()=>void)[]=[];private disposed=false;
 private tiers=new Map<string,import('./viewerQuality.ts').QualityTier>();
 latency=.5;
 readonly urls:Record<string,string>;readonly renderer:WebGLRenderer;
 constructor(urls:Record<string,string>,renderer:WebGLRenderer,changed:()=>void){
  this.urls=urls;this.renderer=renderer;
  this.cache=new RoomChunkCache(id=>{
   const [parent,payload]=id.split('/'),manifest=this.manifests.get(parent),key=manifest?registerChunkPayload(resolveAssetSource(urls[parent])!.endpoint,manifest,payload,this.tiers.get(parent)!):urls[parent];
   const event=assetLoadMeasurement(manifest?'chunk':'room-asset');this.events.set(id,event);event('requested');const started=performance.now();
   const entry=readModel(key,renderer);this.modelEntries.set(id,entry);return {promise:entry.promise.then(model=>{this.latency=Math.min(2,Math.max(.25,.8*this.latency+.2*(performance.now()-started)/1000));event('decoded-resource-ready');event('dependencies-ready');return model;}),release:retainModels([entry],renderer)};
  },()=>{for(const id of this.modelEntries.keys())if(!this.cache.entries.has(id))this.modelEntries.delete(id);this.waiters.forEach(f=>f());if(!this.disposed)changed();},12,2,2000);
 }
 async initialize(){
  for(const key of Object.values(this.urls))this.releases.push(retainAssetSource(key));
  const entries=Object.entries(this.urls);
  // Bound manifest requests too; parent counts must not fan out at startup.
  for(let i=0;i<entries.length;i+=2)await Promise.all(entries.slice(i,i+2).map(async([id,key])=>{
   const source=resolveAssetSource(key),advertisement=source?.response.streaming;
   if(advertisement?.state==='ready'&&advertisement.manifest_url){const manifest=await fetchStreamingManifest(source!.endpoint,advertisement.manifest_url,id);this.tiers.set(id,chunkTier(manifest,source!.tier,this.renderer.capabilities.maxTextureSize));this.manifests.set(id,manifest);}
  }));
  if(this.disposed)throw Error('Streaming session cancelled');
  await this.requestAndWait(this.exactIDs());
 }
 exactIDs(){return Object.keys(this.urls).flatMap(id=>this.manifests.has(id)?[`${id}/navigation`,`${id}/occlusion`]:[`${id}/complete`]);}
 request(ids:Iterable<string>,priority:Iterable<string>=ids){this.requested=new Set(ids);const wanted=[...new Set([...this.exactIDs(),...this.transitions.keys(),...this.requested])];this.cache.request(wanted,[...this.exactIDs(),...this.transitions.keys(),...priority]);}
 async requestAndWait(ids:string[]){this.request([...this.requested,...ids],ids);await new Promise<void>((resolve,reject)=>{
  const check=()=>{if(this.disposed){remove();reject(Error('Streaming session cancelled'));return;}const failed=ids.find(id=>this.cache.entries.get(id)?.status==='failed');if(failed){remove();reject(Error(this.cache.entries.get(failed)?.error||'Chunk failed'));return;}if(ids.every(id=>this.cache.entries.get(id)?.status==='ready')){remove();resolve();}};
  const remove=()=>{this.waiters=this.waiters.filter(f=>f!==check);};this.waiters.push(check);check();
 });}
 exactSources(kind:'navigation'|'occlusion'){return new Map(Object.keys(this.urls).map(id=>[id,this.cache.entries.get(`${id}/${this.manifests.has(id)?kind:'complete'}`)!.value!]));}
 visualSources():Map<string,Object3D>{
  const result=new Map<string,Object3D>();
  for(const id of Object.keys(this.urls)){const m=this.manifests.get(id);if(!m){const value=this.cache.entries.get(`${id}/complete`)?.value;if(value)result.set(id,value.scene);continue;}
   const root=new Group();root.userData.runtimeGeometryRevision=`${m.parent_asset_id}:${m.source_sha256}:${m.partition_revision}`;
   for(const c of m.chunks){const value=this.cache.entries.get(`${id}/${c.id}`)?.value;if(!value)continue;const group=new Group();group.matrixAutoUpdate=false;group.matrix.fromArray(c.local_to_source);group.userData.roomIds=[`${id}/${c.id}`];const copy=value.scene.clone(true);copySourceSurfacePaths(value.scene,copy);copy.traverse(object=>{object.userData.roomIds=[`${id}/${c.id}`];});group.add(copy);root.add(group);}
   result.set(id,root);
  }return result;
 }
 async ensureCommitted(ids:string[]){
  ids.forEach(id=>this.transitions.set(id,(this.transitions.get(id)||0)+1));
  try{await this.requestAndWait(ids);await new Promise<void>((resolve,reject)=>{const check=()=>{if(this.disposed){remove();reject(Error('Streaming session cancelled'));}else if(ids.every(id=>this.committed.has(id))){remove();resolve();}};const remove=()=>{this.waiters=this.waiters.filter(f=>f!==check);};this.waiters.push(check);check();});}finally{ids.forEach(id=>{const count=(this.transitions.get(id)||1)-1;if(count)this.transitions.set(id,count);else this.transitions.delete(id);});}
 }
 retainVisuals(){return retainModels([...this.cache.entries].filter(([,e])=>e.status==='ready').map(([id])=>this.modelEntries.get(id)!),this.renderer);}
 commit(){
  const resident=new Set([...this.cache.entries].filter(([,e])=>e.status==='ready').map(([id])=>id));
  for(const id of [...this.committed])if(!resident.has(id)){this.committed.delete(id);const [parent,payload]=id.split('/');this.readyByParent.get(parent)?.delete(payload);}
  for(const id of resident)if(!this.committed.has(id)){this.committed.add(id);const [parent,payload]=id.split('/');let ready=this.readyByParent.get(parent);if(!ready){ready=new Set();this.readyByParent.set(parent,ready);}ready.add(payload);this.events.get(id)?.('visuals-committed');}
  for(const [parent,m]of this.manifests)for(const region of m.regions){const key=`${parent}/${region.id}`,ready=this.ready(parent);if(region.movement_requires.every(id=>ready.has(id))){if(!this.admittedRegions.has(key)){this.admittedRegions.add(key);region.chunks.forEach(id=>this.events.get(`${parent}/${id}`)?.('movement-admitted'));}}else this.admittedRegions.delete(key);}
  this.waiters.forEach(f=>f());
 }
 ready(parent:string){return this.readyByParent.get(parent)||new Set<string>();}
 dispose(){if(this.disposed)return;this.disposed=true;this.cache.dispose();this.releases.forEach(f=>f());this.waiters.forEach(f=>f());this.modelEntries.clear();this.events.clear();}
}

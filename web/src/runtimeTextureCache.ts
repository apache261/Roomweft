import { TextureLoader, type Texture, type WebGLRenderer } from 'three';
import { resolveAssetSource, verifiedBytes, supportedVariant, retainAssetSource } from './runtimeAssetCache.ts';
type Entry={key:string;assetKey:string;promise:Promise<Texture>;texture?:Texture;owners:number;touched:number;bytes:number};
const entries=new Map<string,Entry>();const MAX_ENTRIES=24,MAX_BYTES=256*1024**2,GRACE_MS=30_000;
let timer:ReturnType<typeof setTimeout>|undefined;
async function load(key:string,renderer:WebGLRenderer){
 const source=resolveAssetSource(key),loader=new TextureLoader();if(!source)return loader.loadAsync(key);
 const manifest=source.response.runtime?.state==='ready'?source.response.runtime.manifest:undefined;
 const variant=manifest&&supportedVariant(manifest,source.tier,renderer);
 if(variant?.url&&((variant.bytes||0)<=(manifest?.source_bytes||Infinity)||(variant.max_texture||0)<(manifest?.source_max_texture||Infinity))){
  let blobURL='';try{const bytes=await verifiedBytes(variant);blobURL=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));return await loader.loadAsync(blobURL);}catch{/* Original is the safe fallback. */}finally{if(blobURL)URL.revokeObjectURL(blobURL);}
 }
 try{return await loader.loadAsync(source.response.url);}catch(error){const r=await fetch(source.endpoint.startsWith('/')&&!source.endpoint.startsWith('/api/')?`/api/v1${source.endpoint}`:source.endpoint);if(!r.ok)throw error;const response=await r.json();if(!response.url)throw error;source.response=response;return loader.loadAsync(response.url);}
}
export function readTexture(key:string,renderer:WebGLRenderer):Entry{
 // PNG/JPEG/WebP pixels are renderer-independent; caps affect variant choice.
 const cacheKey=`${key}:${renderer.capabilities.maxTextureSize}`;let entry=entries.get(cacheKey);
 if(!entry){entry={key:cacheKey,assetKey:key,promise:null!,owners:0,touched:Date.now(),bytes:0};entries.set(cacheKey,entry);const current=entry;entry.promise=load(key,renderer).then(texture=>{current.texture=texture;current.touched=Date.now();const image=texture.image;current.bytes=(image?.width||0)*(image?.height||0)*4*4/3;schedule();return texture;},error=>{entries.delete(cacheKey);throw error;});}
 entry.touched=Date.now();return entry;
}
function prune(){let bytes=[...entries.values()].reduce((sum,e)=>sum+e.bytes,0);for(const e of [...entries.values()].filter(e=>e.texture&&!e.owners&&Date.now()-e.touched>=GRACE_MS).sort((a,b)=>a.touched-b.touched)){if(entries.size<=MAX_ENTRIES&&bytes<=MAX_BYTES)break;entries.delete(e.key);bytes-=e.bytes;e.texture!.dispose();}}
function schedule(){if(timer)clearTimeout(timer);timer=setTimeout(prune,GRACE_MS+10);(timer as unknown as {unref?:()=>void}).unref?.();}
export function retainTextures(list:Entry[]){const leases=list.map(e=>retainAssetSource(e.assetKey));list.forEach(e=>e.owners++);return()=>{leases.forEach(release=>release());list.forEach(e=>{e.owners--;e.touched=Date.now();});schedule();};}

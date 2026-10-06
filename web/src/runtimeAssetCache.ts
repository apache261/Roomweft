import { Mesh, Texture, type Object3D, type WebGLRenderer } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { registerCollisionSource, registerGeometryIdentity } from './collisionGeometry.ts';
import { PreparedGLTFLoader, disposeAssetDecoders } from './PreparedGLTFLoader.ts';
import type { QualityTier } from './viewerQuality.ts';

export type RuntimeVariant = { url: string; sha256: string; bytes: number; texture_rgba8_bytes: number; max_texture: number };
export type AssetResponse = { url: string; runtime?: { state: string; error?: string; manifest?: {
 version: string; source_sha256: string; source_bytes?: number; source_max_texture?:number; variants: Record<QualityTier, RuntimeVariant>;
 collision?: { url: string; sha256: string; bytes?:number; strategy: string; floor_approval: string };
} } };
type Source = { response: AssetResponse; endpoint: string; id: string; tier: QualityTier; registeredAt:number };
const sources = new Map<string, Source>();
const sourceOwners = new Map<string,number>();
const collisionScenes = new WeakMap<Object3D, Object3D>();
export function collisionScene(source: Object3D) { return collisionScenes.get(source); }
export function registerAsset(id: string, endpoint: string, response: AssetResponse, tier: QualityTier): string {
 const manifest = response.runtime?.state === 'ready' ? response.runtime.manifest : undefined;
 const key = `asset:${endpoint}:${id}:${manifest?.source_sha256 || 'original'}:${manifest?.version || 'source'}:${manifest ? tier : 'original'}`;
 sources.delete(key);sources.set(key, { response, endpoint, id, tier, registeredAt:Date.now() });

 return key;
}
function pruneSources(){if(sources.size>128)for(const key of sources.keys()){if(sources.size<=128)break;if(!sourceOwners.get(key)&&Date.now()-sources.get(key)!.registeredAt>=30_000)sources.delete(key);}}
function disposeGLTF(model: GLTF) {
 const geometries = new Set<Mesh['geometry']>(), materials = new Set<import('three').Material>(), textures = new Set<Texture>();
 for (const scene of model.scenes) scene.traverse(object => {
  if (!(object instanceof Mesh)) return;
  geometries.add(object.geometry);
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
   for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
   materials.add(material);
  }
 });
 geometries.forEach(g => g.dispose()); materials.forEach(m=>m.dispose()); textures.forEach(t => t.dispose());
}
export async function verifiedBytes(variant:{url:string;sha256:string}):Promise<ArrayBuffer> {
 const response = await fetch(variant.url); if (!response.ok) throw new Error('Runtime asset download failed');
 const bytes = await response.arrayBuffer();
 // Require secure-context integrity checks before using a derivative.
 // On other origins, use the existing original-asset loading path.
 if (!globalThis.crypto?.subtle) throw new Error('Runtime integrity checks require a secure browser context');
 if (globalThis.crypto?.subtle) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== variant.sha256) throw new Error('Runtime asset integrity check failed');
 }
 return bytes;
}
async function checkedModel(loader: PreparedGLTFLoader,variant:{url:string;sha256:string}):Promise<GLTF>{return loader.parseAsync(await verifiedBytes(variant),'');}
export function resolveAssetSource(key:string){return sources.get(key);}
export function supportedVariant(manifest:NonNullable<NonNullable<AssetResponse['runtime']>['manifest']>,requested:QualityTier,renderer:WebGLRenderer){
 const choices:QualityTier[]=requested==='hq'?['hq','balanced','low']:requested==='balanced'?['balanced','low']:['low'];return choices.map(t=>manifest.variants[t]).find(v=>v?.url&&(v.max_texture||0)<=renderer.capabilities.maxTextureSize);
}

const pendingLoads=new WeakMap<WebGLRenderer,number>();
export async function loadModel(key: string, renderer?: WebGLRenderer): Promise<GLTF> {
 if(renderer)pendingLoads.set(renderer,(pendingLoads.get(renderer)||0)+1);
 try{return await loadModelInternal(key,renderer);}finally{if(renderer){pendingLoads.set(renderer,(pendingLoads.get(renderer)||1)-1);schedulePrune(renderer);}}
}
async function loadModelInternal(key: string, renderer?: WebGLRenderer): Promise<GLTF> {
 const source = sources.get(key), loader = new PreparedGLTFLoader(renderer);
 if (!source) return loader.loadAsync(key);
 const { response } = source;let tier=source.tier; const manifest = response.runtime?.state === 'ready' ? response.runtime.manifest : undefined;
 if(manifest&&renderer){const choices:QualityTier[]=source.tier==='hq'?['hq','balanced','low']:source.tier==='balanced'?['balanced','low']:['low'];tier=choices.find(t=>(manifest.variants[t]?.max_texture||0)<=renderer.capabilities.maxTextureSize)||source.tier;}
 if (manifest?.version === 'runtime-v1' && manifest.variants[tier]?.url) {
  let model: GLTF | undefined;
  try {
   model = await checkedModel(loader, manifest.variants[tier]); registerGeometryIdentity(model.scene,`${source.endpoint}:${manifest.source_sha256}:geometry`);model.scene.userData.runtimeGeometryRevision=`${source.endpoint}:${manifest.source_sha256}`;
   const c = manifest.collision;
   if (c?.url && (manifest.variants[tier].bytes||0)+(c.bytes||0)<=(manifest.source_bytes||Infinity) && c.strategy === 'verified-exact-geometry' && c.floor_approval === 'authored-only') {
    try { const proxy = await checkedModel(loader, c); registerGeometryIdentity(proxy.scene,`${source.endpoint}:${manifest.source_sha256}:geometry`);collisionScenes.set(model.scene, proxy.scene); registerCollisionSource(model.scene, proxy.scene); proxyModels.set(model, proxy); } catch { /* Exact visual geometry remains a validated collision fallback. */ }
   }
   return model;
  } catch { if (model) disposeGLTF(model); }
 }
 try { const model=await loader.loadAsync(response.url);registerGeometryIdentity(model.scene,`${source.endpoint}:${manifest?.source_sha256||source.id}:geometry`);model.scene.userData.runtimeGeometryRevision=`${source.endpoint}:${manifest?.source_sha256||source.id}`;return model; }
 catch (error) {
  // A suspended/unvisited asset may outlive a signed URL. Refresh only through
  // its original project/tour endpoint, retaining the same decoded cache identity.
  const refreshed = await fetch(source.endpoint.startsWith('/')&&!source.endpoint.startsWith('/api/')?`/api/v1${source.endpoint}`:source.endpoint); if (!refreshed.ok) throw error;
  const asset = await refreshed.json() as AssetResponse;
  if (!asset.url) throw error;
  source.response = asset;
  const model=await loader.loadAsync(asset.url);registerGeometryIdentity(model.scene,`${source.endpoint}:${manifest?.source_sha256||source.id}:geometry`);model.scene.userData.runtimeGeometryRevision=`${source.endpoint}:${manifest?.source_sha256||source.id}`;return model;
 }
}
const proxyModels = new WeakMap<GLTF, GLTF>();
export type ModelEntry = { key: string; promise: Promise<GLTF>; model?: GLTF; owners: number; touched: number; bytes: number };
// Decoded buffers/textures may be shared across Canvas remounts only when the
// supported GPU texture formats agree. Auth/project/tour scope stays in asset keys.
const caches = new Map<string, Map<string, ModelEntry>>();
const profiles = new WeakMap<WebGLRenderer,string>();
function rendererProfile(renderer: WebGLRenderer) {
 let profile=profiles.get(renderer);if(!profile){profile=JSON.stringify([renderer.capabilities.maxTextureSize,...['WEBGL_compressed_texture_astc','WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_etc','WEBGL_compressed_texture_etc1','WEBGL_compressed_texture_pvrtc','WEBKIT_WEBGL_compressed_texture_pvrtc','EXT_texture_compression_bptc'].map(name=>renderer.extensions.has(name))]);profiles.set(renderer,profile);}return profile;
}
const MAX_ENTRIES = 12, MAX_BYTES = 512 * 1024 ** 2, GRACE_MS = 30_000;
function memory(model: GLTF) {
 const geometry = new Set<Mesh['geometry']>(), textures = new Set<Texture>(); let bytes = 0;
 model.scene.traverse(o => { if (!(o instanceof Mesh)) return; geometry.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value); });
 for (const g of geometry) { for (const a of Object.values(g.attributes)) bytes += a.array.byteLength; bytes += g.index?.array.byteLength || 0; }
 for (const t of textures) { const image = t.image as { width?: number; height?: number } | undefined; bytes += (image?.width || 0) * (image?.height || 0) * 4 * 4 / 3; }
 return bytes;
}
export function readModel(key: string, renderer: WebGLRenderer): ModelEntry {
 let cache = caches.get(rendererProfile(renderer)); if (!cache) { cache = new Map(); caches.set(rendererProfile(renderer), cache); }
 let entry = cache.get(key);
 if (!entry) {
  entry = { key, promise: null!, owners: 0, touched: Date.now(), bytes: 0 }; cache.set(key, entry);
  const current = entry;
  entry.promise = loadModel(key, renderer).then(model => {
   current.model = model; current.touched = Date.now(); current.bytes = memory(model) + (proxyModels.get(model) ? memory(proxyModels.get(model)!) : 0);
   schedulePrune(renderer); return model;
  }, error => { cache!.delete(key); throw error; });
 }
 entry.touched = Date.now(); return entry;
}
export function pruneAssetCache(renderer: WebGLRenderer) {
 const cache = caches.get(rendererProfile(renderer)); if (!cache) {if(!pendingLoads.get(renderer))disposeAssetDecoders(renderer);return;}
 let bytes = [...cache.values()].reduce((sum, e) => sum + e.bytes, 0);
 const candidates = [...cache.values()].filter(e => e.model && !e.owners && Date.now() - e.touched >= GRACE_MS).sort((a, b) => a.touched - b.touched);
 for (const e of candidates) {
  if (cache.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
  cache.delete(e.key); bytes -= e.bytes;
  disposeGLTF(e.model!); const proxy = proxyModels.get(e.model!); if (proxy) disposeGLTF(proxy);
  if(!sourceOwners.get(e.key))sources.delete(e.key);
 }
 if (!pendingLoads.get(renderer)) disposeAssetDecoders(renderer);
}
const timers = new WeakMap<WebGLRenderer, ReturnType<typeof setTimeout>>();
function schedulePrune(renderer: WebGLRenderer) {
 const previous = timers.get(renderer); if (previous) clearTimeout(previous);
 const timer=setTimeout(() => { timers.delete(renderer); pruneAssetCache(renderer); }, GRACE_MS + 10);
 (timer as unknown as {unref?:()=>void}).unref?.(); timers.set(renderer,timer);
}
export function retainModels(entries: ModelEntry[], renderer: WebGLRenderer) {
 entries.forEach(e => {e.owners++;sourceOwners.set(e.key,(sourceOwners.get(e.key)||0)+1);});
 return () => { entries.forEach(e => { e.owners--;const owners=(sourceOwners.get(e.key)||1)-1;if(owners)sourceOwners.set(e.key,owners);else sourceOwners.delete(e.key); e.touched = Date.now(); }); schedulePrune(renderer); };
}
export function assetCacheStats(renderer: WebGLRenderer) { const entries = [...caches.get(rendererProfile(renderer))?.values() || []]; return { entries: entries.length, owners: entries.reduce((sum, e) => sum + e.owners, 0), bytes: entries.reduce((sum, e) => sum + e.bytes, 0) }; }

export function disposeModel(model: GLTF) { disposeGLTF(model); const proxy = proxyModels.get(model); if (proxy) disposeGLTF(proxy); }

export function retainAssetSource(key:string){sourceOwners.set(key,(sourceOwners.get(key)||0)+1);return()=>{const owners=(sourceOwners.get(key)||1)-1;if(owners)sourceOwners.set(key,owners);else sourceOwners.delete(key);pruneSources();};}

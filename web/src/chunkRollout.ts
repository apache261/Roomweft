import type { AssetResponse } from './runtimeAssetCache';
// Both gates retain ordinary original/whole-file loading. Future advertisements
// must be implemented explicitly before entering the current streaming viewer.
export function chunkStreamingEnabled(buildValue:string|undefined,search:string){
 return buildValue!=='0'&&new URLSearchParams(search).get('streaming')!=='0';
}
export function supportsChunkStreaming(response:AssetResponse|undefined){
 const s=response?.streaming;
 return s?.state==='ready'&&s.processor_version==='chunks-v1'&&s.delivery==='scoped-descriptors'&&typeof s.manifest_url==='string';
}

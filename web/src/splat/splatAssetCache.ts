import {maxSplatBytes, validateSplatBytes} from './profile.ts';

export type SplatProgress = {stage:'download'|'validate';bytes:number;total:number};
type Entry = {owners:number;abort:AbortController;listeners:Set<(p:SplatProgress)=>void>;promise:Promise<ArrayBuffer>;progress?:SplatProgress};
const entries = new Map<string,Entry>();
export const splatCacheStats = () => ({sources:entries.size,owners:[...entries.values()].reduce((n,e)=>n+e.owners,0)});

async function load(endpoint:string,entry:Entry) {
  const signal=entry.abort.signal;
  const progress=(p:SplatProgress)=>{entry.progress=p;entry.listeners.forEach(listener=>listener(p));};
  const timeout=setTimeout(()=>entry.abort.abort(),60_000);
  try {
    let response:Response|undefined;
    // Refresh the scoped descriptor once after an expired signed read. URLs are transport, never cache identity.
    for(let attempt=0;attempt<2;attempt++) {
      const descriptor=await fetch(`/api/v1${endpoint}`,{signal,cache:'no-store'});
      if(!descriptor.ok) throw new Error('Splat source is unavailable in this project or tour.');
      const asset=await descriptor.json() as {url?:string};
      if(!asset.url) throw new Error('Splat source is not ready.');
      response=await fetch(asset.url,{signal});
      if(response.ok)break;
      await response.body?.cancel();
      if(![401,403].includes(response.status)||attempt===1)throw new Error('Could not download splat source.');
    }
    if(!response?.ok||!response.body)throw new Error('Could not download splat source.');
    const length=Number(response.headers.get('Content-Length'));
    if(length>maxSplatBytes)throw new Error('Splat source exceeds the supported byte limit.');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];
    let bytes=0;
    try {
      for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxSplatBytes)throw new Error('Splat source exceeds the supported byte limit.');chunks.push(value);progress({stage:'download',bytes,total:length||0});}
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(!bytes||bytes%32||(length>0&&length!==bytes))throw new Error('Splat source is truncated or has invalid records.');
    const result=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}chunks.length=0;
    // Yield between bounded batches so rapid scene changes and retry remain responsive.
    for(let start=0;start<bytes;start+=262144){signal.throwIfAborted();validateSplatBytes(result.buffer.slice(start,Math.min(bytes,start+262144)));progress({stage:'validate',bytes:Math.min(bytes,start+262144),total:bytes});await new Promise(resolve=>setTimeout(resolve,0));}
    signal.throwIfAborted();return result.buffer;
  } catch(error) {
    if(signal.aborted)throw new Error('Splat loading was cancelled or timed out.');
    if(error instanceof Error && !error.message.includes('http'))throw error;
    throw new Error('Could not load splat source. Check your connection and retry.');
  } finally {clearTimeout(timeout);}
}

// Source bytes can be shared; workers, sorting and GPU allocations belong to each Canvas.
export function acquireSplat(endpoint:string,onProgress:(p:SplatProgress)=>void=()=>{}) {
  let entry=entries.get(endpoint);
  if(!entry){entry={owners:0,abort:new AbortController(),listeners:new Set(),promise:undefined as unknown as Promise<ArrayBuffer>};entries.set(endpoint,entry);entry.promise=load(endpoint,entry);}
  const owned=entry;owned.owners++;owned.listeners.add(onProgress);if(owned.progress)onProgress(owned.progress);
  let released=false;
  return {promise:owned.promise,release(){if(released)return;released=true;owned.listeners.delete(onProgress);if(--owned.owners===0){owned.abort.abort();if(entries.get(endpoint)===owned)entries.delete(endpoint);}}};
}

import { useEffect, useState } from 'react';
import { request } from './api';
import type { AssetResponse } from './runtimeAssetCache';
export function AssetProcessing({ id }: { id: string }) {
 const [runtime,setRuntime]=useState<AssetResponse['runtime']>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>;
  const refresh=()=>request<AssetResponse>(`/assets/${id}`).then(asset=>{if(active){setRuntime(asset.runtime);if(['queued','processing'].includes(asset.runtime?.state||''))timer=setTimeout(refresh,3000);}}).catch(e=>{if(active)setError(e.message);});
  void refresh();return()=>{active=false;clearTimeout(timer);};
 },[id,busy]);
 const process=async()=>{setBusy(true);setError('');try{setRuntime(await request<NonNullable<AssetResponse['runtime']>>(`/assets/${id}/process`,{method:'POST'}));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <div className="asset-processing"><small>{runtime?.state==='ready'?'Optimized versions ready':runtime?.state==='queued'?'Optimization queued':runtime?.state==='processing'?'Optimizing asset…':runtime?.state==='failed'?'Optimization failed': 'Original asset available'}</small>
 {runtime?.error&&<p>{runtime.error}</p>}{error&&<p role="alert">{error}</p>}
 {(!runtime||['failed','unavailable'].includes(runtime.state))&&<button disabled={busy} onClick={()=>void process()}>{runtime?.state==='failed'?'Retry optimization':'Optimize asset'}</button>}
 </div>;
}

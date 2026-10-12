import {useEffect,useState} from 'react';

export function splatCapabilities(mode: string | undefined, development = false) {
 const resolved=mode ?? (development?'on':'off');
 return {viewer:resolved==='on'||resolved==='viewer',authoring:resolved==='on'};
}
// Build and runtime gates must both permit support. Fail closed without hiding metadata.
export function useSplatSupport(retry=0) {
 const build=splatCapabilities(import.meta.env.VITE_SPLAT_SUPPORT,import.meta.env.DEV);
 const [support,setSupport]=useState({viewer:false,authoring:false,loading:true});
 useEffect(()=>{
  let active=true;
  const controller=new AbortController();
  setSupport({viewer:false,authoring:false,loading:true});
  const timeout=setTimeout(()=>controller.abort(),10000);
  fetch('/api/v1/capabilities',{cache:'no-store',signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(c=>{
   if(active&&!controller.signal.aborted)setSupport({viewer:build.viewer&&c.splat_viewer===true,authoring:build.authoring&&c.splat_authoring===true,loading:false});
  }).catch(()=>{if(active)setSupport({viewer:false,authoring:false,loading:false});}).finally(()=>clearTimeout(timeout));
  return ()=>{active=false;clearTimeout(timeout);controller.abort();};
 },[retry,build.viewer,build.authoring]);
 return support;
}

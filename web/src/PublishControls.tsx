import { useEffect, useState } from 'react';
import { request, type Project } from './api';

export function PublishControls({projectID}:{projectID:string}) {
  const [retry,setRetry]=useState(0);
  const [project,setProject]=useState<Project|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    let active=true;setError('');
    request<Project>(`/projects/${projectID}`).then(p=>{if(active)setProject(p);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[projectID,retry]);
  async function change(publish:boolean) {
    setBusy(true);setError('');setNotice('');
    try {const p=await request<Project>(`/projects/${projectID}/${publish?'publish':'unpublish'}`,{method:'POST'});setProject(p);setNotice(publish?'Tour published. Saved edits appear in the shared tour.':'Tour unpublished. Share and embed routes are unavailable.');}
    catch(e){setError(e instanceof Error?e.message:'Could not change publication.');}
    finally{setBusy(false);}
  }
  const url=project?`${location.origin}/t/${project.slug}`:'';
  const iframe=project?`<iframe src="${location.origin}/embed/${project.slug}" title="Virtual tour" width="100%" height="600" style="border:0" allow="fullscreen" allowfullscreen></iframe>`:'';
  async function copy(text:string,label:string) {
    setError('');setNotice('');
    try {await navigator.clipboard.writeText(text);setNotice(`${label} copied.`);}
    catch{setError('Could not copy automatically. Select and copy the text below.');}
  }
  return <section className="publish-panel"><h2>Share tour</h2>
    {error && <p className="error" role="alert">{error}</p>}
    {!project ? error ? <button onClick={()=>setRetry(n=>n+1)}>Retry publication settings</button> : <p role="status">Loading publication settings…</p> : <>
      <p>{project.published?'Published':'Unpublished'} · Save your edits before sharing.</p>
      <div className="form-row"><button disabled={busy} onClick={()=>change(!project.published)}>{busy?'Working…':project.published?'Unpublish tour':'Publish tour'}</button>
      {project.published && <a className="share-open" href={url} target="_blank" rel="noopener noreferrer">Open shared tour</a>}</div>
      {project.published && <><label>Share URL<input readOnly value={url} onFocus={e=>e.target.select()} /></label><button onClick={()=>copy(url,'URL')}>Copy URL</button>
      <label>Embed code<textarea readOnly value={iframe} onFocus={e=>e.target.select()} /></label><button onClick={()=>copy(iframe,'Embed code')}>Copy iframe code</button></>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

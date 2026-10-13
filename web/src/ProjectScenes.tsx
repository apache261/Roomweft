import {useSplatSupport} from './splat/rollout';
import {maxSplatBytes,validateSplatBytes} from './splat/profile';
import { AssetProcessing } from './AssetProcessing';
import type {Arrival} from './navigationSettings';
import { lazy, Suspense, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { request, uploadFile, type Asset, type Scene, type Project, type UploadTicket } from './api';
import { starterLayout,template } from './layout';
import {NewSceneDialog} from './NewSceneDialog';
import { PublishControls } from './PublishControls';
const SceneViewer = lazy(() => import('./SceneViewer').then(module => ({ default: module.SceneViewer })));
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong';

function SceneRow({ scene, selected, start, first, last, busy, select, change, setStart, remove }: {
  scene: Scene; selected: boolean; start: boolean; first: boolean; last: boolean; busy: boolean;
  select: (id:string)=>void; change: (id:string,body:{name?:string;move?:string})=>Promise<void>; setStart:(id:string)=>Promise<void>; remove:(scene:Scene)=>Promise<void>;
}) {
  const [name,setName]=useState(scene.name);
  useEffect(()=>setName(scene.name),[scene.name]);
  function rename(e:FormEvent) { e.preventDefault(); void change(scene.id,{name}); }
  return <li className={selected ? 'selected' : ''}>
    <div className="scene-row-heading"><button className="secondary" disabled={busy} onClick={()=>select(scene.id)}>{scene.name}</button><small>{scene.type==='PANORAMA' ? '360°' : scene.type==='LAYOUT' ? 'Layout' : scene.type==='SPLAT' ? 'Gaussian splat' : '3D'}{start ? ' · Start scene' : ''}</small></div>
    <details className="scene-options"><summary>Scene options</summary><form className="scene-rename" onSubmit={rename}><label htmlFor={`scene-name-${scene.id}`}>Scene name</label><div className="form-row"><input id={`scene-name-${scene.id}`} value={name} maxLength={120} required disabled={busy} onChange={e=>setName(e.target.value)} /><button disabled={busy || !name.trim() || name.trim()===scene.name}>Rename</button></div></form>
    <div className="scene-row-actions"><button disabled={busy || first} onClick={()=>change(scene.id,{move:'up'})}>Move up</button><button disabled={busy || last} onClick={()=>change(scene.id,{move:'down'})}>Move down</button><button disabled={busy || start} onClick={()=>setStart(scene.id)}>Set as start</button><button className="secondary" disabled={busy} onClick={()=>remove(scene)}>Delete scene</button></div></details>
  </li>;
}
export function ProjectScenes({ projectID }: { projectID: string }) {
  const splatSupport=useSplatSupport();
  const [textureRole,setTextureRole]=useState<Asset['file_type']>('TEXTURE_BASE_COLOR');
  const [preview,setPreview]=useState(false);
  const [processingOpen,setProcessingOpen]=useState(false);
  const [newSceneOpen,setNewSceneOpen]=useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [arrival,setArrival]=useState<{pose:Arrival;regionId:string}|undefined>();
  const [selected, setSelected] = useState('');
  const [startScene, setStartScene] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  useEffect(()=>{if(!status||busy)return;const timer=setTimeout(()=>setStatus(''),6000);return()=>clearTimeout(timer);},[status,busy]);
  const [retry, setRetry] = useState(0);
  const [viewerRevision,setViewerRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    Promise.all([request<Asset[]>(`/projects/${projectID}/assets`), request<Scene[]>(`/projects/${projectID}/scenes`), request<Project>(`/projects/${projectID}`)]).then(([a,s,p]) => {
      if (active) { setAssets(a); setScenes(s); setStartScene(p.start_scene_id); setSelected(s.find(scene=>scene.id===p.start_scene_id)?.id || s[0]?.id || ''); }
    }).catch(err => { if (active) setError(message(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectID, retry]);
  function select(id:string,pose?:{pose:Arrival;regionId:string}){if(scenes.some(scene=>scene.id===id)){setArrival(pose);setSelected(id);}}
  async function refreshScenes() {
    const [s,p] = await Promise.all([request<Scene[]>(`/projects/${projectID}/scenes`),request<Project>(`/projects/${projectID}`)]);
    setScenes(s); setStartScene(p.start_scene_id); setSelected(old=>s.some(scene=>scene.id===old) ? old : p.start_scene_id || s[0]?.id || '');
  }
  async function upload(event: ChangeEvent<HTMLInputElement>, imageUpload=false,textureUpload=false) {
    const file=event.target.files?.[0];event.target.value='';if(file)await uploadAsset(file,imageUpload,textureUpload);
  }
  async function uploadAsset(file:File,imageUpload=false,textureUpload=false,createAfter=false,sceneName?:string) {
    setError(''); setStatus('');
    const glb = /\.glb$/i.test(file.name);
    const splat = /\.splat$/i.test(file.name);
    const limitMiB = glb ? 1000 : splat ? maxSplatBytes/1024**2 : 100;
    if ((!glb && !splat && !/\.(jpe?g|png|webp)$/i.test(file.name)) || file.size < 20 || file.size > limitMiB * 1024 * 1024) { setError(`Choose a ${glb ? 'GLB' : splat ? 'raw SPLAT capture' : imageUpload ? 'JPG, PNG or WebP image' : '2:1 JPG, PNG or WebP panorama'} between 20 bytes and ${limitMiB} MiB.`); return; }
    setBusy(true); setProgress(0);
    try {
      if (glb) {
        const magic = new DataView(await file.slice(0, 12).arrayBuffer());
        if (magic.getUint32(0, true) !== 0x46546c67 || magic.getUint32(4, true) !== 2 || magic.getUint32(8, true) !== file.size) throw new Error('Invalid GLB header. Choose a glTF 2.0 binary model.');
      } else if (splat) {
        if(imageUpload||textureUpload) throw new Error("Choose an image for this upload role.");
        if(file.size%32) throw new Error("Raw SPLAT files require complete 32-byte records.");
        validateSplatBytes(await file.slice(0,Math.min(file.size,32*1024)).arrayBuffer());
      } else {
        const image = await createImageBitmap(file).catch(()=>{throw new Error('This image could not be decoded. Choose a valid JPG, PNG or WebP.');});
        const valid = (imageUpload || textureUpload || image.width===2*image.height) && image.width<=8192 && image.height<=4096; image.close();
        if (!valid) throw new Error(imageUpload?'Hotspot images must be at most 8192 × 4096 pixels.':'Panoramas must be 2:1 equirectangular images, at most 8192 × 4096 pixels.');
      }
      const ticket = await request<UploadTicket>(`/projects/${projectID}/uploads`, { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, ...(textureUpload?{file_type:textureRole}:imageUpload?{file_type:'IMAGE'}:{}) }) });
      setAssets(a => [ticket.asset, ...a]); setStatus('Uploading…');
      await uploadFile(ticket, file, setProgress); setStatus('Validating upload…');
      const asset = await request<Asset>(`/assets/${ticket.asset.id}/complete`, { method: 'POST' });
      setAssets(a => a.map(item => item.id === asset.id ? asset : item)); if(createAfter){await createScene(asset,sceneName);return;}setStatus(splat?'Gaussian splat uploaded. Create a scene below.':textureUpload?'Texture uploaded. Select it in a material preset.':imageUpload?'Image uploaded. Select it in hotspot properties.':'Upload complete. Create a scene below.');
    } catch (err) { setError(message(err)); setStatus(''); } finally { setBusy(false); }
  }
  async function confirm(asset: Asset) {
    setBusy(true); setError('');
    try { const updated = await request<Asset>(`/assets/${asset.id}/complete`, { method: 'POST' }); setAssets(a => a.map(item => item.id === asset.id ? updated : item)); setStatus('Upload confirmed.'); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function createScene(asset: Asset,name?:string) {
    setBusy(true); setError('');
    try {
      const scene = await request<Scene>(`/projects/${projectID}/scenes`, { method: 'POST', body: JSON.stringify({ asset_id: asset.id, name: name || asset.name.replace(/\.(glb|jpe?g|png|webp)$/i, '') || 'New scene' }) });
      await refreshScenes();setArrival(undefined);setSelected(scene.id);setNewSceneOpen(false);setStatus('Scene created.');
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function buildLayout(name='Lobby and rooms',single=false,assembly=false) {
    setBusy(true);setError('');
    try {const scene=await request<Scene>(`/projects/${projectID}/scenes`,{method:'POST',body:JSON.stringify({type:'LAYOUT',name,layout:assembly?{version:1,elements:[],doors:[]}:single?{version:1,elements:[template('LOBBY')],doors:[]}:starterLayout()})});await refreshScenes();setArrival(undefined);setSelected(scene.id);setNewSceneOpen(false);setStatus('Layout created. Edit the floor plan, then Walk inside.');}
    catch(err){setError(message(err));}finally{setBusy(false);}
  }
  async function changeScene(id:string, body:{name?:string;move?:string}) {
    setBusy(true); setError('');
    try { await request<Scene>(`/scenes/${id}`,{method:'PATCH',body:JSON.stringify(body)}); await refreshScenes(); }
    catch(err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function setStart(id:string) {
    setBusy(true); setError('');
    try { const p=await request<Project>(`/projects/${projectID}`,{method:'PATCH',body:JSON.stringify({start_scene_id:id})}); setStartScene(p.start_scene_id); setStatus('Start scene saved.'); }
    catch(err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function removeScene(scene:Scene) {
    if (!window.confirm(`Delete scene “${scene.name}”? Navigation links to this scene will also be removed.`)) return;
    setBusy(true); setError('');
    try { await request(`/scenes/${scene.id}`,{method:'DELETE'}); await refreshScenes(); setViewerRevision(n=>n+1); setStatus('Scene deleted.'); }
    catch(err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function processCapture(asset:Asset){setBusy(true);setError('');try{const result=await request<{state:string}>(`/assets/${asset.id}/process`,{method:'POST'});setStatus(result.state==='ready'?'Capture tiles are ready. Reload the scene to use streaming.':'Capture tile generation queued. Reload the scene when processing completes.');}catch(err){setError(message(err));}finally{setBusy(false);}}
  async function removeAsset(asset:Asset) {
    setBusy(true); setError('');
    try { await request(`/assets/${asset.id}`,{method:'DELETE'}); setAssets(items=>items.filter(item=>item.id!==asset.id)); }
    catch(err) { setError(message(err)); } finally { setBusy(false); }
  }
  const scene = scenes.find(s => s.id === selected);
  return <div className={`project-scenes ${preview ? 'preview-mode' : 'builder-mode'}`}>
    {newSceneOpen&&<NewSceneDialog assets={assets} busy={busy} error={error} status={status} onClose={()=>{setNewSceneOpen(false);setError('');}} onLayout={(name,single,assembly)=>void buildLayout(name,single,assembly)} onAsset={(asset,name)=>void createScene(asset,name)} onUpload={(file,name)=>void uploadAsset(file,false,false,true,name)}/> }
    {scenes.length>0 && <div className="preview-toolbar"><button onClick={()=>{setPreview(p=>!p);setArrival(undefined);setSelected(startScene || scenes[0].id);}}>{preview?'Back to builder':'Preview tour'}</button>{scenes.length > 0 && <label className="scene-select">Selected scene<select value={selected} onChange={e => select(e.target.value)}>{scenes.map(s => <option key={s.id} value={s.id}>{s.name}{s.id===startScene ? ' (start)' : ''}</option>)}</select></label>}<span className="workspace-mode">{preview?'Visitor preview':'Scene workspace'}</span><span className="workspace-hint">{preview?'Explore your tour':'Select · Arrange · Connect'}</span></div>}
    {error && !newSceneOpen && <div className="error" role="alert">{error} {!loading && <button onClick={() => setRetry(n => n + 1)} disabled={busy}>Refresh list</button>}</div>}
    {status&&!newSceneOpen&&<div className="project-feedback" role="status">{status}</div>}
    {loading ? <p role="status">Loading assets and scenes…</p> : <>
      <div className="editor-workspace">
        {!preview && <aside className="project-library" aria-label="Project library">      {!preview && <section className="scenes-panel"><div className="library-heading"><h2>Scenes</h2><span>{scenes.length}</span></div><button disabled={busy} onClick={()=>{setError('');setNewSceneOpen(true);}}>+ New scene</button>
        <ol className="scene-list">{scenes.map((item,i)=><SceneRow key={item.id} scene={item} selected={selected===item.id} start={startScene===item.id} first={i===0} last={i===scenes.length-1} busy={busy} select={select} change={changeScene} setStart={setStart} remove={removeScene} />)}</ol>
        {!scenes.length && <p>No scenes yet.</p>}
      </section>}
      {!preview && <details className="library-sharing"><summary>Publish & share</summary><PublishControls projectID={projectID} /></details>}
      {!preview && <details className="library-assets" onToggle={event=>setProcessingOpen(event.currentTarget.open)}><summary>Asset library <span>{assets.length}</span></summary><section className="assets-panel"><p>GLB models, 2:1 panoramas, or JPG, PNG and WebP hotspot images · GLB up to 1000 MiB; images up to 100 MiB · Originals are preserved</p>
        <label htmlFor="glb-upload">Upload GLB</label><input id="glb-upload" type="file" accept=".glb" disabled={busy} onChange={upload} />
        {splatSupport.authoring&&<><label htmlFor="splat-upload">Upload Gaussian splat source</label><input id="splat-upload" type="file" accept=".splat" disabled={busy} onChange={upload} /><p>Raw .splat only · up to 2,000,000 splats / 64,000,000 bytes · Inspection viewing and world-space hotspots.</p></>}
        <label htmlFor="panorama-upload">Upload panorama</label><input id="panorama-upload" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={upload} />
        <label htmlFor="info-image-upload">Upload hotspot image</label><input id="info-image-upload" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={e=>upload(e,true)} />
        <label>Texture map role<select aria-label="Texture map role" value={textureRole} onChange={e=>setTextureRole(e.target.value as Asset['file_type'])}><option value="TEXTURE_BASE_COLOR">Base color (sRGB)</option><option value="TEXTURE_NORMAL">Normal (linear data)</option><option value="TEXTURE_ROUGHNESS">Roughness (linear data)</option><option value="TEXTURE_AO">Baked AO (linear red channel)</option><option value="TEXTURE_LIGHTMAP">Baked indirect light (sRGB)</option></select></label>
        <label htmlFor="texture-upload">Upload texture map</label><input id="texture-upload" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={e=>upload(e,false,true)} />
        {busy && status === 'Uploading…' && <progress value={progress} max={100} aria-label="Upload progress" />}
        <ul className="asset-list">{assets.map(asset => <li key={asset.id}><span><strong>{asset.name}</strong><small>{asset.file_type.startsWith('TEXTURE_')?asset.file_type.replace('TEXTURE_','Texture: ').toLowerCase():asset.file_type==='IMAGE'?'Image':asset.file_type==='PANORAMA' ? '360°' : asset.file_type==='SPLAT' ? 'Gaussian splat' : 'GLB'} · {(asset.size / 1024 / 1024).toFixed(2)} MiB · {asset.upload_status === 'ready' ? 'Ready' : 'Awaiting completion'}</small></span>
          <div className="asset-actions">{asset.file_type==='SPLAT'&&asset.upload_status==='ready'&&splatSupport.streaming&&splatSupport.authoring&&<button disabled={busy} onClick={()=>void processCapture(asset)}>Generate capture tiles</button>}{processingOpen&&(asset.file_type==='GLB'||asset.file_type.startsWith('TEXTURE_'))&&asset.upload_status==='ready'&&<AssetProcessing id={asset.id}/>}{(['GLB','PANORAMA','SPLAT'].includes(asset.file_type) || asset.upload_status!=='ready') && <button disabled={busy || asset.file_type==='SPLAT'&&!splatSupport.authoring} onClick={() => asset.upload_status === 'ready' ? createScene(asset) : confirm(asset)}>{asset.upload_status === 'ready' ? 'Create scene' : 'Confirm upload'}</button>}<button className="secondary" disabled={busy || scenes.some(s=>s.asset_id===asset.id || s.type==='LAYOUT' && s.layout.elements.some(e=>e.asset_id===asset.id))} aria-label={`Delete asset ${asset.name}`} onClick={()=>removeAsset(asset)}>Delete asset</button></div></li>)}</ul>
        {!assets.length && <p>No assets yet.</p>}
      </section></details>}</aside>}
        <div className="editor-stage">      {scene ? <Suspense fallback={<p role="status">Loading viewer…</p>}><SceneViewer key={`${scene.id}:${viewerRevision}:${preview}`} preview={preview} arrival={arrival} assets={assets} scene={scene} scenes={scenes} onNavigate={select} onSaved={updated => setScenes(items => items.map(item => item.id === updated.id ? updated : item))} /></Suspense> : <section className="scene-placeholder"><div aria-hidden="true">◇</div><h2>Start your first scene</h2><p>A scene is one place in your tour. Build connected rooms or upload a building or 360° photo.</p><button disabled={busy} onClick={()=>{setError('');setNewSceneOpen(true);}}>+ New scene</button></section>}
</div>
      </div>
    </>}
  </div>;
}

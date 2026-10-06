import {ThemeSwitch} from './Theme';
import type {Arrival} from './navigationSettings';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { request, type Scene } from './api';
const SceneViewer=lazy(()=>import('./SceneViewer').then(m=>({default:m.SceneViewer})));
type Tour={name:string;description:string;start_scene_id:string|null;scenes:Scene[]};
export function PublicViewer({embed=false}:{embed?:boolean}) {
  const {slug=''}=useParams();
  const [tour,setTour]=useState<Tour|null>(null);
  const [arrival,setArrival]=useState<{pose:Arrival;regionId:string}|undefined>();
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setTour(null);setError('');
    request<Tour>(`/public/tours/${encodeURIComponent(slug)}`).then(t=>{
      if(!active)return;
      if(!t.scenes.length || !t.scenes.some(s=>s.id===t.start_scene_id)) {setError('This tour has no available start scene.');return;}
      setTour(t);setSelected(t.start_scene_id!);
    }).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[slug,retry]);
  const scene=tour?.scenes.find(s=>s.id===selected);
  return <main className={`public-viewer ${embed?'embed-viewer':''}`}>
    {error ? <section className="tour-unavailable"><h1>Tour unavailable</h1><p role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}>Try again</button></section> : !tour ? <p role="status">Loading tour…</p> : <>
      <div className="tour-heading"><ThemeSwitch /><h1>{tour.name}</h1>{!embed && tour.description && <p className="plain-description">{tour.description}</p>}</div>
      <label className="scene-select">Scene<select aria-label="Scene" value={selected} onChange={e=>(()=>{setArrival(undefined);setSelected(e.target.value);})()}>{tour.scenes.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {scene && <Suspense fallback={<p role="status">Loading viewer…</p>}><SceneViewer key={`${slug}:${scene.id}:${retry}`} scene={scene} scenes={tour.scenes} publicSlug={slug} arrival={arrival} preview onSaved={()=>{}} onNavigate={(id,pose)=>{if(tour.scenes.some(s=>s.id===id)){setArrival(pose);setSelected(id);}}} /></Suspense>}
    </>}
  </main>;
}

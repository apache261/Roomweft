import {useRef,useState,type PointerEvent} from 'react';
import type {Surface} from './materials';
import type {WalkRegion} from './navigationSettings';

export function floorEnvelope(surfaces:Surface[],paths:string[]){
 const boxes=surfaces.filter(s=>paths.includes(s.path)&&s.bounds).map(s=>s.bounds!);
 if(!boxes.length)return;
 return {left:Math.min(...boxes.map(b=>b.min[0])),right:Math.max(...boxes.map(b=>b.max[0])),top:Math.min(...boxes.map(b=>b.min[2])),bottom:Math.max(...boxes.map(b=>b.max[2])),min_y:Math.min(...boxes.map(b=>b.max[1]))-.01,max_y:Math.max(...boxes.map(b=>b.max[1]))+.01};
}

export function WalkingRegionMap({surfaces,regions,region,busy,onChange}:{surfaces:Surface[];regions:WalkRegion[];region:WalkRegion;busy:boolean;onChange:(v:Partial<WalkRegion>)=>void}){
 const [drawing,setDrawing]=useState(false),[draft,setDraft]=useState<{left:number;right:number;top:number;bottom:number}|null>(null);
 const svg=useRef<SVGSVGElement>(null),anchor=useRef<{x:number;z:number}|null>(null);
 const boxes=surfaces.filter(s=>s.bounds&&[...s.bounds.min,...s.bounds.max].every(Number.isFinite));
 if(!boxes.length)return <p>Load the model to draw walking areas.</p>;
 const left=Math.min(...boxes.map(s=>s.bounds!.min[0])),right=Math.max(...boxes.map(s=>s.bounds!.max[0])),top=Math.min(...boxes.map(s=>s.bounds!.min[2])),bottom=Math.max(...boxes.map(s=>s.bounds!.max[2]));
 const margin=Math.max(right-left,bottom-top,.5)*.08;
 const point=(event:PointerEvent<SVGSVGElement>)=>{const p=svg.current!.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const m=svg.current!.getScreenCTM();if(!m)return;const transformed=p.matrixTransform(m.inverse());return {x:Math.max(-1000,Math.min(1000,Math.round(transformed.x*100)/100)),z:Math.max(-1000,Math.min(1000,Math.round(transformed.y*100)/100))};};
 const rectangle=(p:{x:number;z:number})=>({left:Math.min(anchor.current!.x,p.x),right:Math.max(anchor.current!.x,p.x),top:Math.min(anchor.current!.z,p.z),bottom:Math.max(anchor.current!.z,p.z)});
 const fit=floorEnvelope(surfaces,region.floor_meshes||[]);
 return <section className="walking-map"><p>Select floor meshes below, then fit the area to those floors. To limit it, choose Draw area and drag a rectangle on this top view. North is −Z.</p>
 <div className="form-row"><button type="button" disabled={busy||!fit} onClick={()=>{if(fit)onChange(fit);}}>Fit area to selected floors</button><button type="button" disabled={busy} aria-pressed={drawing} onClick={()=>{setDrawing(!drawing);setDraft(null);anchor.current=null;}}>{drawing?'Cancel drawing':'Draw area'}</button></div>
 <svg ref={svg} className={drawing?'region-map drawing':'region-map'} viewBox={`${left-margin} ${top-margin} ${Math.max(.1,right-left)+margin*2} ${Math.max(.1,bottom-top)+margin*2}`} role="img" aria-label="Top-down walking area map"
 onPointerDown={event=>{if(!drawing||busy||event.button!==0)return;const p=point(event);if(!p)return;event.preventDefault();anchor.current=p;setDraft(rectangle(p));event.currentTarget.setPointerCapture(event.pointerId);}}
 onPointerMove={event=>{if(!anchor.current||busy)return;const p=point(event);if(p)setDraft(rectangle(p));}}
 onPointerUp={event=>{if(!anchor.current)return;const p=point(event);const next=p&&rectangle(p);anchor.current=null;setDraft(null);if(next&&next.right-next.left>=.1&&next.bottom-next.top>=.1&&!busy){onChange(next);setDrawing(false);}if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
 onPointerCancel={()=>{anchor.current=null;setDraft(null);}}>
 {boxes.map(s=>{const b=s.bounds!,approved=region.floor_meshes?.includes(s.path);return <rect key={s.path} x={b.min[0]} y={b.min[2]} width={Math.max(.01,b.max[0]-b.min[0])} height={Math.max(.01,b.max[2]-b.min[2])} className={approved?'approved-floor':'model-footprint'}><title>{s.label}</title></rect>;})}
 {regions.map(r=><rect key={r.id} x={r.left} y={r.top} width={r.right-r.left} height={r.bottom-r.top} className={`walking-boundary ${r.id===region.id?'active':''} ${r.exterior?'exterior':''}`}/>)}
 {draft&&<rect x={draft.left} y={draft.top} width={draft.right-draft.left} height={draft.bottom-draft.top} className="walking-boundary active draft"/>}
 </svg><p className="creation-note">Green: selected floors · blue outline: current walking area. Drawing changes X/Z boundaries; floor heights stay unchanged. Walls and furniture still block walking.</p>
 </section>;
}

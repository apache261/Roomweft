import { NumericInput } from './NumericInput';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {FloorMeshPicker} from './FloorMeshPicker';
import type {Surface} from './materials';
import type { Asset } from './api';
import { invalidateRoomAssignments, connectedRoom, bounds, isRoom, layoutIssues, sharedEdge, template, type LayoutDocument, type LayoutElement, type LayoutKind, type RoomSide } from './layout';

export function LayoutEditor({document:doc,onChange,onSave,dirty,busy,assets,attached,selection,onQuickAdd,onSelection,surfaces=[]}: {
 surfaces?:Surface[];selection?:string;onSelection?:(id:string)=>void;onQuickAdd?:(add:(()=>void)|null)=>void;document:LayoutDocument;onChange:(doc:LayoutDocument)=>void;onSave:()=>void;dirty:boolean;busy:boolean;assets:Asset[];attached:Set<string>;
}) {
 const [selected,setSelected]=useState(doc.elements[0]?.id||''),[snap,setSnap]=useState(0.5),[pair,setPair]=useState(''),[historyTick,setHistoryTick]=useState(0);
 const [addMessage,setAddMessage]=useState(''),[anchorId,setAnchorId]=useState(''),[doorOffset,setDoorOffset]=useState(0);
 useEffect(()=>{setAnchorId('');setDoorOffset(0);},[selected]);
 const footprint=(e:LayoutElement)=>{const boxes=surfaces.filter(s=>s.elementId===e.id&&s.bounds&&(!e.floor_meshes?.length||e.floor_meshes.includes(s.path))).map(s=>s.bounds!);return e.kind==='INSTANCE'&&boxes.length?{left:Math.min(...boxes.map(b=>b.min[0])),right:Math.max(...boxes.map(b=>b.max[0])),top:Math.min(...boxes.map(b=>b.min[2])),bottom:Math.max(...boxes.map(b=>b.max[2]))}:bounds(e);};
 useEffect(()=>{if(selection&&doc.elements.some(e=>e.id===selection)){setSelected(selection);}},[selection,doc.elements]);
 useEffect(()=>{if(selected&&!doc.elements.some(e=>e.id===selected)&&!doc.doors.some(d=>d.id===selected)){const fallback=doc.elements[0]?.id||'';setSelected(fallback);onSelection?.(fallback);}},[selected,doc.elements,doc.doors,onSelection]);
 const choose=(id:string)=>{setSelected(id);onSelection?.(id);};
 const undo=useRef<LayoutDocument[]>([]),redo=useRef<LayoutDocument[]>([]),svg=useRef<SVGSVGElement>(null);
 const drag=useRef<{id:string;doc:LayoutDocument;x:number;z:number;ox:number;oz:number;view:string}|null>(null);
 const issues=layoutIssues(doc),element=doc.elements.find(e=>e.id===selected),door=doc.doors.find(d=>d.id===selected);
 const boxes=doc.elements.map(footprint),left=Math.min(-8,...boxes.map(b=>b.left))-2,top=Math.min(-10,...boxes.map(b=>b.top))-2,right=Math.max(8,...boxes.map(b=>b.right))+2,bottom=Math.max(6,...boxes.map(b=>b.bottom))+2;
 const viewBox=drag.current?.view || `${left} ${top} ${right-left} ${bottom-top}`;
 const commit=(next:LayoutDocument)=>{undo.current.push(doc);if(undo.current.length>100)undo.current.shift();redo.current=[];setHistoryTick(n=>n+1);onChange(invalidateRoomAssignments(doc,next));};
 const patch=(values:Partial<LayoutElement>)=>element&&commit({...doc,elements:doc.elements.map(e=>e.id===element.id?{...e,...values}:e)});
 const round=(n:number)=>snap?Math.round(n/snap)*snap:n;
 const undoChange=()=>{const previous=undo.current.pop();if(previous){redo.current.push(doc);onChange(previous);setHistoryTick(n=>n+1);}};
 const redoChange=()=>{const next=redo.current.pop();if(next){undo.current.push(doc);onChange(next);setHistoryTick(n=>n+1);}};
 const position=(event:PointerEvent)=>{const point=svg.current!.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
 function add(kind:LayoutKind,asset?:Asset,side?:RoomSide) {
  setAddMessage('');const anchor=element&&isRoom(element)?element:doc.elements.find(isRoom);
  if(anchor&&['LOBBY','ROOM','CORRIDOR'].includes(kind)){const joined=connectedRoom(doc,anchor,kind,side);if(joined){commit(joined);choose(joined.elements.at(-1)!.id);setAddMessage('Room added with a doorway. Save the layout, then walk through it.');}else setAddMessage('No clear space on that side. Choose another side or move the neighboring room.');return;}
  const next=template(kind,round(right+2),0);if(asset){next.asset_id=asset.id;next.name=asset.name.replace(/\.glb$/i,'');next.x=doc.elements.length?round(right+2):0;next.z=0;}
  commit({...doc,elements:[...doc.elements,next]});choose(next.id);
 }
 function align(side:RoomSide){
  const anchor=doc.elements.find(e=>e.id===(anchorId||doc.elements.find(e=>e.kind==='INSTANCE'&&e.id!==selected)?.id));if(!anchor||!element)return;
  const a=footprint(anchor),b=footprint(element),horizontal=side==='east'||side==='west';
  const x=horizontal?(side==='east'?a.right-b.left:a.left-b.right):(a.left+a.right-b.left-b.right)/2+doorOffset;
  const z=horizontal?(a.top+a.bottom-b.top-b.bottom)/2+doorOffset:(side==='south'?a.bottom-b.top:a.top-b.bottom);
  patch({x:element.x+x,z:element.z+z});setAddMessage('Room edges aligned. Check doorway openings in 3D; adjust the doorway offset if needed.');
 }
 function duplicate() {if(!element)return;const next={...structuredClone(element),id:crypto.randomUUID(),name:`${element.name.slice(0,110)} copy`,x:element.kind==='INSTANCE'?round(element.x+1.5):round(right+element.width/2),z:element.z};commit({...doc,elements:[...doc.elements,next]});choose(next.id);}
 function repeatModule() {if(!element||element.kind==='INSTANCE'||element.kind==='WALL')return;
  const b=bounds(element),next={...structuredClone(element),id:crypto.randomUUID(),name:`${element.name.slice(0,110)} repeat`,x:element.x+(b.right-b.left)};
  const edge=sharedEdge(element,next),doors=[...doc.doors];
  if(isRoom(element)&&edge&&edge.end-edge.start>=1.04)doors.push({id:crypto.randomUUID(),a:element.id,b:next.id,at:(edge.start+edge.end)/2,width:Math.min(1.2,edge.end-edge.start-0.24),height:Math.min(2.2,element.height)});
  commit({...doc,elements:[...doc.elements,next],doors});setSelected(next.id);
 }
 function remove() {
  if(element&&!attached.has(element.id)){commit({...doc,elements:doc.elements.filter(e=>e.id!==element.id).map(e=>e.room_id===element.id?{...e,room_id:undefined}:e),doors:doc.doors.filter(d=>d.a!==element.id&&d.b!==element.id)});setSelected('');}
  else if(door){commit({...doc,doors:doc.doors.filter(d=>d.id!==door.id)});setSelected('');}
 }
 const rooms=doc.elements.filter(isRoom),pairs=rooms.flatMap((a,i)=>rooms.slice(i+1).flatMap(b=>{const edge=sharedEdge(a,b);return edge && edge.end-edge.start>=1.04?[{a,b,edge,key:`${a.id}:${b.id}`}]:[];}));
 function connect() {const p=pairs.find(p=>p.key===pair);if(!p)return;const d={id:crypto.randomUUID(),a:p.a.id,b:p.b.id,at:(p.edge.start+p.edge.end)/2,width:Math.min(1.2,p.edge.end-p.edge.start-0.24),height:2.2};commit({...doc,doors:[...doc.doors,d]});setSelected(d.id);}
 useEffect(()=>{onQuickAdd?.(()=>{if(!busy)add('ROOM');});return()=>onQuickAdd?.(null);},[doc,selected,busy,onQuickAdd]);
 const number=(label:string,value:number,update:(n:number)=>void,min=-1000,max=1000,_step:number|string=0.5)=><NumericInput key={`${selected}:${label}`} label={label} value={value} min={min} max={max} onChange={update} />;
 return <section className="layout-editor" aria-label="Layout editor" data-history={historyTick}>
  <div className="viewer-toolbar"><h2>Floor plan</h2><button disabled={busy||!dirty||!!issues.errors.length} onClick={onSave}>{busy?'Saving layout…':'Save layout'}</button></div>
  <p role="status">{dirty?'Unsaved layout changes':'Layout saved'} · One continuous walking world · metres</p>
  <p>Click a room in the 3D view or floor plan to select it. Add room attaches a new room and doorway automatically. Drag shapes to rearrange them.</p>
  {addMessage&&<p role="status">{addMessage}</p>}
  {element&&isRoom(element)&&<div className="room-add-sides"><span>Add a connected room beside {element.name}</span>{([['north','↑ North'],['west','← West'],['east','East →'],['south','↓ South']] as [RoomSide,string][]).map(([side,label])=><button key={side} className="secondary" disabled={busy} onClick={()=>add('ROOM',undefined,side)}>{label}</button>)}</div>}
  <fieldset disabled={busy} className="layout-actions">
   {(['LOBBY','ROOM','CORRIDOR','FLOOR','WALL'] as LayoutKind[]).map(kind=><button key={kind} onClick={()=>add(kind)}>Add {kind.toLowerCase()}</button>)}
   <button disabled={!undo.current.length} onClick={undoChange}>Undo layout</button><button disabled={!redo.current.length} onClick={redoChange}>Redo layout</button>
   <label>Grid snapping<select aria-label="Grid snapping" value={snap} onChange={e=>setSnap(Number(e.target.value))}><option value={0.5}>0.5 m</option><option value={0.1}>0.1 m</option><option value={1}>1 m</option><option value={0}>Off</option></select></label>
  </fieldset>
  <svg ref={svg} className="floor-plan" viewBox={viewBox} role="img" aria-label="Top-down floor plan. Select elements using the list or drag shapes on the grid."
   onPointerMove={event=>{const d=drag.current;if(!d)return;const p=position(event);onChange(invalidateRoomAssignments(d.doc,{...d.doc,elements:d.doc.elements.map(e=>e.id===d.id?{...e,x:round(d.x+p.x-d.ox),z:round(d.z+p.y-d.oz)}:e)}));}}
   onPointerUp={()=>{const d=drag.current;if(!d)return;drag.current=null;if(JSON.stringify(doc)!==JSON.stringify(d.doc)){undo.current.push(d.doc);redo.current=[];}setHistoryTick(n=>n+1);}}
   onPointerCancel={()=>{if(drag.current){onChange(drag.current.doc);drag.current=null;setHistoryTick(n=>n+1);}}}>
   <defs><pattern id="layout-grid" width={snap||0.5} height={snap||0.5} patternUnits="userSpaceOnUse"><path d={`M ${snap||0.5} 0 L 0 0 0 ${snap||0.5}`} fill="none" stroke="#cbd4d8" strokeWidth="0.015" /></pattern></defs>
   <rect x={left-2000} y={top-2000} width={right-left+4000} height={bottom-top+4000} fill="url(#layout-grid)" />
   {doc.elements.map(e=>{const b=footprint(e);return <g key={e.id} className={selected===e.id?'plan-element selected':'plan-element'} data-element={e.id} onPointerDown={event=>{if(busy)return;event.stopPropagation();choose(e.id);const p=position(event);drag.current={id:e.id,doc,x:e.x,z:e.z,ox:p.x,oz:p.y,view:viewBox};svg.current!.setPointerCapture(event.pointerId);}}>
    <rect x={b.left} y={b.top} width={b.right-b.left} height={b.bottom-b.top} fill={e.tint||(e.kind==='INSTANCE'?'#dca768':e.kind==='CORRIDOR'?'#c5d3db':'#e1ded3')} stroke={selected===e.id?'#11636b':'#697e84'} strokeWidth={selected===e.id?0.12:0.06} />
    <text x={e.x} y={e.z-0.1} textAnchor="middle" fontSize="0.35" pointerEvents="none">{e.name}</text><text x={e.x} y={e.z+0.35} textAnchor="middle" fontSize="0.24" pointerEvents="none">{Number((b.right-b.left).toFixed(2))} × {Number((b.bottom-b.top).toFixed(2))} m {e.kind==='INSTANCE'?`· ${e.rotation}°`:''}</text>
   </g>;})}
   {doc.doors.map(d=>{const a=doc.elements.find(e=>e.id===d.a),b=doc.elements.find(e=>e.id===d.b),edge=a&&b?sharedEdge(a,b):null;if(!edge)return null;return <line key={d.id} data-door={d.id} x1={edge.axis==='x'?d.at-d.width/2:edge.line} y1={edge.axis==='x'?edge.line:d.at-d.width/2} x2={edge.axis==='x'?d.at+d.width/2:edge.line} y2={edge.axis==='x'?edge.line:d.at+d.width/2} stroke={selected===d.id?'#ad4a10':'#168477'} strokeWidth="0.2" onPointerDown={e=>{e.stopPropagation();setSelected(d.id);}} />;})}
  </svg>
  {issues.errors.map(text=><p key={text} className="error" role="alert">{text} Fix the plan to update the 3D preview and save.</p>)}
  {issues.warnings.map(text=><p key={text} role="status">{text}</p>)}
  <label>Selected layout element<select aria-label="Selected layout element" value={selected} onChange={e=>choose(e.target.value)}><option value="">Choose an element</option>{doc.elements.map(e=><option key={e.id} value={e.id}>{e.name} ({e.kind.toLowerCase()})</option>)}{doc.doors.map((d,i)=><option key={d.id} value={d.id}>Doorway {i+1}</option>)}</select></label>
  <fieldset disabled={busy} className="layout-properties">
   {element && <>
    <label>Element name<input aria-label="Element name" value={element.name} maxLength={120} onChange={e=>patch({name:e.target.value})} /></label>
    {number('Position X (m)',element.x,n=>patch({x:n}))}{number('Position Z (m)',element.z,n=>patch({z:n}))}
    {element.kind==='INSTANCE'?<>
      {number('Instance rotation (degrees)',element.rotation,n=>patch({rotation:n}),-360,360,1)}{number('Instance scale',element.scale,n=>patch({scale:n}),0.001,100,'any')}
      <label>Instance GLB<select aria-label="Instance GLB" value={element.asset_id} onChange={e=>patch({asset_id:e.target.value,floor_meshes:[]})}>{assets.filter(a=>a.file_type==='GLB'&&a.upload_status==='ready').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Load with room<select aria-label="Load with room" value={element.room_id||''} onChange={e=>patch({room_id:e.target.value||undefined})}><option value="">Always loaded</option>{doc.elements.filter(isRoom).map(room=>{const b=bounds(room),meshes=surfaces.filter(s=>s.elementId===element.id&&s.bounds);const contained=meshes.length>0&&!element.floor_meshes?.length&&meshes.every(s=>s.bounds!.min[0]>=b.left&&s.bounds!.max[0]<=b.right&&s.bounds!.min[2]>=b.top&&s.bounds!.max[2]<=b.bottom&&s.bounds!.min[1]>=-.01&&s.bounds!.max[1]<=room.height);return <option key={room.id} value={room.id} disabled={!contained}>{room.name}{contained?'':' (object must fit inside)'}</option>;})}</select></label><p>Assign only objects contained inside this room. Leave stairs, open areas and structural modules always loaded.</p>
      <fieldset className="room-assembly"><legend>Imported room assembly</legend><p>Approve only this room's structural floors. Floor regions follow its position, rotation and scale; walls remain solid.</p>
      <FloorMeshPicker key={`room-floors-${element.id}`} surfaces={surfaces.filter(s=>s.elementId===element.id)} value={element.floor_meshes||[]} busy={busy||!element.collidable} onChange={floor_meshes=>patch({floor_meshes})}/>
      <label>Align with room<select aria-label="Align with room" value={anchorId||doc.elements.find(e=>e.kind==='INSTANCE'&&e.id!==selected)?.id||''} onChange={e=>setAnchorId(e.target.value)}><option value="">Choose a room</option>{doc.elements.filter(e=>e.kind==='INSTANCE'&&e.id!==selected).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      {number('Doorway offset (m)',doorOffset,setDoorOffset)}
      <div className="room-add-sides">{(['north','west','east','south'] as RoomSide[]).map(side=><button key={side} disabled={busy||!doc.elements.some(e=>e.kind==='INSTANCE'&&e.id!==selected)} onClick={()=>align(side)}>Align {side}</button>)}</div><p>Offset shifts the room along the shared edge. Use Position X/Z to fine-tune. Models must use matching floor heights and open doorways.</p></fieldset>
      <label><input type="checkbox" checked={element.collidable} onChange={e=>patch({collidable:e.target.checked,...(!e.target.checked?{floor_meshes:[]}:{} )})} /> Instance blocks walking (furniture)</label><p>Turn off collision for decorations. Structural floors and walls always collide. GLBs use Y up and metre units; adjust instance scale for other units.</p>
    </>:<>
      {number('Width (m)',element.width,n=>patch({width:n}),0.1,100)}{element.kind!=='WALL'&&number('Depth (m)',element.depth,n=>patch({depth:n}),0.1,100)}{number('Height (m)',element.height,n=>patch({height:n}),0.1,10,0.1)}
      {element.kind==='FLOOR'&&<label><input type="checkbox" checked={!!element.exterior} onChange={e=>patch({exterior:e.target.checked})} /> Exterior floor (requires an exit)</label>}
      <button onClick={()=>patch({rotation:(element.rotation+90)%360})}>Rotate 90°</button>
    </>}
    <label><input type="checkbox" checked={!!element.tint} onChange={e=>patch({tint:e.target.checked?'#bcb4a3':''})} /> {element.kind==='INSTANCE'?'Override instance color':'Override surface color'}</label>
    {element.tint&&<label>Element color<input aria-label="Element color" type="color" value={element.tint} onChange={e=>patch({tint:e.target.value})} /></label>}
    <label><input type="checkbox" checked={element.roughness!==null} onChange={e=>patch({roughness:e.target.checked?0.6:null})} /> Override element roughness</label>
    {element.roughness!==null&&number('Element roughness',element.roughness,n=>patch({roughness:n}),0,1,0.05)}
    <button onClick={duplicate}>Duplicate element</button>{element.kind!=='INSTANCE'&&element.kind!=='WALL'&&<button onClick={repeatModule}>Repeat module to right</button>}<button disabled={attached.has(element.id)} className="secondary" onClick={remove}>Delete element</button>
    {attached.has(element.id)&&<p>Attached hotspots use this element. Edit each hotspot and choose “Keep at world position”, then Save hotspot, before deleting the element.</p>}
   </>}
   {door&&<>
    <p>Doorway clearance: {door.width.toFixed(2)} m wide × {door.height.toFixed(2)} m high.</p>
    {number('Doorway center (m)',door.at,n=>commit({...doc,doors:doc.doors.map(d=>d.id===door.id?{...d,at:n}:d)}))}
    {number('Doorway width (m)',door.width,n=>commit({...doc,doors:doc.doors.map(d=>d.id===door.id?{...d,width:n}:d)}),0.8,10,0.1)}
    {number('Doorway height (m)',door.height,n=>commit({...doc,doors:doc.doors.map(d=>d.id===door.id?{...d,height:n}:d)}),2,10,0.1)}
    <button className="secondary" onClick={remove}>Delete doorway</button>
   </>}
  </fieldset>
  <fieldset disabled={busy}><legend>Connect rooms</legend><label>Touching room edges<select aria-label="Touching room edges" value={pair} onChange={e=>setPair(e.target.value)}><option value="">Choose a shared edge</option>{pairs.map(p=><option key={p.key} value={p.key}>{p.a.name} ↔ {p.b.name} ({(p.edge.end-p.edge.start).toFixed(2)} m edge)</option>)}</select></label><button disabled={!pairs.some(p=>p.key===pair)} onClick={connect}>Add doorway</button><p>Place rooms so their edges touch. Doorways leave at least 0.12 m of wall at each end; overlapping openings are rejected.</p></fieldset>
  <fieldset disabled={busy}><legend>Add imported rooms, furniture or decoration</legend>{assets.filter(a=>a.file_type==='GLB'&&a.upload_status==='ready').map(a=><button key={a.id} onClick={()=>add('INSTANCE',a)}>Place {a.name}</button>)}{!assets.some(a=>a.file_type==='GLB'&&a.upload_status==='ready')&&<p>Upload a GLB in the asset library, then place it here. You can place the same asset several times.</p>}</fieldset>
 </section>;
}

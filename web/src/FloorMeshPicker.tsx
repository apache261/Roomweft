import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Surface} from './materials';

function FloorMeshDialog({surfaces,value,busy,onApply,onClose}:{surfaces:Surface[];value:string[];busy:boolean;onApply:(paths:string[])=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [query,setQuery]=useState(''),[chosen,setChosen]=useState(()=>new Set(value));
 useEffect(()=>{if(!dialog.current?.open)dialog.current?.showModal();},[]);
 const close=()=>{dialog.current?.close();onClose();};
 const available=new Set(surfaces.map(s=>s.path));
 const options=[...surfaces,...value.filter(path=>!available.has(path)).map(path=>({path,label:'Unavailable mesh'}))];
 const visible=options.filter(s=>`${s.label} ${s.path}`.toLowerCase().includes(query.trim().toLowerCase()));
 const toggle=(path:string,checked:boolean)=>setChosen(previous=>{const next=new Set(previous);if(checked)next.add(path);else next.delete(path);return next;});
 const changeVisible=(checked:boolean)=>setChosen(previous=>{const next=new Set(previous);visible.forEach(s=>{if(checked)next.add(s.path);else next.delete(s.path);});return next;});
 return createPortal(<dialog ref={dialog} className="project-details-dialog floor-mesh-dialog" aria-labelledby="floor-mesh-title" onCancel={event=>{event.preventDefault();close();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
 <div className="creation-header"><h2 id="floor-mesh-title">Approved floor meshes</h2><button type="button" className="secondary" aria-label="Close floor selection" onClick={close}>✕</button></div>
 <p>Select structural floors for this walking region. Leave walls, roofs and furniture unchecked.</p>
 <label>Search meshes<input type="search" autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try Floor, Lobby or a mesh path"/></label>
 <div className="floor-picker-actions"><span role="status">{chosen.size} selected · {visible.length} shown</span><button type="button" className="secondary" disabled={busy||!visible.length} onClick={()=>changeVisible(true)}>Select shown</button><button type="button" className="secondary" disabled={busy||!visible.length} onClick={()=>changeVisible(false)}>Clear shown</button></div>
 <div className="floor-picker-list" role="group" aria-label="Mesh choices">{visible.map(s=><label className="floor-picker-row" key={s.path}><input type="checkbox" disabled={busy} checked={chosen.has(s.path)} aria-label={`${s.label} (${s.path})`} onChange={e=>toggle(s.path,e.target.checked)}/><span><strong>{s.label}</strong><small>{s.path}{!available.has(s.path)&&' · no longer in this model'}</small></span></label>)}{!visible.length&&<p>No meshes match your search.</p>}</div>
 <div className="floor-picker-footer"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="button" disabled={busy} onClick={()=>{onApply([...chosen]);close();}}>Apply selection</button></div>
 </dialog>,document.body);
}

export function FloorMeshPicker({surfaces,value,busy,onChange}:{surfaces:Surface[];value:string[];busy:boolean;onChange:(paths:string[])=>void}){
 const [open,setOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 return <div className="floor-picker-control"><span>Approved floor meshes</span><div className="form-row"><button ref={trigger} type="button" disabled={busy} onClick={()=>setOpen(true)}>Choose floor meshes</button><small>{value.length} selected</small></div>
 {open&&<FloorMeshDialog surfaces={surfaces} value={value} busy={busy} onApply={onChange} onClose={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});}}/>}
 </div>;
}

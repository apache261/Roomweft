import type { NavigationSettings } from './navigationSettings';
import type { MaterialPreset } from './materials';
import type { Hotspot, HotspotPosition } from './api';
export type LayoutKind = 'LOBBY' | 'ROOM' | 'CORRIDOR' | 'FLOOR' | 'WALL' | 'INSTANCE';
export type LayoutElement = { room_id?:string; floor_meshes?:string[]; exterior?:boolean; floor_material?:string;wall_material?:string;mesh_materials?:Record<string,string>;id: string; kind: LayoutKind; name: string; x: number; z: number; width: number; depth: number; height: number; rotation: number; asset_id?: string; scale: number; collidable: boolean; tint: string; roughness: number | null };
export type LayoutDoor = { id: string; a: string; b: string; at: number; width: number; height: number };
export type LayoutDocument = { navigation?:NavigationSettings; materials?:MaterialPreset[];version: 1; elements: LayoutElement[]; doors: LayoutDoor[] };
export type Attachment = { element_id: string; local: [number, number, number] };
export const isRoom = (e: LayoutElement) => ['LOBBY','ROOM','CORRIDOR'].includes(e.kind);
export function bounds(e: LayoutElement) {
  const swapped = Math.abs(e.rotation) % 180 === 90, w = swapped ? e.depth : e.width, d = swapped ? e.width : e.depth;
  return { left: e.x-w/2, right: e.x+w/2, top: e.z-d/2, bottom: e.z+d/2 };
}
export function sharedEdge(a: LayoutElement, b: LayoutElement) {
  const x = bounds(a), y = bounds(b);
  let start = Math.max(x.top,y.top), end = Math.min(x.bottom,y.bottom);
  if (end-start>0.01 && (Math.abs(x.right-y.left)<1e-5 || Math.abs(y.right-x.left)<1e-5)) return { axis:'z' as const, line:Math.abs(x.right-y.left)<1e-5 ? x.right : x.left, start, end };
  start=Math.max(x.left,y.left); end=Math.min(x.right,y.right);
  if (end-start>0.01 && (Math.abs(x.bottom-y.top)<1e-5 || Math.abs(y.bottom-x.top)<1e-5)) return { axis:'x' as const, line:Math.abs(x.bottom-y.top)<1e-5 ? x.bottom : x.top, start, end };
  return null;
}
export function template(kind: LayoutKind, x=0, z=0): LayoutElement {
  const size: Record<LayoutKind,number[]> = {LOBBY:[6,6,3],ROOM:[4,4,3],CORRIDOR:[2,4,3],FLOOR:[4,4,0.2],WALL:[4,0.12,3],INSTANCE:[1,1,1]};
  const [width,depth,height]=size[kind];
  return {id:crypto.randomUUID(),kind,name:kind[0]+kind.slice(1).toLowerCase(),x,z,width,depth,height,rotation:0,scale:1,collidable:true,tint:'',roughness:null};
}
export function starterLayout(): LayoutDocument {
  const lobby=template('LOBBY'), corridor=template('CORRIDOR',0,-5), left={...template('ROOM',-3,-6),depth:6,name:'Room A'}, right={...template('ROOM',3,-6),depth:6,name:'Room B'};
  return {version:1,elements:[lobby,corridor,left,right],doors:[{id:crypto.randomUUID(),a:lobby.id,b:corridor.id,at:0,width:1.2,height:2.2},{id:crypto.randomUUID(),a:corridor.id,b:left.id,at:-5,width:1.2,height:2.2},{id:crypto.randomUUID(),a:corridor.id,b:right.id,at:-5,width:1.2,height:2.2}]};
}
export function layoutIssues(doc: LayoutDocument) {
  const errors:string[]=[], warnings:string[]=[];
  if(doc.elements.length>200 || doc.doors.length>200)errors.push('A layout supports at most 200 elements and 200 doorways.');
  const wallEdges:{axis:string;line:number;lo:number;hi:number}[]=[];
  for(const e of doc.elements){const b=bounds(e);if(isRoom(e)){wallEdges.push({axis:'x',line:b.top,lo:b.left,hi:b.right},{axis:'x',line:b.bottom,lo:b.left,hi:b.right},{axis:'z',line:b.left,lo:b.top,hi:b.bottom},{axis:'z',line:b.right,lo:b.top,hi:b.bottom});}else if(e.kind==='WALL'){wallEdges.push(Math.abs(e.rotation)%180===90?{axis:'z',line:e.x,lo:b.top,hi:b.bottom}:{axis:'x',line:e.z,lo:b.left,hi:b.right});}}
  wallEdges.forEach((a,i)=>wallEdges.slice(i+1).forEach(b=>{const distance=Math.abs(a.line-b.line);if(a.axis===b.axis&&distance>1e-5&&distance<0.12-1e-5&&Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo)>1e-5)errors.push('Parallel wall thicknesses overlap. Align their edges or leave at least 0.12 m.');}));
  const rooms=doc.elements.filter(isRoom);
  for (let i=0;i<rooms.length;i++) for (const b of rooms.slice(i+1)) { const a=bounds(rooms[i]), c=bounds(b); if(Math.min(a.right,c.right)-Math.max(a.left,c.left)>1e-5 && Math.min(a.bottom,c.bottom)-Math.max(a.top,c.top)>1e-5) errors.push(`${rooms[i].name} overlaps ${b.name}.`); }
  for (const e of doc.elements) {
    if (!e.name.trim() || [e.x,e.z,e.width,e.depth,e.height,e.rotation,e.scale].some(n=>!Number.isFinite(n)) || Math.abs(e.x)>1000 || Math.abs(e.z)>1000 || e.width<0.1 || e.width>100 || e.depth<0.1 || e.depth>100 || e.height<0.1 || e.height>10 || e.scale<0.001 || e.scale>100 || Math.abs(e.rotation)>360) errors.push(`${e.name}: check dimensions and transforms.`);
    if (isRoom(e) && (e.width<1 || e.depth<1 || e.height<2.2)) errors.push(`${e.name}: room needs at least 1 m sides and 2.2 m height.`);
    if(e.room_id && (e.kind!=='INSTANCE'||!rooms.some(r=>r.id===e.room_id)))errors.push(`${e.name}: streaming room must reference a template room.`);
    if (e.kind==='INSTANCE' && !e.asset_id) errors.push(`${e.name}: choose an uploaded GLB.`);
  }
  const doors=doc.doors.map(d=>({d,a:doc.elements.find(e=>e.id===d.a),b:doc.elements.find(e=>e.id===d.b)}));
  const edges=doors.map(({a,b})=>a&&b?sharedEdge(a,b):null);
  doors.forEach(({d,a,b},i)=>{
    const edge=edges[i];
    if(!a || !b || !isRoom(a) || !isRoom(b) || a.id===b.id || !edge || !Number.isFinite(d.at) || !Number.isFinite(d.width) || !Number.isFinite(d.height) || d.width<0.8 || d.width>10 || d.height<2 || d.height>Math.min(a.height,b.height) || d.at-d.width/2<edge.start+0.12-1e-5 || d.at+d.width/2>edge.end-0.12+1e-5) { errors.push('Doorway needs adjacent edges, 0.8 m width, 2 m height and 0.12 m end clearance.'); return; }
    doors.slice(0,i).forEach(({d:prior},j)=>{const p=edges[j];if(p && p.axis===edge.axis && Math.abs(p.line-edge.line)<1e-5 && Math.abs(prior.at-d.at)<(prior.width+d.width)/2+0.12) errors.push('Doorway openings overlap.');});
    doc.elements.filter(e=>e.kind==='WALL').forEach(e=>{const b=bounds(e);if(edge.axis==='x'?edge.line>=b.top-0.12&&edge.line<=b.bottom+0.12&&b.right>d.at-d.width/2&&b.left<d.at+d.width/2:edge.line>=b.left-0.12&&edge.line<=b.right+0.12&&b.bottom>d.at-d.width/2&&b.top<d.at+d.width/2)errors.push('Standalone wall blocks a doorway.');});
  });
  if (rooms.length>1) {
    const reached=new Set([rooms[0].id]); let changed=true;
    while(changed) {changed=false;for(const d of doc.doors) {if(!reached.has(d.a)&&!reached.has(d.b))continue;for(const id of [d.a,d.b])if(!reached.has(id)){reached.add(id);changed=true;}}}
    const disconnected=rooms.filter(e=>!reached.has(e.id));if(disconnected.length)warnings.push(`Disconnected rooms: ${disconnected.map(e=>e.name).join(', ')}. Connect touching edges with a doorway.`);
  }
  return {errors:[...new Set(errors)],warnings};
}
export function attachPoint(e: LayoutElement, p: {x:number;y:number;z:number}): Attachment {
  const a=e.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),scale=e.kind==='INSTANCE'?e.scale:1,x=p.x-e.x,z=p.z-e.z;
  return {element_id:e.id,local:[(c*x-s*z)/scale,p.y/scale,(s*x+c*z)/scale]};
}
export function attachmentPoint(doc: LayoutDocument, attachment: Attachment) {
  const e=doc.elements.find(e=>e.id===attachment.element_id);if(!e)return null;
  const a=e.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),scale=e.kind==='INSTANCE'?e.scale:1,[x,y,z]=attachment.local;
  return {x:e.x+scale*(c*x+s*z),y:scale*y,z:e.z+scale*(-s*x+c*z),attachment};
}
export function layoutHotspots(hotspots: Hotspot[],doc:LayoutDocument):Hotspot[] {return hotspots.map(h=>{
  const p=h.position;if(!('x' in p) || !p.attachment)return h;
  return {...h,position:attachmentPoint(doc,p.attachment) || p};
});}
export function canonicalLayout(d: LayoutDocument) {
 const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v;
 return JSON.stringify(ordered({navigation:d.navigation||null,materials:d.materials||[],version:d.version,elements:[...d.elements].sort((a,b)=>a.id.localeCompare(b.id)),doors:[...d.doors].sort((a,b)=>a.id.localeCompare(b.id))}));
}
export function worldPoint(position:HotspotPosition) {return 'x' in position?position:null;}

export type RoomSide='east'|'south'|'west'|'north';
// Add a usable connection, keeping the same geometry and validation as manual doors.
export function connectedRoom(doc:LayoutDocument,anchor:LayoutElement,kind:LayoutKind='ROOM',side?:RoomSide):LayoutDocument|undefined {
 if(!isRoom(anchor)||!['LOBBY','ROOM','CORRIDOR'].includes(kind))return;
 const b=bounds(anchor);
 for(const direction of side?[side]:['east','south','west','north'] as RoomSide[]){
  const room=template(kind);room.name=`${room.name} ${doc.elements.filter(e=>e.kind===kind).length+1}`;
  room.x=direction==='east'?b.right+room.width/2:direction==='west'?b.left-room.width/2:anchor.x;
  room.z=direction==='south'?b.bottom+room.depth/2:direction==='north'?b.top-room.depth/2:anchor.z;
  const edge=sharedEdge(anchor,room);if(!edge||edge.end-edge.start<1.04)continue;
  const next={...doc,elements:[...doc.elements,room],doors:[...doc.doors,{id:crypto.randomUUID(),a:anchor.id,b:room.id,at:(edge.start+edge.end)/2,width:Math.min(1.2,edge.end-edge.start-.24),height:Math.min(2.2,anchor.height,room.height)}]};
  if(!layoutIssues(next).errors.length)return next;
 }
}

// Spatial edits invalidate reviewed room containment; material edits do not.
export function invalidateRoomAssignments(previous:LayoutDocument,next:LayoutDocument):LayoutDocument {
 const transformKeys=['x','z','width','depth','height','rotation','scale','asset_id'] as const;
 const changed=(id:string)=>{const before=previous.elements.find(e=>e.id===id),after=next.elements.find(e=>e.id===id);return !before||!after||transformKeys.some(key=>before[key]!==after[key]);};
 return {...next,elements:next.elements.map(e=>e.room_id&&(changed(e.id)||changed(e.room_id))?{...e,room_id:undefined}:e)};
}

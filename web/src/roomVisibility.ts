import { Box3, Camera, Frustum, Matrix4, Plane, Vector3 } from 'three';
import { bounds, isRoom, sharedEdge, type LayoutDocument } from './layout.ts';
export type VisibilityRoom = { id:string; box:Box3 };
// Visibility portals are geometric openings, never navigation exits/permissions.
export type VisibilityOpening = { a:string;b:string;vertices:Vector3[] };
export function layoutRoomMetadata(doc:LayoutDocument) {
 const rooms:VisibilityRoom[]=doc.elements.filter(isRoom).map(e=>{const b=bounds(e);return {id:e.id,box:new Box3(new Vector3(b.left,0,b.top),new Vector3(b.right,e.height,b.bottom))};});
 const openings:VisibilityOpening[]=doc.doors.flatMap(d=>{
  const a=doc.elements.find(e=>e.id===d.a),b=doc.elements.find(e=>e.id===d.b),edge=a&&b?sharedEdge(a,b):null;if(!edge)return [];
  const point=(along:number,y:number)=>edge.axis==='x'?new Vector3(along,y,edge.line):new Vector3(edge.line,y,along);
  return [{a:d.a,b:d.b,vertices:[point(d.at-d.width/2,0),point(d.at+d.width/2,0),point(d.at+d.width/2,d.height),point(d.at-d.width/2,d.height)]}];
 });
 // Unclassified structural imports/open floors can introduce windows, stairs or
 // atriums not represented by template doors. Keep the full view in that case.
 const conservative=doc.doors.length!==openings.length||doc.elements.some(e=>e.kind==='FLOOR'||(e.kind==='INSTANCE'&&(!e.room_id||e.floor_meshes?.length)));
 return {rooms,openings,conservative};
}
function clip(vertices:Vector3[],planes:Plane[]) {
 let polygon=vertices.map(v=>v.clone());
 for(const plane of planes){const next:Vector3[]=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=plane.distanceToPoint(a),db=plane.distanceToPoint(b);if(da>=-1e-5)next.push(a);if((da>=0)!==(db>=0))next.push(a.clone().lerp(b,da/(da-db)));}polygon=next;if(polygon.length<3)return [];
 }return polygon;
}
export function visibleRooms(camera:Camera,rooms:VisibilityRoom[],openings:VisibilityOpening[],inspection=false):Set<string> {
 const all=()=>new Set(rooms.map(r=>r.id));if(inspection||!rooms.length||camera.projectionMatrix.elements[15]!==0)return all();
 const eye=new Vector3().setFromMatrixPosition(camera.matrixWorld);
 const current=rooms.filter(r=>r.box.clone().expandByScalar(.08).containsPoint(eye));
 // Door planes, exterior views and uncertain room membership use full visibility.
 if(!current.length||current.length>2)return all();
 if(current.length===2&&!openings.some(p=>current.some(r=>r.id===p.a)&&current.some(r=>r.id===p.b)))return all();
 const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const result=new Set<string>(current.map(r=>r.id));let visits=0;
 const visit=(id:string,planes:Plane[],path:Set<string>)=>{
  if(++visits>512)return false;
  for(const opening of openings){const next=opening.a===id?opening.b:opening.b===id?opening.a:undefined;if(!next||path.has(next))continue;
   const polygon=clip(opening.vertices,planes);if(polygon.length<3)continue;
   const center=polygon.reduce((sum,v)=>sum.add(v),new Vector3()).divideScalar(polygon.length);
   if(center.distanceTo(eye)<.15){result.add(next);if(!visit(next,planes,new Set([...path,next])))return false;continue;}
   const cone=polygon.map((v,i)=>{const p=new Plane().setFromCoplanarPoints(eye,v,polygon[(i+1)%polygon.length]);if(p.distanceToPoint(center)<0)p.negate();return p;});
   result.add(next);if(!visit(next,[...planes,...cone],new Set([...path,next])))return false;
  }return true;
 };
 for(const room of current)if(!visit(room.id,frustum.planes,new Set(current.map(r=>r.id))))return all();
 return result;
}
export function preloadRooms(visible:Set<string>,openings:VisibilityOpening[]) {
 const wanted=new Set(visible);for(const p of openings)if(visible.has(p.a)||visible.has(p.b)){wanted.add(p.a);wanted.add(p.b);}return wanted;
}

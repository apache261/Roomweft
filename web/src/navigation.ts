import { collisionGeometry, immutableGeometryIdentity } from './collisionGeometry.ts';
import { acquireNavigation, saveNavigation, releaseNavigation, navigationIdentity } from './navigationCache.ts';
import { performanceStage } from './performanceMetrics.ts';
import { Box3, Mesh, Object3D, Ray, Triangle, Vector3, InterleavedBufferAttribute } from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { TriangleIndex } from './TriangleIndex.ts';
import type { CameraView } from './api';
import { navigationSettings, type NavigationSettings, type Portal, type WalkRegion } from './navigationSettings.ts';
export const EYE_HEIGHT=1.65;
export const WALK_RADIUS=0.22;
const DOWN=new Vector3(0,-1,0),UP=new Vector3(0,1,0),SKIN=0.002;
export interface NavigationWorld {
 readonly bounds:Box3;grounded(position:Vector3,regionId?:string):Vector3|undefined;start():CameraView|undefined;move(position:Vector3,delta:Vector3):Vector3;dispose():void;recovery?():CameraView|undefined;
}
// Triangles are indexed once. Collision is independent of visual culling and
// floor eligibility, with bounded capsule sweeps rather than bounding-box walls.
export class WalkWorld implements NavigationWorld {
 readonly bounds:Box3;readonly settings:NavigationSettings;readonly regions:WalkRegion[];
 private collision=new TriangleIndex();private floors=new Map<string,TriangleIndex>();private starts:number[][];
 private cacheKey="";private disposed=false;
 private blockedRooms:{left:number;right:number;top:number;bottom:number}[]=[];
 private admits:((p:Vector3,radius:number,eyeHeight:number)=>boolean)|undefined;
 private exterior:string|undefined;private entryPose:CameraView|undefined;
 constructor(model:Object3D,settings?:NavigationSettings) {
  const finish = performanceStage('collision-preparation');
  this.admits=model.userData.admitsMovement;this.settings=navigationSettings(settings||model.userData.navigation);this.blockedRooms=model.userData.blockedRooms||[];
  model.updateWorldMatrix(true,true);this.bounds=new Box3().setFromObject(model);this.starts=model.userData.walkStarts||[];
  this.regions=model.userData.walkRegions||this.settings.regions;
  const signature:string[]=[];
  const fingerprint=(object:Object3D,path:string,blocked=false)=>{
   blocked=blocked||object.userData.collidable===false;
   if(object instanceof Mesh&&!blocked){const g=collisionGeometry(object);signature.push(JSON.stringify([path,object.userData.materialPath,object.userData.walkFloor,immutableGeometryIdentity(g)||g.uuid,immutableGeometryIdentity(g)?0:navigationIdentity(g.getAttribute('position')),g.getAttribute('position') instanceof InterleavedBufferAttribute ? (g.getAttribute('position') as InterleavedBufferAttribute).data.version : (g.getAttribute('position') as import('three').BufferAttribute)?.version,immutableGeometryIdentity(g)?0:navigationIdentity(g.index||undefined),g.index?.version,object.matrixWorld.elements]));}
   object.children.forEach((child,i)=>fingerprint(child,`${path}/${i}`,blocked));
  };fingerprint(model,'0');
  this.cacheKey=JSON.stringify([this.settings,this.regions,signature]);
  const cached=acquireNavigation(this.cacheKey);
  if(cached){this.collision=cached.collision;this.floors=cached.floors;finish();return;}
  for(const region of this.regions)this.floors.set(region.id,new TriangleIndex());
  const visit=(object:Object3D,path:string,blocked=false)=>{
   blocked=blocked||object.userData.collidable===false;
   if(object instanceof Mesh&&!blocked){const geometry=collisionGeometry(object),pos=geometry.getAttribute('position'),indices=geometry.index;if(pos){const count=indices?.count||pos.count;
    for(let i=0;i+2<count;i+=3){const vertices=[0,1,2].map(j=>new Vector3().fromBufferAttribute(pos,indices?indices.getX(i+j):i+j).applyMatrix4(object.matrixWorld));const t=new Triangle(...vertices as [Vector3,Vector3,Vector3]);const normal=t.getNormal(new Vector3());if(!Number.isFinite(normal.x)||normal.lengthSq()<0.5)continue;
     this.collision.addTriangle(t);this.collision.addTriangle(new Triangle(t.c.clone(),t.b.clone(),t.a.clone()));
     if(normal.y>=Math.cos(this.settings.max_slope*Math.PI/180))for(const region of this.regions){const eligible=object.userData.walkFloor===true||region.floor_meshes?.includes(object.userData.materialPath||path);if(eligible&&vertices.every(v=>v.y>=region.min_y-0.001&&v.y<=region.max_y+0.001))this.floors.get(region.id)!.addTriangle(t);}
    }
   }}object.children.forEach((child,i)=>visit(child,`${path}/${i}`,blocked));
  };visit(model,'0');if(this.collision.triangles.length)this.collision.build();for(const tree of this.floors.values())if(tree.triangles.length)tree.build();
  saveNavigation(this.cacheKey,{collision:this.collision,floors:this.floors});
  finish();
 }
 dispose(){if(!this.disposed){this.disposed=true;releaseNavigation(this.cacheKey);}}
 private allowed(x:number,z:number,regionId?:string){return this.regions.filter(r=>(regionId?r.id===regionId:!r.exterior||r.id===this.exterior)&&x>=r.left-1e-6&&x<=r.right+1e-6&&z>=r.top-1e-6&&z<=r.bottom+1e-6);}
 private floor(p:Vector3,regionId?:string){let best:number|undefined;const feet=p.y-this.settings.eye_height;
  for(const r of this.allowed(p.x,p.z,regionId)){const hit=this.floors.get(r.id)!.rayIntersect(new Ray(new Vector3(p.x,feet+this.settings.step_height+0.03,p.z),DOWN));if(hit&&hit.distance<=2*this.settings.step_height+0.06){const y=hit.position.y;if(best===undefined||y>best)best=y;}}
  return best;
 }
 private capsule(p:Vector3){const feet=p.y-this.settings.eye_height;return new Capsule(new Vector3(p.x,feet+WALK_RADIUS+SKIN,p.z),new Vector3(p.x,p.y+0.1-WALK_RADIUS,p.z),WALK_RADIUS);}
 private contacts(p:Vector3){const cap=this.capsule(p),triangles:Triangle[]=[];this.collision.getCapsuleTriangles(cap,triangles);return triangles.flatMap(t=>{const hit=this.collision.triangleCapsuleIntersect(cap,t);return hit&&hit.depth>SKIN?[hit]:[];});}
 grounded(p:Vector3,regionId?:string):Vector3|undefined {
  if(!p.toArray().every(Number.isFinite)||this.admits&&!this.admits(p,WALK_RADIUS+SKIN*2,this.settings.eye_height))return;
  const radius=WALK_RADIUS+SKIN*2;if(this.blockedRooms.some(r=>p.x+radius>r.left&&p.x-radius<r.right&&p.z+radius>r.top&&p.z-radius<r.bottom))return;
  const heights:number[]=[];
  for(let i=-1;i<8;i++){const a=i*Math.PI/4,r=i===-1?0:WALK_RADIUS+SKIN*2;const y=this.floor(new Vector3(p.x+Math.sin(a)*r,p.y,p.z+Math.cos(a)*r),regionId);if(y===undefined)return;heights.push(y);}
  const floor=Math.max(...heights),result=new Vector3(p.x,floor+this.settings.eye_height,p.z);
  if(Math.abs(floor-(p.y-this.settings.eye_height))>this.settings.step_height+0.03||this.contacts(result).length)return;
  // The cylinder checks body clearance; this ray covers the lower step space.
  const head=this.collision.rayIntersect(new Ray(new Vector3(p.x,floor+0.03,p.z),UP));if(head&&head.distance<this.settings.eye_height+0.1-SKIN)return;
  return result;
 }
 start(regionId?:string):CameraView|undefined {
  for(const values of this.starts){const p=this.validStart(new Vector3(values[0],values[1]-EYE_HEIGHT+this.settings.eye_height,values[2]),regionId);if(p)return {position:p.toArray() as [number,number,number],yaw:0,pitch:0};}
  for(const r of this.regions.filter(r=>regionId?r.id===regionId:!r.exterior))for(const x of [0.5,0.25,0.75,0.1,0.9])for(const z of [0.5,0.25,0.75,0.1,0.9]){const px=r.left+(r.right-r.left)*x,pz=r.top+(r.bottom-r.top)*z;const hit=this.floors.get(r.id)!.rayIntersect(new Ray(new Vector3(px,r.max_y+0.03,pz),DOWN));if(!hit)continue;const p=this.validStart(new Vector3(px,hit.position.y+this.settings.eye_height,pz),regionId);if(p)return {position:p.toArray() as [number,number,number],yaw:0,pitch:0};}
 }
 private threshold(a:Vector3,b:Vector3){return this.settings.portals.some(p=>{const axis=p.axis,other=axis==='x'?'z':'x',coordinate=p.position[axis==='x'?0:2],middle=p.position[other==='x'?0:2];if((a[axis]-coordinate)*(b[axis]-coordinate)>0&&Math.abs(b[axis]-coordinate)>Math.abs(a[axis]-coordinate))return false;const near=Math.min(a[axis],b[axis])-WALK_RADIUS<=coordinate&&Math.max(a[axis],b[axis])+WALK_RADIUS>=coordinate;return near&&Math.min(a[other],b[other])-WALK_RADIUS<middle+p.width/2&&Math.max(a[other],b[other])+WALK_RADIUS>middle-p.width/2&&Math.abs(a.y-p.position[1])<this.settings.eye_height;});}
 private supportedSweep(a:Vector3,b:Vector3) {
  // Project every support path onto approved floor triangles and union exact
  // intervals. Even gaps smaller than the collision substep cannot be skipped.
  for(let sample=-1;sample<8;sample++){
   const angle=sample*Math.PI/4,radius=sample<0?0:WALK_RADIUS+SKIN*2,offset=new Vector3(Math.sin(angle)*radius,0,Math.cos(angle)*radius),start=a.clone().add(offset),end=b.clone().add(offset),intervals:[number,number][]=[];
   for(const region of this.regions.filter(r=>!r.exterior||r.id===this.exterior)){
    if(Math.max(start.x,end.x)<region.left||Math.min(start.x,end.x)>region.right||Math.max(start.z,end.z)<region.top||Math.min(start.z,end.z)>region.bottom)continue;
    const triangles=this.floors.get(region.id)!.getBoxTriangles(new Box3(new Vector3(Math.min(start.x,end.x)-SKIN,region.min_y-SKIN,Math.min(start.z,end.z)-SKIN),new Vector3(Math.max(start.x,end.x)+SKIN,region.max_y+SKIN,Math.max(start.z,end.z)+SKIN)));
    for(const triangle of triangles){let lo=0,hi=1;const clip=(v0:number,v1:number)=>{if(v0<-1e-7&&v1<-1e-7){hi=-1;return;}const delta=v1-v0;if(Math.abs(delta)<1e-12)return;const t=(-1e-7-v0)/delta;if(delta>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);};
     clip(start.x-region.left,end.x-region.left);clip(region.right-start.x,region.right-end.x);clip(start.z-region.top,end.z-region.top);clip(region.bottom-start.z,region.bottom-end.z);
     const vertices=[triangle.a,triangle.b,triangle.c],sign=Math.sign((triangle.b.x-triangle.a.x)*(triangle.c.z-triangle.a.z)-(triangle.b.z-triangle.a.z)*(triangle.c.x-triangle.a.x));
     for(let i=0;i<3;i++){const p=vertices[i],q=vertices[(i+1)%3],side=(v:Vector3)=>sign*((q.x-p.x)*(v.z-p.z)-(q.z-p.z)*(v.x-p.x));clip(side(start),side(end));}
     const normal=triangle.getNormal(new Vector3()),difference=(v:Vector3)=>v.y-this.settings.eye_height-triangle.a.y+(normal.x*(v.x-triangle.a.x)+normal.z*(v.z-triangle.a.z))/normal.y,limit=this.settings.step_height+0.03,d0=difference(start),d1=difference(end);clip(limit-d0,limit-d1);clip(limit+d0,limit+d1);
     if(lo<=hi)intervals.push([Math.max(0,lo),Math.min(1,hi)]);
    }
   }
   intervals.sort((x,y)=>x[0]-y[0]);let covered=0;for(const [lo,hi]of intervals){if(lo>covered+1e-6)break;covered=Math.max(covered,hi);}if(covered<1-1e-6)return false;
  }return true;
 }
 move(position:Vector3,delta:Vector3):Vector3 {
  if(!delta.toArray().every(Number.isFinite)||delta.length()>100)return position.clone();
  let result=position.clone();const count=Math.max(1,Math.ceil(delta.length()/0.025)),part=delta.clone().divideScalar(count);
  const attempt=(a:Vector3,b:Vector3)=>{if(this.threshold(a,b))return;const grounded=this.grounded(b);return grounded&&this.supportedSweep(a,grounded)?grounded:undefined;};
  for(let i=0;i<count;i++){const candidate=result.clone().add(part),full=attempt(result,candidate);if(full){result=full;continue;}
   // Project movement onto the actual contact plane for diagonal walls.
   const contact=this.contacts(candidate).find(c=>Math.abs(c.normal.y)<0.7);
   if(contact){const slide=part.clone().addScaledVector(contact.normal,-part.dot(contact.normal));slide.y=0;const p=attempt(result,result.clone().add(slide));if(p){result=p;continue;}}
   for(const axis of ['x','z'] as const){const p=attempt(result,result.clone().add(new Vector3(axis==='x'?part.x:0,0,axis==='z'?part.z:0)));if(p)result=p;}
  }return result;
 }
 canActivate(p:Portal,position:Vector3){const point=new Vector3(...p.position);if(point.distanceTo(position)>1.5)return false;const direction=point.clone().sub(position),distance=direction.length();if(distance<0.01)return true;const hit=this.collision.rayIntersect(new Ray(position,direction.normalize()));return !hit||hit.distance>=distance-SKIN;}
 validStart(position:Vector3,regionId?:string){const valid=this.grounded(position,regionId);if(!valid)return;const locked=this.settings.portals.some(p=>Math.abs(position[p.axis]-p.position[p.axis==='x'?0:2])<WALK_RADIUS+SKIN&&Math.abs(position[p.axis==='x'?'z':'x']-p.position[p.axis==='x'?2:0])<p.width/2+WALK_RADIUS&&Math.abs(position.y-p.position[1])<this.settings.eye_height);return locked?undefined:valid;}
 recovery(){if(this.exterior){const valid=this.entryPose&&this.validStart(new Vector3(...this.entryPose.position),this.exterior);return valid?{...this.entryPose!,position:valid.toArray() as [number,number,number]}:this.start(this.exterior);}return this.start();}
 snapshotNavigation(){return {configuration:JSON.stringify([this.settings,this.regions]),exterior:this.exterior,entryPose:this.entryPose?{...this.entryPose,position:[...this.entryPose.position] as [number,number,number]}:undefined};}
 restoreNavigation(snapshot:ReturnType<WalkWorld['snapshotNavigation']>|undefined){
  if(!snapshot||snapshot.configuration!==JSON.stringify([this.settings,this.regions])||!snapshot.exterior||!snapshot.entryPose)return;
  if(this.regions.some(r=>r.id===snapshot.exterior&&r.exterior)&&this.validStart(new Vector3(...snapshot.entryPose.position),snapshot.exterior)){this.exterior=snapshot.exterior;this.entryPose=snapshot.entryPose;}
 }
 get exteriorActive(){return !!this.exterior;}
 enter(p:Portal):CameraView|undefined {const valid=this.validStart(new Vector3(...p.arrival.position),p.destination_region_id);if(!valid)return;const region=this.regions.find(r=>r.id===p.destination_region_id);this.exterior=region?.exterior?region.id:undefined;const pose={...p.arrival,position:valid.toArray() as [number,number,number]};this.entryPose=this.exterior?pose:undefined;return pose;}
}

// Fixed 120 Hz integration gives the same acceleration at 30/60/120 FPS.
export class WalkSimulation {
 readonly velocity=new Vector3();private accumulated=0;private last:Vector3|undefined;
 private world:NavigationWorld;private speed:number;private smooth:boolean;
 constructor(world:NavigationWorld,speed=2,smooth=true){this.world=world;this.speed=speed;this.smooth=smooth;}
 clear(){this.velocity.set(0,0,0);this.accumulated=0;}
 step(position:Vector3,input:Vector3,seconds:number){if(!Number.isFinite(seconds)||seconds<0){this.clear();return position.clone();}let current=position.clone();
  if(!this.world.grounded(current)){const recover=this.last&&this.world.grounded(this.last);const start=recover||(this.world.recovery?this.world.recovery():this.world.start())?.position;if(!start){this.clear();return current;}current=Array.isArray(start)?new Vector3(...start):start;this.clear();}
  if(seconds>0.25){this.clear();this.last=current.clone();return current;}
  this.accumulated+=Math.min(seconds,0.1);let work=0;
  while(this.accumulated+1e-9>=1/120&&work++<12){this.accumulated-=1/120;const target=input.clone();if(target.lengthSq()>1)target.normalize();target.multiplyScalar(this.speed);if(this.smooth){const change=target.sub(this.velocity),limit=(input.lengthSq()?10:14)/120;if(change.length()>limit)change.setLength(limit);this.velocity.add(change);}else this.velocity.copy(target);const next=this.velocity.lengthSq()>1e-10?this.world.move(current,this.velocity.clone().multiplyScalar(1/120)):current;current=next;this.last=current.clone();}
  return current;
 }
}

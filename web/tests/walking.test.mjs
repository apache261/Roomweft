import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {WalkWorld,WalkSimulation} from '../src/navigation.ts';
import {defaultNavigation} from '../src/navigationSettings.ts';
const box=(root,size,p,floor=false)=>{const mesh=new Mesh(new BoxGeometry(...size),new MeshBasicMaterial());mesh.position.fromArray(p);mesh.userData.walkFloor=floor;root.add(mesh);return mesh;};
const region=(values={})=>({id:crypto.randomUUID(),name:'Interior',left:-6,right:6,top:-6,bottom:6,min_y:-0.01,max_y:0.01,...values});
function fixture(){const root=new Group();box(root,[12,.2,12],[0,-.1,0],true);root.userData.walkRegions=[region()];return root;}
test('unreviewed imports, roofs and decoration tops never supply standing floors',()=>{
 const root=new Group();box(root,[8,.2,8],[0,-.1,0]);const unreviewed=new WalkWorld(root);assert.equal(unreviewed.start(),undefined);unreviewed.dispose();
 root.userData.walkRegions=[region()];box(root,[4,.2,4],[0,3,0]);const noFloor=new WalkWorld(root);assert.equal(noFloor.start(),undefined);noFloor.dispose();
 const approved=fixture();box(approved,[2,.2,2],[0,3,0]);const world=new WalkWorld(approved);assert.equal(world.grounded(new Vector3(0,4.75,0)),undefined);assert.ok(world.grounded(new Vector3(0,1.65,0)));world.dispose();
});
test('30/60/120 FPS schedules have matching acceleration, normalized diagonals and bounded long-frame recovery',()=>{
 const positions=[];for(const fps of [30,60,120]){const world=new WalkWorld(fixture()),sim=new WalkSimulation(world),start=new Vector3(0,1.65,0);let p=start.clone();for(let i=0;i<fps;i++)p=sim.step(p,new Vector3(1,0,1),1/fps);positions.push(p);assert.ok(p.distanceTo(start)>1.7&&p.distanceTo(start)<2.01);const pause=sim.step(p,new Vector3(1,0,1),4);assert.ok(pause.distanceTo(p)<1e-9);assert.equal(sim.velocity.length(),0);for(let i=0;i<fps/2;i++)p=sim.step(p,new Vector3(),1/fps);assert.ok(p.distanceTo(positions.at(-1))<0.16);const recovered=sim.step(new Vector3(NaN,9,20),new Vector3(),1/60);assert.ok(world.grounded(recovered));sim.clear();assert.equal(sim.velocity.length(),0);world.dispose();}
 assert.ok(positions[0].distanceTo(positions[1])<1e-7);assert.ok(positions[1].distanceTo(positions[2])<1e-7);
});
test('capsule sweeps stop at thin walls, floor gaps, low ceilings and window barriers and slide along angled walls',()=>{
 const root=fixture();box(root,[.004,3,10],[1,1.5,0]);const world=new WalkWorld(root);const stop=world.move(new Vector3(0,1.65,0),new Vector3(5,0,0));assert.ok(stop.x<.79);assert.ok(world.move(new Vector3(.75,1.65,0),new Vector3(2,0,-2)).z<-1.8);world.dispose();
 const angled=fixture(),wall=box(angled,[.01,3,10],[1,1.5,0]);wall.rotation.y=Math.PI/4;const diagonal=new WalkWorld(angled);const slide=diagonal.move(new Vector3(0,1.65,0),new Vector3(3,0,-1));assert.ok(slide.z>0.1,JSON.stringify(slide));assert.ok(diagonal.grounded(slide));diagonal.dispose();
 for(const width of [.2,.004]){const gap=new Group();box(gap,[4,.2,4],[-2,-.1,0],true);box(gap,[4,.2,4],[2+width,-.1,0],true);gap.userData.walkRegions=[region()];const missing=new WalkWorld(gap);assert.ok(missing.move(new Vector3(-1,1.65,0),new Vector3(4,0,0)).x<0);missing.dispose();}
 const ceiling=fixture();box(ceiling,[4,.05,4],[0,1.4,0]);const low=new WalkWorld(ceiling);assert.equal(low.grounded(new Vector3(0,1.65,0)),undefined);low.dispose();
});
test('ramps and simple stairs are validated separately, with configured slope and step limits',()=>{
 const ramp=new Group(),r=box(ramp,[6,.1,4],[0,0,0],true);r.rotation.z=Math.PI/12;ramp.userData.walkRegions=[region({min_y:-1,max_y:1})];const world=new WalkWorld(ramp);let p=new Vector3(-2,-2*Math.tan(Math.PI/12)+.05+1.65,0);assert.ok(world.grounded(p));p=world.move(p,new Vector3(4,0,0));assert.ok(p.x>1.8&&p.y>2);world.dispose();const steep=new WalkWorld(ramp,{...defaultNavigation,max_slope:10});assert.equal(steep.start(),undefined);steep.dispose();
 const stairs=new Group();box(stairs,[4,.2,4],[-2,-.1,0],true);for(let i=0;i<4;i++)box(stairs,[.6,.2*(i+1),4],[.3+i*.6,.1*(i+1),0],true);box(stairs,[4,.8,4],[4.4,.4,0],true);stairs.userData.walkRegions=[region({min_y:-.01,max_y:.81})];const stairWorld=new WalkWorld(stairs);const top=stairWorld.move(new Vector3(-1,1.65,0),new Vector3(4,0,0));assert.ok(top.x>2.9&&top.y>2.4,JSON.stringify(top));const down=stairWorld.move(top,new Vector3(-4,0,0));assert.ok(down.x<-.9&&down.y<1.7);stairWorld.dispose();const tooHigh=new WalkWorld(stairs,{...defaultNavigation,step_height:.1});assert.ok(tooHigh.move(new Vector3(-1,1.65,0),new Vector3(4,0,0)).x<0);tooHigh.dispose();
});
test('outdoor floors and portal thresholds remain locked until a validated click, with a safe return',()=>{
 const root=fixture(),inside=region({top:-2,bottom:4}),outside=region({name:'Courtyard',top:-6,bottom:-2,exterior:true});root.userData.walkRegions=[inside,outside];
 const exit={id:crypto.randomUUID(),label:'Enter courtyard',position:[0,1.65,-1.8],axis:'z',width:2,destination_region_id:outside.id,arrival:{position:[0,1.65,-3],yaw:0,pitch:0}},back={id:crypto.randomUUID(),label:'Return inside',position:[0,1.65,-2.5],axis:'z',width:2,destination_region_id:inside.id,arrival:{position:[0,1.65,0],yaw:0,pitch:0}};root.userData.navigation={...defaultNavigation,portals:[exit,back]};
 const world=new WalkWorld(root);const blocked=world.move(new Vector3(0,1.65,0),new Vector3(0,0,-5));assert.ok(blocked.z>-1.6);assert.equal(world.grounded(new Vector3(0,1.65,-4)),undefined);assert.ok(world.canActivate(exit,blocked));assert.equal(world.canActivate(exit,new Vector3(4,1.65,0)),false);
 const pose=world.enter(exit);assert.ok(pose);const exterior=new Vector3(...pose.position);assert.ok(world.grounded(exterior));assert.ok(world.recovery().position[2]<-2);assert.ok(world.move(exterior,new Vector3(0,0,5)).z<-2.7);assert.ok(world.canActivate(back,exterior));const returned=world.enter(back);assert.ok(returned);assert.equal(world.grounded(new Vector3(0,1.65,-4)),undefined);
 assert.equal(world.enter({...exit,arrival:{...exit.arrival,position:[100,1.65,100]}}),undefined);world.dispose();
});

test('editor navigation starts and stops immediately while visitor movement keeps acceleration',()=>{
 const world=new WalkWorld(fixture()),start=new Vector3(0,1.65,0),editor=new WalkSimulation(world,2,false),visitor=new WalkSimulation(world,2);
 const instant=editor.step(start,new Vector3(1,0,0),1/120),eased=visitor.step(start,new Vector3(1,0,0),1/120);assert.ok(instant.x>eased.x*10);assert.ok(editor.step(instant,new Vector3(),1/60).distanceTo(instant)<1e-9);assert.ok(visitor.step(eased,new Vector3(),1/120).x>=eased.x);world.dispose();
});

test('runtime replacement preserves explicit exterior access only while approvals and configuration still agree',()=>{
 const root=fixture(),inside=region({id:'inside',top:-1.5}),outside=region({id:'outside',name:'Courtyard',bottom:-1.5,exterior:true});root.userData.walkRegions=[inside,outside];
 const exit={id:'exit',label:'Courtyard',position:[0,1.65,-1.8],axis:'z',width:2,destination_region_id:outside.id,arrival:{position:[0,1.65,-3],yaw:0,pitch:0}};root.userData.navigation={...defaultNavigation,portals:[exit]};
 const world=new WalkWorld(root);assert.ok(world.enter(exit));const state=world.snapshotNavigation();
 const replacement=new WalkWorld(root);replacement.restoreNavigation(state);assert.ok(replacement.exteriorActive);assert.ok(replacement.grounded(new Vector3(0,1.65,-3)));
 root.userData.walkRegions=[inside];const changed=new WalkWorld(root);changed.restoreNavigation(state);assert.equal(changed.exteriorActive,false);assert.equal(changed.grounded(new Vector3(0,1.65,-3)),undefined);
 world.dispose();replacement.dispose();changed.dispose();
});

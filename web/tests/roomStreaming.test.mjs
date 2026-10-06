import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BoxGeometry,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,Vector3} from 'three';
import {visibleRooms,preloadRooms,layoutRoomMetadata} from '../src/roomVisibility.ts';
import {RoomChunkCache} from '../src/roomStreaming.ts';
import {starterLayout,template,layoutIssues,invalidateRoomAssignments} from '../src/layout.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {WalkWorld} from '../src/navigation.ts';
import {prepareSpatialRendering} from '../src/spatialRendering.ts';
const camera=()=>{const c=new PerspectiveCamera(65,1,.05,1000);c.position.set(0,1.65,0);c.lookAt(0,1.65,-10);c.updateMatrixWorld();return c;};
const rooms=[0,1,2,3].map(i=>({id:String(i),box:new Box3(new Vector3(-3,0,2-i*4),new Vector3(3,3,6-i*4))}));
// Room zero contains the camera in these fixtures.
rooms[0].box.set(new Vector3(-3,0,-2),new Vector3(3,3,2));rooms[1].box.set(new Vector3(-3,0,-6),new Vector3(3,3,-2));rooms[2].box.set(new Vector3(-3,0,-10),new Vector3(3,3,-6));rooms[3].box.set(new Vector3(3,0,-6),new Vector3(7,3,-2));
const opening=(a,b,z,x=0)=>({a,b,vertices:[new Vector3(x-.6,0,z),new Vector3(x+.6,0,z),new Vector3(x+.6,2.2,z),new Vector3(x-.6,2.2,z)]});
test('portal clipping follows aligned openings and rejects a connected room outside the portal cone',()=>{
 const c=camera(),portals=[opening('0','1',-2),opening('1','2',-6),opening('1','3',-4,4)];
 const visible=visibleRooms(c,rooms,portals);assert.deepEqual([...visible].sort(),['0','1','2']);
 assert.ok(preloadRooms(visible,portals).has('3'));
 c.lookAt(0,1.65,10);c.updateMatrixWorld();assert.deepEqual([...visibleRooms(c,rooms,portals)],['0']);
});
test('inspection, exterior, doorway boundaries and missing structural metadata use conservative visibility',()=>{
 const c=camera();assert.equal(visibleRooms(c,rooms,[],true).size,4);
 c.position.set(20,2,0);c.updateMatrixWorld();assert.equal(visibleRooms(c,rooms,[]).size,4);
 c.position.set(0,1.65,-2);c.updateMatrixWorld();assert.equal(visibleRooms(c,rooms,[]).size,4);
 const doc=starterLayout();assert.equal(layoutRoomMetadata(doc).openings.length,3);doc.navigation={portals:[{id:'exit'}]};assert.equal(layoutRoomMetadata(doc).openings.length,3);
 doc.elements.push(template('FLOOR'));assert.equal(layoutRoomMetadata(doc).conservative,true);
});
test('unready room blocks the capsule before its doorway and rejects saved/portal arrivals until ready',()=>{
 const doc=starterLayout(),corridor=doc.elements.find(e=>e.kind==='CORRIDOR');
 const blocked=buildLayout(doc,new Map(),new Map(),new Map(),new Set([corridor.id])),world=new WalkWorld(blocked.root);
 const p=world.move(new Vector3(0,1.65,0),new Vector3(0,0,-5));assert.ok(p.z>-2.8);
 assert.equal(world.validStart(new Vector3(0,1.65,-5)),undefined);
 const ready=buildLayout(doc),next=new WalkWorld(ready.root);assert.ok(next.move(new Vector3(0,1.65,0),new Vector3(0,0,-5)).z<-4.9);
 next.dispose();world.dispose();ready.dispose();blocked.dispose();
});
test('room batching retains separate visibility owners, shared-wall owners, and exact navigation',()=>{
 const doc=starterLayout(),room=doc.elements[0];
 doc.elements.push({...template('INSTANCE',0,0),asset_id:'chair',room_id:room.id,collidable:false});
 const source=new Group(),mesh=new Mesh(new BoxGeometry(.5,.5,.5),new MeshStandardMaterial());mesh.position.y=.25;source.add(mesh);
 const prepared=buildLayout(doc,new Map([['chair',source]])),visual=prepareSpatialRendering(prepared.root);
 assert.ok(visual.root.children.some(o=>o.userData.roomIds.includes(room.id)));assert.ok(visual.root.children.some(o=>o.userData.roomIds.length===2));
 const world=new WalkWorld(prepared.root),start=world.start();visual.root.children.forEach(o=>o.visible=false);assert.deepEqual(world.start(),start);
 const imported=prepared.root.children.find(o=>o instanceof Group);assert.deepEqual(imported.userData.roomIds,[room.id]);
 world.dispose();visual.dispose();prepared.dispose();mesh.geometry.dispose();mesh.material.dispose();
 const invalid=starterLayout();invalid.elements.push({...template('INSTANCE'),asset_id:'chair',room_id:'missing'});assert.ok(layoutIssues(invalid).errors.some(e=>e.includes('streaming room')));
});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('chunk cache bounds concurrency, deduplicates shared assets, retries failures, evicts and revisits safely',async()=>{
 const pending=new Map(),loads=[],released=[],cache=new RoomChunkCache(id=>{loads.push(id);let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});pending.set(id,{resolve,reject});return {promise,release:()=>released.push(id)};},()=>{},2,2);
 cache.request(['a','a','b','c']);assert.deepEqual(loads,['a','b']);pending.get('a').resolve('A');await settle();assert.deepEqual(loads,['a','b','c']);pending.get('b').reject(new Error('offline'));pending.get('c').resolve('C');await settle();assert.equal(cache.entries.get('b').status,'failed');
 cache.retry();assert.equal(loads.filter(id=>id==='b').length,2);pending.get('b').resolve('B');await settle();
 cache.request(['d']);pending.get('d').resolve('D');await settle();assert.ok(cache.entries.size<=2);assert.ok(released.includes('a'));
 cache.request(['a']);assert.equal(loads.filter(id=>id==='a').length,2);pending.get('a').resolve('A2');await settle();cache.dispose();assert.equal(cache.entries.size,0);
 assert.equal(released.length,loads.length);
});
test('disposing pending room requests releases each lease once and ignores late completion',async()=>{
 let resolve,released=0,changed=0;const cache=new RoomChunkCache(()=>({promise:new Promise(r=>resolve=r),release:()=>released++}),()=>changed++);
 cache.request(['room']);cache.dispose();resolve('late');await settle();assert.equal(released,1);assert.equal(changed,0);assert.equal(cache.entries.size,0);
});

test('walking through a doorway near the camera plane does not request unrelated rooms',()=>{
 const c=camera(),portals=[opening('0','1',-2),opening('1','2',-6),opening('1','3',-4,4)];
 for(const z of [-1.94,-2.03,-2.09,-2.2]){c.position.set(0,1.65,z);c.lookAt(0,1.65,10);c.updateMatrixWorld();const visible=visibleRooms(c,rooms,portals);assert.ok(visible.size<=2,'near doorway stays conservative within the adjoining rooms');assert.ok(visible.has('0')||visible.has('1'));}
});

test('room containment review survives material edits and clears on instance/owner transforms',()=>{
 const before=starterLayout(),room=before.elements[0],instance={...template('INSTANCE'),asset_id:'chair',room_id:room.id};before.elements.push(instance);
 const edit=(id,values)=>({...before,elements:before.elements.map(e=>e.id===id?{...e,...values}:e)});
 assert.equal(invalidateRoomAssignments(before,edit(instance.id,{tint:'#ffffff'})).elements.at(-1).room_id,room.id);
 assert.equal(invalidateRoomAssignments(before,edit(instance.id,{scale:2})).elements.at(-1).room_id,undefined);
 assert.equal(invalidateRoomAssignments(before,edit(room.id,{width:8})).elements.at(-1).room_id,undefined);
});

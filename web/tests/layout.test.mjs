import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Vector3} from 'three';
import {starterLayout,template,layoutIssues,attachPoint,attachmentPoint,canonicalLayout} from '../src/layout.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {WalkWorld} from '../src/navigation.ts';

test('connected lobby and rooms share doorway geometry, solid walls, floor support and a safe spawn',()=>{
 const doc=starterLayout();assert.deepEqual(layoutIssues(doc),{errors:[],warnings:[]});
 const model=buildLayout(doc),world=new WalkWorld(model.root),start=world.start();assert.ok(new Vector3(...start.position).distanceTo(new Vector3(0,1.65,0))<1e-6);
 const corridor=world.move(new Vector3(...start.position),new Vector3(0,0,-5));assert.ok(corridor.z<-4.9);
 for(const x of [-3,3]) {const room=world.move(corridor,new Vector3(x,0,0));assert.ok(Math.abs(room.x-x)<0.01);assert.ok(world.grounded(room));const stop=world.move(room,new Vector3(10*Math.sign(x),0,0));assert.ok(Math.abs(stop.x)<4.75);}
 for(const delta of [new Vector3(10,0,0),new Vector3(0,0,10),new Vector3(0,0,-20)]) {const p=world.move(new Vector3(...start.position),delta);assert.ok(p.x<2.75 && p.z<2.75 && p.z>-6.75);}
 const side=world.move(new Vector3(0,1.65,-1),new Vector3(10,0,0));assert.ok(side.x<2.75);
 // Each coincident room edge is split into unique non-overlapping wall intervals.
 const signatures=new Set();for(const child of model.root.children)if(child instanceof Mesh){const p=child.geometry.parameters,key=JSON.stringify([child.position.toArray(),p.width,p.height,p.depth]);assert.ok(!signatures.has(key),'duplicate wall geometry');signatures.add(key);}
 assert.equal(world.grounded(new Vector3(50,1.65,0)),undefined);
 world.dispose();model.dispose();
});
test('narrow doorway remains usable while unsupported floor gaps and blocked openings stop walking',()=>{
 const doc=starterLayout();doc.doors[0].width=0.8;
 const model=buildLayout(doc),world=new WalkWorld(model.root);
 const p=world.move(new Vector3(0,1.65,0),new Vector3(0,0,-5));assert.ok(p.z<-4.9);
 world.dispose();model.dispose();
 doc.doors=[];const closed=buildLayout(doc),solid=new WalkWorld(closed.root);assert.ok(solid.move(new Vector3(0,1.65,0),new Vector3(0,0,-5)).z>-2.75);solid.dispose();closed.dispose();
 const floors={version:1,elements:[template('FLOOR',0,0),template('FLOOR',0,-5)],doors:[]};const gap=buildLayout(floors),edge=new WalkWorld(gap.root);assert.ok(edge.move(new Vector3(0,1.65,0),new Vector3(0,0,-8)).z>=-2);edge.dispose();gap.dispose();
});
test('instances share source geometry and textures, isolate materials and obey collision flag',()=>{
 const source=new Group(),original=new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial({color:'#ac4a24'}));original.position.y=0.5;source.add(original);
 const doc=starterLayout(),a={...template('INSTANCE',1,0),asset_id:'asset',tint:'#11aa22'},b={...a,id:crypto.randomUUID(),x:-1,rotation:45,scale:0.7,tint:'#2244cc',collidable:false};doc.elements.push(a,b);
 const model=buildLayout(doc,new Map([['asset',source]]));const instances=model.root.children.filter(e=>e instanceof Group);const copies=instances.map(g=>{let mesh;g.traverse(e=>{if(e instanceof Mesh)mesh=e;});return mesh;});
 assert.equal(copies[0].geometry,original.geometry);assert.equal(copies[1].geometry,original.geometry);assert.notEqual(copies[0].material,copies[1].material);assert.equal(original.material.color.getHexString(),'ac4a24');assert.equal(copies[0].material.color.getHexString(),'11aa22');
 const world=new WalkWorld(model.root);assert.equal(world.grounded(new Vector3(1,1.65,0)),undefined);assert.ok(world.grounded(new Vector3(-1,1.65,0)));
 const stopped=world.move(new Vector3(0,1.65,0),new Vector3(2,0,0));assert.ok(stopped.x<0.35);const through=world.move(new Vector3(0,1.65,0),new Vector3(-2,0,0));assert.ok(through.x<-1.9);
 world.dispose();model.dispose();original.geometry.dispose();original.material.dispose();
});
test('author validation catches overlaps, disconnected rooms, blocked doors and invalid attachment targets',()=>{
 const doc=starterLayout();doc.elements.push(template('ROOM'));assert.ok(layoutIssues(doc).errors.some(e=>e.includes('overlap')));doc.elements.pop();doc.doors=[];assert.ok(layoutIssues(doc).warnings.length);
 const blocked=starterLayout();blocked.elements.push({...template('WALL',0,-3),width:2});assert.ok(layoutIssues(blocked).errors.some(e=>e.includes('blocks')));
 const instance={...template('INSTANCE',3,4),scale:2,rotation:90};const p={x:5,y:2,z:1},a=attachPoint(instance,p),result=attachmentPoint({version:1,elements:[instance],doors:[]},a);assert.ok(Math.abs(result.x-p.x)<1e-8 && Math.abs(result.z-p.z)<1e-8);assert.equal(attachmentPoint({version:1,elements:[],doors:[]},a),null);
 const order=starterLayout(),reordered=JSON.parse(JSON.stringify(order),(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v);assert.equal(canonicalLayout(order),canonicalLayout(reordered));
});

test('quick-add connects a room with a usable doorway and rejects occupied sides',async()=>{
 const {connectedRoom}=await import('../src/layout.ts');const doc={version:1,elements:[template('LOBBY')],doors:[]},anchor=doc.elements[0];
 const joined=connectedRoom(doc,anchor,'ROOM','east');assert.ok(joined);assert.equal(doc.elements.length,1);assert.deepEqual(layoutIssues(joined),{errors:[],warnings:[]});assert.equal(joined.doors.length,1);
 const model=buildLayout(joined),world=new WalkWorld(model.root);assert.ok(world.move(new Vector3(0,1.65,0),new Vector3(5,0,0)).x>4.9);world.dispose();model.dispose();
 assert.equal(connectedRoom(joined,anchor,'ROOM','east'),undefined);const alternate=connectedRoom(joined,anchor);assert.ok(alternate);assert.equal(alternate.elements.length,3);assert.deepEqual(layoutIssues(alternate),{errors:[],warnings:[]});
 anchor.rotation=90;anchor.width=4;anchor.depth=8;const rotated=connectedRoom(doc,anchor,'CORRIDOR','north');assert.ok(rotated);assert.deepEqual(layoutIssues(rotated),{errors:[],warnings:[]});
});

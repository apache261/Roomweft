import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {Vector3} from 'three';
import {template} from '../src/layout.ts';
import {prepareModel,defaultSettings} from '../src/sceneSettings.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {WalkWorld} from '../src/navigation.ts';

test('five independently imported practice rooms provide continuous reviewed floors without generated geometry',async()=>{
 const parts=[['lobby',0,0],['room-1',-4,-1.5],['room-2',-4,1.5],['kitchen',4,-1],['cr',3.5,2]],sources=new Map(),elements=[];
 for(const [name,x,z] of parts){
  const bytes=await readFile(new URL(`../../assets/prefabs/practice-house/${name}.glb`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');sources.set(name,gltf.scene);
  const prepared=prepareModel(gltf.scene,defaultSettings),floor_meshes=prepared.surfaces.filter(s=>s.label.endsWith('_Floor')).map(s=>s.path);prepared.dispose();
  elements.push({...template('INSTANCE',x,z),name,asset_id:name,floor_meshes});
 }
 const doc={version:1,elements,doors:[]},built=buildLayout(doc,sources),world=new WalkWorld(built.root);
 assert.equal(world.regions.length,5);assert.ok(world.start());
 for(const [z,x] of [[-1.5,-3],[1.5,-3],[-1,4],[2,3.4]]){
  const approach=world.move(new Vector3(0,1.65,0),new Vector3(0,0,z));const room=world.move(approach,new Vector3(x,0,0));assert.ok(Math.abs(room.x-x)<.03,JSON.stringify(room.toArray()));assert.ok(world.grounded(room));
  const back=world.move(room,new Vector3(-x,0,0));assert.ok(Math.abs(back.x)<.03,'Return crosses the same doorway');
 }
 const stop=world.move(new Vector3(0,1.65,0),new Vector3(20,0,0));assert.ok(stop.x<2,'Closed section of lobby wall still blocks movement');
 const surface=built.surfaces.find(s=>s.elementId===elements[1].id&&s.label.endsWith('_Floor'));assert.equal(surface.bounds.min[0],-6,'Floor map uses translated module bounds');
 world.dispose();built.dispose();
 const unreviewed=buildLayout({...doc,elements:elements.map(e=>({...e,floor_meshes:[]}))},sources),unsafe=new WalkWorld(unreviewed.root);assert.equal(unsafe.start(),undefined);unsafe.dispose();unreviewed.dispose();
 const moved=buildLayout({...doc,elements:elements.map((e,i)=>i===1?{...e,x:-8,rotation:90}:e)},sources),updated=new WalkWorld(moved.root);const area=updated.regions.find(r=>r.id===elements[1].id);assert.ok(area.left<-9&&area.right<-6);assert.equal(updated.grounded(new Vector3(-3,1.65,-1.5)),undefined,'Moving a module removes its old standing surface');updated.dispose();moved.dispose();
});

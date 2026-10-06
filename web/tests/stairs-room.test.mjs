import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {Vector3} from 'three';
import {prepareModel,defaultSettings} from '../src/sceneSettings.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {template} from '../src/layout.ts';
import {WalkWorld} from '../src/navigation.ts';

async function load(name){
 const bytes=await readFile(new URL(`../../assets/prefabs/practice-house/${name}.glb`,import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const prepared=prepareModel(gltf.scene,defaultSettings);
 const floors=prepared.surfaces.filter(s=>s.label.endsWith('_Floor')).map(s=>s.path);
 prepared.dispose();return {root:gltf.scene,floors};
}

test('stairs prefab connects to the lobby, climbs each small step and returns through the doorway',async()=>{
 const stairs=await load('room-stairs'),lobby=await load('lobby');assert.equal(stairs.floors.length,5);
 const doc={version:1,elements:[{...template('INSTANCE'),asset_id:'lobby',floor_meshes:lobby.floors},{...template('INSTANCE',-4,-1.5),asset_id:'stairs',floor_meshes:stairs.floors}],doors:[]};
 const sources=new Map([['lobby',lobby.root],['stairs',stairs.root]]),built=buildLayout(doc,sources),world=new WalkWorld(built.root);
 let p=world.move(new Vector3(0,1.65,0),new Vector3(0,0,-1.5));
 p=world.move(p,new Vector3(-3,0,0));assert.ok(Math.abs(p.x+3)<.03);assert.ok(Math.abs(p.y-1.65)<1e-5);
 for(const [x,y] of [[-3.75,1.8],[-4.25,1.95],[-4.75,2.1],[-5.5,2.1]]){
  p=world.move(p,new Vector3(x-p.x,0,0));assert.ok(Math.abs(p.x-x)<.03,JSON.stringify(p));assert.ok(Math.abs(p.y-y)<1e-5,JSON.stringify(p));assert.ok(world.validStart(p),'Each tread supports a standing start');
 }
 p=world.move(p,new Vector3(5.5,0,0));assert.ok(Math.abs(p.x)<.03);assert.ok(Math.abs(p.y-1.65)<1e-5,'Descends and returns to the lobby');
 const wall=world.move(new Vector3(-5.5,2.1,-1.5),new Vector3(-3,0,0));assert.ok(wall.x>-5.8,'Raised-floor wall still blocks walking');
 world.dispose();built.dispose();
 // Approving the bottom floor alone must not make stair/landing tops walkable.
 const unreviewed=buildLayout({...doc,elements:doc.elements.map(e=>e.asset_id==='stairs'?{...e,floor_meshes:[stairs.floors[0]]}:e)},sources),blocked=new WalkWorld(unreviewed.root);
 assert.equal(blocked.validStart(new Vector3(-5.5,2.1,-1.5)),undefined);
 assert.ok(blocked.move(new Vector3(-3,1.65,-1.5),new Vector3(-2.5,0,0)).x>-3.6,'Unapproved steps remain obstacles');
 blocked.dispose();unreviewed.dispose();
});

test('standalone stairs support both elevations and respect the configured step height',async()=>{
 const stairs=await load('room-stairs');
 const settings={...defaultSettings,navigation:{regions:[{id:'stairs',name:'Room floors',left:-2,right:2,top:-1.5,bottom:1.5,min_y:-.01,max_y:.46,floor_meshes:stairs.floors}]}};
 const prepared=prepareModel(stairs.root,settings),world=new WalkWorld(prepared.root);
 assert.ok(world.validStart(new Vector3(1,1.65,0)));assert.ok(world.validStart(new Vector3(-1.5,2.1,0)));
 const up=world.move(new Vector3(1,1.65,0),new Vector3(-2.5,0,0));assert.ok(Math.abs(up.x+1.5)<.03);assert.ok(Math.abs(up.y-2.1)<1e-5);
 const down=world.move(up,new Vector3(2.5,0,0));assert.ok(Math.abs(down.x-1)<.03);assert.ok(Math.abs(down.y-1.65)<1e-5);
 world.dispose();prepared.dispose();
 const limited=prepareModel(stairs.root,{...settings,navigation:{...settings.navigation,step_height:.1}}),low=new WalkWorld(limited.root);
 assert.ok(low.move(new Vector3(1,1.65,0),new Vector3(-2.5,0,0)).x>.5,'A step-height setting below the 15cm riser prevents climbing');
 low.dispose();limited.dispose();
});

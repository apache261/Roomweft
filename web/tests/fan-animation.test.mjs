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
 return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
const rotor=root=>root.getObjectByName('Fan_room_Fan_rotor');

test('embedded fan clip loops on independent clones and leaves the uploaded model unchanged',async()=>{
 const source=await load('room-fan');assert.equal(source.animations.length,1);assert.ok(Math.abs(source.animations[0].duration-1.6)<1e-6);
 const a=prepareModel(source.scene,defaultSettings,new Map(),source.animations),b=prepareModel(source.scene,defaultSettings,new Map(),source.animations);
 const initial=rotor(a.root).quaternion.clone();a.updateAnimations(.2);
 assert.ok(initial.angleTo(rotor(a.root).quaternion)>.7,'Blades rotate around their central hub');
 assert.equal(rotor(b.root).quaternion.angleTo(initial),0,'Separate instances have independent animation state');
 assert.equal(rotor(source.scene).quaternion.angleTo(initial),0,'Uploaded source is preserved');
 const pose=rotor(a.root).quaternion.clone().normalize();a.updateAnimations(source.animations[0].duration);assert.ok(pose.angleTo(rotor(a.root).quaternion.clone().normalize())<1e-6,'Animation loops without reversing');
 a.dispose();b.dispose();
});

test('animated fan room assembles with the lobby and stays walkable in both directions',async()=>{
 const fan=await load('room-fan'),lobby=await load('lobby');
 const doc={version:1,elements:[{...template('INSTANCE',0,0),asset_id:'lobby',floor_meshes:['0/0/0']},{...template('INSTANCE',-4,-1.5),asset_id:'fan',floor_meshes:['0/0/0']}],doors:[]};
 const built=buildLayout(doc,new Map([['lobby',lobby.scene],['fan',fan.scene]]),new Map(),new Map([['fan',fan.animations]]));
 const world=new WalkWorld(built.root),initial=rotor(built.root).quaternion.clone();built.updateAnimations(.2);assert.ok(initial.angleTo(rotor(built.root).quaternion)>.7);
 assert.ok(world.grounded(new Vector3(-4,1.65,-1.5)),'Fan clears standing height');
 const approach=world.move(new Vector3(0,1.65,0),new Vector3(0,0,-1.5)),inside=world.move(approach,new Vector3(-4,0,0)),back=world.move(inside,new Vector3(4,0,0));
 assert.ok(Math.abs(inside.x+4)<.03);assert.ok(Math.abs(back.x)<.03);
 world.dispose();built.dispose();
});

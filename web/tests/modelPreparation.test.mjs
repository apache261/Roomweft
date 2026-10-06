import {reviewFixture} from './reviewedWorld.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { defaultSettings, modelMatrix, prepareModel, sameSettings, moveHotspots } from '../src/sceneSettings.ts';
import { checkRequiredExtensions } from '../src/PreparedGLTFLoader.ts';
import { WalkWorld } from '../src/navigation.ts';

test('scale, Z-up and yaw correction applies to geometry and walking without altering source materials', () => {
  const source = new Group();
  const material = new MeshStandardMaterial({ color: '#e03030', roughness: 0.8 });
  const floor = new Mesh(new BoxGeometry(600, 500, 20), material);
  source.add(floor);
  const settings = structuredClone(defaultSettings);
  settings.model = { scale: 0.01, up_axis: 'Z', rotation: 90 };
  settings.appearance.tint = '#2060ff'; settings.appearance.roughness = 0.3;
  const prepared = prepareModel(source, settings);
  const dimensions = prepared.dimensions;
  assert.ok(Math.abs(dimensions[0] - 5) < 1e-9 && Math.abs(dimensions[1] - 0.2) < 1e-9 && Math.abs(dimensions[2] - 6) < 1e-9);
  reviewFixture(prepared.root,['0/0/0']);
  const world = new WalkWorld(prepared.root);
  assert.ok(world.start(), 'corrected centimetre floor supports walking');
  assert.equal(material.color.getHexString(), 'e03030'); assert.equal(material.roughness, 0.8);
  const copyMaterial = prepared.root.children[0].children[0].material;
  assert.notEqual(copyMaterial, material);
  prepared.applyAppearance(defaultSettings.appearance);
  assert.equal(copyMaterial.color.getHexString(), 'e03030');
  assert.equal(copyMaterial.roughness, 0.8);
  const original = new Vector3(100,200,300);
  const transformed = original.clone().applyMatrix4(modelMatrix(settings.model));
  assert.ok(Math.abs(transformed.x + 2) < 1e-9 && transformed.y === 3 && Math.abs(transformed.z + 1) < 1e-9);
  world.dispose(); prepared.dispose(); floor.geometry.dispose(); material.dispose();
});

test('fixture geometry has walkable lobby and rooms after nonstandard units/axis correction', async () => {
  // Parse geometry with images omitted: actual texture decoding is covered in the browser.
  for (const [file, model] of [['textured-interior.glb', defaultSettings.model], ['textured-interior-cm-z.glb', {scale:.01,up_axis:'Z',rotation:0}]]) {
    const bytes=await readFile(new URL('../../tests/testdata/'+file,import.meta.url));
    const jsonLength=bytes.readUInt32LE(12);
    const json=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
    delete json.images; delete json.textures;
    for (const material of json.materials) delete material.pbrMetallicRoughness.baseColorTexture;
    const binStart=28+jsonLength;
    const bin=bytes.subarray(binStart);
    let document=Buffer.from(JSON.stringify(json));
    document=Buffer.concat([document,Buffer.alloc((4-document.length%4)%4,32)]);
    const rebuilt=Buffer.alloc(28+document.length+bin.length);
    rebuilt.write('glTF');rebuilt.writeUInt32LE(2,4);rebuilt.writeUInt32LE(rebuilt.length,8);
    rebuilt.writeUInt32LE(document.length,12);rebuilt.writeUInt32LE(0x4e4f534a,16);document.copy(rebuilt,20);
    rebuilt.writeUInt32LE(bin.length,20+document.length);rebuilt.writeUInt32LE(0x004e4942,24+document.length);bin.copy(rebuilt,28+document.length);
    const gltf=await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset,rebuilt.byteOffset+rebuilt.byteLength),'');
    const prepared=prepareModel(gltf.scene,{...defaultSettings,model});
    reviewFixture(prepared.root);
    const world=new WalkWorld(prepared.root); const spawn=world.start(); assert.ok(spawn);
    const leftDoor=new Vector3(-2,spawn.position[1],0);
    const through=world.move(leftDoor,new Vector3(0,0,-3));
    assert.ok(through.z < -2.9,'connected room doorway is walkable');
    assert.ok(prepared.dimensions[0] < 9 && prepared.dimensions[2] < 11);
    world.dispose();prepared.dispose();
  }
});

test('Meshopt and Basis are supported; unknown extensions and Draco remain explicit errors', () => {
  assert.doesNotThrow(()=>checkRequiredExtensions(['KHR_materials_unlit','KHR_texture_transform','EXT_meshopt_compression','KHR_texture_basisu']));
  for (const extension of ['VENDOR_unknown','KHR_draco_mesh_compression']) {
    assert.throws(()=>checkRequiredExtensions([extension]),new RegExp(extension));
  }
});


test('saved JSON key ordering does not create false edits and draft hotspots follow model correction', () => {
  const reordered = { model: {rotation:0,up_axis:'Y',scale:1}, appearance: Object.fromEntries(Object.entries(defaultSettings.appearance).reverse()) };
  assert.equal(sameSettings(defaultSettings,reordered),true);
  const h=[{position:{x:100,y:200,z:300}},{position:{yaw:0,pitch:0}}];
  const result=moveHotspots(h,defaultSettings.model,{scale:.01,up_axis:'Z',rotation:0});
  assert.ok(Math.abs(result[0].position.x-1)<1e-9 && Math.abs(result[0].position.y-3)<1e-9 && Math.abs(result[0].position.z+2)<1e-9);
  assert.deepEqual(h[0].position,{x:100,y:200,z:300});
  assert.equal(result[1],h[1]);
});

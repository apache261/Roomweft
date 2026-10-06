import {reviewFixture} from './reviewedWorld.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { WalkWorld, EYE_HEIGHT } from '../src/navigation.ts';

test('demo house has an interior spawn, solid walls, a usable doorway and no walking off the floor', async () => {
  const bytes = await readFile(new URL('../../tests/testdata/house.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  reviewFixture(gltf.scene);
  const world = new WalkWorld(gltf.scene);
  const start = world.start(); assert.ok(start);
  assert.ok(Math.abs(start.position[1] - (0.1 + EYE_HEIGHT)) < 0.001);
  const p = new Vector3(...start.position);
  for (const direction of [new Vector3(10,0,0), new Vector3(-10,0,0), new Vector3(0,0,-10)]) {
    const stopped = world.move(p, direction);
    assert.ok(Math.abs(stopped.x) < 2.59 && stopped.z > -2.09, 'walls stop even a large movement');
    assert.ok(stopped.distanceTo(p) > 1, 'movement works inside');
  }
  const front = world.move(p, new Vector3(0,0,2.4));
  assert.ok(front.z > 2.2, 'open door does not act like a wall');
  const edge = world.move(front, new Vector3(0,0,5));
  assert.ok(edge.z <= 2.5, 'cannot walk off unsupported floor');
  const slide = world.move(new Vector3(2.55,p.y,0), new Vector3(1,0,-1));
  assert.ok(slide.x < 2.59 && slide.z < -0.8, 'slide along a wall');
  world.dispose();
});

test('low ceilings and absent floors reject a walking start', () => {
  const empty = new WalkWorld(new Group()); assert.equal(empty.start(), undefined); empty.dispose();
  const group = new Group();
  for (const y of [0,1]) { const mesh = new Mesh(new BoxGeometry(4,0.1,4),new MeshBasicMaterial()); mesh.position.y = y; group.add(mesh); }
  const world = new WalkWorld(group); assert.equal(world.start(), undefined); world.dispose();
});

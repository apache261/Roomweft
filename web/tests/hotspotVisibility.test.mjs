import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { hotspotPoint, hotspotVisible } from '../src/hotspotVisibility.ts';

test('surface and legacy hotspots remain visible, walls hide distant hotspots, and points behind the camera are hidden', () => {
  const camera = new PerspectiveCamera(60, 1, 0.05, 100);
  camera.updateProjectionMatrix();
  const wall = new Mesh(new BoxGeometry(4, 4, 0.2), new MeshBasicMaterial());
  wall.position.z = -2; wall.updateMatrixWorld();
  assert.equal(hotspotVisible(new Vector3(0, 0, -1.9), camera, [wall], false), true);
  assert.equal(hotspotVisible(new Vector3(0, 0, -1.86), camera, [wall], false), true);
  assert.equal(hotspotVisible(new Vector3(0, 0, -3), camera, [wall], false), false);
  assert.equal(hotspotVisible(new Vector3(0, 0, 3), camera, [], false), false);
  assert.equal(hotspotVisible(new Vector3(0, 0, -0.01), camera, [], false), false);
  wall.geometry.dispose(); wall.material.dispose();
});

test('panorama markers ignore the panorama sphere but respect camera facing', () => {
  const camera = new PerspectiveCamera(75, 1, 0.1, 100);
  camera.updateProjectionMatrix();
  assert.equal(hotspotVisible(hotspotPoint({ yaw: 0, pitch: 0 }), camera, [], true), true);
  assert.equal(hotspotVisible(hotspotPoint({ yaw: Math.PI, pitch: 0 }), camera, [], true), false);
  assert.deepEqual(hotspotPoint({ x: 1, y: 2, z: 3 }).toArray(), [1, 2, 3]);
});

import { Group, InstancedMesh, Matrix4 } from 'three';
import { HotspotVisibility, visibilityResult } from '../src/hotspotVisibility.ts';

test('full frustum rejects side, vertical, near/far and behind-camera markers before raycasts', () => {
  const camera = new PerspectiveCamera(60, 1, .1, 10);
  const wall = new Mesh(new BoxGeometry(4, 4, .2), new MeshBasicMaterial()); wall.position.z = -2;
  const visibility = new HotspotVisibility(); visibility.begin(camera, [wall], false);
  for (const point of [[10, 0, -3], [0, 10, -3], [0, 0, -.01], [0, 0, -11], [0, 0, 3]]) {
    assert.equal(visibility.evaluate(visibilityResult(new Vector3(...point))).visible, false);
  }
  assert.equal(visibility.stats.raycasts, 0);
});

test('shared results cache until camera, walls, hierarchy, geometry or projection change', () => {
  const camera = new PerspectiveCamera(60, 1, .1, 100);
  const wall = new Mesh(new BoxGeometry(4, 4, .2), new MeshBasicMaterial()); wall.position.z = -2;
  const group = new Group(); group.add(wall);
  const visibility = new HotspotVisibility(), result = visibilityResult(new Vector3(0, 0, -3));
  const evaluate = () => { visibility.begin(camera, [group], false); return visibility.evaluate(result).visible; };
  assert.equal(evaluate(), false);
  const count = visibility.stats.raycasts; assert.equal(evaluate(), false);
  assert.equal(visibility.stats.raycasts, count); assert.equal(visibility.stats.cacheHits, 1);
  wall.position.x = 10; assert.equal(evaluate(), true);
  wall.position.x = 0; assert.equal(evaluate(), false);
  group.visible = false; assert.equal(evaluate(), true);
  group.visible = true; assert.equal(evaluate(), false);
  wall.layers.set(1); assert.equal(evaluate(), true);
  wall.layers.set(0); assert.equal(evaluate(), false);
  wall.geometry.translate(10, 0, 0); assert.equal(evaluate(), true);
  wall.geometry.translate(-10, 0, 0); assert.equal(evaluate(), false);
  group.remove(wall); assert.equal(evaluate(), true);
  group.add(wall); assert.equal(evaluate(), false);
  camera.position.x = 10; assert.equal(evaluate(), false);
  camera.position.x = 0; assert.equal(evaluate(), false);
  camera.far = 2; camera.updateProjectionMatrix(); assert.equal(evaluate(), false);
  assert.ok(visibility.stats.rejected >= 2);
});

test('bounds skip unrelated meshes and transformed instance occluders stay conservative', () => {
  const camera = new PerspectiveCamera(60, 1, .1, 100);
  const unrelated = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()); unrelated.position.set(20, 0, -2);
  const visibility = new HotspotVisibility(), result = visibilityResult(new Vector3(0, 0, -3));
  visibility.begin(camera, [unrelated], false); assert.equal(visibility.evaluate(result).visible, true);
  assert.equal(visibility.stats.raycasts, 0);
  const instances = new InstancedMesh(new BoxGeometry(4, 4, .2), new MeshBasicMaterial(), 1);
  instances.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -2));
  visibility.begin(camera, [instances], false); assert.equal(visibility.evaluate(result).visible, false);
  instances.setMatrixAt(0, new Matrix4().makeTranslation(20, 0, -2)); instances.computeBoundingSphere();
  visibility.begin(camera, [instances], false); assert.equal(visibility.evaluate(result).visible, true);
});

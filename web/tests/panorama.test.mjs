import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { panoramaAngles, panoramaPoint } from '../src/panorama.ts';

test('panorama hotspot angles match the camera rotation and round-trip around the sphere', () => {
 for (const yaw of [-Math.PI,-2,-1,0,1,2,Math.PI]) for (const pitch of [-1.4,-0.5,0,0.5,1.4]) {
  const view={yaw,pitch};const point=new Vector3(...panoramaPoint(view));const actual=panoramaAngles(point);
  assert.ok(Math.abs(actual.yaw-yaw)<1e-9);assert.ok(Math.abs(actual.pitch-pitch)<1e-9);
  const forward=new Vector3(0,0,-1).applyEuler(new Euler(pitch,yaw,0,'YXZ'));
  assert.ok(forward.distanceTo(point.normalize())<1e-9,'marker direction matches saved view');
 }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSplatSettings,sameSettings,sameSourceTransform,moveHotspotsForSettings} from '../src/sceneSettings.ts';
test('splat settings compare values independently of JSON key order and move world hotspots through translation, units and axis correction',()=>{
 const a=structuredClone(defaultSplatSettings),b=structuredClone(defaultSplatSettings);b.splat={max_distance:1000,position:[0,0,0],controls:'orbit',version:1,min_distance:.1};assert.ok(sameSettings(a,b));
 a.splat.position=[10,0,0];b.splat.position=[20,0,0];b.model={scale:2,up_axis:'Z',rotation:0};assert.equal(sameSourceTransform(a,b),false);
 const spots=[{position:{x:11,y:2,z:3}},{position:{yaw:.5,pitch:.2}}];const transformed=moveHotspotsForSettings(spots,a,b);for(const [key,value] of Object.entries({x:22,y:6,z:-4}))assert.ok(Math.abs(transformed[0].position[key]-value)<1e-9);assert.equal(transformed[1],spots[1]);const restored=moveHotspotsForSettings(transformed,b,a);for(const key of ['x','y','z'])assert.ok(Math.abs(restored[0].position[key]-spots[0].position[key])<1e-9);
 const appearance=structuredClone(a);appearance.appearance.exposure=2;assert.equal(sameSourceTransform(a,appearance),true);assert.equal(sameSettings(a,appearance),false);
});

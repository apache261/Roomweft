import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splatCapabilities} from '../src/splat/rollout.ts';
test('production capture build fails closed while viewer mode preserves viewing only',()=>{
 assert.deepEqual(splatCapabilities(undefined),{viewer:false,authoring:false});
 assert.deepEqual(splatCapabilities(undefined,true),{viewer:true,authoring:true});
 assert.deepEqual(splatCapabilities('off',true),{viewer:false,authoring:false});
 assert.deepEqual(splatCapabilities('viewer'),{viewer:true,authoring:false});
 assert.deepEqual(splatCapabilities('on'),{viewer:true,authoring:true});
 assert.deepEqual(splatCapabilities('unknown'),{viewer:false,authoring:false});
});

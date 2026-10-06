import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkStreamingEnabled,supportsChunkStreaming} from '../src/chunkRollout.ts';
test('build and per-view rollback select complete delivery independently',()=>{
 assert.equal(chunkStreamingEnabled(undefined,'?perf=1'),true);
 assert.equal(chunkStreamingEnabled('0','?streaming=1'),false);
 assert.equal(chunkStreamingEnabled('1','?streaming=0'),false);
 assert.equal(chunkStreamingEnabled('1','?streaming=1'),true);
});
test('only supported ready scoped manifest advertisements enter chunk viewing',()=>{
 const streaming={state:'ready',processor_version:'chunks-v1',delivery:'scoped-descriptors',manifest_url:'/api/v1/assets/parent/chunks'};
 assert.equal(supportsChunkStreaming({streaming}),true);
 for(const patch of [{state:'queued'},{processor_version:'chunks-v2'},{delivery:'external-files'},{manifest_url:undefined}])assert.equal(supportsChunkStreaming({streaming:{...streaming,...patch}}),false);
 assert.equal(supportsChunkStreaming(undefined),false);
});

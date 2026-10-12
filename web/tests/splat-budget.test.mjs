import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reserveSplatRenderer,rendererResidentLimit,splatRendererStats} from '../src/splat/budget.js';
test('concurrent captures respect aggregate renderer budget and release idempotently',()=>{
 const release=reserveSplatRenderer(rendererResidentLimit);
 assert.equal(splatRendererStats().renderers,1);
 assert.throws(()=>reserveSplatRenderer(1),/Close other capture viewers/);
 release();release();assert.equal(splatRendererStats().estimatedResidentBytes,0);
 const next=reserveSplatRenderer(1);next();
 for(const bytes of [NaN,-1,0,Infinity])assert.throws(()=>reserveSplatRenderer(bytes));
});

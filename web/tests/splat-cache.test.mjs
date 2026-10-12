import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acquireSplat,splatCacheStats} from '../src/splat/splatAssetCache.ts';
const fixture=readFileSync(new URL('../public/splat-fixtures/small.splat',import.meta.url));
test('splat source leases share bytes, renew expired transport and release their last owner',async()=>{
 const original=globalThis.fetch;let descriptors=0,downloads=0;
 globalThis.fetch=async path=>{if(String(path).startsWith('/api/v1')){descriptors++;return Response.json({url:`https://storage.invalid/source?lease=${descriptors}`});}downloads++;return downloads===1?new Response(null,{status:403}):new Response(fixture,{headers:{'Content-Length':String(fixture.length)}});};
 try{
  const a=acquireSplat('/assets/owned'),b=acquireSplat('/assets/owned');const [x,y]=await Promise.all([a.promise,b.promise]);assert.equal(x,y);assert.equal(descriptors,2);assert.equal(downloads,2);a.release();a.release();assert.deepEqual(splatCacheStats(),{sources:1,owners:1});b.release();assert.deepEqual(splatCacheStats(),{sources:0,owners:0});
 }finally{globalThis.fetch=original;}
});
test('last-owner cancellation cannot delete a newer source lease',async()=>{
 const original=globalThis.fetch;let signals=[];
 globalThis.fetch=(_path,{signal})=>{signals.push(signal);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
 try{const old=acquireSplat('/assets/cancelled');const rejection=assert.rejects(old.promise);old.release();const next=acquireSplat('/assets/cancelled');const second=assert.rejects(next.promise);old.release();assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);next.release();await Promise.all([rejection,second]);assert.deepEqual(splatCacheStats(),{sources:0,owners:0});}finally{globalThis.fetch=original;}
});
test('missing Content-Length cannot admit excessive or malformed splat bytes',async()=>{
 const original=globalThis.fetch;
 for(const payload of [fixture.subarray(0,fixture.length-1),Buffer.alloc(32),new Uint8Array(64_000_032)]) {
  globalThis.fetch=async path=>String(path).startsWith('/api/v1')?Response.json({url:'https://storage.invalid/raw'}):new Response(payload);
  const lease=acquireSplat('/assets/invalid');try{await assert.rejects(lease.promise);}finally{lease.release();}
 }
 globalThis.fetch=original;
});

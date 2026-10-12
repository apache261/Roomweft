import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSplatBytes,maxSplatBytes} from '../src/splat/profile.ts';
const fixture=readFileSync(new URL('../public/splat-fixtures/small.splat',import.meta.url));
const bytes=()=>Uint8Array.from(fixture).buffer;
test('splat-v1 browser feedback checks fixed records and finite attributes',()=>{
 assert.equal(validateSplatBytes(bytes()),441);assert.equal(maxSplatBytes,64_000_000);
 for(const mutate of [b=>new DataView(b).setFloat32(0,NaN,true),b=>new DataView(b).setFloat32(12,0,true),b=>new DataView(b).setFloat32(12,-1,true),b=>new Uint8Array(b).fill(128,28,32)]){const b=bytes();mutate(b);assert.throws(()=>validateSplatBytes(b));}
 assert.throws(()=>validateSplatBytes(new ArrayBuffer(0)));assert.throws(()=>validateSplatBytes(bytes().slice(0,-1)));
});

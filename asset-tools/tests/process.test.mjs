import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { processAsset } from '../process.mjs';

test('house, textured hierarchy and animated fan preserve identities through every tier and exact proxies', async () => {
 const dir = await mkdtemp(tmpdir() + '/tour-asset-test-');
 try {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}); await MeshoptDecoder.ready;
  for (const file of ['tests/testdata/house.glb','tests/testdata/textured-interior.glb','assets/prefabs/practice-house/room-fan.glb']) {
   const output = resolve(dir,file.split('/').at(-1)), manifest = await processAsset(resolve('..',file),output);
   assert.equal(manifest.source_sha256.length,64);assert.equal(manifest.collision.floor_approval,'authored-only');assert.ok(manifest.surfaces.every(s=>s.source===s.runtime));
   for (const tier of ['low','balanced','hq']) {
    const bytes=await readFile(output+'/'+tier+'.glb'), doc=await io.readBinary(bytes);
    assert.ok(doc.getRoot().listExtensionsRequired().some(e=>e.extensionName==='EXT_meshopt_compression'));
    assert.equal(bytes.length,manifest.variants[tier].bytes);
    if(file.includes('fan'))assert.equal(doc.getRoot().listAnimations().length,1);
   }
   const proxy=await io.readBinary(await readFile(output+'/collision.glb'));
   assert.equal(proxy.getRoot().listTextures().length,0);assert.equal(proxy.getRoot().listMaterials().length,0);
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('malformed input never emits a publishable manifest and leaves source untouched', async () => {
 const dir=await mkdtemp(tmpdir()+'/tour-invalid-');
 try{const source=dir+'/bad.glb',bytes=Buffer.from('invalid model');await writeFile(source,bytes);await assert.rejects(processAsset(source,dir));assert.deepEqual(await readFile(source),bytes);await assert.rejects(readFile(dir+'/manifest.json'));}finally{await rm(dir,{recursive:true,force:true});}
});

import sharp from 'sharp';
import { processTexture } from '../process.mjs';
test('external material texture variants retain alpha and aspect with bounded mip-chain estimates',async()=>{
 const dir=await mkdtemp(tmpdir()+'/tour-textures-');
 try{const image=await sharp({create:{width:2048,height:1024,channels:4,background:{r:40,g:120,b:200,alpha:.4}}}).png().toBuffer();await writeFile(dir+'/source.png',image);const manifest=await processTexture(dir+'/source.png',dir);
  const low=await sharp(dir+'/low.png').metadata(),balanced=await sharp(dir+'/balanced.png').metadata();assert.equal(low.width,1024);assert.equal(low.height,512);assert.ok(low.hasAlpha);assert.equal(balanced.width,2048);assert.equal(manifest.variants.low.texture_rgba8_bytes,Math.ceil(1024*512*4*4/3));assert.deepEqual(await readFile(dir+'/source.png'),image);
 }finally{await rm(dir,{recursive:true,force:true});}
});

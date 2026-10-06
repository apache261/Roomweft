import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chunkingFixtures} from '../scripts/chunking-fixtures.mjs';
import {layoutIssues} from '../src/layout.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {WalkWorld} from '../src/navigation.ts';
import validator from '../../asset-tools/node_modules/gltf-validator/index.js';
test('reference GLBs are valid and preserve source paths and dependency cases',async()=>{
 const {manifest,files,scenes,hotspots}=await chunkingFixtures();
 for(const f of manifest.fixtures){
  const bytes=files.get(f.file);
  assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
  const validation=await validator.validateBytes(new Uint8Array(bytes));
  assert.equal(validation.issues.numErrors,0,JSON.stringify(validation.issues.messages));
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  if(f.file==='authored-rooms.glb'){
   for(const path of manifest.reviewedFloorPaths){let node={children:json.scenes[0].nodes};for(const i of path.split('/').slice(1))node=json.nodes[node.children[Number(i)]];assert.equal(node.name,'Reviewed floor');}
   assert.equal(json.skins[0].joints.length,1);assert.equal(json.animations.length,1);assert.equal(json.images.length,1);assert.equal(json.materials.length,2);
  }else{assert.equal(json.nodes.length,1);assert.equal(json.meshes[0].primitives.length,1);}
 }
 assert.ok(hotspots.some(h=>h.position.attachment));
 assert.equal(layoutIssues(scenes[2].layout).errors.length,0);
 const prepared=buildLayout(scenes[2].layout,new Map()),world=new WalkWorld(prepared.root);
 assert.ok(world.start());world.dispose();prepared.dispose();
});

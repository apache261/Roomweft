import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sourceInventory} from '../../asset-tools/inventory.mjs';
import {performanceFixtures} from '../scripts/performance-fixtures.mjs';
import {defaultPartition,validatePartition} from '../src/chunkingContracts.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5175';
const {project,scenes,assets}=performanceFixtures(),scene={...scenes[0]},asset=assets[0];
const staticFile=new URL('../../tests/testdata/house.glb',import.meta.url),animatedFile=new URL('../../tests/testdata/chunking/authored-rooms.glb',import.meta.url);
let inventory=await sourceInventory(staticFile),bytes=await readFile(staticFile),review={revision:0,inventory:null,document:null},conflict=false;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1200,height:800}});
 await context.route(origin+'/partition-source.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
 await context.route(origin+'/api/v1/**',async r=>{
  const p=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(p===`/assets/${asset.id}/partition/inventory`){review=review.inventory?review:{revision:0,source_sha256:inventory.source_sha256,inventory,document:defaultPartition(inventory)};data=review;}
  else if(p===`/assets/${asset.id}/partition`){
   if(r.request().method()==='PUT'){
    const body=r.request().postDataJSON();if(conflict||body.revision!==review.revision)return r.fulfill({status:409,json:{error:'partition or source changed; reload the current review'}});
    try{validatePartition(body.document,inventory);}catch(e){return r.fulfill({status:400,json:{error:e.message}});}
    review={...review,revision:review.revision+1,document:body.document};
   }data=review;
  }else if(p===`/projects/${project.id}`)data=project;
  else if(p.endsWith('/assets'))data=[asset];
  else if(p===`/assets/${asset.id}`)data={...asset,url:origin+'/partition-source.glb',runtime:{state:'unavailable'}};
  else if(p.endsWith('/scenes'))data=[scene];
  else if(p.endsWith('/hotspots'))data=[];
  else throw Error('Unexpected '+p);
  return r.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function open(){await page.goto(origin+'/projects/'+project.id);await page.getByRole('tab',{name:'Partition',exact:true}).click();await page.getByRole('button',{name:'Inspect original source',exact:true}).waitFor();}
 await open();await page.getByRole('button',{name:'Inspect original source',exact:true}).click();await page.getByLabel('Partition policy',{exact:true}).selectOption('reviewed-rooms');
 await page.getByLabel('New partition room name').fill('Reviewed house');await page.getByRole('button',{name:'Add partition room',exact:true}).click();
 const floor=inventory.nodes.find(n=>n.path==='0/0');assert.ok(floor?.renderable);
 await page.locator('.partition-node-list details').filter({has:page.locator('summary',{hasText:floor.name+' · '+floor.path})}).locator('summary').click();
 await page.getByLabel('Partition owner '+floor.path,{exact:true}).selectOption({label:'Reviewed house'});
 await page.getByRole('button',{name:'Save partition review',exact:true}).click();await page.getByText(/Partition review saved/).waitFor();assert.equal(review.revision,1);assert.ok(review.document.rooms[0].node_paths.includes(floor.path));
 const saved=structuredClone(review);await page.reload();await page.getByRole('tab',{name:'Partition',exact:true}).click();await page.getByText('Revision 1',{exact:false}).waitFor();assert.deepEqual(review,saved);
 // Changing a source volume to exclude its owned floor must block saving.
 const bound=page.getByLabel('Reviewed house min X',{exact:true});await bound.fill('999');assert.ok(await page.getByRole('button',{name:'Save partition review',exact:true}).isDisabled());await page.getByRole('button',{name:'Discard partition edits',exact:true}).click();
 // Stale edits report a conflict without pretending the save succeeded.
 conflict=true;await page.getByLabel('Partition room name '+review.document.rooms[0].id,{exact:true}).fill('Concurrent edit');await page.getByRole('button',{name:'Save partition review',exact:true}).click();await page.getByRole('alert').filter({hasText:/partition or source changed/}).waitFor();assert.equal(review.revision,1);conflict=false;
 await page.getByRole('button',{name:'Discard partition edits',exact:true}).click();
 // Invalid physical opening cannot certify visibility/readiness.
 await page.getByRole('button',{name:'Add visibility opening',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Save partition review',exact:true}).isDisabled());await page.getByRole('button',{name:'Discard partition edits',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // A skin/clip source has an explicit, non-editable global fallback.
 inventory=await sourceInventory(animatedFile);bytes=await readFile(animatedFile);review={revision:0,inventory:null,document:null};await open();await page.getByRole('button',{name:'Inspect original source',exact:true}).click();await page.getByText('This source requires complete global ownership:',{exact:true}).waitFor();assert.notEqual(await page.getByLabel('Partition policy',{exact:true}).locator('option[value="reviewed-rooms"]').getAttribute('disabled'),null);
 assert.deepEqual(errors,[]);console.log('PASS partition inspector source inventory, saved revision, crossing bounds, conflicts, invalid openings, mobile layout and skin/clip fallback');
}finally{await browser.close();}

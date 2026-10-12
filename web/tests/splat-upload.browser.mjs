import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();let project;
try{
 const created=await context.request.post(origin+'/api/v1/projects',{data:{name:'Splat browser admission'}});assert.equal(created.status(),201);project=await created.json();
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/projects/'+project.id);await page.getByText('Asset library',{exact:false}).click();
 const good=readFileSync(new URL('../public/splat-fixtures/small.splat',import.meta.url));const bad=Buffer.from(good);bad.writeFloatLE(NaN,0);
 const input=page.getByLabel('Upload Gaussian splat source',{exact:true});
 await input.setInputFiles({name:'invalid.splat',mimeType:'application/octet-stream',buffer:bad});await page.getByRole('alert').filter({hasText:'Invalid splat position or linear scale.'}).waitFor();
 await input.setInputFiles({name:'room.splat',mimeType:'application/octet-stream',buffer:good});await page.getByText('Splat source uploaded. Tour viewing is pending phase 3.',{exact:true}).waitFor();
 const assets=await (await context.request.get(origin+`/api/v1/projects/${project.id}/assets`)).json();assert.equal(assets.length,1);assert.equal(assets[0].file_type,'SPLAT');assert.equal(assets[0].upload_status,'ready');
 const descriptor=await (await context.request.get(origin+`/api/v1/assets/${assets[0].id}`)).json();
 const hash=await page.evaluate(async url=>{const r=await fetch(url);if(!r.ok)throw new Error('Source download failed');const b=await r.arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(v=>v.toString(16).padStart(2,'0')).join('');},descriptor.url);
 assert.equal(hash,createHash('sha256').update(good).digest('hex'));
 const made=await context.request.post(origin+`/api/v1/projects/${project.id}/scenes`,{data:{name:'Splat source',asset_id:assets[0].id}});assert.equal(made.status(),201);assert.equal((await made.json()).type,'SPLAT');
 await page.reload();await page.getByText('Gaussian splat source is ready. Shared tour viewing is pending phase 3.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Splat browser admission passed: early attribute feedback, signed POST with CORS, completion, byte-identical private browser read and explicit phase-3 viewer state.');
}finally{
 if(project)await context.request.delete(origin+'/api/v1/projects/'+project.id);await browser.close();
}

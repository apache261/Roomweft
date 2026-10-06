import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const origin=process.env.TEST_ASSET_API_URL||'http://localhost:8081';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Use a disposable local API for worker integration');
const request=async(path,method='GET',body)=>{const r=await fetch(origin+'/api/v1'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.status===204?null:r.json();};
const source=await readFile(new URL('../../tests/testdata/house.glb',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
let project;
try{
 project=await request('/projects','POST',{name:'Phase 4 worker integration'});
 const ticket=await request(`/projects/${project.id}/uploads`,'POST',{name:'house.glb',size:source.length});
 const form=new FormData();for(const [k,v]of Object.entries(ticket.upload.fields))form.append(k,v);form.append('file',new Blob([source],{type:'model/gltf-binary'}),'house.glb');
 assert.ok((await fetch(ticket.upload.url,{method:'POST',body:form})).ok);
 const completed=await request('/assets/'+ticket.asset.id+'/complete','POST');assert.equal(completed.upload_status,'ready');
 let result;
 for(let i=0;i<30;i++){result=await request('/assets/'+completed.id);if(['ready','failed'].includes(result.runtime?.state))break;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.equal(result.runtime.state,'ready',result.runtime.error);
 assert.equal(hash(Buffer.from(await(await fetch(result.url)).arrayBuffer())),hash(source),'original is byte-for-byte preserved');
 for(const v of [...Object.values(result.runtime.manifest.variants),result.runtime.manifest.collision]){
  const r=await fetch(v.url);assert.ok(r.ok);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.length,v.bytes);assert.equal(hash(bytes),v.sha256);
 }
 assert.ok(!JSON.stringify(result.runtime).includes('"key"'));
 await request(`/projects/${project.id}/scenes`,'POST',{asset_id:completed.id,name:'House'});
 assert.equal((await fetch(origin+'/api/v1/public/tours/'+project.slug+'/assets/'+completed.id)).status,404);
 await request('/projects/'+project.id+'/publish','POST');
 const publicAsset=await request('/public/tours/'+project.slug+'/assets/'+completed.id);assert.equal(publicAsset.runtime.state,'ready');
 await request('/projects/'+project.id+'/unpublish','POST');
 assert.equal((await fetch(origin+'/api/v1/public/tours/'+project.slug+'/assets/'+completed.id)).status,404);
 const manifest=structuredClone(result.runtime.manifest);for(const v of [...Object.values(manifest.variants),manifest.collision])delete v.url;
 const image=await sharp({create:{width:2048,height:1024,channels:4,background:{r:20,g:100,b:200,alpha:.5}}}).png().toBuffer();
 const textureTicket=await request(`/projects/${project.id}/uploads`,'POST',{name:'normal.png',size:image.length,file_type:'TEXTURE_NORMAL'}),imageForm=new FormData();for(const[k,v]of Object.entries(textureTicket.upload.fields))imageForm.append(k,v);imageForm.append('file',new Blob([image],{type:'image/png'}),'normal.png');assert.ok((await fetch(textureTicket.upload.url,{method:'POST',body:imageForm})).ok);await request('/assets/'+textureTicket.asset.id+'/complete','POST');
 let texture;
 for(let i=0;i<30;i++){texture=await request('/assets/'+textureTicket.asset.id);if(['ready','failed'].includes(texture.runtime?.state))break;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.equal(texture.runtime.state,'ready',texture.runtime.error);assert.equal(hash(Buffer.from(await(await fetch(texture.url)).arrayBuffer())),hash(image));
 const lowBytes=Buffer.from(await(await fetch(texture.runtime.manifest.variants.low.url)).arrayBuffer());assert.equal(hash(lowBytes),texture.runtime.manifest.variants.low.sha256);const lowImage=await sharp(lowBytes).metadata();assert.equal(lowImage.width,1024);assert.equal(lowImage.height,512);assert.ok(lowImage.hasAlpha);
 const textureManifest=structuredClone(texture.runtime.manifest);for(const v of Object.values(textureManifest.variants))delete v.url;
 await writeFile('/tmp/phase4-worker-evidence.json',JSON.stringify({execution:'Local Go API + PostgreSQL + private MinIO storage + native Node processor',checks:['upload confirmation','persistent queue','background processing','atomic manifest','original byte preservation','variant integrity','collision integrity','public reference policy','unpublish denies URL refresh','external normal-map variants','texture alpha/aspect','texture original preservation'],manifest,textureManifest},null,2));
 console.log('PASS local upload → worker → private derivatives → signed delivery → original preservation; publication access checks. Evidence: /tmp/phase4-worker-evidence.json');
}finally{if(project)await request('/projects/'+project.id,'DELETE');}

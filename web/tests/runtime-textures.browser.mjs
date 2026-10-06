import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { performanceFixtures,performanceFiles } from '../scripts/performance-fixtures.mjs';
import { processTexture } from '../../asset-tools/process.mjs';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5174',output='/tmp/phase4-texture-browser';await mkdir(output,{recursive:true});
const {project,scenes,assets}=performanceFixtures(),scene=scenes[3],files=await performanceFiles(),manifests=new Map();
for(const asset of assets.filter(a=>a.file_type.startsWith('TEXTURE_'))){const source=output+'/'+asset.name;await writeFile(source,files.get(asset.name));const manifest=await processTexture(source,output+'/'+asset.id);manifests.set(asset.id,manifest);for(const tier of ['low','balanced','hq'])files.set(asset.id+'/'+tier+'.png',await readFile(output+'/'+asset.id+'/'+tier+'.png'));}
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1100,height:800}}),page=await context.newPage(),errors=[],downloads=[];let fail=false;
 page.on('pageerror',e=>errors.push(e.message));
 await context.route(origin+'/texture-files/**',r=>{const key=new URL(r.request().url()).pathname.slice('/texture-files/'.length);downloads.push(key);if(fail&&key.includes('/'))return r.fulfill({status:404});return r.fulfill({body:files.get(key),contentType:'image/png'});});
 await context.route(origin+'/api/v1/**',r=>{const path=new URL(r.request().url()).pathname.slice('/api/v1'.length);let data;
  if(path===`/projects/${project.id}`)data=project;else if(path.endsWith('/assets'))data=assets;
  else if(assets.some(a=>path.endsWith('/assets/'+a.id))){const a=assets.find(a=>path.endsWith('/assets/'+a.id)),m=manifests.get(a.id),manifest=m&&structuredClone(m);if(manifest)for(const[tier,v]of Object.entries(manifest.variants))v.url=origin+'/texture-files/'+a.id+'/'+tier+'.png';data={...a,url:origin+'/texture-files/'+a.name,runtime:manifest?{state:'ready',manifest}:undefined};}
  else if(path.endsWith('/scenes'))data=[scene];else if(path.endsWith('/hotspots'))data=[];else if(path.endsWith('/layout'))data={document:scene.layout,revision:1};else if(path===`/public/tours/${project.slug}`)data={...project,start_scene_id:scene.id,scenes:[scene]};else throw new Error(path);
  return r.fulfill({json:data});
 });
 const snapshot=()=>page.evaluate(()=>window.__tourPerformance);
 async function open(mode='/t/'){await page.goto(origin+mode+project.slug+'?perf=1');await page.getByRole('button',{name:'Inspect model',exact:true}).waitFor();await page.waitForFunction(()=>window.__tourPerformance?.firstUsableViewMs>0);}
 await page.addInitScript(()=>localStorage.setItem('tour-render-quality','low'));
 await open();await page.waitForTimeout(1300);const low=await snapshot();assert.ok(low.resources.textureInventory.filter(t=>t.width===1024).length>=4);
 const before=low.metadata.cameraPosition;
 await page.getByLabel('Rendering quality',{exact:true}).selectOption('balanced');await page.waitForTimeout(1600);const balanced=await snapshot();assert.ok(balanced.resources.textureInventory.filter(t=>t.width===2048).length>=4);assert.ok(Math.hypot(...before.map((v,i)=>v-balanced.metadata.cameraPosition[i]))<1e-5);
 await open('/embed/');fail=true;await open();await page.waitForTimeout(1300);const fallback=await snapshot();assert.ok(fallback.resources.textureInventory.filter(t=>t.width===2048).length>=4);assert.ok(downloads.some(k=>k.startsWith('benchmark-2048')));assert.deepEqual(errors,[]);
 await writeFile(output+'/evidence.json',JSON.stringify({execution:'Headless Chromium / ANGLE SwiftShader; four external 2048 textures; API mocked; not physical-device acceptance',checks:['Low 1024 variants','Balanced 2048 variants','floor/pose preservation','public/embed','failed variant original fallback'],lowInventory:low.resources.textureInventory,balancedInventory:balanced.resources.textureInventory,manifests:Object.fromEntries(manifests),downloads},null,2));console.log('PASS external material texture tiers, pose, public/embed and fallback. Evidence: '+output+'/evidence.json');
}finally{await browser.close();}

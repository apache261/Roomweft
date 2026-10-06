import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {defaultSettings} from '../src/sceneSettings.ts';
import {template} from '../src/layout.ts';
const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';
const project={id:crypto.randomUUID(),name:'Numeric input checks',slug:'numeric-inputs',start_scene_id:crypto.randomUUID(),published:false};
let scene={id:project.start_scene_id,project_id:project.id,name:'House',type:'LAYOUT',layout_revision:1,layout:{version:1,elements:[template('LOBBY'),template('ROOM',10,0)],doors:[]},settings:structuredClone(defaultSettings),start_camera:{}};
let writes=0;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route(origin+'/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.slice('/api/v1'.length),method=route.request().method();let data;
    if(path===`/projects/${project.id}`)data=project;
    else if(path.endsWith('/assets')||path.endsWith('/hotspots'))data=[];
    else if(path===`/projects/${project.id}/scenes`)data=[scene];
    else if(path===`/scenes/${scene.id}/layout`){
      if(method==='PUT'){writes++;scene={...scene,layout:route.request().postDataJSON().document,layout_revision:scene.layout_revision+1};data=scene;}
      else data={document:scene.layout,revision:scene.layout_revision};
    }else if(path===`/scenes/${scene.id}`){if(method==='PATCH'){writes++;scene={...scene,...route.request().postDataJSON()};}data=scene;}
    else throw new Error('Unexpected route '+path);
    await route.fulfill({json:data});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/projects/'+project.id);
  await page.getByRole('region',{name:'Layout editor'}).waitFor();
  const field=label=>page.getByLabel(label,{exact:true});
  async function invalid(label,text,message){
    const input=field(label);await input.fill(text);
    assert.equal(await input.inputValue(),text,'Invalid draft stays editable');
    assert.equal(await input.getAttribute('aria-invalid'),'true');
    await input.locator('..').getByRole('alert').filter({hasText:message}).waitFor();
    assert.equal(await input.evaluate(e=>e.checkValidity()),false);
  }
  async function valid(label,text){
    const input=field(label);await input.fill(text);
    assert.equal(await input.inputValue(),text,'Decimal and exponent formatting stays intact');
    assert.equal(await input.getAttribute('aria-invalid'),'false');
    assert.equal(await input.evaluate(e=>e.checkValidity()),true);
  }
  // Clearing, signs, partial decimals, malformed numbers and limits never snap back.
  await invalid('Position X (m)','','Enter a number.');
  await field('Position X (m)').pressSequentially('-');
  assert.equal(await field('Position X (m)').inputValue(),'-');
  await field('Position X (m)').pressSequentially('1.25');
  assert.equal(await field('Position X (m)').inputValue(),'-1.25');
  assert.equal(await field('Position X (m)').getAttribute('aria-invalid'),'false');
  for(const text of ['abc','1.2.3','Infinity','1e999','0x10'])await invalid('Position X (m)',text,'Enter a valid number.');
  await invalid('Position X (m)','1001','between -1000 and 1000');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Cannot save yet: correct Position X (m).',{exact:true}).waitFor();assert.equal(writes,0);
  await valid('Position X (m)','-1000');await valid('Position X (m)','1000');await valid('Position X (m)','0');
  await invalid('Position Z (m)','-1001','between -1000 and 1000');
  await valid('Position Z (m)','-1.250');
  await field('Position Z (m)').press('ArrowUp');assert.equal(await field('Position Z (m)').inputValue(),'-1.250');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Layout saved. Walk inside and save a new start view.',{exact:true}).waitFor();assert.equal(scene.layout.elements[0].z,-1.25);
  // A different selected element gets its own draft even if its number matches.
  await invalid('Position Z (m)','oops','Enter a valid number.');
  await field('Selected layout element').selectOption(scene.layout.elements[1].id);
  assert.equal(await field('Position Z (m)').inputValue(),'0');assert.equal(await field('Position Z (m)').getAttribute('aria-invalid'),'false');
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();
  await invalid('Exposure','0.01','between 0.1 and 4');
  await valid('Exposure','1.30');
  await invalid('Exposure','1e-','Enter a valid number.');
  await field('Exposure').pressSequentially('1');assert.equal(await field('Exposure').inputValue(),'1e-1');assert.equal(await field('Exposure').getAttribute('aria-invalid'),'false');
  await valid('Exposure','1.3');
  // Save catches invalid fields in another inspector tab and reveals the error.
  await invalid('Light intensity','6','between 0 and 5');
  await page.getByRole('tab',{name:'Plan',exact:true}).click();const before=writes;
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Cannot save yet: correct Light intensity.',{exact:true}).waitFor();assert.equal(writes,before);
  assert.equal(await page.getByRole('tab',{name:'Appearance',exact:true}).getAttribute('aria-selected'),'true');
  await valid('Light intensity','0.65');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved.',{exact:true}).waitFor();assert.equal(scene.settings.appearance.light_intensity,.65);
  await invalid('Exposure','bad','Enter a valid number.');await page.getByRole('button',{name:'Reset settings',exact:true}).click();assert.equal(await field('Exposure').inputValue(),'1');assert.equal(await field('Exposure').getAttribute('aria-invalid'),'false');
  await page.getByRole('tab',{name:'Walking',exact:true}).click();await page.getByText('Movement settings',{exact:true}).click();
  await invalid('Walking speed (m/s)','7','between 0.25 and 6');await valid('Walking speed (m/s)','0.75');
  await page.getByRole('tab',{name:'Materials',exact:true}).click();await page.getByRole('button',{name:'Add material preset',exact:true}).click();
  await invalid('Tile size (m)','0','between 0.01 and 100');await valid('Tile size (m)','0.125');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Settings saved.',{exact:true}).waitFor();assert.equal(scene.layout.navigation.speed,.75);assert.equal(scene.layout.materials[0].tile_size,.125);
  assert.deepEqual(errors,[]);
  console.log('Numeric inputs passed: free typing, partial/invalid drafts, decimal precision, range limits, selection/reset, all four panels and save validation across tabs.');
} finally {await browser.close();}

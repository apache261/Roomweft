import {PNG} from 'pngjs';
import {pathToFileURL} from 'node:url';
import {createLayoutDemo} from './create-layout-demo.mjs';
import {newMaterial} from '../src/materials.ts';
export function textureFixture(kind) {
 const png=new PNG({width:64,height:64});
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){let color;
  if(kind==='normal')color=[128,128,255];else if(kind==='roughness')color=[180,180,180];
  else if(kind==='wood'){const grain=(Math.sin(x*1.8+y*0.04)+1)*18;color=[164+grain,86+grain,32+grain];}
  else if(kind==='wall')color=x%16<2||y%16<2?[70,28,94]:[175,86,185];
  else color=x<3||y<3?[40,60,67]:[125+(x+y)%14,181+(x+y)%14,190+(x+y)%14];
  const i=(y*64+x)*4;for(let c=0;c<3;c++)png.data[i+c]=color[c];png.data[i+3]=255;
 }
 return PNG.sync.write(png);
}
export async function createMaterialsDemo(origin='http://localhost:5173') {
 const fixture=await createLayoutDemo(origin);const {project,scene,request}=fixture;
 try {
  const assets={};for(const [name,role]of [['stone','TEXTURE_BASE_COLOR'],['wood','TEXTURE_BASE_COLOR'],['wall','TEXTURE_BASE_COLOR'],['normal','TEXTURE_NORMAL'],['roughness','TEXTURE_ROUGHNESS']]){
   const bytes=textureFixture(name),ticket=await request(`/projects/${project.id}/uploads`,'POST',{name:`${name}.png`,size:bytes.length,file_type:role}),form=new FormData();for(const [k,v]of Object.entries(ticket.upload.fields))form.append(k,v);form.append('file',new Blob([bytes],{type:'image/png'}),`${name}.png`);
   const uploaded=await fetch(ticket.upload.url,{method:'POST',body:form});if(!uploaded.ok)throw new Error(`Texture upload: ${uploaded.status}`);assets[name]=await request(`/assets/${ticket.asset.id}/complete`,'POST');
  }
  const stone={...newMaterial('Stone tiles'),base_color:assets.stone.id,normal:assets.normal.id,roughness_map:assets.roughness.id},wood={...newMaterial('Wood boards'),base_color:assets.wood.id,tile_size:1},wall={...newMaterial('Purple wall tiles'),base_color:assets.wall.id,tile_size:0.25};
  const doc=scene.layout;doc.materials=[stone,wood,wall];doc.elements[0].floor_material=stone.id;doc.elements[2].floor_material=wood.id;doc.elements[3].wall_material=wall.id;
  const updated=await request(`/scenes/${scene.id}/layout`,'PUT',{revision:scene.layout_revision,document:doc});return {...fixture,scene:updated,textureAssets:assets};
 }catch(error){await request(`/projects/${project.id}`,'DELETE');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';const {project}=await createMaterialsDemo(origin);console.log(`Tiled layout created: ${origin}/projects/${project.id}`);}

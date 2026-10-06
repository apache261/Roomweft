import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {starterLayout,template} from '../src/layout.ts';
export async function createLayoutDemo(origin='http://localhost:5173',empty=false) {
 async function request(path,method='GET',data) {const response=await fetch(`${origin}/api/v1${path}`,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});if(!response.ok)throw new Error(`${method} ${path}: ${await response.text()}`);return response.status===204?undefined:response.json();}
 const project=await request('/projects','POST',{name:'Connected layout example',description:'A lobby, corridor and two rooms in one walking world, with two independent instances of a textured table.'});
 try {
  const bytes=await readFile(new URL('../../tests/testdata/layout-table.glb',import.meta.url)),ticket=await request(`/projects/${project.id}/uploads`,'POST',{name:'layout-table.glb',size:bytes.length});
  const form=new FormData();for(const [key,value]of Object.entries(ticket.upload.fields))form.append(key,value);form.append('file',new Blob([bytes],{type:'model/gltf-binary'}),'layout-table.glb');
  const upload=await fetch(ticket.upload.url,{method:'POST',body:form});if(!upload.ok)throw new Error(`Upload failed: ${upload.status}`);
  const asset=await request(`/assets/${ticket.asset.id}/complete`,'POST');
  if(empty)return {project,asset,request};
  const doc=starterLayout();doc.elements.push({...template('INSTANCE',-1.5,1),asset_id:asset.id,name:'Lobby table',tint:'#bd7942'},{...template('INSTANCE',1.5,1),asset_id:asset.id,name:'Small table',rotation:90,scale:0.7,tint:'#567bb0'});
  const scene=await request(`/projects/${project.id}/scenes`,'POST',{type:'LAYOUT',name:'Lobby and connected rooms',layout:doc});
  await request(`/scenes/${scene.id}`,'PATCH',{start_camera:{position:[0,1.65,0],yaw:0,pitch:0}});
  await request(`/scenes/${scene.id}/hotspots`,'POST',{type:'INFO',title:'Lobby welcome',description:'Walk through the central doorway into the corridor. The side doors lead to Room A and Room B. Tables block walking; walls remain solid.',position:{x:-2.88,y:1.4,z:0,attachment:{element_id:doc.elements[0].id,local:[-2.88,1.4,0]}}});
  return {project,scene,asset,request};
 } catch(error){await request(`/projects/${project.id}`,'DELETE');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';const {project}=await createLayoutDemo(origin);console.log(`Layout example created: ${origin}/projects/${project.id}`);}

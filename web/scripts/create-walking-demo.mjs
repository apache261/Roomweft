import {pathToFileURL} from 'node:url';
import {createMaterialsDemo} from './create-materials-demo.mjs';
import {starterLayout,template} from '../src/layout.ts';
import {defaultNavigation} from '../src/navigationSettings.ts';
export async function createWalkingDemo(origin='http://localhost:5173'){
 const fixture=await createMaterialsDemo(origin),{project,request}=fixture;
 try{const doc=fixture.scene.layout,courtyard={...template('FLOOR',0,7),name:'Courtyard',width:6,depth:4,exterior:true,floor_material:doc.materials[0].id};doc.elements.push(courtyard);
 const annexDoc=starterLayout();const annex=await request(`/projects/${project.id}/scenes`,'POST',{type:'LAYOUT',name:'Gallery annex',layout:annexDoc});
 const exit={id:crypto.randomUUID(),label:'enter courtyard',position:[0,1.65,2.6],axis:'z',width:1.2,destination_region_id:courtyard.id,arrival:{position:[0,1.65,6],yaw:Math.PI,pitch:0}},back={id:crypto.randomUUID(),label:'return inside',position:[0,1.65,5.5],axis:'z',width:1.2,destination_region_id:doc.elements[0].id,arrival:{position:[0,1.65,0],yaw:0,pitch:0}},gallery={id:crypto.randomUUID(),label:'enter gallery',position:[2.6,1.65,0],axis:'x',width:1.2,destination_scene_id:annex.id,destination_region_id:annexDoc.elements[0].id,arrival:{position:[0,1.65,0],yaw:0,pitch:0}};
 doc.navigation={...defaultNavigation,portals:[exit,back,gallery]};const scene=await request(`/scenes/${fixture.scene.id}/layout`,'PUT',{revision:fixture.scene.layout_revision,document:doc});
 annexDoc.navigation={...defaultNavigation,portals:[{id:crypto.randomUUID(),label:'return to lobby',position:[0,1.65,2.6],axis:'z',width:1.2,destination_scene_id:scene.id,destination_region_id:doc.elements[0].id,arrival:{position:[0,1.65,0],yaw:0,pitch:0}}]};await request(`/scenes/${annex.id}/layout`,'PUT',{revision:annex.layout_revision,document:annexDoc});
 await request(`/scenes/${scene.id}`,'PATCH',{start_camera:{position:[0,1.65,0],yaw:0,pitch:0}});
 await request(`/scenes/${scene.id}/hotspots`,'POST',{type:'NAVIGATION',title:'Gallery tour',position:{x:2.8,y:1.4,z:-1},destination_scene_id:annex.id});
 await request(`/scenes/${scene.id}/hotspots`,'POST',{type:'INFO',title:'Courtyard artwork',description:'Information never grants walking access to the courtyard. Use its exit to enter, then the return exit to come back.',position:{x:0,y:1.4,z:7}});
 return {...fixture,scene:await request(`/scenes/${scene.id}`),annex,courtyard,exit,back,gallery};
 }catch(error){await request(`/projects/${project.id}`,'DELETE');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const origin=process.env.TOUR_ORIGIN||'http://localhost:5173';const f=await createWalkingDemo(origin);console.log(`Walking example created: ${origin}/projects/${f.project.id}`);}

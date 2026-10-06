import { readFile } from 'node:fs/promises';
import { defaultSettings } from '../src/sceneSettings.ts';
import { template, attachPoint } from '../src/layout.ts';
const id = n => `00000000-0000-4000-9000-${String(n).padStart(12,'0')}`;
export async function chunkingFixtures() {
  const manifest = JSON.parse(await readFile(new URL('../../tests/testdata/chunking/manifest.json',import.meta.url),'utf8'));
  const files = new Map(await Promise.all(manifest.fixtures.map(async f => [f.file,await readFile(new URL('../../tests/testdata/chunking/'+f.file,import.meta.url))])));
  const project = { id:id(1), name:'Chunking Phase 0 references',slug:'chunking-phase0',published:true,start_scene_id:id(10) };
  const assets = manifest.fixtures.map((f,i)=>({id:id(i+2),project_id:project.id,name:f.file,file_type:'GLB',upload_status:'ready',size:f.bytes}));
  const scenes = assets.map((asset,i)=>({id:id(10+i),project_id:project.id,asset_id:asset.id,name:asset.name,type:'3D',start_camera:manifest.start,settings:{...structuredClone(defaultSettings),navigation:{regions:[{id:'reviewed-interior',name:'Fixture reviewed structural floors',left:-2.9,right:2.9,top:-8.9,bottom:2.9,min_y:-.01,max_y:.01,floor_meshes:i?manifest.giantReviewedFloorPaths:manifest.reviewedFloorPaths}],portals:[{id:'explicit-doorway',label:'Enter Room B',position:[0,1.2,-3],axis:'z',width:2,destination_region_id:'reviewed-interior',arrival:{position:[0,1.65,-4],yaw:0,pitch:0}}]}}}));
  const roomA={...template('LOBBY',0,0),id:id(30),width:6,depth:6}, roomB={...template('ROOM',0,-6),id:id(31),width:6,depth:6};
  scenes.push({id:id(12),project_id:project.id,name:'Attached hotspot and explicit exit',type:'LAYOUT',layout_revision:1,settings:structuredClone(defaultSettings),start_camera:manifest.start,layout:{version:1,elements:[roomA,roomB],doors:[{id:id(32),a:roomA.id,b:roomB.id,at:0,width:2,height:2.2}],navigation:{portals:[{id:'attached-exit',label:'Enter Room B',position:[0,1.2,-3],axis:'z',width:2,destination_region_id:roomB.id,arrival:{position:[0,1.65,-4],yaw:0,pitch:0}}]}}});
  const position={x:1,y:1.3,z:-2.85};
  const hotspots=[{id:id(40),scene_id:scenes[2].id,type:'INFO',title:'Attached doorway marker',description:'Must retain its module-local position through reconstruction.',position:{...position,attachment:attachPoint(roomA,position)}}, {id:id(41),scene_id:scenes[0].id,type:'INFO',title:'Behind wall reference',description:'Must be occluded by the authored left wall.',position:{x:-3.4,y:1.3,z:0}}];
  return { manifest, project, assets, scenes, hotspots, files };
}

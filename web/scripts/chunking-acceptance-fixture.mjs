import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {BoxGeometry} from 'three';
import sharp from '../../asset-tools/node_modules/sharp/lib/index.js';
import {sourceInventory} from '../../asset-tools/inventory.mjs';
import {defaultNavigation} from '../src/navigationSettings.ts';
import {defaultSettings} from '../src/sceneSettings.ts';
const require=createRequire(new URL('../../asset-tools/package.json',import.meta.url));
const {Document,NodeIO}=await import(require.resolve('@gltf-transform/core'));

export async function createAcceptanceFixture(dir){
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();
 const image=await sharp(Buffer.from([220,100,50,255,50,150,220,255,120,220,100,255,200,80,150,255]),{raw:{width:2,height:2,channels:4}}).png().toBuffer();
 const material=doc.createMaterial('Authored shared floor').setBaseColorTexture(doc.createTexture().setImage(image).setMimeType('image/png'));
 function box(name,size,position){
  const geometry=new BoxGeometry(...size),p=doc.createPrimitive().setMaterial(material);
  for(const [name,semantic,type] of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2']])p.setAttribute(semantic,doc.createAccessor().setType(type).setArray(geometry.getAttribute(name).array).setBuffer(buffer));
  p.setAttribute('TEXCOORD_1',p.getAttribute('TEXCOORD_0').clone());
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(buffer));
  scene.addChild(doc.createNode(name).setTranslation(position).setMesh(doc.createMesh().addPrimitive(p)));geometry.dispose();
 }
 for(let i=0;i<6;i++)box(`Floor ${i}`,[4,.2,4],[0,-.1,-i*4]);
 box('Global wall',[.1,3,24],[-2,1.5,-10]);
 const source=dir+'/source.glb',bytes=Buffer.from(await new NodeIO().writeBinary(doc));await writeFile(source,bytes);const inventory=await sourceInventory(source);
 const partition={schema:'partition-v1',source_sha256:inventory.source_sha256,policy:'reviewed-rooms',visibility:'reviewed-openings',rooms:Array.from({length:6},(_,i)=>({id:`area-${i}`,name:`Area ${i}`,bounds:{min:[-2,-.2,-i*4-2],max:[2,3,-i*4+2]},node_paths:[`0/${i}`]})),global_node_paths:['0/6'],openings:Array.from({length:5},(_,i)=>({id:`door-${i}`,from:`area-${i}`,to:`area-${i+1}`,kind:'doorway',reviewed:true,corners:[[-.7,0,-i*4-2],[.7,0,-i*4-2],[.7,2.2,-i*4-2],[-.7,2.2,-i*4-2]]}))};
 const settings={...structuredClone(defaultSettings),navigation:{...defaultNavigation,regions:[{id:'00000000-0000-4000-9000-000000000095',name:'Approved floors',left:-1.9,right:2,top:-22,bottom:2,min_y:-.21,max_y:.01,floor_meshes:Array.from({length:6},(_,i)=>`0/${i}`)}]}};
 return {source,bytes,inventory,partition,settings,start:{position:[0,1.65,0],yaw:Math.PI,pitch:0}};
}

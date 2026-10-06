import {Box3,Matrix4,Vector3,Quaternion} from 'three';
import {defaultNavigation} from '../src/navigationSettings.ts';
import {modelMatrix} from '../src/sceneSettings.ts';
// These bundled fixtures have known structural floors. This explicit author
// review is demo setup, never automatic approval of arbitrary uploaded models.
export function reviewedInterior(bytes,model={scale:1,up_axis:'Y',rotation:0}){
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()),floors=[],box=new Box3();
 const visit=(index,path,parent)=>{const node=json.nodes[index],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1]))),matrix=parent.clone().multiply(local);
  if(/floor/i.test(node.name||'')&&node.mesh!==undefined){floors.push(path);for(const primitive of json.meshes[node.mesh].primitives){const accessor=json.accessors[primitive.attributes.POSITION];if(accessor.min&&accessor.max)box.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(matrix));}}
  (node.children||[]).forEach((child,i)=>visit(child,`${path}/${i}`,matrix));};(json.scenes[json.scene||0].nodes||[]).forEach((n,i)=>visit(n,`0/${i}`,modelMatrix(model)));
 const regions=floors.length?[{id:crypto.randomUUID(),name:'Reviewed fixture interior',left:box.min.x,right:box.max.x,top:box.min.z,bottom:box.max.z,min_y:box.max.y-0.01,max_y:box.max.y+0.01,floor_meshes:floors}]:[];
 // Trim the house's protruding slab to the reviewed indoor wall line.
 if(json.nodes.some(n=>n.name==='Floor')&&regions.length){regions[0].left=-2.9;regions[0].right=2.9;regions[0].top=-2.4;regions[0].bottom=2.4;}
 return {...defaultNavigation,regions,portals:[]};
}

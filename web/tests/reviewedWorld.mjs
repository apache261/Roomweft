import {Box3,Mesh,Vector3} from 'three';
import {meshSurfaces} from '../src/materials.ts';
import {defaultNavigation} from '../src/navigationSettings.ts';
// Fixtures explicitly review named structural floors; furniture and roofs are
// deliberately excluded even when they have horizontal triangles.
export function reviewFixture(root,paths){root.updateMatrixWorld(true);const surfaces=meshSurfaces(root),box=new Box3().setFromObject(root);const selected=paths||surfaces.filter(s=>/floor/i.test(s.label)).map(s=>s.path);let lowest=Infinity;root.traverse(o=>{if(o instanceof Mesh&&selected.includes(o.userData.materialPath)){lowest=Math.min(lowest,new Box3().setFromObject(o).max.y);}});if(!Number.isFinite(lowest))lowest=box.min.y;
 const navigation={...defaultNavigation,regions:[{id:crypto.randomUUID(),name:'Reviewed fixture floor',left:box.min.x,right:box.max.x,top:box.min.z,bottom:box.max.z,min_y:lowest-0.02,max_y:lowest+0.02,floor_meshes:selected}],portals:[]};root.userData.navigation=navigation;root.userData.walkRegions=navigation.regions;return navigation;}

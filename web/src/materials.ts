import { hasBakeUV,isMovingMesh } from './hqRendering.ts';
import { Box3, Mesh, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector3, type Object3D, type Texture, type Material } from 'three';
// Canonical remapping is runtime-owned. Uploaded GLB extras cannot approve
// another mesh's floor or impersonate its material/source path.
const sourceSurfacePaths=new WeakMap<Object3D,string>();
export function registerSourceSurfacePath(object:Object3D,path:string){sourceSurfacePaths.set(object,path);}
export function copySourceSurfacePaths(source:Object3D,copy:Object3D){const path=sourceSurfacePaths.get(source);if(path)sourceSurfacePaths.set(copy,path);source.children.forEach((child,i)=>{if(copy.children[i])copySourceSurfacePaths(child,copy.children[i]);});}
export type MaterialPreset = { id:string;name:string;light_map?:string;ao_map?:string;bake_revision?:string;base_color?:string;normal?:string;roughness_map?:string;tile_size:number;repeat:[number,number];offset:[number,number];rotation:number;tint:string;roughness:number };
export type Surface = {path:string;label:string;uv:boolean;bakeUV?:boolean;elementId?:string;bounds?:{min:number[];max:number[]}};
export function newMaterial(name='Stone tiles'):MaterialPreset {return {id:crypto.randomUUID(),name,tile_size:0.5,repeat:[1,1],offset:[0,0],rotation:0,tint:'#ffffff',roughness:0.85};}
export const textureIds=(presets:MaterialPreset[]=[])=>[...new Set(presets.flatMap(p=>[p.base_color,p.normal,p.roughness_map,p.ao_map,p.light_map].filter((id):id is string=>!!id)))].sort();
// Child-index paths remain stable across cloning, reloads and duplicate mesh names.
export function hasUVs(mesh:Mesh) {
 const uv=mesh.geometry.getAttribute('uv'),position=mesh.geometry.getAttribute('position');
 if(!uv||!position||uv.count!==position.count||!uv.count||uv.itemSize<2)return false;
 for(let i=0;i<uv.count;i++)if(!Number.isFinite(uv.getX(i))||!Number.isFinite(uv.getY(i)))return false;
 return true;
}
export function meshSurfaces(root:Object3D,elementId?:string):Surface[] {
 const surfaces:Surface[]=[];
 root.updateWorldMatrix(true,true);
 const visit=(o:Object3D,path:string)=>{if(o instanceof Mesh){const sourcePath=sourceSurfacePaths.get(o)||path;o.userData.materialPath=sourcePath;const box=new Box3().setFromObject(o);surfaces.push({path:sourcePath,label:o.name||`Mesh ${path}`,uv:hasUVs(o),bakeUV:hasBakeUV(o)&&!isMovingMesh(o),elementId,bounds:box.isEmpty()?undefined:{min:box.min.toArray(),max:box.max.toArray()}});}o.children.forEach((c,i)=>visit(c,`${path}/${i}`));};visit(root,'0');return surfaces;
}
export function tiledMaterial(p:MaterialPreset,textures:Map<string,Texture>,metres:[number,number]=[1,1],original?:Material) {
 const material=original?.clone() as MeshStandardMaterial || new MeshStandardMaterial();
 const owned:Texture[]=[];
 const map=(id:string|undefined,color:boolean)=>{const source=id&&textures.get(id);if(!source)return null;const t=source.clone();owned.push(t);t.colorSpace=color?SRGBColorSpace:NoColorSpace;t.wrapS=t.wrapT=RepeatWrapping;t.repeat.set(metres[0]/p.tile_size*p.repeat[0],metres[1]/p.tile_size*p.repeat[1]);t.offset.fromArray(p.offset);t.center.set(0,0);t.rotation=p.rotation*Math.PI/180;t.needsUpdate=true;return t;};
 material.userData.presetId=p.id;material.color.set(p.tint);material.roughness=p.roughness;material.map=map(p.base_color,true);material.normalMap=map(p.normal,false);material.roughnessMap=map(p.roughness_map,false);material.metalness=0;material.metalnessMap=null;material.needsUpdate=true;
 return {material,dispose:()=>{material.dispose();owned.forEach(t=>t.dispose());}};
}
export function applySurfaceMaterials(root:Object3D,presets:MaterialPreset[],assignments:Record<string,string>,textures:Map<string,Texture>,scale=1) {
 const owned:ReturnType<typeof tiledMaterial>[]=[];
 meshSurfaces(root);
 root.traverse(o=>{if(!(o instanceof Mesh))return;const p=presets.find(p=>p.id===assignments[o.userData.materialPath]);if(!p||!hasUVs(o))return;
 // Existing UV islands are retained. Convert one UV unit to metres using the
 // two largest world dimensions and UV extents; authored UV distortion remains.
 const box=new Box3().setFromObject(o).getSize(new Vector3()).toArray().sort((a,b)=>b-a),uv=o.geometry.getAttribute('uv');let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
 for(let i=0;i<uv.count;i++){minU=Math.min(minU,uv.getX(i));maxU=Math.max(maxU,uv.getX(i));minV=Math.min(minV,uv.getY(i));maxV=Math.max(maxV,uv.getY(i));}
 const metres:[number,number]=[Math.max(0.01,box[0]*scale)/Math.max(0.01,maxU-minU),Math.max(0.01,box[1]*scale)/Math.max(0.01,maxV-minV)];
 const apply=(m:Material)=>{const result=tiledMaterial(p,textures,metres,m);owned.push(result);return result.material;};o.material=Array.isArray(o.material)?o.material.map(apply):apply(o.material);
 });return ()=>owned.forEach(m=>m.dispose());
}

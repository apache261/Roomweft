import {prepareModel,defaultSettings,type SceneSettings} from '../sceneSettings.ts';
import {meshSurfaces} from '../materials.ts';
import {Mesh,MeshBasicMaterial,DoubleSide,type Object3D} from 'three';
export type SplatProxy=NonNullable<NonNullable<SceneSettings['splat']>['proxy']>;
export function prepareSplatProxy(source:Object3D,settings:SceneSettings,overlay=false) {
 let animated=false;source.traverse(object=>{if(object instanceof Mesh&&((object as Mesh&{isSkinnedMesh?:boolean;isInstancedMesh?:boolean}).isSkinnedMesh||(object as Mesh&{isInstancedMesh?:boolean}).isInstancedMesh||object.morphTargetInfluences?.length))animated=true;});if(animated)throw Error('Use an expanded static GLB collision proxy without skinning, morph targets or GPU instancing.');
 const proxy=settings.splat!.proxy!;
 const prepared=prepareModel(source,{...defaultSettings,model:proxy.model,navigation:proxy.reviewed?settings.navigation:undefined});
 // Uploaded extras cannot exempt a wall from collision or approve an unselected floor.
 prepared.root.children[0].traverse(object=>{object.userData={materialPath:object.userData.materialPath};});
 prepared.root.matrix.setPosition(...proxy.position);prepared.root.updateMatrixWorld(true);
 prepared.root.userData.runtimeGeometryRevision=JSON.stringify(proxy);
 const materials:MeshBasicMaterial[]=[];
 prepared.root.traverse(object=>{if(object instanceof Mesh){const material=new MeshBasicMaterial({color:'#00dfff',wireframe:overlay,side:DoubleSide,transparent:overlay,opacity:.5,depthWrite:false,colorWrite:overlay});materials.push(material);object.material=material;}});
 return {...prepared,surfaces:meshSurfaces(prepared.root.children[0]),dispose(){materials.forEach(m=>m.dispose());prepared.dispose();}};
}
export const proxyReady=(s:SceneSettings)=>!!s.splat?.proxy?.reviewed&&!!s.navigation?.regions.length;

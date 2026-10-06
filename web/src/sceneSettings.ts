import { applyCollisionGeometry } from './collisionGeometry.ts';
import { navigationSettings, type NavigationSettings } from './navigationSettings.ts';
import { applySurfaceMaterials, meshSurfaces, type MaterialPreset } from './materials.ts';
import { AnimationMixer, Box3, Group, Matrix4, Mesh, MeshStandardMaterial, PropertyBinding, Vector3, type AnimationClip, type Texture, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type SceneSettings = {
 navigation?:NavigationSettings;
 materials?:MaterialPreset[];surface_materials?:Record<string,string>;
  appearance: { hq_shadows?:boolean; exposure: number; environment_intensity: number; light_intensity: number; background: string; tint: string; roughness: number | null };
  model: { scale: number; up_axis: 'Y' | 'Z'; rotation: number };
};
export const defaultSettings: SceneSettings = {
  appearance: { exposure: 1, environment_intensity: 1, light_intensity: 1, background: '#edf1e8', tint: '', roughness: null },
  model: { scale: 1, up_axis: 'Y', rotation: 0 },
};
export function modelMatrix(model: SceneSettings['model']): Matrix4 {
  return new Matrix4().makeRotationY(model.rotation * Math.PI / 180)
    .multiply(new Matrix4().makeRotationX(model.up_axis === 'Z' ? -Math.PI / 2 : 0))
    .scale(new Vector3(model.scale, model.scale, model.scale));
}
export function prepareModel(source: Object3D, settings: SceneSettings, textures:Map<string,Texture>=new Map(), animations:AnimationClip[]=[]) {
  const root = new Group();
  root.userData.runtimeGeometryRevision=source.userData.runtimeGeometryRevision?`${source.userData.runtimeGeometryRevision}:${JSON.stringify(settings.model)}`:undefined;
  root.matrixAutoUpdate = false; root.matrix.copy(modelMatrix(settings.model));
  const copy = clone(source);
  copy.userData.runtimeAnimated = animations.length > 0;
  const clonedNodes=new WeakMap<Object3D,Object3D>();
  const pair=(a:Object3D,b:Object3D)=>{clonedNodes.set(a,b);a.children.forEach((child,i)=>pair(child,b.children[i]));};pair(source,copy);
  for(const clip of animations)for(const track of clip.tracks){const binding=PropertyBinding.parseTrackName(track.name),authored=PropertyBinding.findNode(source,binding.nodeName) as Object3D|undefined,node=(PropertyBinding.findNode(copy,binding.nodeName) as Object3D|undefined)||(authored&&clonedNodes.get(authored));if(node)node.userData.hqShadowDynamic=true;}

  applyCollisionGeometry(source, copy);
  const materials = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  copy.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const override = (material: MeshStandardMaterial) => {
      const existing = materials.get(material); if (existing) return existing;
      const result = material.clone(); materials.set(material, result);
      if (settings.appearance.tint && result.color) result.color.set(settings.appearance.tint);
      if (settings.appearance.roughness !== null && 'roughness' in result) result.roughness = settings.appearance.roughness;
      return result;
    };
    object.material = Array.isArray(object.material) ? object.material.map(override) : override(object.material);
  });
 copy.updateMatrixWorld(true);
 const disposeTiling=applySurfaceMaterials(copy,settings.materials||[],settings.surface_materials||{},textures,settings.model.scale);
 root.userData.navigation=navigationSettings(settings.navigation);
 root.userData.walkRegions=settings.navigation?.regions||[];
  root.add(copy); root.updateMatrixWorld(true);
  const surfaces=meshSurfaces(copy);
  const mixer=animations.length?new AnimationMixer(copy):undefined;
  animations.forEach(clip=>mixer!.clipAction(clip).play());
  return {
    root, surfaces, hasAnimations: animations.length > 0, dimensions: new Box3().setFromObject(root).getSize(new Vector3()).toArray(),
    updateAnimations: (seconds:number) => mixer?.update(seconds),
    applyAppearance: (appearance: SceneSettings['appearance']) => materials.forEach((material, original) => {
      if (material.color) { if (appearance.tint) material.color.set(appearance.tint); else material.color.copy(original.color); }
      if ('roughness' in material) material.roughness = appearance.roughness === null ? original.roughness : appearance.roughness;
    }),
    dispose: () => {mixer?.stopAllAction();mixer?.uncacheRoot(copy);disposeTiling();materials.forEach(material => material.dispose());},
  };
}

export function moveHotspots<T extends { position: { x: number; y: number; z: number } | { yaw: number; pitch: number } }>(hotspots: T[], old: SceneSettings['model'], next: SceneSettings['model']): T[] {
  const conversion = modelMatrix(next).multiply(modelMatrix(old).invert());
  return hotspots.map(h => {
    if (!('x' in h.position)) return h;
    const p = new Vector3(h.position.x, h.position.y, h.position.z).applyMatrix4(conversion);
    return { ...h, position: { ...h.position, x: p.x, y: p.y, z: p.z } };
  });
}

export function sameModel(a: SceneSettings['model'], b: SceneSettings['model']) {
  return a.scale === b.scale && a.up_axis === b.up_axis && a.rotation === b.rotation;
}
export function sameSettings(a: SceneSettings, b: SceneSettings) {
  return !!a.appearance.hq_shadows===!!b.appearance.hq_shadows && JSON.stringify(navigationSettings(a.navigation))===JSON.stringify(navigationSettings(b.navigation)) && JSON.stringify(a.materials||[])===JSON.stringify(b.materials||[]) && JSON.stringify(a.surface_materials||{})===JSON.stringify(b.surface_materials||{}) && sameModel(a.model, b.model) && (Object.keys(defaultSettings.appearance) as (keyof SceneSettings['appearance'])[])
    .every(key => a.appearance[key] === b.appearance[key]);
}

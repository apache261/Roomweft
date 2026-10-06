import { Box3, BufferAttribute, BufferGeometry, Camera, Group, InstancedMesh, Material, Mesh, Object3D, Sphere, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

export const spatialPolicy = { chunkMetres: 8, maxBatchVertices: 65536, maxMergedVertices: 500000, maxLODVertices: 200000, hysteresis: .15 };
export const simplifierReady = MeshoptSimplifier.supported ? MeshoptSimplifier.ready : Promise.reject(new Error('Simplification unavailable'));
// Attach a handler even in viewers that never request visual optimization.
simplifierReady.catch(() => {});
type SurfaceRef = { path?: string; elementId?: string; source: Mesh; firstTriangle?: number; triangleCount?: number };
type VisualLOD = { mesh: Mesh; geometries: BufferGeometry[]; sphere: Sphere; level: number };
export function lodLevel(pixels: number, previous: number): number {
  const thresholds = [180, 60], h = spatialPolicy.hysteresis;
  let level = previous;
  while (level < 2 && pixels < thresholds[level] * (1 - h)) level++;
  while (level > 0 && pixels > thresholds[level - 1] * (1 + h)) level--;
  return level;
}
export function resolveRuntimeSurface(mesh: Mesh, instanceId?: number, faceIndex?: number): SurfaceRef | undefined {
  const instances = mesh.userData.runtimeInstances as SurfaceRef[] | undefined;
  if (instances) return instanceId === undefined ? undefined : instances[instanceId];
  const ranges = mesh.userData.runtimeSurfaces as SurfaceRef[] | undefined;
  return ranges?.find(r => faceIndex !== undefined && faceIndex >= r.firstTriangle! && faceIndex < r.firstTriangle! + r.triangleCount!);
}
function roomIds(object:Object3D):string[] {for(let p:Object3D|null=object;p;p=p.parent)if(p.userData.roomIds)return p.userData.roomIds;return [];}
function reference(mesh: Mesh): SurfaceRef {
  let parent: Object3D | null = mesh;
  while (parent && !parent.userData.layoutElement) parent = parent.parent;
  return { source: mesh, path: mesh.userData.materialPath, elementId: parent?.userData.layoutElement };
}
function signature(material: Material) {
  if (material.type !== 'MeshStandardMaterial' && material.type !== 'MeshBasicMaterial') return material.uuid;
  const json: Record<string, unknown> = material.toJSON({ textures: {}, images: {}, geometries: {}, materials: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} }) as unknown as Record<string, unknown>;
  delete json.uuid; delete json.name; delete json.metadata;
  return JSON.stringify(json);
}
function eligible(mesh: Mesh) {
  // Three's instanced normal shader cannot represent shear. Keep those meshes
  // separate rather than changing their authored lighting.
  const e=mesh.matrixWorld.elements;
  const columns=[[e[0],e[1],e[2]],[e[4],e[5],e[6]],[e[8],e[9],e[10]]];
  for(const [a,b] of [[0,1],[0,2],[1,2]]) {
    const dot=columns[a].reduce((sum,v,i)=>sum+v*columns[b][i],0);
    const scale=Math.hypot(...columns[a])*Math.hypot(...columns[b]);
    if(Math.abs(dot)>scale*1e-6)return false;
  }
  if (!mesh.geometry.getAttribute('position') || mesh.geometry.type === 'InstancedBufferGeometry' || mesh.type !== 'Mesh' || Array.isArray(mesh.material) || !['MeshStandardMaterial','MeshBasicMaterial'].includes(mesh.material.type) || mesh.material.transparent || mesh.material.opacity < 1 || mesh.material.onBeforeCompile !== Material.prototype.onBeforeCompile || mesh.material.customProgramCacheKey !== Material.prototype.customProgramCacheKey || mesh.material.clippingPlanes?.length || mesh.morphTargetInfluences?.length || mesh.geometry.drawRange.start !== 0 || Number.isFinite(mesh.geometry.drawRange.count) || mesh.matrixWorld.determinant() <= 0) return false;
  for (let p: Object3D | null = mesh; p; p = p.parent) {
    if (!p.visible || p.userData.runtimeAnimated || p.userData.runtimeSeparate) return false;
  }
  return true;
}
function schema(geometry: BufferGeometry) {
  return Object.entries(geometry.attributes).sort().map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${'isInterleavedBufferAttribute' in a}:${a.array.constructor.name}`).join('|');
}

// The authored tree remains the sole source for collision, approvals and occlusion.
// The render tree shares source resources; only newly created geometry is owned here.
export function prepareSpatialRendering(authored: Object3D, simplify = false, batch = true) {
  authored.updateWorldMatrix(true, true);
  const root = new Group();
  root.userData.runtimeAuthoredRoot = authored;
  const owned = new Set<BufferGeometry>(), instances: InstancedMesh[] = [], lods: VisualLOD[] = [];
  const groups = new Map<string, Mesh[]>(), keys = new Map<Material, string>();
  const stats = { sourceMeshes: 0, renderMeshes: 0, instancedGroups: 0, batches: 0, lodGroups: 0 };
  let lodVertices = 0, mergedVertices = 0;
  const approved = new Set<string>((authored.userData.walkRegions || []).flatMap((r: { floor_meshes?: string[] }) => r.floor_meshes || []));
  const addLOD = (mesh: Mesh, source: Mesh, repeated = false) => {
    const g = source.geometry, position = g.getAttribute('position');
    const box = new Box3().setFromObject(source), size = box.getSize(new Vector3());
    if (!simplify || !eligible(source) || !position || position.itemSize !== 3 || position.normalized || 'isInterleavedBufferAttribute' in position || !g.index || g.index.count < 1500 || lodVertices + position.count > spatialPolicy.maxLODVertices || source.userData.walkFloor || approved.has(source.userData.materialPath) || /wall|floor|door|stair|ceiling|opening|frame/i.test(source.name) || Math.max(size.x,size.y,size.z) > 3 || (!repeated && !source.userData.visualLOD)) return;
    lodVertices += position.count;
    const variants = [mesh.geometry];
    try {
      const index = Uint32Array.from(g.index.array), positions = Float32Array.from(position.array);
      const attributes = ['normal', 'uv'].map(name => g.getAttribute(name)).filter(a => a && !a.normalized && !('isInterleavedBufferAttribute' in a));
      const stride = attributes.reduce((n,a) => n+a.itemSize,0), data = new Float32Array(position.count*stride);
      for (let i=0;i<position.count;i++) { let offset=0; for(const a of attributes) { for(let j=0;j<a.itemSize;j++) data[i*stride+offset+j]=a.getComponent(i,j); offset+=a.itemSize; } }
      for (const [ratio,error] of [[.6,.001],[.3,.003]]) {
        const [indices] = MeshoptSimplifier.simplifyWithAttributes(index,positions,3,data,stride,attributes.flatMap(a=>Array(a.itemSize).fill(a.itemSize===2?1:.5)),null,Math.floor(index.length*ratio/3)*3,error,['LockBorder']);
        if (!indices.length || indices.length >= variants[variants.length-1].index!.count) { variants.push(variants[variants.length-1]); continue; }
        // Variants own attributes so disposing one cannot invalidate shared source buffers.
        const variant = g.clone();
        variant.setIndex(new BufferAttribute(indices,1)); variant.boundingBox=g.boundingBox?.clone() || null; variant.boundingSphere=g.boundingSphere?.clone() || null;
        owned.add(variant); variants.push(variant);
      }
      if (variants.some(v=>v!==variants[0])) {
        const sphere = mesh instanceof InstancedMesh ? (mesh.computeBoundingSphere(),mesh.boundingSphere!.clone()) : (mesh.geometry.computeBoundingSphere(),mesh.geometry.boundingSphere!.clone().applyMatrix4(mesh.matrix));
        lods.push({mesh,geometries:variants,sphere,level:0}); stats.lodGroups++;
      }
    } catch { /* Unsupported geometry keeps its original detail. */ }
  };
  const passthrough = (mesh: Mesh) => {
    const visual = mesh.clone(false); visual.matrixAutoUpdate=false; visual.matrix.copy(mesh.matrixWorld);
    // Skinned/animated objects cannot be flattened safely: use the original subtree below.
    visual.userData = {...mesh.userData,roomIds:roomIds(mesh)}; root.add(visual); stats.renderMeshes++; addLOD(visual,mesh);
  };
  const visit = (object: Object3D) => {
    if (!object.visible) return;
    if (object.userData.runtimeAnimated || object.type === 'SkinnedMesh' || object.type === 'InstancedMesh' || !(object instanceof Mesh) && object.type !== 'Group' && object.type !== 'Object3D') {
      // Keep original hierarchy and mixer bindings. Rendering through a shallow wrapper
      // avoids reparenting the authored nodes used by the mixer/navigation.
      const wrapper = new Group(); wrapper.matrixAutoUpdate=false;
      wrapper.matrix.copy(object.parent?.matrixWorld || root.matrix);
      wrapper.userData.roomIds=roomIds(object);wrapper.children=[object]; root.add(wrapper);
      object.traverse(o=>{if(o instanceof Mesh){stats.sourceMeshes++;stats.renderMeshes++;}}); return;
    }
    if (object instanceof Mesh) {
      stats.sourceMeshes++;
      if (batch && eligible(object)) {
        const material = object.material as Material;
        if(!keys.has(material)) keys.set(material,signature(material));
        const b=new Box3().setFromObject(object).getCenter(new Vector3());
        const chunk=b.toArray().map(v=>Math.floor(v/spatialPolicy.chunkMetres)).join(':');
        const key=`${JSON.stringify(roomIds(object))}|${chunk}|${keys.get(material)}|${schema(object.geometry)}|${object.layers.mask}|${object.castShadow}|${object.receiveShadow}|${object.renderOrder}|${object.frustumCulled}`;
        const list=groups.get(key)||[];list.push(object);groups.set(key,list);
      } else passthrough(object);
    }
    object.children.forEach(visit);
  };
  visit(authored);
  for (const members of groups.values()) {
    const byGeometry=new Map<BufferGeometry,Mesh[]>();
    members.forEach(mesh=>{const list=byGeometry.get(mesh.geometry)||[];list.push(mesh);byGeometry.set(mesh.geometry,list);});
    const remaining:Mesh[]=[];
    for(const [geometry,list] of byGeometry) {
      if(list.length<2){remaining.push(...list);continue;}
      const visual=new InstancedMesh(geometry,list[0].material,list.length);
      list.forEach((mesh,i)=>visual.setMatrixAt(i,mesh.matrixWorld));
      visual.instanceMatrix.needsUpdate=true;visual.computeBoundingBox();visual.computeBoundingSphere();
      visual.layers.mask=list[0].layers.mask;visual.castShadow=list[0].castShadow;visual.receiveShadow=list[0].receiveShadow;visual.renderOrder=list[0].renderOrder;visual.frustumCulled=list[0].frustumCulled;
      visual.userData.roomIds=roomIds(list[0]);visual.userData.runtimeInstances=list.map(reference);root.add(visual);instances.push(visual);
      stats.instancedGroups++;stats.renderMeshes++;
      const safeLOD=list.every(m=>!m.userData.walkFloor && !approved.has(m.userData.materialPath) && !/wall|floor|door|stair|ceiling|opening|frame/i.test(m.name) && new Box3().setFromObject(m).getSize(new Vector3()).toArray().every(v=>v<=3));
      if(safeLOD)addLOD(visual,list[0],true);
    }
    // Bound extra memory and preserve useful culling granularity.
    let batch:Mesh[]=[], vertices=0;
    const flush=()=>{
      if(batch.length<2 || mergedVertices + vertices > spatialPolicy.maxMergedVertices){batch.forEach(passthrough);batch=[];vertices=0;return;}
      const geometries=batch.map(m=>{const g=m.geometry.clone();g.applyMatrix4(m.matrixWorld);return g;});
      // Normalize index representation without welding authored seams.
      geometries.forEach(g=>{if(!g.index)g.setIndex(Array.from({length:g.getAttribute('position').count},(_,i)=>i));});
      const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(!merged)batch.forEach(passthrough);
      else {mergedVertices += vertices;owned.add(merged);merged.computeBoundingBox();merged.computeBoundingSphere();const visual=new Mesh(merged,batch[0].material);let first=0;
        visual.layers.mask=batch[0].layers.mask;visual.castShadow=batch[0].castShadow;visual.receiveShadow=batch[0].receiveShadow;visual.renderOrder=batch[0].renderOrder;visual.frustumCulled=batch[0].frustumCulled;
        visual.userData.roomIds=roomIds(batch[0]);visual.userData.runtimeSurfaces=batch.map(m=>{const count=(m.geometry.index?.count||m.geometry.getAttribute('position').count)/3;const ref={...reference(m),firstTriangle:first,triangleCount:count};first+=count;return ref;});root.add(visual);stats.batches++;stats.renderMeshes++;}
      batch=[];vertices=0;
    };
    remaining.forEach(m=>{const count=m.geometry.getAttribute('position')?.count||0;if(vertices+count>spatialPolicy.maxBatchVertices)flush();if(count>spatialPolicy.maxBatchVertices)passthrough(m);else{batch.push(m);vertices+=count;}});flush();
  }
  root.updateMatrixWorld(true);
  const center=new Vector3(), viewCenter=new Vector3();
  return {root,stats,update(camera:Camera,height:number){
    for(const lod of lods){center.copy(lod.sphere.center);viewCenter.copy(center).applyMatrix4(camera.matrixWorldInverse);
      const projection=camera.projectionMatrix.elements[5];const perspective=camera.projectionMatrix.elements[15]===0;
      const pixels=perspective&&-viewCenter.z<=lod.sphere.radius?Infinity:height*Math.abs(projection)*lod.sphere.radius/(perspective?Math.max(.001,-viewCenter.z-lod.sphere.radius):1);
      const level=lodLevel(pixels,lod.level);if(level!==lod.level){lod.level=level;lod.mesh.geometry=lod.geometries[level];}
    }
  },dispose(){owned.forEach(g=>g.dispose());instances.forEach(i=>i.dispose());root.clear();}};
}

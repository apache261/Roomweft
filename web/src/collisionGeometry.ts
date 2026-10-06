import { Mesh, type BufferGeometry, type Object3D } from 'three';
const sources = new WeakMap<Object3D, Object3D>();
const geometries = new WeakMap<Mesh, BufferGeometry>();
export function registerCollisionSource(source: Object3D, proxy: Object3D) { sources.set(source, proxy); }
export function collisionGeometry(mesh: Mesh) { return geometries.get(mesh) || mesh.geometry; }
export function applyCollisionGeometry(source: Object3D, copy: Object3D) {
 const proxy = sources.get(source); if (!proxy) return;
 const pairs: [Mesh, BufferGeometry][] = [];
 const match = (visual: Object3D, collision: Object3D): boolean => {
  if (visual.children.length !== collision.children.length || (visual instanceof Mesh) !== (collision instanceof Mesh)) return false;
  if (visual instanceof Mesh && collision instanceof Mesh) pairs.push([visual, collision.geometry]);
  return visual.children.every((child, i) => match(child, collision.children[i]));
 };
 if (match(copy, proxy)) for (const [mesh, geometry] of pairs) geometries.set(mesh, geometry);
}

const identities = new WeakMap<BufferGeometry, { key: string; position: unknown; index: unknown; version: number; indexVersion: number }>();
export function registerGeometryIdentity(root: Object3D, key: string) {
 const visit=(object:Object3D,path:string)=>{
  if(object instanceof Mesh){const g=object.geometry,p=g.getAttribute('position');if(p)identities.set(g,{key:`${key}:${path}`,position:p,index:g.index,version:'version' in p?p.version:p.data.version,indexVersion:g.index?.version||0});}
  object.children.forEach((child,i)=>visit(child,`${path}/${i}`));
 };visit(root,'0');
}
export function immutableGeometryIdentity(geometry: BufferGeometry) {
 const identity=identities.get(geometry),p=geometry.getAttribute('position');
 return identity&&p&&p===identity.position&&geometry.index===identity.index&&('version' in p?p.version:p.data.version)===identity.version&&(geometry.index?.version||0)===identity.indexVersion?identity.key:undefined;
}

import {Box3,Ray,Triangle,Vector3} from 'three';
import {Octree} from 'three/examples/jsm/math/Octree.js';
import type {Capsule} from 'three/examples/jsm/math/Capsule.js';
type Node={box:Box3;triangles?:Triangle[];children?:[Node,Node]};
// A median BVH avoids exponential triangle duplication for coincident modular
// walls, while retaining Three's tested triangle/capsule and ray predicates.
export class TriangleIndex extends Octree {
 private tree?:Node;
 build(){const create=(triangles:Triangle[]):Node=>{const box=new Box3();for(const t of triangles){box.expandByPoint(t.a);box.expandByPoint(t.b);box.expandByPoint(t.c);}box.expandByScalar(0.002);if(triangles.length<=24)return {box,triangles};const size=box.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';triangles.sort((a,b)=>(a.a[axis]+a.b[axis]+a.c[axis])-(b.a[axis]+b.b[axis]+b.c[axis]));const middle=Math.floor(triangles.length/2);return {box,children:[create(triangles.slice(0,middle)),create(triangles.slice(middle))]};};if(this.triangles.length)this.tree=create([...this.triangles]);return this;}
 private query(node:Node|undefined,intersects:(box:Box3)=>boolean,result:Triangle[]){if(!node||!intersects(node.box))return;if(node.triangles)result.push(...node.triangles);else for(const child of node.children!)this.query(child,intersects,result);}
 getBoxTriangles(box:Box3){const triangles:Triangle[]=[];this.query(this.tree,b=>b.intersectsBox(box),triangles);return triangles;}
 getCapsuleTriangles(capsule:Capsule,triangles:Triangle[]){this.query(this.tree,b=>capsule.intersectsBox(b),triangles);return triangles;}
 getRayTriangles(ray:Ray,triangles:Triangle[]){this.query(this.tree,b=>ray.intersectsBox(b),triangles);return triangles;}
 clear(){this.tree=undefined;super.clear();return this;}
}

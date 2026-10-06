import {Box3,Vector3,Matrix4} from 'three';
import {type Bounds,type Partition,type SourceInventory,type PartitionRoom} from './chunkingContracts.ts';
// Only preview bounds use the prepared transform. Saved ownership stays in source space.
export function preparedPartitionBounds(bounds:Bounds,transform:Matrix4):Bounds{
 const box=new Box3(new Vector3(...bounds.min),new Vector3(...bounds.max)).applyMatrix4(transform);
 return {min:box.min.toArray(),max:box.max.toArray()};
}
export function assignPartitionNode(p:Partition,i:SourceInventory,path:string,owner:string):Partition{
 const changedRooms=new Set([p.rooms.find(r=>r.node_paths.includes(path))?.id,owner]);
 const next=structuredClone(p);next.global_node_paths=next.global_node_paths.filter(v=>v!==path);
 next.rooms.forEach(r=>r.node_paths=r.node_paths.filter(v=>v!==path));
 if(owner==='global')next.global_node_paths.push(path);else next.rooms.find(r=>r.id===owner)?.node_paths.push(path);
 // Membership changes recompute bounds. Authors can then tighten/review the volume.
 for(const r of next.rooms){if(!changedRooms.has(r.id))continue;const members=i.nodes.filter(n=>r.node_paths.includes(n.path)&&n.bounds);if(members.length)r.bounds={min:[0,1,2].map(axis=>Math.min(...members.map(n=>n.bounds!.min[axis]))) as Bounds['min'],max:[0,1,2].map(axis=>Math.max(...members.map(n=>n.bounds!.max[axis]))) as Bounds['max']};}
 return next;
}
export function removePartitionRoom(p:Partition,id:string):Partition{
 const room=p.rooms.find(r=>r.id===id);return {...p,rooms:p.rooms.filter(r=>r.id!==id),global_node_paths:[...p.global_node_paths,...room?.node_paths||[]],openings:p.openings.filter(o=>o.from!==id&&o.to!==id)};
}
export function newPartitionRoom(i:SourceInventory,name:string):PartitionRoom{return{id:'room-'+crypto.randomUUID(),name,bounds:structuredClone(i.bounds),node_paths:[]};}

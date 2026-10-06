// Independently delivered GLBs are chunks. Shared asset IDs load once, even when
// multiple rooms reference them. Lease release is delegated to the asset cache.
export type ChunkState<T>={status:'loading'|'ready'|'failed';value?:T;error?:string;release:()=>void};
export class RoomChunkCache<T> {
 readonly entries=new Map<string,ChunkState<T>>();
 private wanted=new Set<string>();private queue:string[]=[];private running=0;private disposed=false;
 private load:(id:string)=>{promise:Promise<T>;release:()=>void};private changed:()=>void;private limit:number;private concurrency:number;
 constructor(load:(id:string)=>{promise:Promise<T>;release:()=>void},changed:()=>void,limit=12,concurrency=2){this.load=load;this.changed=changed;this.limit=limit;this.concurrency=concurrency;}
 request(ids:Iterable<string>){this.wanted=new Set(ids);for(const id of this.wanted){const entry=this.entries.get(id);if(entry){this.entries.delete(id);this.entries.set(id,entry);}}this.queue=this.queue.filter(id=>this.wanted.has(id));for(const id of this.wanted)if(!this.entries.has(id)&&!this.queue.includes(id))this.queue.push(id);this.prune();this.pump();}
 retry(){for(const [id,e]of this.entries)if(e.status==='failed'){e.release();this.entries.delete(id);}this.request(this.wanted);this.changed();}
 private prune(){for(const [id,e]of this.entries){if(this.entries.size<=Math.max(this.limit,this.wanted.size))break;if(this.wanted.has(id)||e.status==='loading')continue;e.release();this.entries.delete(id);}}
 private pump(){while(!this.disposed&&this.running<this.concurrency&&this.queue.length){const id=this.queue.shift()!;if(!this.wanted.has(id)||this.entries.has(id))continue;
  const lease=this.load(id),entry:ChunkState<T>={status:'loading',release:lease.release};this.entries.set(id,entry);this.running++;
  lease.promise.then(value=>{entry.status='ready';entry.value=value;},error=>{entry.status='failed';entry.error=error instanceof Error?error.message:String(error);}).finally(()=>{this.running--;if(this.disposed){entry.release();this.entries.delete(id);}else{this.prune();this.changed();this.pump();}});
 }}
 dispose(){this.disposed=true;this.queue=[];for(const [id,e]of this.entries)if(e.status!=='loading'){e.release();this.entries.delete(id);}}
}

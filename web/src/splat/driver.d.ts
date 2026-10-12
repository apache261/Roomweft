import type {Mesh,Camera,WebGLRenderer,Box3} from "three";
export function createSplat(bytes:ArrayBuffer,gl:WebGLRenderer,invalidate:()=>void,onSorted?:()=>void):{mesh:Mesh;bounds:Box3;dispose:()=>void;count:number;cpuBytes:number;gpuBytes:number;update:(camera:Camera)=>void};
export function createSplatAsync(bytes:ArrayBuffer,gl:WebGLRenderer,invalidate:()=>void,onSorted:()=>void,signal:AbortSignal,onProgress?:(fraction:number)=>void,onError?:(error:Error)=>void):Promise<ReturnType<typeof createSplat>>;

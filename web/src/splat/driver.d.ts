import type {Mesh,Camera,WebGLRenderer} from "three";
export function createSplat(bytes:ArrayBuffer,gl:WebGLRenderer,invalidate:()=>void,onSorted?:()=>void):{mesh:Mesh;dispose:()=>void;count:number;cpuBytes:number;gpuBytes:number;update:(camera:Camera)=>void};

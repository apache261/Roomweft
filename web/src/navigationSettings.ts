export type WalkRegion={id:string;name:string;left:number;right:number;top:number;bottom:number;min_y:number;max_y:number;floor_meshes?:string[];exterior?:boolean};
export type Arrival={position:[number,number,number];yaw:number;pitch:number};
export type Portal={id:string;label:string;position:[number,number,number];axis:'x'|'z';width:number;destination_scene_id?:string;destination_region_id:string;arrival:Arrival};
export type NavigationSettings={speed:number;eye_height:number;step_height:number;max_slope:number;regions:WalkRegion[];portals:Portal[]};
export const defaultNavigation:NavigationSettings={speed:2,eye_height:1.65,step_height:0.25,max_slope:40,regions:[],portals:[]};
export function navigationSettings(value?:Partial<NavigationSettings>):NavigationSettings{return {...defaultNavigation,...value,regions:value?.regions||[],portals:value?.portals||[]};}

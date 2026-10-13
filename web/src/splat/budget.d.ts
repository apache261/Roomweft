export const sourceResidentLimit: number;
export const rendererResidentLimit: number;
export function splatRendererStats(): {renderers:number;estimatedResidentBytes:number;limitBytes:number};
export function reserveSplatRenderer(bytes:number):()=>void;
export function reserveSplatSource(bytes?:number):()=>void;

// Conservative provisional ceilings; physical-device acceptance is still required.
export const sourceResidentLimit = 128_000_000;
export const rendererResidentLimit = 384 * 1024 * 1024;
let rendererBytes = 0, renderers = 0;
export const splatRendererStats = () => ({renderers, estimatedResidentBytes: rendererBytes, limitBytes: rendererResidentLimit});
export function reserveSplatRenderer(bytes) {
 if (!Number.isFinite(bytes) || bytes <= 0 || rendererBytes + bytes > rendererResidentLimit) {
  throw new Error('Capture exceeds the viewer memory budget. Close other capture viewers or export a smaller .splat and retry.');
 }
 rendererBytes += bytes; renderers++;
 let released = false;
 return () => { if (!released) { released = true; rendererBytes -= bytes; renderers--; } };
}

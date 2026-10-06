// Whole-file source identity retains existing bake-v1 compatibility. Partition
// revisions and future chunk products do not enter a static lighting review key.
export function bakeAssetIdentity(id:string|null,response?:{runtime?:{manifest?:{source_sha256:string}}}|null){return response?.runtime?.manifest?.source_sha256||id;}

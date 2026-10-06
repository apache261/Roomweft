import type { AssetResponse } from './runtimeAssetCache.ts';
import type { QualityTier } from './viewerQuality.ts';
// Provisional RGBA8-equivalent envelopes, not measured VRAM/device budgets.
export const textureVariantBudgets:Record<QualityTier,number>={low:64*1024**2,balanced:192*1024**2,hq:384*1024**2};
export function sceneAssetTier(responses:AssetResponse[],requested:QualityTier){
 const choices:QualityTier[]=requested==='hq'?['hq','balanced','low']:requested==='balanced'?['balanced','low']:['low'];
 let result={tier:requested,bytes:0,budget:textureVariantBudgets[requested],unknown:0,overBudget:false};
 for(const tier of choices){let bytes=0,unknown=0;for(const response of responses){const v=response.runtime?.state==='ready'?response.runtime.manifest?.variants[tier]:undefined;if(v&&Number.isFinite(v.texture_rgba8_bytes))bytes+=v.texture_rgba8_bytes;else unknown++;}result={tier,bytes,budget:textureVariantBudgets[tier],unknown,overBudget:bytes>textureVariantBudgets[tier]};if(!result.overBudget)return result;}
 // Never drop authored textures or floors to satisfy an estimate. The lowest
 // available tier and explicit diagnostics preserve the validated fallback.
 return result;
}

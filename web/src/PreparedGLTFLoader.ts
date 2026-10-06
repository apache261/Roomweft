import type { WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { performanceStage } from './performanceMetrics.ts';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Meshopt is bundled locally. Basis support is configured for the active renderer.
const basisLoaders = new WeakMap<WebGLRenderer, KTX2Loader>();
export function disposeAssetDecoders(renderer: WebGLRenderer) { basisLoaders.get(renderer)?.dispose(); basisLoaders.delete(renderer); }
const supported = new Set([
  'EXT_meshopt_compression', 'KHR_texture_basisu',
  'KHR_lights_punctual', 'KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_dispersion',
  'KHR_materials_ior', 'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_transmission',
  'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_volume',
  'KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_mesh_quantization',
  'EXT_texture_webp', 'EXT_texture_avif', 'EXT_mesh_gpu_instancing', 'EXT_materials_bump',
]);
export function checkRequiredExtensions(required: string[] = []) {
  if (!Array.isArray(required) || required.some(extension => typeof extension !== 'string')) throw new Error('Model import: Invalid required extension metadata. Re-export a valid GLB 2.0 model.');
  const unsupported = required.filter(extension => !supported.has(extension));
  if (unsupported.length) throw new Error(`Model import: Unsupported required extension(s): ${unsupported.join(', ')}. Re-export a self-contained GLB without these extensions. Draco assets need an uncompressed export or a Meshopt variant.`);
}
export class PreparedGLTFLoader extends GLTFLoader {
  override parse(data: ArrayBuffer | string, path: string, onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void): void {
    // Validate before the built-in loader constructs decoder extensions: Draco
    // would otherwise fail before plugin hooks with a generic loader error.
    let document: string;
    if (typeof data === 'string') document = data;
    else {
      const view = new DataView(data);
      if (data.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('Model import: Expected a self-contained GLB 2.0 binary file.');
      const length = view.getUint32(12, true);
      if (length > data.byteLength - 20) throw new Error('Model import: The GLB JSON chunk is truncated. Re-export the model.');
      document = new TextDecoder().decode(new Uint8Array(data, 20, length));
    }
    let json;
    try { json = JSON.parse(document); } catch { throw new Error('Model import: The GLB metadata could not be decoded. Re-export a valid GLB 2.0 model.'); }
    checkRequiredExtensions(json.extensionsRequired);
    if (json.extensionsUsed?.includes('KHR_texture_basisu') && !this.ktx2Loader) throw new Error('Model import: KTX2 textures require a renderer with detected texture support.');
    if (json.extensionsUsed?.includes('KHR_draco_mesh_compression')) throw new Error('Model import: Draco compressed geometry needs an uncompressed GLB export or a Meshopt variant.');
    const finish = performanceStage('gltf-decode', typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength);
    try { super.parse(data, path, gltf => { finish(); onLoad(gltf); }, event => { finish('error'); onError?.(event); }); }
    catch (error) { finish('error'); throw error; }
  }
  constructor(renderer?: WebGLRenderer) {
    super();
    this.setMeshoptDecoder(MeshoptDecoder);
    if (renderer) this.configure(renderer);
    this.register(parser => ({
      name: 'TOUR_import_validation',
      beforeRoot: async () => {
        const json = parser.json;
        checkRequiredExtensions(json.extensionsRequired);
        for (const texture of json.textures || []) {
          if (texture.source !== undefined && !json.images?.[texture.source]) throw new Error('Model import: A material texture references a missing embedded image. Re-export with textures embedded.');
        }
        for (const image of json.images || []) {
          if (image.bufferView !== undefined && !json.bufferViews?.[image.bufferView]) throw new Error('Model import: An embedded image references a missing buffer view. Re-export with valid PNG/JPG textures.');
        }
      },
      afterRoot: async () => {
        const textures = await parser.getDependencies('texture');
        if (textures.some(texture => !texture)) throw new Error('Model import: An embedded texture is missing or could not be decoded. Re-export the model with valid embedded PNG/JPG textures.');
      },
    }));
  }
  configure(renderer: WebGLRenderer) {
    let loader = basisLoaders.get(renderer);
    if (!loader) {
      loader = new KTX2Loader().setTranscoderPath('/decoders/basis/').setWorkerLimit(2).detectSupport(renderer);
      basisLoaders.set(renderer, loader);
    }
    this.setKTX2Loader(loader);
    return this;
  }

}

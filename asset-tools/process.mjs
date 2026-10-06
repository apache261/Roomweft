import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { cloneDocument, dedup, prune, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Mesh, Texture, Vector3 } from 'three';

export const VERSION = 'runtime-v1';
const hash = data => createHash('sha256').update(data).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function inspectContainer(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Expected a complete self-contained GLB 2.0');
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  for (const resource of [...json.buffers || [], ...json.images || []]) if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('External resources are not processed; embed all buffers and images');
  const supported = new Set(ALL_EXTENSIONS.map(E => E.EXTENSION_NAME));
  for (const extension of json.extensionsUsed || []) if (!supported.has(extension) || ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_mesh_gpu_instancing'].includes(extension)) throw new Error(`Processing does not support ${extension}; original is preserved`);
  return json;
}
async function validate(bytes) {
  const result = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50 });
  if (result.issues.numErrors) throw new Error(`glTF validation failed: ${result.issues.messages.filter(m => m.severity === 0).map(m => m.message).join('; ')}`);
}

// Ignore index/vertex ordering while preserving oriented faces and every vertex
// attribute/morph value. No welding, quantization, graph flattening or mesh joins.
function primitiveSignature(primitive, geometryOnly = false) {
  if (primitive.getMode() !== 4) throw new Error('Derivative processing currently requires triangle primitives');
  const semantics = geometryOnly ? ['POSITION'] : primitive.listSemantics().sort();
  const attributes = semantics.map(s => primitive.getAttribute(s));
  const targets = geometryOnly ? [] : primitive.listTargets().flatMap(t => t.listSemantics().sort().map(s => t.getAttribute(s)));
  const all = [...attributes, ...targets], indices = primitive.getIndices()?.getArray(), count = indices?.length ?? attributes[0]?.getCount();
  if (!count || count % 3 || count > 6_000_000) throw new Error('Invalid or excessive triangle data');
  const vertex = i => all.map(a => Array.from(a.getArray().subarray(i * a.getElementSize(), (i + 1) * a.getElementSize()))).flat().join(',');
  const faces = [];
  for (let i = 0; i < count; i += 3) {
    const v = [0, 1, 2].map(j => vertex(indices ? indices[i + j] : i + j));
    faces.push([v.join('|'), [v[1], v[2], v[0]].join('|'), [v[2], v[0], v[1]].join('|')].sort()[0]);
  }
  return hash(stable({ semantics, types: all.map(a => [a.getType(), a.getComponentType(), a.getNormalized()]), faces: faces.sort() }));
}
async function semanticSnapshot(doc) {
  const { json } = await io.writeJSON(doc);
  // Resolve accessor references against writeJSON ordering, not root ordering.
  const written = await io.readJSON(await io.writeJSON(doc));
  const writtenAccessors = written.getRoot().listAccessors();
  const resolvedAccessor = index => { const a = writtenAccessors[index]; return { type: a.getType(), component: a.getComponentType(), normalized: a.getNormalized(), values: Array.from(a.getArray()) }; };
  json.meshes = written.getRoot().listMeshes().map((mesh, i) => ({ ...json.meshes[i], primitives: mesh.listPrimitives().map((p, j) => {
    const meta = { ...json.meshes[i].primitives[j] }; delete meta.attributes; delete meta.indices; delete meta.targets;
    return { ...meta, vertexData: primitiveSignature(p) };
  }) }));
  for (const animation of json.animations || []) for (const sampler of animation.samplers) { sampler.input = resolvedAccessor(sampler.input); sampler.output = resolvedAccessor(sampler.output); }
  for (const skin of json.skins || []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = resolvedAccessor(skin.inverseBindMatrices);
  for (const image of json.images || []) { delete image.uri; delete image.bufferView; delete image.mimeType; }
  for (const texture of json.textures || []) {
    if (texture.extensions?.EXT_texture_webp) { texture.source = texture.extensions.EXT_texture_webp.source; delete texture.extensions.EXT_texture_webp; if (!Object.keys(texture.extensions).length) delete texture.extensions; }
  }
  delete json.buffers; delete json.bufferViews; delete json.accessors; delete json.asset;
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    json[key] = (json[key] || []).filter(e => !['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'].includes(e)).sort();
  }
  return stable(json);
}
async function runtimeInventory(bytes) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.register(parser => ({ name: 'TOUR_geometry_inventory', beforeRoot() {
    const dependency = parser.getDependency.bind(parser), textures = new Map();
    parser.getDependency = (type, index) => {
      if (type !== 'texture') return dependency(type, index);
      if (!textures.has(index)) textures.set(index, Promise.resolve(new Texture()));
      return textures.get(index);
    };
  } }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const surfaces = [], geometry = [];
  const visit = (object, path) => {
    if (object instanceof Mesh) {
      surfaces.push({ source: path, runtime: path, name: object.name, uv: !!object.geometry.getAttribute('uv') });
      const p = object.geometry.getAttribute('position'), index = object.geometry.index, faces = [];
      for (let i = 0; i < (index?.count ?? p.count); i += 3) {
        const v = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(object.matrixWorld).toArray().join(','));
        faces.push([v.join('|'), [v[1], v[2], v[0]].join('|'), [v[2], v[0], v[1]].join('|')].sort()[0]);
      }
      geometry.push([path, hash(faces.sort().join('\n'))]);
    }
    object.children.forEach((child, i) => visit(child, `${path}/${i}`));
  };
  visit(gltf.scene, '0');
  const bounds = new Box3().setFromObject(gltf.scene);
  gltf.scene.traverse(object => { object.geometry?.dispose(); const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []; for (const m of materials) { for (const value of Object.values(m)) if (value?.isTexture) value.dispose(); m.dispose(); } });
  return { surfaces, geometryHash: hash(stable(geometry)), bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
}
export async function processAsset(source, output) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const bytes = await readFile(source); inspectContainer(bytes); await validate(bytes);
  const sourceDoc = await io.readBinary(bytes), before = await semanticSnapshot(sourceDoc), inventory = await runtimeInventory(bytes);
  await mkdir(output, { recursive: true });
  const manifest = { version: VERSION, source_sha256: hash(bytes), source_bytes: bytes.length, bounds: inventory.bounds, surfaces: inventory.surfaces, variants: {} };
  const maxBytes = { low: 64 * 1024 ** 2, balanced: 192 * 1024 ** 2, hq: 384 * 1024 ** 2 };
  for (const [tier, cap] of [['low', 1024], ['balanced', 2048], ['hq', 4096]]) {
    const doc = cloneDocument(sourceDoc);
    await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR] }), prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER], keepLeaves: true, keepAttributes: true, keepSolidTextures: true, keepExtras: true }), reorder({ encoder: MeshoptEncoder, cleanup: false }));
    let textureBytes = 0, maxTexture = 0;
    for (const texture of doc.getRoot().listTextures()) {
      const image = texture.getImage(); if (!image) throw new Error('Texture has no embedded pixels');
      const resized = await sharp(image, { limitInputPixels: 64 * 1024 ** 2 }).resize({ width: cap, height: cap, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
      texture.setImage(new Uint8Array(resized.data)).setMimeType('image/png');
      textureBytes += Math.ceil(resized.info.width * resized.info.height * 4 * 4 / 3); maxTexture = Math.max(maxTexture, resized.info.width, resized.info.height);
    }
    if (textureBytes > maxBytes[tier]) throw new Error(`${tier} textures exceed the provisional RGBA8 budget; reduce texture count/resolution and retry`);
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const encoded = await io.writeBinary(doc); await validate(encoded);
    const decoded = await io.readBinary(encoded);
    if (await semanticSnapshot(decoded) !== before) throw new Error(`${tier}: authored transforms, materials, attributes, skin or animation identity changed`);
    const runtime = await runtimeInventory(encoded);
    if (stable(runtime.surfaces) !== stable(inventory.surfaces) || runtime.geometryHash !== inventory.geometryHash) throw new Error(`${tier}: runtime surface paths or exact collision geometry changed`);
    await writeFile(`${output}/${tier}.glb`, encoded);
    manifest.variants[tier] = { file: `${tier}.glb`, sha256: hash(encoded), bytes: encoded.length, texture_rgba8_bytes: textureBytes, max_texture: maxTexture };
  }
  // Exact geometry proxy: strip rendering attributes/materials, retaining hierarchy,
  // skinning and morph positions. Floors are still approved only by authored settings.
  const collisionDoc = cloneDocument(sourceDoc);
  for (const mesh of collisionDoc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    primitive.setMaterial(null);
    for (const semantic of primitive.listSemantics()) if (!['POSITION', 'JOINTS_0', 'WEIGHTS_0'].includes(semantic)) primitive.setAttribute(semantic, null);
    for (const target of primitive.listTargets()) for (const semantic of target.listSemantics()) if (semantic !== 'POSITION') target.setAttribute(semantic, null);
  }
  for (const material of collisionDoc.getRoot().listMaterials()) material.dispose();
  for (const texture of collisionDoc.getRoot().listTextures()) texture.dispose();
  await collisionDoc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER], keepLeaves: true, keepAttributes: true, keepSolidTextures: true, keepExtras: true }));
  collisionDoc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const collision = await io.writeBinary(collisionDoc); await validate(collision);
  const proxyInventory = await runtimeInventory(collision);
  if (proxyInventory.geometryHash !== inventory.geometryHash || stable(proxyInventory.surfaces.map(s => [s.source, s.name])) !== stable(inventory.surfaces.map(s => [s.source, s.name]))) throw new Error('Collision proxy changed exact geometry or surface paths');
  await writeFile(`${output}/collision.glb`, collision);
  manifest.collision = { file: 'collision.glb', sha256: hash(collision), bytes: collision.length, geometry_sha256: inventory.geometryHash, strategy: 'verified-exact-geometry', floor_approval: 'authored-only' };
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv[4]?.startsWith('TEXTURE_')?processTexture:processAsset)(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
}

export async function processTexture(source, output) {
 const bytes=await readFile(source),metadata=await sharp(bytes,{limitInputPixels:64*1024**2}).metadata();
 if(!['png','jpeg','webp'].includes(metadata.format)||!metadata.width||!metadata.height)throw new Error('Use a valid PNG, JPG or WebP texture');
 await mkdir(output,{recursive:true});
 const manifest={version:VERSION,source_sha256:hash(bytes),source_bytes:bytes.length,source_max_texture:Math.max(metadata.width,metadata.height),bounds:{width:metadata.width,height:metadata.height},surfaces:[],variants:{}};
 for(const [tier,cap]of [['low',1024],['balanced',2048],['hq',4096]]){
  const result=await sharp(bytes,{limitInputPixels:64*1024**2}).resize({width:cap,height:cap,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  const decoded=await sharp(result.data).metadata();if(decoded.width!==result.info.width||decoded.height!==result.info.height||!!decoded.hasAlpha!==!!metadata.hasAlpha)throw new Error('Texture dimensions or alpha changed unexpectedly');
  await writeFile(`${output}/${tier}.png`,result.data);
  manifest.variants[tier]={file:`${tier}.png`,sha256:hash(result.data),bytes:result.data.length,max_texture:Math.max(result.info.width,result.info.height),texture_rgba8_bytes:Math.ceil(result.info.width*result.info.height*4*4/3)};
 }
 await writeFile(`${output}/manifest.json`,JSON.stringify(manifest,null,2));return manifest;
}

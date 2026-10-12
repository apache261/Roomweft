/* Adapted from @react-three/drei 10.7.9 core/Splat.js. MIT; see LICENSE.drei.
 * Local changes: bounded whole-source decode, owned worker/textures, demand-frame invalidation. */
import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei/core/shaderMaterial.js";
const SplatMaterial = /* @__PURE__ */shaderMaterial({
  alphaTest: 0,
  viewport: /* @__PURE__ */new THREE.Vector2(1980, 1080),
  focal: 1000.0,
  centerAndScaleTexture: null,
  covAndColorTexture: null
}, /*glsl*/`
    precision highp sampler2D;
    precision highp usampler2D;
    out vec4 vColor;
    out vec3 vPosition;
    uniform vec2 resolution;
    uniform vec2 viewport;
    uniform float focal;
    attribute uint splatIndex;
    uniform sampler2D centerAndScaleTexture;
    uniform usampler2D covAndColorTexture;    

    vec2 unpackInt16(in uint value) {
      int v = int(value);
      int v0 = v >> 16;
      int v1 = (v & 0xFFFF);
      if((v & 0x8000) != 0)
        v1 |= 0xFFFF0000;
      return vec2(float(v1), float(v0));
    }

    void main () {
      ivec2 texSize = textureSize(centerAndScaleTexture, 0);
      ivec2 texPos = ivec2(splatIndex%uint(texSize.x), splatIndex/uint(texSize.x));
      vec4 centerAndScaleData = texelFetch(centerAndScaleTexture, texPos, 0);
      vec4 center = vec4(centerAndScaleData.xyz, 1);
      vec4 camspace = modelViewMatrix * center;
      vec4 pos2d = projectionMatrix * camspace;

      float bounds = 1.2 * pos2d.w;
      if (pos2d.z < -pos2d.w || pos2d.x < -bounds || pos2d.x > bounds
        || pos2d.y < -bounds || pos2d.y > bounds) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
      }

      uvec4 covAndColorData = texelFetch(covAndColorTexture, texPos, 0);
      vec2 cov3D_M11_M12 = unpackInt16(covAndColorData.x) * centerAndScaleData.w;
      vec2 cov3D_M13_M22 = unpackInt16(covAndColorData.y) * centerAndScaleData.w;
      vec2 cov3D_M23_M33 = unpackInt16(covAndColorData.z) * centerAndScaleData.w;
      mat3 Vrk = mat3(
        cov3D_M11_M12.x, cov3D_M11_M12.y, cov3D_M13_M22.x,
        cov3D_M11_M12.y, cov3D_M13_M22.y, cov3D_M23_M33.x,
        cov3D_M13_M22.x, cov3D_M23_M33.x, cov3D_M23_M33.y
      );

      mat3 J = mat3(
        focal / camspace.z, 0., -(focal * camspace.x) / (camspace.z * camspace.z),
        0., focal / camspace.z, -(focal * camspace.y) / (camspace.z * camspace.z),
        0., 0., 0.
      );

      mat3 W = transpose(mat3(modelViewMatrix));
      mat3 T = W * J;
      mat3 cov = transpose(T) * Vrk * T;
      vec2 vCenter = vec2(pos2d) / pos2d.w;
      float diagonal1 = cov[0][0] + 0.3;
      float offDiagonal = cov[0][1];
      float diagonal2 = cov[1][1] + 0.3;
      float mid = 0.5 * (diagonal1 + diagonal2);
      float radius = length(vec2((diagonal1 - diagonal2) / 2.0, offDiagonal));
      float lambda1 = mid + radius;
      float lambda2 = max(mid - radius, 0.1);
      vec2 diagonalVector = normalize(vec2(offDiagonal, lambda1 - diagonal1));
      vec2 v1 = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
      vec2 v2 = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);
      uint colorUint = covAndColorData.w;
      vColor = vec4(
        float(colorUint & uint(0xFF)) / 255.0,
        float((colorUint >> uint(8)) & uint(0xFF)) / 255.0,
        float((colorUint >> uint(16)) & uint(0xFF)) / 255.0,
        float(colorUint >> uint(24)) / 255.0
      );
      vPosition = position;

      gl_Position = vec4(
        vCenter 
          + position.x * v2 / viewport * 2.0 
          + position.y * v1 / viewport * 2.0, pos2d.z / pos2d.w, 1.0);
    }
    `, /*glsl*/`
    #include <alphatest_pars_fragment>
    #include <alphahash_pars_fragment>
    in vec4 vColor;
    in vec3 vPosition;
    void main () {
      float A = -dot(vPosition.xy, vPosition.xy);
      if (A < -4.0) discard;
      float B = exp(A) * vColor.a;
      vec4 diffuseColor = vec4(vColor.rgb, B);
      #include <alphatest_fragment>
      #include <alphahash_fragment>
      gl_FragColor = diffuseColor;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `);
function createWorker(self) {
  let matrices = null;
  let offset = 0;
  function sortSplats(view, hashed = false) {
    const vertexCount = matrices.length / 16;
    const threshold = -0.0001;
    let maxDepth = -Infinity;
    let minDepth = Infinity;
    const depthList = new Float32Array(vertexCount);
    const sizeList = new Int32Array(depthList.buffer);
    const validIndexList = new Int32Array(vertexCount);
    let validCount = 0;
    for (let i = 0; i < vertexCount; i++) {
      // Sign of depth is reversed
      const depth = view[0] * matrices[i * 16 + 12] + view[1] * matrices[i * 16 + 13] + view[2] * matrices[i * 16 + 14] + view[3];
      // Skip behind of camera and small, transparent splat
      if (hashed || depth < 0 && matrices[i * 16 + 15] > threshold * depth) {
        depthList[validCount] = depth;
        validIndexList[validCount] = i;
        validCount++;
        if (depth > maxDepth) maxDepth = depth;
        if (depth < minDepth) minDepth = depth;
      }
    }

    // This is a 16 bit single-pass counting sort
    const depthInv = maxDepth > minDepth ? (256 * 256 - 1) / (maxDepth - minDepth) : 0;
    const counts0 = new Uint32Array(256 * 256);
    for (let i = 0; i < validCount; i++) {
      sizeList[i] = (depthList[i] - minDepth) * depthInv | 0;
      counts0[sizeList[i]]++;
    }
    const starts0 = new Uint32Array(256 * 256);
    for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
    const depthIndex = new Uint32Array(validCount);
    for (let i = 0; i < validCount; i++) depthIndex[starts0[sizeList[i]]++] = validIndexList[i];
    return depthIndex;
  }
  self.onmessage = e => {
    if (e.data.method == 'push') {
      if (offset === 0) matrices = new Float32Array(e.data.length);
      const new_matrices = new Float32Array(e.data.matrices);
      matrices.set(new_matrices, offset);
      offset += new_matrices.length;
    } else if (e.data.method == 'sort') {
      if (matrices !== null) {
        const indices = sortSplats(new Float32Array(e.data.view), e.data.hashed);
        // @ts-ignore
        self.postMessage({
          indices,
          key: e.data.key
        }, [indices.buffer]);
      }
    }
  };
}
function pushDataBuffer(shared, buffer, vertexCount) {
  const context = shared.gl.getContext();
  if (shared.loadedVertexCount + vertexCount > shared.maxVertexes) vertexCount = shared.maxVertexes - shared.loadedVertexCount;
  if (vertexCount <= 0) throw 'Failed to parse file';
  const u_buffer = new Uint8Array(buffer);
  const f_buffer = new Float32Array(buffer);
  const matrices = new Float32Array(vertexCount * 16);
  const covAndColorData_uint8 = new Uint8Array(shared.covAndColorData.buffer);
  const covAndColorData_int16 = new Int16Array(shared.covAndColorData.buffer);
  for (let i = 0; i < vertexCount; i++) {
    const quat = new THREE.Quaternion(-(u_buffer[32 * i + 28 + 1] - 128) / 128.0, (u_buffer[32 * i + 28 + 2] - 128) / 128.0, (u_buffer[32 * i + 28 + 3] - 128) / 128.0, -(u_buffer[32 * i + 28 + 0] - 128) / 128.0);
    quat.normalize().invert();
    const center = new THREE.Vector3(f_buffer[8 * i + 0], f_buffer[8 * i + 1], -f_buffer[8 * i + 2]);
    const scale = new THREE.Vector3(f_buffer[8 * i + 3 + 0], f_buffer[8 * i + 3 + 1], f_buffer[8 * i + 3 + 2]);
    const mtx = new THREE.Matrix4();
    mtx.makeRotationFromQuaternion(quat);
    mtx.transpose();
    mtx.scale(scale);
    const mtx_t = mtx.clone();
    mtx.transpose();
    mtx.premultiply(mtx_t);
    mtx.setPosition(center);
    const cov_indexes = [0, 1, 2, 5, 6, 10];
    let max_value = 0.0;
    for (let j = 0; j < cov_indexes.length; j++) if (Math.abs(mtx.elements[cov_indexes[j]]) > max_value) max_value = Math.abs(mtx.elements[cov_indexes[j]]);
    let destOffset = shared.loadedVertexCount * 4 + i * 4;
    shared.centerAndScaleData[destOffset + 0] = center.x;
    shared.centerAndScaleData[destOffset + 1] = -center.y;
    shared.centerAndScaleData[destOffset + 2] = center.z;
    shared.centerAndScaleData[destOffset + 3] = max_value / 32767.0;
    destOffset = shared.loadedVertexCount * 8 + i * 4 * 2;
    for (let j = 0; j < cov_indexes.length; j++) covAndColorData_int16[destOffset + j] = mtx.elements[cov_indexes[j]] * 32767.0 / max_value;

    shared.bounds?.expandByPoint(new THREE.Vector3(center.x, -center.y, center.z));

    // RGBA
    destOffset = shared.loadedVertexCount * 16 + (i * 4 + 3) * 4;
    const col = new THREE.Color(u_buffer[32 * i + 24 + 0] / 255, u_buffer[32 * i + 24 + 1] / 255, u_buffer[32 * i + 24 + 2] / 255);
    col.convertSRGBToLinear();
    covAndColorData_uint8[destOffset + 0] = col.r * 255;
    covAndColorData_uint8[destOffset + 1] = col.g * 255;
    covAndColorData_uint8[destOffset + 2] = col.b * 255;
    covAndColorData_uint8[destOffset + 3] = u_buffer[32 * i + 24 + 3];

    // Store scale and transparent to remove splat in sorting process
    mtx.elements[15] = Math.max(scale.x, scale.y, scale.z) * u_buffer[32 * i + 24 + 3] / 255.0;
    for (let j = 0; j < 16; j++) matrices[i * 16 + j] = mtx.elements[j];
  }
  while (vertexCount > 0) {
    let width = 0;
    let height = 0;
    const xoffset = shared.loadedVertexCount % shared.bufferTextureWidth;
    const yoffset = Math.floor(shared.loadedVertexCount / shared.bufferTextureWidth);
    if (shared.loadedVertexCount % shared.bufferTextureWidth != 0) {
      width = Math.min(shared.bufferTextureWidth, xoffset + vertexCount) - xoffset;
      height = 1;
    } else if (Math.floor(vertexCount / shared.bufferTextureWidth) > 0) {
      width = shared.bufferTextureWidth;
      height = Math.floor(vertexCount / shared.bufferTextureWidth);
    } else {
      width = vertexCount % shared.bufferTextureWidth;
      height = 1;
    }
    const centerAndScaleTextureProperties = shared.gl.properties.get(shared.centerAndScaleTexture);
    context.bindTexture(context.TEXTURE_2D, centerAndScaleTextureProperties.__webglTexture);
    context.texSubImage2D(context.TEXTURE_2D, 0, xoffset, yoffset, width, height, context.RGBA, context.FLOAT, shared.centerAndScaleData, shared.loadedVertexCount * 4);
    const covAndColorTextureProperties = shared.gl.properties.get(shared.covAndColorTexture);
    context.bindTexture(context.TEXTURE_2D, covAndColorTextureProperties.__webglTexture);
    context.texSubImage2D(context.TEXTURE_2D, 0, xoffset, yoffset, width, height,
    // @ts-ignore
    context.RGBA_INTEGER, context.UNSIGNED_INT, shared.covAndColorData, shared.loadedVertexCount * 4);
    shared.gl.resetState();
    shared.loadedVertexCount += width * height;
    vertexCount -= width * height;
  }
  return matrices;
}

export function createSplat(bytes, gl, invalidate, onSorted, onError, deferred = false) {
  const count = bytes.byteLength / 32;
  const context = gl.getContext();
  const width = Math.min(context.getParameter(context.MAX_TEXTURE_SIZE), Math.max(1, count));
  const height = Math.ceil(count / width);
  if (height > context.getParameter(context.MAX_TEXTURE_SIZE)) throw new Error('Capture exceeds GPU texture capacity');
  const shared = {gl, worker:null, bounds:new THREE.Box3(), rowLength:32, numVertices:count, maxVertexes:count,
    loadedVertexCount:0, bufferTextureWidth:width, bufferTextureHeight:height,
    centerAndScaleData:new Float32Array(width*height*4), covAndColorData:new Uint32Array(width*height*4)};
  shared.centerAndScaleTexture = new THREE.DataTexture(shared.centerAndScaleData,width,height,THREE.RGBAFormat,THREE.FloatType);
  shared.covAndColorTexture = new THREE.DataTexture(shared.covAndColorData,width,height,THREE.RGBAIntegerFormat,THREE.UnsignedIntType);
  shared.covAndColorTexture.internalFormat='RGBA32UI';
  shared.centerAndScaleTexture.needsUpdate=shared.covAndColorTexture.needsUpdate=true;
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-2,-2,0,2,2,0,-2,2,0,2,-2,0,2,2,0,-2,-2,0]),3));
  const indices=new THREE.InstancedBufferAttribute(new Uint32Array(count),1);
  indices.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('splatIndex',indices);geometry.instanceCount=0;
  const material=new SplatMaterial();
  Object.assign(material,{transparent:true,depthTest:true,depthWrite:false,blending:THREE.CustomBlending,blendSrcAlpha:THREE.OneFactor,toneMapped:true,
    centerAndScaleTexture:shared.centerAndScaleTexture,covAndColorTexture:shared.covAndColorTexture});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.raycast=()=>{};
  const workerURL = URL.createObjectURL(new Blob(['(', createWorker.toString(), ')(self)'], {type:'application/javascript'}));
  const worker = new Worker(workerURL);
  URL.revokeObjectURL(workerURL);
  shared.worker=worker;
  let disposed=false,pending=false,lastView='',sortTimeout;
  const dispose=()=>{if(disposed)return;disposed=true;clearTimeout(sortTimeout);worker.terminate();geometry.dispose();material.dispose();shared.centerAndScaleTexture.dispose();shared.covAndColorTexture.dispose();};
  try {
    gl.initTexture(shared.centerAndScaleTexture);gl.initTexture(shared.covAndColorTexture);
    if(!deferred){const matrices=pushDataBuffer(shared,bytes,count);
    worker.postMessage({method:'push',length:count*16,matrices:matrices.buffer},[matrices.buffer]);}
  } catch(error) {dispose();throw error;}
  worker.onerror=()=>{if(!disposed){dispose();onError?.(new Error("Splat sorting failed. Retry the scene."));}};
  worker.onmessage=e=>{if(disposed)return;clearTimeout(sortTimeout);indices.set(e.data.indices);indices.needsUpdate=true;geometry.instanceCount=e.data.indices.length;pending=false;onSorted?.();invalidate();};
  const viewport=new THREE.Vector4(),viewMatrix=new THREE.Matrix4();
  return {mesh,dispose,count,bounds:shared.bounds,
    async decode(signal,onProgress){
      try {for(let start=0;start<count;start+=8192){signal.throwIfAborted();if(disposed)throw new Error('Splat decoding cancelled');
        const n=Math.min(8192,count-start),matrices=pushDataBuffer(shared,bytes.slice(start*32,(start+n)*32),n);
        worker.postMessage({method:'push',length:count*16,matrices:matrices.buffer},[matrices.buffer]);onProgress?.((start+n)/count);
        await new Promise(resolve=>setTimeout(resolve,0));}signal.throwIfAborted();
      }catch(error){dispose();throw error;}
    },cpuBytes:bytes.byteLength+width*height*32+count*76,gpuBytes:width*height*32+count*4,
    update(camera){
      if(disposed)return;
      gl.getCurrentViewport(viewport); material.viewport.set(viewport.z,viewport.w);
      material.focal=viewport.w/2*Math.abs(camera.projectionMatrix.elements[5]);
      camera.updateMatrixWorld();mesh.updateWorldMatrix(true,false);
      viewMatrix.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);
      const m=viewMatrix.elements,view=new Float32Array([m[2],-m[6],m[10],m[14]]),key=Array.from(view).join(',');
      if(pending||key===lastView)return;pending=true;lastView=key;
      sortTimeout=setTimeout(()=>{if(!disposed){dispose();onError?.(new Error('Splat sorting timed out. Retry the scene.'));}},15000);
      worker.postMessage({method:'sort',key:mesh.uuid,view:view.buffer,hashed:false},[view.buffer]);
    }};
}

export async function createSplatAsync(bytes,gl,invalidate,onSorted,signal,onProgress,onError){
 signal.throwIfAborted();
 const driver=createSplat(bytes,gl,invalidate,onSorted,onError,true);
 await driver.decode(signal,onProgress);return driver;
}

// splat-v1: little-endian 32-byte records, no header or external resources.
export const maxSplatCount = 2_000_000;
export const maxSplatBytes = maxSplatCount * 32;
export function validateSplatBytes(bytes: ArrayBuffer): number {
  if (!bytes.byteLength || bytes.byteLength % 32 || bytes.byteLength > maxSplatBytes) throw new Error('Use a raw .splat capture with 32-byte records and at most 2,000,000 splats (64,000,000 bytes).');
  const view = new DataView(bytes);
  for (let offset=0; offset<bytes.byteLength; offset+=32) {
    for (let i=0; i<6; i++) {
      const value=view.getFloat32(offset+i*4,true);
      if (!Number.isFinite(value) || (i<3 ? Math.abs(value)>1e6 : value<1e-6 || value>1000)) throw new Error('Invalid splat position or linear scale.');
    }
    let norm=0;
    for(let i=28;i<32;i++) norm+=((view.getUint8(offset+i)-128)/128)**2;
    if(norm<0.81 || norm>1.21) throw new Error('Invalid splat quaternion: expected quantized unit w,x,y,z.');
  }
  return bytes.byteLength/32;
}

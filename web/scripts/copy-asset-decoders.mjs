import { copyFile, mkdir } from 'node:fs/promises';
const output = new URL('../public/decoders/basis/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) await copyFile(new URL('../node_modules/three/examples/jsm/libs/basis/' + file, import.meta.url), new URL(file, output));

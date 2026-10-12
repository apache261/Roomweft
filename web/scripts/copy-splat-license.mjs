import {copyFile,mkdir} from 'node:fs/promises';
const output=new URL('../public/licenses/',import.meta.url);
await mkdir(output,{recursive:true});
await copyFile(new URL('../src/splat/LICENSE.drei',import.meta.url),new URL('drei-splat.txt',output));

import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('../public/splat-fixtures/',import.meta.url));mkdirSync(directory,{recursive:true});
function write(name,points){const b=Buffer.alloc(points.length*32);points.forEach(([x,y,z,r,g,blue,scale],i)=>{const o=i*32;[x,y,z,scale,scale,scale].forEach((v,j)=>b.writeFloatLE(v,o+j*4));b.set([r,g,blue,220,255,128,128,128],o+24);});writeFileSync(directory+name+'.splat',b);}
const small=[];for(let x=-10;x<=10;x++)for(let y=-10;y<=10;y++)small.push([x/10,y/10,0,80+x*7,120+y*5,210,.055]);write('small',small);
const indoor=[];for(let a=-60;a<=60;a++)for(let b=-40;b<=40;b++){indoor.push([a/20,-b/20,3,190,100,80,.07]);indoor.push([-3,-b/20,a/20,80,160,200,.07]);indoor.push([3,-b/20,a/20,100,190,120,.07]);indoor.push([a/20,2,b/20,160,150,120,.07]);}write('indoor',indoor);

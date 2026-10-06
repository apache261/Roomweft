import {readFile, readdir, writeFile} from 'node:fs/promises';

// Remove when stable Fiber migrates to Timer. Fail on upgrades so this patch
// cannot silently stop working when upstream changes its bundled frame loop.
const root = new URL('../node_modules/@react-three/fiber/', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (pkg.version !== '9.8.1') throw new Error('Review the Fiber Timer compatibility patch for version ' + pkg.version);
const factory = (await readFile(new URL('fiber-timer-clock.mjs', import.meta.url), 'utf8')).replace('export function', 'function');
const marker = '// tour-fiber-timer-compatibility';
const dist = new URL('dist/', root);
let patched = 0;
for (const name of await readdir(dist)) {
  if (!/^events-.*\.(esm|cjs\.dev|cjs\.prod)\.js$/.test(name)) continue;
  const file = new URL(name, dist);
  const source = await readFile(file, 'utf8');
  if (source.includes(marker)) { patched++; continue; }
  const clocks = [...source.matchAll(/new (THREE(?:__namespace)?)\.Clock\(\)/g)];
  if (clocks.length !== 1) throw new Error('Unexpected Fiber clock construction in ' + name);
  const updated = source.replace(clocks[0][0], `createTimerClock(${clocks[0][1]}.Timer)`);
  await writeFile(file, updated + '\n' + marker + '\n' + factory);
  patched++;
}
if (patched !== 3) throw new Error('Expected three Fiber web bundles, found ' + patched);
console.log('Applied Fiber 9 Timer compatibility patch (ESM, CJS dev and production).');

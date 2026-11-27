// Driver for this entry: it answers every case of the set with the local
// solve module and writes the answers out, one per case and in the set's
// order, as a JSON array.
//
// The harness runs `node main.ts` with the set at /input and /output for
// the answers; outside a container those two folders come from
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR instead. V8's incremental
// marking is switched off up front, before solve.js is loaded, so all of
// its work runs under that setting.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as v8 from 'node:v8';

v8.setFlagsFromString('--no-incremental-marking');

const solver = await import(new URL('./solve.js', import.meta.url).href);

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const loaded = JSON.parse(fs.readFileSync(path.join(inDir, 'cases.json'), 'utf8'));
const done = [];
for (const entry of loaded) done.push(solver.run(entry.input));
fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(done));

/**
 * Regenerates test/fixtures/merkle-backend.json from the BACKEND's own
 * builder (api/src/server/services/escrow/merkle.ts), so the SDK's tests
 * compare against what the finaliser actually publishes, not against a second
 * implementation of the same idea.
 *
 *   npx vite-node scripts/make-merkle-fixture.ts
 *
 * Needs api/node_modules (for viem v2 as the backend resolves it). Reads the
 * backend source only; writes only inside sdk/.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildMerkleTree } from '../../api/src/server/services/escrow/merkle';

const entries = [
  { account: '0x31fffDFc9Ec36F1340be49245E1c96F4512F679e', amount: '100000000000000' },
  { account: '0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6', amount: '100000000000000' },
  { account: '0x0265A0C64A602c2c833CF011c131c6a7c993ACe9', amount: '100000000000000' },
  { account: '0x5aD5000000000000000000000000000000000001', amount: '70000000000000' },
  { account: '0x1490000000000000000000000000000000000002', amount: '30000000000000' },
];

const single = [{ account: '0x31fffDFc9Ec36F1340be49245E1c96F4512F679e', amount: '1' }];

const out = (list: typeof entries) => {
  const tree = buildMerkleTree(list);
  return { input: list, root: tree.root, dump: tree.dump, entries: tree.entries() };
};

const fixture = {
  generatedBy: 'api/src/server/services/escrow/merkle.ts buildMerkleTree',
  five: out(entries),
  single: out(single),
};

writeFileSync(resolve(__dirname, '../test/fixtures/merkle-backend.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log('roots', fixture.five.root, fixture.single.root);

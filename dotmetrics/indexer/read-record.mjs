/**
 * Read one DotNS text record over plain eth_call and print its value — the
 * read-back the refresh pipeline uses to confirm a `dotns text set` actually
 * landed. A set that cannot be read back did not happen, whatever the CLI
 * printed.
 *
 * Reads the CONTENT RESOLVER directly (never registry.resolver(); see
 * dotns.mjs). Prints the raw value on stdout — empty output means the record
 * is empty. A failed CALL exits non-zero instead: "could not read" and "reads
 * as empty" are different claims.
 *
 *   node read-record.mjs <name> <key>
 *   node read-record.mjs dotmetrics.dot directory
 */
import { contracts, nodeOf } from './dotns.mjs';

const [name, key] = process.argv.slice(2);
if (!name || !key) {
  console.error('usage: node read-record.mjs <name> <key>');
  process.exit(1);
}

try {
  const { resolver } = contracts();
  const value = String((await resolver.text(nodeOf(name), key)) ?? '');
  process.stdout.write(value + '\n');
  process.exit(0);
} catch (e) {
  console.error(`record read failed for ${key} on ${name}: ${e?.message ?? e}`);
  process.exit(2);
}

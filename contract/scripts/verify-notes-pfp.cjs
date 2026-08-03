// Read the two new contracts back off chain. A deploy that shipped stale
// bytecode is invisible otherwise — the address exists either way, and the app
// only fails later, at the first write.
//
// The devnet RPC is a Substrate node, not an Ethereum one: there is no
// `eth_call`. Reads go through pallet-revive's dry-run, which is what the SDK's
// contract layer does, so this uses the same path the app will.
//
// MASKS() must come back as the PeoplebookMasks2 address both contracts
// hard-code. Anything else means the blob was stale.
const NOTES = '0xf3584d1b59fb8759f4c6572e3a13c8a7af79c0cc';
const PFP = '0x6f3f9d84161f0bd0eb9d6524a5a2e5089b565470';
const EXPECT_MASKS = '0x4c1fe8f4d4fa617ac421ce54b4c8441ab8d0bd4a';

(async () => {
  const { createClient } = await import('polkadot-api');
  const { getWsProvider } = await import('polkadot-api/ws-provider/node');
  const contracts = await import('@parity/product-sdk/contracts');
  const { devnet_asset_hub } = await import('@parity/product-sdk-descriptors/devnet-asset-hub');

  const notesAbi = require('../artifacts/contracts/ChirpNotes.sol/ChirpNotes.json').abi;
  const pfpAbi = require('../artifacts/contracts/PeoplePFP.sol/PeoplePFP.json').abi;

  const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
  const rt = contracts.createContractRuntimeFromClient(client, devnet_asset_hub);
  const notes = contracts.createContract(rt, NOTES, notesAbi);
  const pfp = contracts.createContract(rt, PFP, pfpAbi);

  const show = async (label, fn) => {
    try { console.log(`${label.padEnd(24)} ${JSON.stringify(await fn())}`); }
    catch (e) { console.log(`${label.padEnd(24)} FAILED: ${e?.message ?? e}`); }
  };

  await show('notes.count', async () => (await notes.count.query()).value);
  await show('notes.totalRatings', async () => (await notes.totalRatings.query()).value);
  await show('notes.MASKS', async () => (await notes.MASKS.query()).value);
  await show('notes.notesOf(1)', async () => (await notes.notesOf.query(1n)).value);
  await show('pfp.MASKS', async () => (await pfp.MASKS.query()).value);
  await show('pfp.pfpOf(1)', async () => (await pfp.pfpOf.query(1n)).value);

  console.log(`\nexpected MASKS: ${EXPECT_MASKS}`);
  client.destroy();
})();

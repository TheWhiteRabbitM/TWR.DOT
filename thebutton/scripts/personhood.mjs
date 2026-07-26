/**
 * Devnet personhood toolkit for The Button.
 *
 *   node scripts/personhood.mjs status      — count recognized persons, show ours
 *   node scripts/personhood.mjs recognize   — make our deploy account a person (DummyDim)
 *   node scripts/personhood.mjs press       — press The Button on-chain via Revive.call
 *
 * MNEMONIC must be set in the environment (never printed). The DummyDim pallet
 * is the devnet's mock individuality mechanism — this is exactly what it is
 * for, and none of it exists on a production network.
 */
import { createClient, Enum } from 'polkadot-api';
import { getWsProvider } from '@polkadot-api/ws-provider';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers';
import { devnet_individuality } from '@parity/product-sdk-descriptors/devnet-individuality';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import { Binary } from 'polkadot-api';

const INDIVIDUALITY_RPC = process.env.INDIVIDUALITY_RPC ?? 'wss://people-paseo.rotko.net';
const ASSET_HUB_RPC = process.env.ASSET_HUB_RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const EXPECTED_ADDRESS = '5GL8hErZeFmqyQHQnZKJzZjsVXfDFAmHU7H9CAM18bPgKQPp';
const BUTTON = '0xC16Ee1AaF736DCF624f0A183f0975E3F05991DDb';

const mode = process.argv[2] ?? 'status';

// A dead RPC endpoint must fail loudly, not hang forever — this script hung
// for many minutes against an unresponsive node before this backstop existed.
const DEADLINE_MS = Number(process.env.DEADLINE_MS ?? 90_000);
setTimeout(() => {
  console.error(`FATAL: global deadline of ${DEADLINE_MS / 1000}s exceeded — endpoint unresponsive?`);
  process.exit(1);
}, DEADLINE_MS).unref();

function fatal(msg) {
  console.error('FATAL:', msg);
  process.exit(1);
}

function keypairFromEnv() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) fatal('MNEMONIC not set');
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)));
  // cdm derives the account straight from the mnemonic, no path. Verify.
  const pair = derive('');
  const address = ss58Address(pair.publicKey, 42);
  if (address !== EXPECTED_ADDRESS) {
    fatal(`derived ${address}, expected ${EXPECTED_ADDRESS} — derivation path mismatch`);
  }
  return pair;
}

function hex(bytes) {
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function withClient(rpc, descriptor, fn) {
  const client = createClient(getWsProvider(rpc));
  try {
    const api = client.getTypedApi(descriptor);
    return await fn(api, client);
  } finally {
    client.destroy();
  }
}

async function status() {
  const pair = keypairFromEnv();
  await withClient(INDIVIDUALITY_RPC, devnet_individuality, async (api) => {
    const nextId = await api.query.People.NextPersonalId.getValue();
    const entries = await api.query.People.People.getEntries();
    console.log(`recognized persons (People map entries): ${entries.length}`);
    console.log(`next personal id (ids ever allocated):   ${nextId}`);

    const meKey = hex(pair.publicKey).toLowerCase();
    const safe = (v) =>
      JSON.stringify(v, (_, x) =>
        typeof x === 'bigint' ? x.toString() : x?.asHex ? x.asHex() : x,
      );

    // The our-key check must never sink the counts above.
    try {
      if (entries.length > 0) {
        console.log(`first entry shape: ${safe(entries[0]).slice(0, 220)}`);
      }
      const keyHex = (entry) => {
        const stored = entry?.keyArgs?.[0] ?? entry?.args?.[0];
        if (typeof stored === 'string') return stored.toLowerCase();
        if (stored?.asHex) return stored.asHex().toLowerCase();
        if (stored instanceof Uint8Array) return hex(stored).toLowerCase();
        return safe(stored)?.toLowerCase() ?? '';
      };
      const mine = entries.find((entry) => keyHex(entry).includes(meKey.slice(2)));
      console.log(`our key in People map: ${mine ? `YES — ${safe(mine.value)}` : 'no'}`);
    } catch (error) {
      console.log(`our-key check failed (non-fatal): ${error?.message ?? error}`);
    }
  });
}

async function recognize() {
  const pair = keypairFromEnv();
  const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign);

  await withClient(INDIVIDUALITY_RPC, devnet_individuality, async (api) => {
    const before = await api.query.People.NextPersonalId.getValue();
    console.log(`next personal id before: ${before}`);

    // The individuality chain carries a custom VerifyMultiSignature signed
    // extension; a plain account signature declares it Disabled explicitly.
    const TX_OPTS = {
      customSignedExtensions: { VerifyMultiSignature: { value: Enum('Disabled') } },
    };

    console.log('reserving one personal id…');
    const reserve = await api.tx.DummyDim.reserve_ids({ count: 1 }).signAndSubmit(signer, TX_OPTS);
    if (!reserve.ok) fatal(`reserve_ids failed: ${JSON.stringify(reserve.dispatchError)}`);
    console.log(`reserved. tx ${reserve.txHash}`);

    // Sequential allocation: our reservation is the previous NextPersonalId.
    const id = before;
    console.log(`recognizing personal id ${id} with our own public key as member key…`);
    const rec = await api.tx.DummyDim.recognize_personhood({
      ids_and_keys: [[id, Binary.fromHex(hex(pair.publicKey))]],
    }).signAndSubmit(signer, TX_OPTS);
    if (!rec.ok) fatal(`recognize_personhood failed: ${JSON.stringify(rec.dispatchError)}`);
    console.log(`recognized. tx ${rec.txHash}`);

    const entries = await api.query.People.People.getEntries();
    console.log(`recognized persons now: ${entries.length}`);
  });
}

async function press() {
  const pair = keypairFromEnv();
  const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign);

  // press() selector: first 4 bytes of keccak256("press()"). Computed, not
  // hardcoded, so a typo cannot silently call a different function.
  const { keccak_256 } = await import('@noble/hashes/sha3');
  const selector = keccak_256(new TextEncoder().encode('press()')).slice(0, 4);

  await withClient(ASSET_HUB_RPC, devnet_asset_hub, async (api, client) => {
    console.log('dry-running press() via ReviveApi.call…');
    const unsafe = client.getUnsafeApi();
    const dry = await unsafe.apis.ReviveApi.call(
      EXPECTED_ADDRESS,
      Binary.fromHex(BUTTON),
      0n,
      undefined,
      undefined,
      Binary.fromHex(hex(selector)),
    );

    const result = dry?.result;
    console.log('dry-run success:', result?.success);
    if (!result?.success) {
      console.log('dry-run failure detail:', JSON.stringify(result?.value, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v?.asHex?.() ?? v,
      ));
      fatal('the chain says press() would fail — see detail above');
    }

    const gas = dry.gas_required;
    console.log(`gas required: ref_time ${gas.ref_time}, proof_size ${gas.proof_size}`);

    console.log('submitting Revive.call press()…');
    const tx = await api.tx.Revive.call({
      dest: Binary.fromHex(BUTTON),
      value: 0n,
      gas_limit: {
        ref_time: (gas.ref_time * 13n) / 10n,
        proof_size: (gas.proof_size * 13n) / 10n,
      },
      storage_deposit_limit: dry.storage_deposit?.value ? (dry.storage_deposit.value * 13n) / 10n : 1_000_000_000_000n,
      data: Binary.fromHex(hex(selector)),
    }).signAndSubmit(signer);

    if (!tx.ok) fatal(`press failed: ${JSON.stringify(tx.dispatchError)}`);
    console.log(`PRESSED. tx ${tx.txHash}`);
  });
}

/** Read our balance on both chains. */
async function balances() {
  const pair = keypairFromEnv();
  const who = ss58Address(pair.publicKey, 42);
  for (const [label, rpc, descriptor] of [
    ['asset hub', ASSET_HUB_RPC, devnet_asset_hub],
    ['individuality', INDIVIDUALITY_RPC, devnet_individuality],
  ]) {
    await withClient(rpc, descriptor, async (api) => {
      const account = await api.query.System.Account.getValue(who);
      console.log(`${label}: free ${account.data.free} (nonce ${account.nonce})`);
    });
  }
}

/**
 * Teleport PAS from Asset Hub to the individuality chain so our account can
 * pay fees there. System chains accept teleports from each other.
 */
async function teleport() {
  const pair = keypairFromEnv();
  const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign);
  const amount = BigInt(process.argv[3] ?? 50) * 10n ** 10n; // PAS has 10 decimals

  await withClient(ASSET_HUB_RPC, devnet_asset_hub, async (_api, client) => {
    console.log(`teleporting ${amount} plancks to the individuality chain (para 1004)…`);
    // The bundled descriptor trails the live runtime for PolkadotXcm, so the
    // typed API rejects the call with "Incompatible runtime entry". The unsafe
    // API encodes against live metadata instead — same trick the SDK uses for
    // ReviveApi dry-runs. V5 to match the live XCM version.
    const unsafe = client.getUnsafeApi();
    const tx = unsafe.tx.PolkadotXcm.limited_teleport_assets({
      dest: Enum('V5', {
        parents: 1,
        interior: Enum('X1', [Enum('Parachain', 1004)]),
      }),
      beneficiary: Enum('V5', {
        parents: 0,
        interior: Enum('X1', [
          Enum('AccountId32', { network: undefined, id: Binary.fromHex(hex(pair.publicKey)) }),
        ]),
      }),
      assets: Enum('V5', [
        {
          id: { parents: 1, interior: Enum('Here') },
          fun: Enum('Fungible', amount),
        },
      ]),
      fee_asset_item: 0,
      weight_limit: Enum('Unlimited'),
    });

    const result = await tx.signAndSubmit(signer);
    if (!result.ok) fatal(`teleport failed: ${JSON.stringify(result.dispatchError, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    console.log(`teleport submitted and finalized: ${result.txHash}`);
  });

  // Give the XCM a moment to execute on the destination, then show balances.
  await new Promise((r) => setTimeout(r, 15_000));
  await balances();
}

const run = { status, recognize, press, balances, teleport }[mode];
if (!run) fatal(`unknown mode ${mode}`);
run().then(
  () => process.exit(0),
  (e) => fatal(e?.message ?? String(e)),
);

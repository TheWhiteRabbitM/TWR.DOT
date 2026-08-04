// Rename the demo mask and give it a face.
//
// The picture is generated here rather than picked: it is drawn for a circle,
// because that is how every avatar in the app is clipped, and it echoes the
// app's own mark so the account reads as chirp's rather than as a stranger's.
//
// Run from chirp/ with MNEMONIC in the environment.
import { readFileSync } from 'node:fs';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import * as descriptors from '@parity/product-sdk-descriptors/devnet-asset-hub';
import * as contracts from '@parity/product-sdk/contracts';


const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
const FACE = '0xbc11688b1421bdde1fa1be5ea5bf02e9bb49be03';
const MASK = 1n;
const NAME = 'Chirp Dev';

// Drawn full-bleed: the avatar is clipped to a circle everywhere it appears, so
// a rounded square would only lose its corners. The bubble is the app's mark,
// and the dot inside it is cut out to the gradient so it reads at 40px.

// Generated on the Windows side with sharp — its binaries do not load under
// WSL, and the key that signs this only exists there.
const bytes = readFileSync('_face.webp');
console.log('face:', bytes.length, 'bytes');

const kp = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(process.env.MNEMONIC)))('');
const signer = getPolkadotSigner(kp.publicKey, 'Sr25519', kp.sign);
const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
const rt = contracts.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);

const masksAbi = JSON.parse(readFileSync('src/masks-abi.json', 'utf8'));
const faceAbi = JSON.parse(readFileSync('src/face-abi.json', 'utf8'));
const masks = contracts.createContract(rt, MASKS, masksAbi, { signer });
const face = contracts.createContract(rt, FACE, faceAbi, { signer });

const G = { gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n }, storageDepositLimit: 10n ** 18n, signer };
// The picture writes kilobytes, so it needs the larger allowance — and stays
// under this chain's per-extrinsic ceiling of 1_599_875_000_000.
const BIG = { gasLimit: { ref_time: 1_400_000_000_000n, proof_size: 5_000_000n }, storageDepositLimit: 10n ** 18n, signer };

// Read the profile first: setProfile takes all four fields, so writing only the
// name would silently erase the telegram, x and bio already there.
const cur = (await masks.profileOf.query(MASK)).value;
const pick = (v, k, i) => (Array.isArray(v) ? v[i] : v?.[k]) ?? '';
const [tg, x, bio] = [String(pick(cur, 'telegram', 1)), String(pick(cur, 'x', 2)), String(pick(cur, 'bio', 3))];
console.log(`keeping telegram="${tg}" x="${x}" bio="${bio}"`);

const r1 = await masks.setProfile.tx(NAME, tg, x, bio, G);
console.log('name  ->', r1?.ok === false ? JSON.stringify(r1).slice(0, 160) : 'ok');

const hex = '0x' + Buffer.from(bytes).toString('hex');
const r2 = await face.setFace.tx(MASK, hex, BIG);
console.log('face  ->', r2?.ok === false ? JSON.stringify(r2).slice(0, 160) : 'ok');

const back = (await face.sizeOf.query(MASK)).value;
console.log('sizeOf(1) on chain ->', Number(back), 'bytes');
client.destroy();

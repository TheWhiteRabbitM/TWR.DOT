// Add today's findings to PeopleWiki. Same shape as the first seeding run — the
// point of the wiki is that what cost us hours costs the next person nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import * as descriptors from '@parity/product-sdk-descriptors/devnet-asset-hub';
import * as contracts from '@parity/product-sdk/contracts';

// Relative, so this runs from WSL as well as from Windows. Not .pathname —
// that keeps the URL escaping and a space in the path arrives as %20.
const C = fileURLToPath(new URL('../contract/', import.meta.url));
const WIKI = '0x0465Db2133a6A3B096Eb6e39E44daa31EF3E37AA';
const kp = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(process.env.MNEMONIC)))('');
const signer = getPolkadotSigner(kp.publicKey, 'Sr25519', kp.sign);
const abi = JSON.parse(readFileSync(C + 'artifacts/contracts/PeopleWiki.sol/PeopleWiki.json', 'utf8')).abi;
const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
const rt = contracts.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
const w = contracts.createContract(rt, WIKI, abi, { signer });
const G = { gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n }, storageDepositLimit: 10n ** 18n, signer };
const MASK = 1n;

const E = [
['tooling', 'pad signs with a default key unless MNEMONIC is in the environment',
 'polkadot-app-deploy resolves its key as options.mnemonic || process.env.DOTNS_MNEMONIC || process.env.MNEMONIC || DEFAULT_MNEMONIC (chunk-VCE7PHQW.js around line 1173). With none of those set it silently uses the built-in default and signs as an account that owns nothing, so every publish to a name you own fails with "Domain x.dot is already owned by 0x...". The error names the OWNER, not the signer, which reads as if the domain were somebody else. Check which H160 pad prints in Preflight: if it is not yours, the environment is the problem, not the domain. Note the key can be nested in the keystore (ours is under a devnet key), so a top-level lookup returns undefined and falls through to the default just the same.'],

['tooling', 'A bash script from a Windows checkout will not parse in WSL',
 'Files carrying CRLF line endings fail in WSL bash with a syntax error pointing at a perfectly good line, e.g. "syntax error near `for attempt in $(seq 1 \\"$ATTEMPTS\\"); do". Strip them first: sed "s/\\r$//" script.sh > /tmp/script.sh && bash /tmp/script.sh. Same script runs fine from Git Bash on the Windows side.'],

['sdk', 'The host uploads to Bulletin for you: getPreimageManager',
 'An ordinary user cannot publish to Bulletin - the storage pool accounts need an authorisation that is currently ungrantable. But @parity/product-sdk-host exposes getPreimageManager(), with submit(bytes) returning a key and lookup(key, cb) delivering the bytes back through a subscription that reports null until it finds them. The host does the authorising. That is the only upload path an app can offer a user, and it is enough for anything small: chirp stores profile pictures this way, keeping only the key on chain. Preimages are content-addressed, so re-submitting identical bytes returns the identical key - which makes renewal free and means the contract never has to be touched again.'],

['sdk', 'Notifications: requestDevicePermission, then getNotificationManager',
 'requestDevicePermission takes one of "Notifications", "Camera", "Microphone", "Bluetooth", "NFC", "Location", "Clipboard", "OpenUrl", "Biometrics" and answers a Result whose value is granted true or false - a refusal is not an error. Delivery is getNotificationManager().push({text, deeplink, scheduledAt}), returning an id you can cancel. scheduledAt is a millisecond Unix timestamp as a bigint; leave it out to fire now. There is a cap on pending notifications and hitting it throws with the reason on error.cause.'],

['contracts', 'The devnet RPC has no eth_call',
 'It is a Substrate node, so eth_call comes back -32601 Method not found however well-formed the request. Reading a deployed contract means going through pallet-revive dry-run, which is what @parity/product-sdk/contracts does. Worth knowing before writing a verification script: an address exists whether or not the bytecode is what you meant to deploy, and a stale blob is invisible until the first write fails. Read a known constant back - ours hard-code the masks address, so MASKS() returning the right value proves the bytecode is the fresh one.'],

['deploy', 'Off the untyped api a contract address is a Binary, not a string',
 'client.getUnsafeApi() avoids needing generated descriptors for a one-off deploy, but the Revive.Instantiated event then carries the address as a Binary object. Printing it straight gives "[object Object]" and the deploy is effectively lost - you have the contract on chain and no idea where. Call .asHex(). Also worth knowing: getUnsafeApi needs no descriptors at all, which is handy in a project that has none.'],

['tooling', 'Node resolves imports from the script location, not the cwd',
 'Running node from a directory that has a dependency does not help if the script lives elsewhere: resolution starts at the SCRIPT file. A deploy script under contract/scripts importing polkadot-api gets contract/node_modules, whatever directory you launched it from. It shows up as ERR_PACKAGE_PATH_NOT_EXPORTED when two projects pin different versions - polkadot-api 1.15 exports ./ws-provider/*, newer builds export ./ws instead.'],

['tooling', 'A CSS grid column of 1fr will not clip its content',
 'A grid item min-width defaults to auto, so a single-column mobile layout written as grid-template-columns: 1fr grows to fit its widest child instead of constraining it. A horizontally scrolling strip inside then scrolls the whole PAGE. Write minmax(0, 1fr) and put min-width: 0 on the item. peoplewiki scrolled to 1453px on a 375px screen for exactly this, invisible on a desktop.'],
];

for (const [tag, title, body] of E) {
  const r = await w.add.tx(MASK, tag, title, body, G);
  console.log(`${r?.ok === false ? 'FAILED' : 'ok'}  ${title}`);
}
client.destroy();

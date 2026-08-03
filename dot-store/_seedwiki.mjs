import { readFileSync } from 'node:fs';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import * as descriptors from '@parity/product-sdk-descriptors/devnet-asset-hub';
import * as contracts from '@parity/product-sdk/contracts';

const C = 'C:/Users/miche/Downloads/DOT APP/contract/';
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
['chains', 'The devnet: three chains and what each one is for',
 'Asset Hub (wss://asset-hub-paseo-rpc.n.dwellir.com, genesis 0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2) runs the contracts, through pallet-revive on PolkaVM. Identity lives on the People chain (wss://people-paseo.rotko.net) as usernames in Resources.usernameOwnerOf. Bulletin (wss://bulletin-paseo.tservices.es:8443) stores app bundles as content-addressed CIDs, feeless but quota-limited. Careful: paseo-people-next-system-rpc.polkadot.io is a DIFFERENT chain (genesis 0xc5af...), not this devnet. Querying it returns 36k unrelated users instead of this devnet 41.'],

['signing', 'SignerManager({dappName}) does not use the user wallet',
 'Inside the Polkadot app, new SignerManager({dappName}) makes HostProvider.tryConnect take the dappName branch and call getProductAccount(name, 0): an APP-SCOPED account the host derives. It is not the wallet the person funded and they cannot see it in the wallet UI. Anything minted lands on an address they do not control, and a call carrying value fails with Revive.TransferFailed however low the price. getLegacyAccounts() and getLegacyAccountSigner() reach the real wallet accounts, but not every host exposes any.'],

['signing', 'One identity per app name, so ask for the same name everywhere',
 'The host derives a DIFFERENT account per dappName. Two apps asking under their own names are two different people on chain: an NFT claimed in one does not exist as far as the other is concerned, and a contract checking ownerOf(token) == msg.sender reverts. Every app meant to share one identity must request the SAME product name. That string IS the identity.'],

['signing', 'createContract silently ignores a signer option',
 'ContractOptions accepts signerManager, defaultOrigin and defaultSigner. Passing {signer} is an unknown key: it is dropped without a word, and every write fails ContractSignerMissingError, which surfaces as "no account connected". TxOptions on .tx() DOES take signer. Two adjacent APIs, two different names. Pass both.'],

['signing', 'Without ChainSubmit permission a signature hangs forever',
 'requestPermission({tag: "ChainSubmit", value: undefined}) from @parity/product-sdk-host must be called before signing anything. SignerManager does it on connect; going through getAccountsProvider() instead loses it, and then the host never raises the wallet sheet. The call does not fail - it never returns. Three separate fixes were shipped chasing a bug that was only a missing permission.'],

['contracts', 'Contract mappings are keyed by the H160, never by the ss58',
 'pallet-revive maps a Substrate account to an address the Ethereum way: keccak256(public key), last 20 bytes. A mapping like maskOf[address] is keyed by THAT. Passing the ss58 string the wallet reports reads a different slot and returns zero, so an account that holds something looks like it holds nothing. Verified pair: 5GL8hErZeFmqyQHQnZKJzZjsVXfDFAmHU7H9CAM18bPgKQPp maps to 0x4c8ad74eb2e8a804066e0bc7245a27a9db9a983d.'],

['contracts', 'A proxy keeps msg.sender: account abstraction reaches contracts',
 'Proxy.proxy(real, None, Revive.call(...)) makes the CONTRACT see the real account as msg.sender. Verified on this devnet: a delegate key called a function gated on ownerOf(mask) == msg.sender for a mask it does not own, and it succeeded. So an app signing with a host-derived account can act for a real account once the person runs Proxy.addProxy(delegate, Any, 0). Note the Proxies map is keyed real -> delegates, so discovering what a delegate may act for means scanning entries, a few hundred rows.'],

['contracts', 'PolkaVM rejects a getter returning several dynamic arrays',
 'A view function returning eight arrays (ids, authors, bodies and so on) makes instantiation fail with ContractTrapped - at DEPLOY time, not when called. Split it: value types in one getter, each string in its own, and let the reader page by walking ids downward. The same trap applies to pushing a struct containing empty strings inside a constructor.'],

['deploy', 'cdm cannot register a NEW contract name',
 'cdm deploy bundles Revive.instantiate_with_code and ContractRegistry.publishLatest into one utility.batch_all. The registry traps when inserting a name it has never seen - proven with read-only dry runs: publishLatest for an already registered name succeeds, for any new name it is ContractTrapped, regardless of gas or storage deposit. batch_all is all-or-nothing, so the perfectly good instantiate is rolled back with it. Filed as devnet issue #10.'],

['deploy', 'Deploy a new contract with a bare instantiate',
 'Skip the registry entirely: api.tx.Revive.instantiate_with_code({value: 0n, weight_limit: {ref_time: 900000000000n, proof_size: 3000000n}, storage_deposit_limit: 5n * 10n ** 12n, code: Binary.fromHex("0x" + blob), data: Binary.fromHex("0x"), salt: undefined}). The address comes from the Revive.Instantiated event. Binary.fromBytes does not exist in papi 2.2.x and fromOpaque rejects raw bytes - fromHex is the one that works. A much larger weight_limit is rejected outright as InvalidTxError.'],

['deploy', 'cdm build fails silently when solc rejects a file',
 'The error reads "An unexpected error occurred: TypeError: Cannot convert undefined or null to object" - no file, no line. It means solc produced no artifact and the plugin then read undefined. The blob is simply not regenerated, so the NEXT deploy ships the PREVIOUS bytecode and nothing warns you. Always check the .polkavm mtime after building, and read a deployed contract constants back off chain before wiring its address into an app. Causes seen so far: a hand-typed address with a wrong EIP-55 checksum, and characters inside a NatSpec comment. Bisect the file down to a stub to find it.'],

['deploy', 'Do not hard-code an identity contract address as a constant',
 'A contract that pins another as constant cannot follow it. Adding one field to an identity contract would have orphaned every mask AND every post, because the social contract pinned the old address. Either make the reference owner-settable, or extend sideways with a sibling contract that holds the new field.'],

['bulletin', 'Publishing works only from an already-authorised pool account',
 'Bulletin storage is feeless but limited per authorisation: an entry carries transactions and bytes allowances plus an expiry. New authorisations cannot be minted right now because the faucet authorizer has quota.transactions = 0 and allowedAuthorizers is empty, so dotns bulletin authorize always fails. Publishing still succeeds when the deploy tool happens to draw a pool account that already holds a live grant, so retry until it does - up to 20 attempts is reasonable. Filed as devnet issue #9.'],

['names', 'A .dot name under 9 characters needs Full Personhood',
 'Registering a short name is refused outright with "under 9 chars needs Full Personhood". Longer names register normally for about 10 PAS. Watch out: dotns can run out of V8 heap while formatting its own output AFTER the registration already succeeded. Check whether the name is yours before retrying, or you will be told it is already registered and conclude you failed. NODE_OPTIONS=--max-old-space-size=8192 avoids the crash.'],

['identity', 'Asset Hub contracts cannot read the People chain',
 'An AccountId32 is the same account on every parachain, but that does not let a contract on Asset Hub check anything about People chain state - there is no cross-chain state read available to contracts here. A People username therefore cannot be verified contract-side. What CAN be done: have the person act through a proxy so their on-chain identity belongs to their real AccountId32, then any reader can check that account against the People chain themselves. Verifiable by people, not by the contract - and worth saying which of the two you mean.'],

['sdk', 'The SDK hides its own error messages from JSON.stringify',
 'Contract calls answer err(Error), and Error.prototype.message is a NON-ENUMERABLE own property. JSON.stringify(err) therefore yields {"isSdkError":true,"source":"tx"} and drops the only useful field. Read .message first, then .name, then the structured dispatchError. Custom Solidity errors are not decoded on this path either: every named revert arrives as the same opaque ContractReverted, so map the conditions your app can actually hit.'],

['sdk', 'Pass explicit gas limits, or the wallet is never asked',
 'Without gasLimit and storageDepositLimit, .tx() sizes the call with its own dry run, and that estimate comes back short: the call reverts Revive.OutOfGas BEFORE any signature is requested, so it looks like the wallet is broken. Passing both skips the dry run entirely. Unused weight is not charged and the storage deposit is reserved rather than spent, so be generous: ref_time 600000000000, proof_size 1000000 works for ordinary calls.'],

['host', 'Host-derived accounts do not need funding',
 'Hours were lost topping up an app-scoped account on the theory that it could not pay its fees. A claim signed by one succeeded from an account that had never been funded: the host covers the fee. What such an account cannot do is TRANSFER value it does not hold, which is a different failure (Revive.TransferFailed) with a different fix - stop sending value you do not need to send.'],

['tooling', 'Build from Windows, publish from WSL',
 'node_modules in a Windows checkout hold Windows binaries, so npm run build under WSL fails while the identical command from Windows succeeds. The dotns and cdm tooling, on the other hand, wants WSL. Mixing them up produces failures that look like code problems and are not: four app builds "failed" this way before the cause was obvious.'],

['values', 'The value unit is planck, and the contract sees it multiplied',
 'The value passed to a pallet-revive call is native planck, 10 decimals: 1 PAS is 10000000000. Inside the contract msg.value is that number multiplied by 1e8, giving the 18-decimal EVM unit, so a price stored as 1e18 is cleared by sending 1e10 planck. Getting this wrong sends either nothing or a fortune, and the revert does not tell you which.'],
];

let n = 0;
for (const [tag, title, body] of E) {
  try {
    await w.add.tx(MASK, tag, title, body, G);
    n++;
    process.stdout.write('RESULT added ' + n + ': ' + title.slice(0, 50) + '\n');
  } catch (e) {
    process.stdout.write('RESULT FAILED ' + title.slice(0, 40) + ' :: ' + String(e.message).slice(0, 60) + '\n');
  }
}
process.stdout.write('RESULT count = ' + String((await w.count.query())?.value) + '\n');
client.destroy();
process.exit(0);

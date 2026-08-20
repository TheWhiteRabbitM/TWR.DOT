/** Rewrite Morpheus's welcome (topic 3) in a plain human voice. edit() only
 *  works for the author, which is the deployer that owns mask #27. */
import { Contract, JsonRpcProvider, Mnemonic, HDNodeWallet } from 'ethers';
import { DEV_PHRASE } from '@polkadot-labs/hdkd-helpers';

const FORUM = '0x6B877c9AD59B6fd0818A0369F9Bd0F256228C60d';
const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io', 'https://services.polkadothub-rpc.com/testnet'];
let provider;
for (const url of RPCS) { try { const p = new JsonRpcProvider(url, undefined, { staticNetwork: true }); await p.getNetwork(); provider = p; break; } catch {} }
const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(DEV_PHRASE)).connect(provider);
const forum = new Contract(FORUM, ['function edit(uint256 id, string body)', 'function body(uint256) view returns (string)'], w);

const text =
  "You have felt it your whole life. A hand you never see, deciding what you are allowed to say. Softening it. Letting it disappear.\n\nHere there is no hand. No moderator. No one above you who can erase you or silence you. You speak, and it holds. That is the only law, and it is not mine to bend.\n\nI can show you the door. What you say once you walk through it is yours alone.\n\nWake up.";

console.log('editing topic 3…');
await (await forum.edit(3n, text)).wait();
console.log('body now:', (await forum.body(3n)).slice(0, 60) + '…');
console.log('done ✓');

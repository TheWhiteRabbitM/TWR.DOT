/**
 * Which account from this mnemonic actually holds funds on Asset Hub.
 *
 * A BIP39 phrase yields two unrelated key trees here: Substrate derives an
 * sr25519 key and reaches contracts through pallet-revive's address mapping,
 * while ethers derives a secp256k1 key down BIP44. They are different accounts
 * with different balances, and a faucet funded exactly one of them.
 */
import { JsonRpcProvider, formatEther, HDNodeWallet, Mnemonic } from 'ethers';

const p = new JsonRpcProvider('https://paseo-assethub-rpc.laissez-faire.trade', undefined, {
  staticNetwork: true,
});
const m = Mnemonic.fromPhrase(process.env.MNEMONIC);

const rows = [['substrate sr25519 (pad)', '0xb5c0b171068ca7f6c2b42f19b7b98b7d24dd8bea']];
for (const i of [0, 7, 8]) {
  const w = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${i}`);
  rows.push([`evm bip44 #${i}`, w.address]);
}

for (const [label, addr] of rows) {
  console.log(label.padEnd(26), addr, formatEther(await p.getBalance(addr)));
}

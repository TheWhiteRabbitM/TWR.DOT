import { Contract, JsonRpcProvider, formatEther } from 'ethers';

/**
 * Everything this shop shows comes off the chain when you open it. There is no
 * catalogue file, no build-time snapshot and no indexer — the same argument
 * dotdirectory makes, for the same reason: a market whose stock is a JSON blob
 * committed last Tuesday is lying to whoever reads it.
 */

/** Amazdot, deployed against the live Peoplebook masks. */
export const MARKET = '0x6D2eEfb18Cfb2f90dDd7B42c0db038d80eaCb162';
/** PeoplebookMasks2 — identity for both sides of every order. */
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
/** Where a bundle's files are served from once published to Bulletin. */
export const GATEWAY = 'https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];

const MARKET_ABI = [
  'function listingCount() view returns (uint256)',
  'function orderCount() view returns (uint256)',
  'function page(uint256 start, uint256 size) view returns (tuple(uint256 seller, string title, string descCid, string imageCid, string payloadCid, bytes32 keyCommit, uint256 price, uint32 stock, bool digital, uint64 listedAt)[])',
  'function rating(uint256 seller) view returns (uint32 avgX100, uint32 count)',
  'function sales(uint256 seller) view returns (uint32)',
  'function ordersOfBuyer(address who) view returns (uint256[])',
  'function order(uint256 id) view returns (tuple(uint256 listingId, address buyer, uint256 buyerMask, uint256 paid, uint8 state, uint64 at, uint16 buyerSplit, uint16 sellerSplit, bytes sealed_, bytes sealedKey))',
];

const MASKS_ABI = [
  'function ownerOf(uint256 id) view returns (address)',
  'function maskOf(address who) view returns (uint256)',
  'function verifiedName(uint256 id) view returns (string)',
  'function profileOf(uint256 id) view returns (string displayName, string telegram, string x, string bio)',
  'function tierOf(uint256 id) view returns (uint8)',
];

/**
 * One connection, shared. A second provider opened quietly alongside the first
 * is how dotmetrics' heatmap came out uniformly empty: it failed on its own and
 * nothing surfaced.
 */
let cached: Promise<{ provider: JsonRpcProvider; endpoint: string; failed: string[] }> | null = null;

export function connect() {
  cached ??= open();
  return cached;
}

async function open() {
  const failed: string[] = [];
  for (const endpoint of RPCS) {
    try {
      const provider = new JsonRpcProvider(endpoint, undefined, {
        batchMaxCount: 60,
        staticNetwork: true,
      });
      await provider.getBlockNumber();
      return { provider, endpoint, failed };
    } catch {
      failed.push(new URL(endpoint).host);
    }
  }
  cached = null;
  throw new Error(`no endpoint answered (${failed.join(', ')})`);
}

/* ---------------------------------------------------------------- types --- */

export interface Listing {
  id: number;
  seller: bigint;
  title: string;
  descCid: string;
  imageCid: string;
  payloadCid: string;
  price: bigint;
  priceText: string;
  stock: number;
  digital: boolean;
  listedAt: number;
}

/**
 * A shop, and the two different kinds of name it might have.
 *
 * The mask contract keeps these apart on purpose and so does this: a `.dot` is
 * PROVEN — the contract recomputed its namehash and asked the registry who owns
 * it — while a display name is free text the holder typed. Collapsing them into
 * one `name` field, which an earlier version of this file did, means a seller
 * can type "polkadot" and be rendered exactly like a seller who owns
 * polkadot.dot. The tick has to mean something or it should not be drawn.
 */
export interface Seller {
  mask: bigint;
  owner: string | null;
  /** A `.dot` the holder PROVED they own. Shown with a tick. */
  verified: string | null;
  /** Free text the holder chose. Shown plainly, never with a tick. */
  display: string | null;
  sales: number;
  ratingX100: number;
  reviews: number;
}

/** What to call a shop, and whether that name is proof of anything. */
export const nameOf = (s: Seller | undefined, mask: bigint) =>
  s?.verified
    ? { label: `${s.verified}.dot`, proven: true }
    : s?.display
      ? { label: s.display, proven: false }
      : { label: `mask #${mask}`, proven: false };

export interface Shop {
  listings: Listing[];
  sellers: Map<string, Seller>;
  blockNumber: number;
  endpoint: string;
  failedOver: string[];
}

/**
 * Prices come back in plancks. Rendering them needs a decision rather than a
 * default: `formatEther` on a devnet balance gives eighteen digits of noise, so
 * this trims to four and drops a trailing point.
 */
export const priceOf = (wei: bigint) => {
  const s = formatEther(wei);
  const [i, f = ''] = s.split('.');
  const frac = f.slice(0, 4).replace(/0+$/, '');
  return frac ? `${i}.${frac}` : i;
};

/* ----------------------------------------------------------------- read --- */

const PAGE = 20;

/**
 * Read the whole shop.
 *
 * Paged and halving on refusal, for the reason dotdirectory measured: every
 * entry costs work inside one eth_call and eth_call has a gas ceiling, so the
 * safe page size moves as listings grow. Guessing a constant works until it
 * silently does not.
 */
export async function readShop(): Promise<Shop> {
  const { provider, endpoint, failed } = await connect();
  const market = new Contract(MARKET, MARKET_ABI, provider);

  const [total, blockNumber] = await Promise.all([
    market.listingCount().then(Number),
    provider.getBlockNumber(),
  ]);

  const listings: Listing[] = [];
  let start = 0;
  let size = PAGE;
  while (start < total) {
    try {
      const page = await market.page(start, Math.min(size, total - start));
      page.forEach((e: never[], i: number) => {
        const l = e as unknown as {
          seller: bigint; title: string; descCid: string; imageCid: string;
          payloadCid: string; price: bigint; stock: bigint; digital: boolean; listedAt: bigint;
        };
        listings.push({
          id: start + i,
          seller: l.seller,
          title: l.title,
          descCid: l.descCid,
          imageCid: l.imageCid,
          payloadCid: l.payloadCid,
          price: l.price,
          priceText: priceOf(l.price),
          stock: Number(l.stock),
          digital: l.digital,
          listedAt: Number(l.listedAt),
        });
      });
      start += page.length;
    } catch (e) {
      size = Math.floor(size / 2);
      if (size < 1) throw e;
    }
  }

  return { listings, sellers: new Map(), blockNumber, endpoint, failedOver: failed };
}

/**
 * Who the sellers are: the proven `.dot` on their mask, their completed sales
 * and their rating. Fired together so ethers batches them — the same call
 * pattern that took dotdirectory's owner pass from 99 seconds to 11.
 */
export async function readSellers(masks: bigint[]): Promise<Map<string, Seller>> {
  const { provider } = await connect();
  const market = new Contract(MARKET, MARKET_ABI, provider);
  const registry = new Contract(MASKS, MASKS_ABI, provider);
  const out = new Map<string, Seller>();

  await Promise.all(
    masks.map(async (mask) => {
      const [owner, verified, profile, sales, rating] = await Promise.all([
        registry.ownerOf(mask).catch(() => null),
        registry.verifiedName(mask).catch(() => ''),
        registry.profileOf(mask).catch(() => null),
        market.sales(mask).then(Number).catch(() => 0),
        market.rating(mask).catch(() => [0n, 0n]),
      ]);
      const held = owner && !/^0x0+$/i.test(String(owner)) ? String(owner) : null;
      out.set(mask.toString(), {
        mask,
        owner: held,
        verified: String(verified ?? '').trim() || null,
        display: String(profile?.[0] ?? '').trim() || null,
        sales,
        ratingX100: Number(rating[0] ?? 0),
        reviews: Number(rating[1] ?? 0),
      });
    }),
  );
  return out;
}

/** The mask an address holds, or 0n. Used to tell a visitor they are a seller. */
export async function maskOf(address: string): Promise<bigint> {
  const { provider } = await connect();
  return new Contract(MASKS, MASKS_ABI, provider).maskOf(address).catch(() => 0n);
}

export const STATE_LABEL = [
  'none', 'paid', 'sent', 'confirmed', 'disputed', 'refunded', 'settled',
] as const;

export interface Order {
  id: number;
  listingId: number;
  buyer: string;
  buyerMask: bigint;
  paid: bigint;
  state: number;
  at: number;
  sealedKey: string;
}

/** The orders one account has placed, newest first. */
export async function readOrdersOf(address: string): Promise<Order[]> {
  const { provider } = await connect();
  const market = new Contract(MARKET, MARKET_ABI, provider);
  const ids: bigint[] = await market.ordersOfBuyer(address).catch(() => []);
  const rows = await Promise.all(
    ids.map(async (id) => {
      const o = await market.order(id);
      return {
        id: Number(id),
        listingId: Number(o.listingId),
        buyer: String(o.buyer),
        buyerMask: o.buyerMask as bigint,
        paid: o.paid as bigint,
        state: Number(o.state),
        at: Number(o.at),
        sealedKey: String(o.sealedKey),
      };
    }),
  );
  return rows.reverse();
}

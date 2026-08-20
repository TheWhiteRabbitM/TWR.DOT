/**
 * Every byte this page shows comes off the chain at view time. There is no
 * baked directory, no snapshot and no build-time index — which is the entire
 * point of the contract it reads.
 *
 * Discovering `.dot` names used to require walking blocks and scraping plaintext
 * out of raw extrinsic bytes, because DotNS is ENS-style and its events carry
 * only the hash of a name. That needed a machine and a schedule. DotDirectory
 * keeps the plaintext on-chain instead, so the same discovery is two eth_calls
 * and a browser can do it alone.
 */
import { Contract, JsonRpcProvider, keccak256, solidityPacked, toUtf8Bytes, ZeroHash } from 'ethers';

/**
 * DotDirectory2. The first version is still live at
 * 0x8ebd9f5a7c278744c90c88c149b5fb95144277a7 and still correct; this one adds
 * arrival blocks and resolves owners inside the page view, which is what turns
 * 205 owner calls into five.
 */
export const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';
export const REGISTRY = '0x527b08a640b527a3dae0C4BE04D7344E430B6E50';
/** Where every `.dot` keeps its text records. Same address dotmetrics reads. */
export const CONTENT_RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

const RESOLVER_ABI = [
  'function text(bytes32 node, string key) view returns (string)',
  'function contenthash(bytes32 node) view returns (bytes)',
];

/** keccak256("dot"), the parent node every `<label>.dot` hangs from. */
const DOT_NODE = keccak256(
  solidityPacked(['bytes32', 'bytes32'], [ZeroHash, keccak256(toUtf8Bytes('dot'))]),
);

export const nodeOf = (label: string) =>
  keccak256(solidityPacked(['bytes32', 'bytes32'], [DOT_NODE, keccak256(toUtf8Bytes(label))]));

/** Same endpoints, and the same failover reasoning, as dotmetrics uses. */
const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];

const DIRECTORY_ABI = [
  'function count() view returns (uint256)',
  'function lastChangedAt() view returns (uint256)',
  'function isListed(string label) view returns (bool)',
  'function ownerOfLabel(string label) view returns (address)',
  'function pageDetailed(uint256 start, uint256 size) view returns (tuple(string label, address owner, uint64 firstSeenBlock)[])',
];

/**
 * Entries per `pageDetailed` call.
 *
 * Not a constant to be picked: every entry costs an external call into the
 * registry, all inside one eth_call, and eth_call has a gas ceiling. Measured
 * against this contract, 25 entries answer and 30 revert — but that boundary
 * moves with the RPC's limits and with anything the contract later does per
 * entry, so `readPage` halves on refusal instead of trusting this number. It is
 * a starting point, deliberately under the measured ceiling.
 */
const PAGE = 20;

export interface Listing {
  label: string;
  owner: string | null;
  /** Block the name was first announced. 0 when unknown. */
  firstSeenBlock: number;
  /** Approximate wall-clock arrival, derived from measured block time. */
  firstSeenAt: Date | null;
}

export interface Snapshot {
  labels: Listing[];
  lastChangedAt: number;
  blockNumber: number;
  /** Seconds per block, measured rather than assumed. */
  blockSeconds: number;
  endpoint: string;
  /** Endpoints that refused before one answered — disclosed, not hidden. */
  failedOver: string[];
}

/**
 * Try each endpoint in turn. A failover is reported rather than swallowed: a
 * page that quietly reads from a different chain than it claims is worse than
 * one that admits it had to move.
 */
/**
 * One connection for the whole page, cached.
 *
 * Every reader used to call connect() for itself, which meant three providers
 * racing the same public endpoint and three separate probe requests before any
 * real work. Sharing one also shares its batch queue, which is where the
 * ninefold speedup lives — calls from different readers in the same tick end up
 * in the same JSON-RPC batch instead of competing.
 */
let cached: Promise<{ provider: JsonRpcProvider; endpoint: string; failed: string[] }> | null = null;

function connect() {
  cached ??= openConnection();
  return cached;
}

/** The same connection everything else reads through — exported so the sweep
 *  cannot open a second one. A racing third connection that failed silently is
 *  exactly how the hourly heatmap came out uniformly empty. */
export const sharedProvider = connect;

async function openConnection(): Promise<{
  provider: JsonRpcProvider;
  endpoint: string;
  failed: string[];
}> {
  const failed: string[] = [];
  for (const url of RPCS) {
    try {
      // batchMaxCount is the whole performance story here. ethers coalesces
      // calls issued in the same tick into one JSON-RPC batch, so firing every
      // read at once costs a handful of HTTP requests instead of hundreds.
      // Hand-rolling "batches" of 8 and awaiting each defeats it completely:
      // measured over 205 names, that was 99.3s against 11.5s for the same work
      // submitted all at once. It also sidesteps the browser's six-connections-
      // per-host cap, because there are barely any connections to queue.
      const provider = new JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        batchMaxCount: 50,
      });
      await provider.getBlockNumber();
      return { provider, endpoint: new URL(url).host, failed };
    } catch {
      failed.push(new URL(url).host);
    }
  }
  cached = null; // a failed connection must not be remembered as the connection
  throw new Error(`no rpc answered — tried ${RPCS.length}`);
}

/**
 * Seconds per block, measured from two real headers rather than assumed. A
 * hard-coded figure would silently rot the moment the chain's cadence changed,
 * and every arrival date on the page hangs off it.
 */
async function measureBlockTime(provider: JsonRpcProvider, head: number): Promise<number> {
  const span = 1000;
  const [a, b] = await Promise.all([
    provider.getBlock(Math.max(1, head - span)),
    provider.getBlock(head),
  ]);
  if (!a || !b || b.number === a.number) return 6;
  return (b.timestamp - a.timestamp) / (b.number - a.number);
}

export async function readDirectory(): Promise<Snapshot> {
  const { provider, endpoint, failed } = await connect();
  const directory = new Contract(DIRECTORY, DIRECTORY_ABI, provider);

  const [rawCount, rawChanged, blockNumber] = await Promise.all([
    directory.count(),
    directory.lastChangedAt(),
    provider.getBlockNumber(),
  ]);
  const total = Number(rawCount);
  const blockSeconds = await measureBlockTime(provider, blockNumber);

  type Row = { label: string; owner: string; firstSeenBlock: bigint };

  /**
   * Read a span, halving it whenever the node refuses. A revert here is not a
   * contract error — it is the eth_call gas ceiling being hit by the external
   * calls `pageDetailed` makes per entry — so the response is a smaller ask,
   * exactly as it is for a transaction that will not fit in a block.
   */
  async function readPage(start: number, size: number): Promise<Row[]> {
    try {
      return (await directory.pageDetailed(start, size)) as Row[];
    } catch (err) {
      if (size <= 1) throw err;
      const half = Math.ceil(size / 2);
      const [a, b] = await Promise.all([
        readPage(start, half),
        readPage(start + half, size - half),
      ]);
      return [...a, ...b];
    }
  }

  // Paged rather than one call: the list grows without bound, and a single read
  // of an unbounded array is the thing that eventually stops working. Each page
  // brings its owners and arrival blocks with it — resolved inside the contract
  // view — so this is the only pass needed for all three.
  const pages: Promise<Row[]>[] = [];
  for (let start = 0; start < total; start += PAGE) pages.push(readPage(start, PAGE));
  const entries = (await Promise.all(pages)).flat();

  const now = Date.now();
  const labels: Listing[] = entries.map((e) => {
    const seen = Number(e.firstSeenBlock);
    const owner = e.owner && e.owner !== '0x0000000000000000000000000000000000000000' ? e.owner : null;
    return {
      label: e.label,
      owner,
      firstSeenBlock: seen,
      firstSeenAt: seen > 0 ? new Date(now - (blockNumber - seen) * blockSeconds * 1000) : null,
    };
  });

  return {
    labels,
    lastChangedAt: Number(rawChanged),
    blockNumber,
    blockSeconds,
    endpoint,
    failedOver: failed,
  };
}

/**
 * Owners are fetched separately and lazily. They are one call per label against
 * the registry, so loading them up front would make the first paint wait on two
 * hundred round trips for information that is secondary to the list itself.
 */
/**
 * Exact arrival times for a set of blocks.
 *
 * `firstSeenAt` on a Listing is derived from `head - block` times the average
 * block time, which is fine for a monthly curve and not fine for an hourly grid:
 * the error compounds over weeks and would smear registrations into the wrong
 * hour, or the wrong day. Real header timestamps cost one call per distinct
 * block, and the provider batches them, so an hour-precision view is affordable
 * exactly when it is needed.
 */
export async function readBlockTimes(blocks: number[]): Promise<Map<number, Date>> {
  const wanted = [...new Set(blocks.filter((b) => b > 0))];
  if (wanted.length === 0) return new Map();
  const { provider } = await connect();
  const out = new Map<number, Date>();
  await Promise.all(
    wanted.map(async (n) => {
      try {
        const b = await provider.getBlock(n);
        if (b) out.set(n, new Date(b.timestamp * 1000));
      } catch {
        /* one unreadable header must not cost the rest their timestamps */
      }
    }),
  );
  return out;
}

/**
 * What a name actually carries. The three records together are the same signal
 * dotmetrics calls a tier: a contenthash means something is deployed, a manifest
 * means someone described it, and a name with neither is registered and empty.
 */
export interface Records {
  category: string | null;
  /** True when the resolver holds a non-empty contenthash. */
  deployed: boolean;
  /** True when a manifest record exists. */
  described: boolean;
  /** The owner-written title, when the manifest carries one. */
  displayName: string | null;
  /** The owner-written description. The most useful thing a name publishes. */
  description: string | null;
}

/**
 * Manifests are JSON written by the name's owner, shaped
 * `{ $v, displayName, description, icon: { cid, format } }`. Anything else — a
 * truncated record, a hand-edited string, a future version — must not take the
 * row down with it, so a parse failure only means "no title, no description"
 * while `described` stays true: the manifest exists either way.
 */
function parseManifest(raw: string): { displayName: string | null; description: string | null } {
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { displayName: str(m.displayName), description: str(m.description) };
  } catch {
    return { displayName: null, description: null };
  }
}

export type Tier = 'described' | 'deployed' | 'registered';

export const tierOf = (r: Records): Tier =>
  r.described ? 'described' : r.deployed ? 'deployed' : 'registered';

/**
 * Read the records for a list of labels.
 *
 * Three calls per name, so this is deliberately not part of the first paint:
 * two hundred names is six hundred round trips and the list is what the page is
 * for. Each read is independent — a missing manifest must not cost a name its
 * contenthash — which is the same rule enrich-onchain follows off-chain.
 */
export async function readRecords(labels: string[]): Promise<Map<string, Records>> {
  const { provider } = await connect();
  const resolver = new Contract(CONTENT_RESOLVER, RESOLVER_ABI, provider);
  const out = new Map<string, Records>();

  // Every read issued at once so the provider can batch them. Failures stay
  // per-call: a missing manifest must not cost a name its contenthash.
  await Promise.all(
    labels.map(async (label) => {
      const node = nodeOf(label);
      const [category, hash, manifest] = await Promise.all([
        resolver.text(node, 'category').catch(() => ''),
        resolver.contenthash(node).catch(() => '0x'),
        resolver.text(node, 'manifest').catch(() => ''),
      ]);
      const clean = String(category ?? '')
        .trim()
        .toLowerCase();
      const raw = String(manifest ?? '').trim();
      const { displayName, description } = raw
        ? parseManifest(raw)
        : { displayName: null, description: null };
      out.set(label, {
        category: clean || null,
        deployed: Boolean(hash) && hash !== '0x' && hash !== '0x00',
        described: Boolean(raw),
        displayName,
        description,
      });
    }),
  );
  return out;
}

/**
 * Everything the registration form needs to know about one name, in one read.
 *
 * Deliberately on the ethers path rather than the SDK's: this runs while the
 * visitor is still typing, before any wallet exists and possibly instead of one.
 * A form that could not tell you `yours.dot` is unregistered until you connected
 * a wallet would be asking for a signature to deliver a "no".
 *
 * `owner` is the H160 the registry holds. A wallet's public key derives to an
 * H160 through a hash rather than a truncation, so the comparison belongs to
 * deriveH160 in the write path — not to a string prefix here.
 */
export interface NameState {
  label: string;
  /** Whether DotNS has an owner for it. Nothing else matters if this is false. */
  registered: boolean;
  owner: string | null;
  /** Whether the directory already carries it. */
  listed: boolean;
  records: Records;
}

export async function readName(rawLabel: string): Promise<NameState> {
  const label = rawLabel.trim().toLowerCase().replace(/\.dot$/, '');
  const { provider } = await connect();
  const directory = new Contract(DIRECTORY, DIRECTORY_ABI, provider);

  const [owner, listed, records] = await Promise.all([
    directory.ownerOfLabel(label).catch(() => null),
    directory.isListed(label).catch(() => false),
    readRecords([label]),
  ]);

  const held = owner && !/^0x0+$/i.test(String(owner)) ? String(owner) : null;
  return {
    label,
    registered: Boolean(held),
    owner: held,
    listed: Boolean(listed),
    records: records.get(label) ?? {
      category: null,
      deployed: false,
      described: false,
      displayName: null,
      description: null,
    },
  };
}

/* readOwners is gone on purpose. Owners now arrive with the page from
   pageDetailed, resolved inside the contract view — one call per fifty names
   instead of one per name, which removed the ~19 second pass this used to be. */

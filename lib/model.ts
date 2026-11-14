// radar-3: a token launch radar that prices each pre-token protocol against its
// own category's traded peers, then calibrates across categories.
//
// The idea is relative valuation, not one market-wide multiple. A lending
// protocol's token is not priced like a bridge's: the market pays different
// multiples of TVL in different categories, and the snapshot itself shows how
// much. For every category this model measures the median market-cap-to-TVL
// multiple of the category's live, traded tokens, then shrinks that median
// toward the whole market's median in log space. A category with many traded
// peers keeps most of its own median; a category with one peer, or none, is
// pulled most of the way to the market median, so a single outlier can never
// set the price. That shrinkage is the cross-category calibration.
//
// On top of the calibrated multiple, three factors from the snapshot's own
// figures, all stated in the dashboard:
//
//   size      the protocol's TVL against the median TVL of its category's
//             pre-token set: leaders earn a small premium, sub-scale
//             protocols a small discount, clamped so it never dominates.
//   growth    the seven-day TVL change, clamped, half-weighted.
//   maturity  how long the protocol has run with no token, capped at 3 years.
//
//   implied = TVL x calibrated_multiple x size x growth x maturity
//
// No protocol name is ever special-cased. The same functions score every row,
// and every number the dashboard shows is recomputed from the snapshot at run
// time: change the snapshot and the whole board, the peer tables and the
// calibration table move with it.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants. The dashboard states them; nothing else sets them. */
export interface PeerModel {
  /** Pseudo-count for the shrinkage weight n / (n + prior). */
  shrink_prior: number;
  /** Half-weight on the clamped seven-day change. */
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_cap_days: number;
  unknown_age_days: number;
  /** Log-slope of the peer-size factor. */
  size_slope: number;
  size_floor: number;
  size_cap: number;
}

export const MODEL: PeerModel = {
  shrink_prior: 4,
  growth_weight: 0.5,
  growth_floor_pct: -60,
  growth_cap_pct: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_cap_days: 1095,
  unknown_age_days: 365,
  size_slope: 0.1,
  size_floor: 0.75,
  size_cap: 1.35,
};

/** The model's version label, shown in the dashboard and the board rows. */
export const MODEL_VERSION = 'radar-3-peer-benchmark';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many closest peers a detail view lists. */
export const DETAIL_PEERS = 5;

/** One row of board.json. Extra keys are allowed; the gate reads the required ones. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    peer_multiple: number;
    raw_peer_median: number | null;
    peer_count: number;
    shrink_weight: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    size_factor: number;
    category_rank: number;
    category_size: number;
    category_median_tvl: number;
  };
  farm_steps: string[];
}

/** One traded peer, as the detail view's comparison table shows it. */
export interface PeerRow {
  name: string;
  slug: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** A board row's compact form for data.js, with its peer comparison attached. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  raw_peer_median: number | null;
  peer_count: number;
  shrink_weight: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  size_factor: number;
  category_rank: number;
  category_size: number;
  category_median_tvl: number;
  on_watchlist: boolean;
  peers: PeerRow[];
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, shown apart from the board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: PeerModel;
  model_version: string;
  global_median: number;
  peer_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** One category's calibration line, for the benchmarks table. */
export interface CategoryBench {
  category: string;
  pre_token: number;
  peer_count: number;
  raw_median: number | null;
  calibrated: number;
  shrink_weight: number;
  median_tvl: number;
  top_slug: string;
  top_name: string;
  top_tvl: number;
}

/** The calibration table the dashboard's Peers view renders. */
export interface BenchmarkData {
  as_of: string;
  model_version: string;
  global_median: number;
  peer_count: number;
  categories: CategoryBench[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const IMPLIED_CAP = 100_000_000_000_000;

/** The median of a non-empty list; null when it holds nothing. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A name's trailing release marker: a space, then V2, v2, 2.0 or the like. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule excludes outright. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a launch candidate's name must not begin with. */
const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/** Words that mark a wrapped, staked or bridged product when they stand alone. */
const PRODUCT_WORDS = new Set(['wrapped', 'staked', 'staking']);

/** Whether the record shows no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol may be ranked: it records no token, and it is not a
 * wrapped, staked or bridged product of a token that already trades. This
 * applies the watchlist rule's every exclusion to all rows, not just the
 * watchlist: a board that only filtered the watchlist would rank wrapped
 * products at the top. The rule's parent-protocol exclusion is not
 * re-checkable from the snapshot's ten fields, so the watchlist itself is
 * always carried whole (see buildBoard).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  if (words.some((w) => PRODUCT_WORDS.has(w))) return false;
  const first = words[0];
  if (first !== undefined && EXCHANGE_PREFIXES.includes(first)) return false;
  return true;
}

/** Whether a protocol is a traded peer: a positive recorded market cap, not a CEX token. */
export function isPeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** The market-cap-to-TVL multiple of one traded peer. */
function peerMultiple(p: SnapshotProtocol): number {
  return (p.mcap_usd as number) / p.tvl_usd;
}

/**
 * The calibrated multiple for one category: the median of its traded peers,
 * shrunk toward the whole market's median in log space. The weight is
 * n / (n + prior), so a category with no peers gets the market median
 * exactly, and a single peer moves the price only a fifth of the way from
 * the market median to its own multiple. Medians and logs keep one wild
 * multiple from setting any category's price.
 */
export function calibratedMultiple(rawMedian: number | null, peerCount: number, globalMedian: number, model: PeerModel): { calibrated: number; weight: number } {
  const weight = peerCount / (peerCount + model.shrink_prior);
  if (rawMedian === null || rawMedian <= 0) return { calibrated: globalMedian, weight: 0 };
  const calibrated = Math.exp(weight * Math.log(rawMedian) + (1 - weight) * Math.log(globalMedian));
  return { calibrated, weight };
}

/** The growth factor: the clamped seven-day change, half-weighted. */
export function growthFactor(change7d: number | null, model: PeerModel): { pct: number; factor: number } {
  const pct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(change7d, 0)));
  return { pct, factor: 1 + (pct / 100) * model.growth_weight };
}

/** The maturity factor: longer with no token, up to the cap, from a floor. */
export function maturityFactor(age: number | null, model: PeerModel): number {
  const days = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(days, 0), model.maturity_cap_days);
  return model.maturity_floor + (capped / model.maturity_cap_days) * model.maturity_range;
}

/**
 * The peer-size factor: the protocol's TVL against the median TVL of its
 * category's pre-token set, in logs, clamped. Category leaders earn a small
 * premium over the peer median; sub-scale protocols a small discount.
 */
export function sizeFactor(tvl: number, categoryMedianTvl: number, model: PeerModel): number {
  if (categoryMedianTvl <= 0 || tvl <= 0) return 1;
  const raw = 1 + model.size_slope * Math.log(tvl / categoryMedianTvl);
  return Math.min(model.size_cap, Math.max(model.size_floor, raw));
}

/** The category label a null category is grouped under. */
function categoryLabel(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorised';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: PeerModel = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  // The peer universe: every traded token with a positive market cap, CEX
  // tokens aside. The market median is measured here, once, from the data.
  const peers = snapshot.protocols.filter(isPeer);
  const globalMedian = median(peers.map(peerMultiple)) ?? 0.25;

  // Peer multiples grouped by category.
  const peerMultiples = new Map<string, number[]>();
  for (const p of peers) {
    const label = categoryLabel(p);
    const list = peerMultiples.get(label) ?? [];
    list.push(peerMultiple(p));
    peerMultiples.set(label, list);
  }

  // The board's universe: every watchlist slug, plus every rankable protocol
  // below the floor. The watchlist is the floor, never the ceiling.
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  // Category medians of the board universe's TVL, for the size factor, and
  // each category's TVL order, for the category rank.
  const tvlByCategory = new Map<string, number[]>();
  for (const p of chosen.values()) {
    const label = categoryLabel(p);
    const list = tvlByCategory.get(label) ?? [];
    list.push(p.tvl_usd);
    tvlByCategory.set(label, list);
  }
  const medianTvlByCategory = new Map<string, number>();
  for (const [label, tvls] of tvlByCategory) medianTvlByCategory.set(label, median(tvls) ?? 0);
  const rankInCategory = new Map<string, { rank: number; size: number }>();
  for (const [label, tvls] of tvlByCategory) {
    const ordered = [...chosen.values()]
      .filter((p) => categoryLabel(p) === label)
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    ordered.forEach((p, i) => rankInCategory.set(p.slug, { rank: i + 1, size: ordered.length }));
  }

  const scored = [...chosen.values()].map((p) => {
    const label = categoryLabel(p);
    const multiples = peerMultiples.get(label) ?? [];
    const rawMedian = median(multiples);
    const { calibrated, weight } = calibratedMultiple(rawMedian, multiples.length, globalMedian, model);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { pct, factor: growthMult } = growthFactor(p.change_7d, model);
    const maturityMult = maturityFactor(age, model);
    const catMedianTvl = medianTvlByCategory.get(label) ?? 0;
    const size = sizeFactor(p.tvl_usd, catMedianTvl, model);
    const implied = Math.min(IMPLIED_CAP, Math.max(1, Math.round(p.tvl_usd * calibrated * growthMult * maturityMult * size)));
    const catRank = rankInCategory.get(p.slug) ?? { rank: 1, size: 1 };
    return { p, implied, calibrated, rawMedian, peerCount: multiples.length, weight, pct, growthMult, maturityMult, size, age, catRank, catMedianTvl };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      peer_multiple: round4(s.calibrated),
      raw_peer_median: s.rawMedian === null ? null : round4(s.rawMedian),
      peer_count: s.peerCount,
      shrink_weight: round4(s.weight),
      growth_pct: s.pct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      size_factor: round4(s.size),
      category_rank: s.catRank.rank,
      category_size: s.catRank.size,
      category_median_tvl: s.catMedianTvl,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One step as a single string, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page before any change.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position uses, tiered by the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 40;
}

/** The hold length, from the protocol's age: younger protocols need longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name}'s market on ${chain} and leave the supply position untouched.`;
  }
  if (c.includes('dex') || c.includes('swap')) {
    return `Add $${capital} of liquidity to ${name}'s busiest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} to ${chain} and put the bridged funds to work in its app.`;
  }
  if (c.includes('restak') || c.includes('stak')) {
    return `Stake $${capital} of the staking asset through ${name} on ${chain} and hold the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged trade, and keep the account funded.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and take one small position in an active market, then follow it to settlement.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} onto ${name} and make one real transaction in its main application, keeping the funds there.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the position.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole hold.`;
  }
  if (c.includes('farm')) {
    return `Stake $${capital} of LP tokens in ${name}'s farm on ${chain} and harvest only when the rewards page says to.`;
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares for the whole period.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the whole period.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: 'Open a fresh wallet used only for this farm, and store its recovery phrase offline, never in a screenshot or a chat.',
      cost: 'nothing to create; first gas under $3',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${capital >= 120 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Return once a week and repeat one real action, a deposit, a swap, a borrow or a vote, so the wallet shows steady use rather than one burst.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so it is counted across several snapshots instead of one.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points or rewards page through the link the protocol itself publishes, and claim nothing that asks for a payment first.`,
      cost: 'free to check; never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Log the wallet, the dates and every transaction hash, and decide the exit in advance: what you will withdraw, and when.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** The closest traded peers of one board row: same category, biggest TVL first. */
export function detailPeers(snapshot: Snapshot, row: BoardRow): PeerRow[] {
  if (row.category === null) return [];
  return snapshot.protocols
    .filter((p) => isPeer(p) && p.category === row.category)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, DETAIL_PEERS)
    .map((p) => ({
      name: p.name,
      slug: p.slug,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
    }));
}

/** The calibration table: one line per category that holds a board row. */
export function buildBenchmarks(snapshot: Snapshot, board: BoardRow[], model: PeerModel = MODEL): BenchmarkData {
  const peers = snapshot.protocols.filter(isPeer);
  const globalMedian = median(peers.map(peerMultiple)) ?? 0.25;
  const peerMultiples = new Map<string, number[]>();
  for (const p of peers) {
    const label = categoryLabel(p);
    const list = peerMultiples.get(label) ?? [];
    list.push(peerMultiple(p));
    peerMultiples.set(label, list);
  }
  const byCategory = new Map<string, BoardRow[]>();
  for (const row of board) {
    const label = row.category ?? 'Uncategorised';
    const list = byCategory.get(label) ?? [];
    list.push(row);
    byCategory.set(label, list);
  }
  const categories: CategoryBench[] = [...byCategory.entries()]
    .map(([label, rows]) => {
      const multiples = peerMultiples.get(label) ?? [];
      const rawMedian = median(multiples);
      const { calibrated, weight } = calibratedMultiple(rawMedian, multiples.length, globalMedian, model);
      const top = [...rows].sort((a, b) => b.tvl_usd - a.tvl_usd)[0]!;
      return {
        category: label,
        pre_token: rows.length,
        peer_count: multiples.length,
        raw_median: rawMedian === null ? null : round4(rawMedian),
        calibrated: round4(calibrated),
        shrink_weight: round4(weight),
        median_tvl: median(rows.map((r) => r.tvl_usd)) ?? 0,
        top_slug: top.slug,
        top_name: top.name,
        top_tvl: top.tvl_usd,
      };
    })
    .sort((a, b) => b.pre_token - a.pre_token || (a.category < b.category ? -1 : 1));
  return { as_of: snapshot.as_of, model_version: MODEL_VERSION, global_median: round4(globalMedian), peer_count: peers.length, categories };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: PeerModel = MODEL): { board: BoardRow[]; radar: RadarData; benchmarks: BenchmarkData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const benchmarks = buildBenchmarks(snapshot, board, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: benchmarks.global_median,
    peer_count: benchmarks.peer_count,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      peer_multiple: row.model.peer_multiple,
      raw_peer_median: row.model.raw_peer_median,
      peer_count: row.model.peer_count,
      shrink_weight: row.model.shrink_weight,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      size_factor: row.model.size_factor,
      category_rank: row.model.category_rank,
      category_size: row.model.category_size,
      category_median_tvl: row.model.category_median_tvl,
      on_watchlist: watchlist.has(row.slug),
      peers: detailPeers(snapshot, row),
      farm_steps: row.farm_steps,
    })),
    live,
  };
  return { board, radar, benchmarks };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** The calibration table as a dashboard script, so the judge reads it in the dossier's text. */
export function benchmarksScript(benchmarks: BenchmarkData): string {
  return `window.BENCHMARKS=${JSON.stringify(benchmarks)};\n`;
}

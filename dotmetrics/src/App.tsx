import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { APPS, buildApps, type Discovered } from './lib/registry';
import { gatewayUrl, loadDirectory, type DirectorySource } from './lib/directory';
import { startLiveTail } from './lib/livetail';
import { readContract, ping } from './lib/chain';
import { CONTENT_RESOLVER, REGISTRY } from './lib/dotns';
import {
  ChainVitals,
  PulseStrip,
  RegistrationHeatmap,
  StepSparkline,
  SurvivalChart,
  type Death,
  type EcoSnapshot,
  type HeadBeat,
  type RegPoint,
  type SurvivalPoint,
} from './Charts';
import { openAppChat } from './lib/host-chat';
import { copyText, openExternal } from './lib/host-nav';
import ecosystemSnapshot from './lib/ecosystem.json';
import livenessData from './lib/liveness.json';
import changelogData from './lib/changelog.json';
import shotsData from './lib/shots.json';
import discoveredData from './lib/discovered.json';
import type { AppEntry, AppStats } from './lib/types';
import {
  ENDONYM,
  LANGS,
  getLang,
  languageName,
  locale,
  setLang,
  t,
  tSplit,
  useLang,
  type Lang,
} from './lib/i18n';
import { detectLang } from './lib/detect-lang';
import { ENDPOINT, SERVICE_LABEL, TranslateError, translate } from './lib/translate';

/**
 * dotmetrics — the index of the .dot ecosystem.
 *
 * This page used to be an analytics console. It was the wrong product: 42 apps
 * and three days of history do not fill a console, and the charts that filled it
 * were drawing shapes that the data did not contain. What does not exist
 * anywhere else is a SEARCHABLE, ATTRIBUTED list of .dot apps — the official
 * directory holds 19 labelhashes nobody can turn back into names, and we hold 42
 * names with an owner, a tier and a manifest each. So: search first, ranked
 * index second, analytics demoted to supporting evidence at the bottom.
 *
 * Every number on this page is a chain fact with a stated denominator and
 * window. There is no quality score anywhere — a "tier" says what exists on
 * chain (a manifest, a contenthash, nothing), never how good an app is, and
 * every row can be expanded to read its tier back in words.
 *
 * And every tier is a fact ANY name can produce. That was not true until this
 * pass: the top tier, "live data", was awarded to the four apps whose contract
 * ABI dotmetrics had hand-coded, and all four belong to the person running the
 * index — so the highest rank in a public directory was reachable only by its
 * owner. Disclosing it in the Method block did not fix it. The tier is gone;
 * what dotmetrics reads through its own ABIs is still shown, labelled as ours
 * and ranking nothing; and the per-app number every app can obtain is the event
 * count for an address the NAME declares in a `contract` record.
 */

const eco = ecosystemSnapshot as EcoSnapshot;

/**
 * Layout for the sections this redesign introduced.
 *
 * It lives here rather than in styles.css because that file belongs to another
 * pass and this one owns only App.tsx and Charts.tsx. It adds no colours, no
 * radii and no type steps of its own — every value below is a token from
 * styles.css. Lift it into styles.css verbatim when the two passes merge; it is
 * a single contiguous block for exactly that reason.
 */
const LAYOUT_CSS = `
/* ---- language control: one disclosure, one panel of four ----
   This was two segments, EN | IT, and four do not fit. Measured at 375px: the
   disclosure below is 43px wide, a four-segment strip is 132px, and the bar has
   38px of slack. The 51px difference does not produce a horizontal scrollbar —
   it is taken out of the block pulse, the only other shrinkable thing in the
   row, whose readout drops from 157px to 106px and starts ellipsising the head
   number it exists to show. Trading a chain fact for a language label is the
   wrong trade, so the control collapses to the code of the current language and
   opens a panel listing all four.

   Still not a <select>. A native dropdown does not open inside the Polkadot
   shell's webview — a bug this codebase has already paid for once. This is
   ordinary DOM, positioned absolutely, driven from the keyboard.

   The panel is anchored right: it grows leftward into the page, so at any
   viewport it stays inside the bar's own padding and can never widen the
   document. Being absolutely positioned it contributes nothing to layout. */
.langsw { position: relative; flex: none; }
.langsw-btn {
  display: inline-flex; align-items: center; gap: var(--sp-1);
  height: var(--sp-7); padding: 0 var(--sp-2);
  border: 1px solid var(--line); border-radius: var(--r-1); background: var(--bg-1);
  color: var(--tx-mid); font: inherit; font-size: var(--fs-0); font-weight: 600;
  letter-spacing: 0.04em; line-height: 1; cursor: pointer;
  transition: color 100ms ease, border-color 100ms ease;
}
.langsw-btn:hover { color: var(--tx-hi); }
.langsw-btn[aria-expanded='true'] { border-color: var(--pink); color: var(--pink); }
.langsw-btn:focus-visible { outline: 2px solid var(--pink); outline-offset: 1px; }
/* Drawn from two borders rather than set as "▾": a shell whose font lacks the
   glyph would render a tofu box in the top bar, and this has to survive fonts
   we do not control. */
.langsw-c {
  width: 5px; height: 5px; flex: none; margin-top: -3px;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg); transition: transform 120ms ease;
}
.langsw-btn[aria-expanded='true'] .langsw-c { margin-top: 1px; transform: rotate(225deg); }

.langsw-panel {
  position: absolute; top: calc(100% + var(--sp-2)); right: 0; z-index: 30;
  min-width: 156px; padding: var(--sp-1);
  display: flex; flex-direction: column;
  border: 1px solid var(--line-strong); border-radius: var(--r-2);
  background: var(--bg-1); box-shadow: var(--shadow);
}
.langsw-panel button {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4);
  /* 40px, not the 28px of a facet chip: this one is aimed at with a thumb. */
  height: var(--sp-10); padding: 0 var(--sp-3);
  border: 0; border-radius: var(--r-1); background: transparent;
  color: var(--tx-mid); font: inherit; font-size: var(--fs-2); line-height: 1;
  text-align: left; white-space: nowrap; cursor: pointer;
}
.langsw-panel button:hover { background: var(--bg-2); color: var(--tx-hi); }
.langsw-panel button[aria-checked='true'] { color: var(--pink); }
.langsw-panel button:focus-visible { outline: 2px solid var(--pink); outline-offset: -2px; }
.langsw-code { font-family: var(--mono); font-size: var(--fs-0); letter-spacing: 0.06em; color: var(--tx-low); }
.langsw-panel button[aria-checked='true'] .langsw-code { color: var(--pink); }

/* ---- third-party description: marker, translate control, MT disclosure ----
   These style OUR annotations around an author's words. They are deliberately
   quiet: the accent belongs to the measured data, not to a language tag. */
.lang-tag {
  flex: none; align-self: center; padding: 0 4px; height: 15px;
  display: inline-flex; align-items: center;
  border: 1px solid var(--line); border-radius: 3px; background: var(--bg-3);
  color: var(--tx-low); font-family: var(--mono); font-size: 10px; font-weight: 600;
  letter-spacing: 0.06em; line-height: 1;
}
.lang-do {
  flex: none; align-self: center; padding: 0 var(--sp-1); height: 16px;
  border: 0; background: transparent; color: var(--tx-low);
  font: inherit; font-size: var(--fs-0); line-height: 1; cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px; white-space: nowrap;
}
.lang-do:hover:not(:disabled) { color: var(--tx-hi); }
.lang-do:disabled { cursor: default; opacity: 0.7; }
.lang-do:focus-visible { outline: 2px solid var(--pink); outline-offset: 1px; border-radius: 3px; }
/* The machine-translation disclosure. It sits UNDER the text it applies to and
   is never abbreviated to an icon: a reader has to be able to tell, without
   hovering anything, that these are not the author's words. */
.idx-mt { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 var(--sp-2);
  font-size: var(--fs-0); line-height: 16px; color: var(--tx-low); }
.idx-mt b { font-weight: 600; color: var(--tx-mid); text-transform: uppercase; letter-spacing: 0.04em; }
.idx-mt.is-err, .idx-mt.is-err b { color: var(--warn); }

/* ---- search: the first interactive element on the page ---- */
.find { position: relative; display: flex; align-items: center; margin-top: var(--sp-4); }
.find-in {
  width: 100%; height: var(--sp-12); padding: 0 var(--sp-12) 0 var(--sp-4);
  border: 1px solid var(--line-strong); border-radius: var(--r-1);
  background: var(--bg-1); color: var(--tx-hi);
  /* 16px literal: anything smaller makes iOS Safari zoom the whole page on
     focus, and this app is opened inside a phone shell more often than not. */
  font-size: 16px; outline: none;
}
.find-in::placeholder { color: var(--tx-low); }
.find-in:focus { border-color: var(--pink); outline: 2px solid var(--pink); outline-offset: 1px; }
.find-clear {
  position: absolute; right: var(--sp-2); width: var(--sp-8); height: var(--sp-8);
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--r-1); background: var(--bg-3);
  color: var(--tx-mid); font-size: var(--fs-3); line-height: 1; cursor: pointer;
}
.find-clear:hover { background: var(--bg-4); color: var(--tx-hi); }

/* ---- status line: one hero number, one step spark, one 12px line ---- */
/* The headline pair. Two panels of equal standing: the count is narrow and
   fixed, the heatmap takes the rest, because its width carries 24 hours of
   meaning while the number's does not. Below 900px they stack, count first. */
.hero { display: grid; grid-template-columns: minmax(260px, 22rem) 1fr; gap: var(--sp-4); align-items: stretch; margin: var(--sp-5) 0 var(--sp-4); }
.hero-count { display: flex; flex-direction: column; justify-content: center; gap: var(--sp-3); padding: var(--sp-5); }
.hero-top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); }
.hero-n { font-size: 56px; font-weight: 600; line-height: 0.9; letter-spacing: -0.03em; color: var(--tx-hi); }
.hero-t { margin: 0; font-size: var(--fs-2); line-height: 1.5; color: var(--tx-mid); }
.hero-t b { font-weight: 500; color: var(--tx-hi); }
.hero-t .is-stale { color: var(--warn); }
.hero-heat { display: flex; flex-direction: column; }
.hero-heat .heatwrap { flex: 1; display: flex; align-items: center; }

@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr; }
  .hero-n { font-size: 44px; }
  .hero-count { padding: var(--sp-4); }
}
.spark-step { flex: none; display: block; }
.spark-step-line { fill: none; stroke: var(--pink); stroke-width: 1.5; stroke-linecap: butt; stroke-linejoin: miter; }

/* ---- facets: one row, scrolled sideways, never wrapped ---- */
.facets { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.facets::-webkit-scrollbar { display: none; }
.facet { flex: none; }

/* ---- the index ---- */
.idx { margin-bottom: var(--sp-6); }
/* 72px exactly: 8+8 padding around three fixed line boxes (20 + 14 + 18) and
   two 2px gaps. The line-heights are pinned rather than inherited so a long
   display name cannot silently grow every row in the index. */
.idx-row { align-items: flex-start; min-height: 68px; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); }
.idx-ico {
  width: var(--sp-6); height: var(--sp-6); flex: none; margin-top: 2px; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--r-1); background: var(--bg-3); color: var(--tx-mid);
  font-size: var(--fs-1); font-weight: 600; text-transform: uppercase;
}
.idx-ico img { width: 100%; height: 100%; object-fit: cover; display: block; }
.idx-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
/* Title and tier sit together at the left. The old rule pushed the badge to the
   far edge with justify-content:space-between, opening a wide empty gap on every
   row that read as scatter; the badge belongs next to the thing it labels. */
.idx-l1 { display: flex; align-items: baseline; gap: var(--sp-2); height: var(--sp-6); min-width: 0; }
.idx-title { flex: 0 1 auto; font-size: var(--fs-3); font-weight: 600; line-height: var(--sp-6); color: var(--tx-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A quiet tag, not a shout: small, neutral, hugging the name. Repeated on every
   row, so it must not compete with the name for attention. */
.idx-l1 .badge { flex: none; height: 15px; padding: 0 5px; font-size: 9px; border-radius: 4px; align-self: center; }
.idx-l2 { display: flex; align-items: baseline; gap: var(--sp-2); height: 16px; font-family: var(--mono); font-size: var(--fs-0); line-height: 16px; color: var(--tx-low); min-width: 0; }
.idx-l2 i { font-style: normal; white-space: nowrap; }
/* The liveness warning. --warn and nothing else: no icon, no badge, no accent —
   a quiet factual line in the metadata row, present only when the last probe
   failed. Alive bundles render nothing at all here. */
.idx-live-warn { color: var(--warn); }
/* min-height, not height: a fixed height plus wrapping text cut descriptions
   mid-line with no ellipsis. The clamp is what limits the lines.
   The line is a flex row because the description can now carry a language
   marker and a translate control beside it — those stay put at full size while
   only the author's text clamps. */
.idx-l3 { min-height: 20px; display: flex; align-items: baseline; gap: var(--sp-2); font-size: var(--fs-2); line-height: 20px; color: var(--tx-mid); }
.idx-l3-t { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
.idx-val { flex: none; align-self: center; text-align: right; }
.idx-val b { display: block; font-size: var(--fs-4); font-weight: 600; color: var(--tx-hi); }
.idx-val i { display: block; font-style: normal; font-size: var(--fs-0); color: var(--tx-low); }
/* The measured-events cell carries its own window — "events · last 151 blocks
   (~5 min)" — which is longer than a bare metric label ever was. It gets a cap
   and permission to wrap onto a second line rather than pushing the title out
   of the row; the number above it stays on one line at full size. */
.idx-val-ev { max-width: 11rem; }
.idx-val-ev i { white-space: normal; line-height: 14px; }

/* ---- "read by dotmetrics": our instrumentation, marked as ours ----
   Deliberately the quietest block in an expanded row, and below every chain
   fact in it. It carries no accent and no badge vocabulary: a reader must not
   be able to mistake a number WE went to the trouble of reading for a
   distinction the app earned. */
.ours { margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--line); }
.ours-h { margin: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 var(--sp-2);
  font-size: var(--fs-2); line-height: 1.45; }
.ours-h b { font-weight: 600; font-size: var(--fs-0); letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--tx-low); }
.ours-figs { color: var(--tx-mid); }
.ours-note { margin: 2px 0 0; font-size: var(--fs-0); line-height: 1.45; color: var(--tx-low); }
.idx-detail {
  padding: 0 var(--sp-4) var(--sp-4) calc(var(--sp-4) + var(--sp-6) + var(--sp-3));
  background: var(--bg-2); border-bottom: 1px solid var(--line);
}
.idx-why { margin: 0 0 var(--sp-3); font-size: var(--fs-2); line-height: 1.45; color: var(--tx-hi); }
.idx-why b { font-weight: 600; }
.idx-empty { padding: var(--sp-6) var(--sp-4); text-align: center; font-size: var(--fs-2); color: var(--tx-low); }
.idx-count { padding: var(--sp-2) 0 var(--sp-3); font-size: var(--fs-1); color: var(--tx-low); }

/* ---- A. pulse strip ---- */
.pulsestrip { display: flex; align-items: center; gap: var(--sp-3); }
.pulsestrip-ticks { display: flex; align-items: center; gap: 2px; height: 12px; }
.pulsestrip-tick { width: 3px; height: 12px; flex: none; background: var(--bg-4); }
.pulsestrip-tick.is-on { background: var(--pink-fill); }
.pulsestrip.is-stalled .pulsestrip-tick { background: var(--bg-3); }
.pulsestrip.is-stalled .pulsestrip-tick.is-on { background: var(--warn); }
.pulsestrip-read { font-size: var(--fs-1); color: var(--tx-mid); white-space: nowrap; }
.pulsestrip-read.is-warn { color: var(--warn); }

/* ---- B. registration heatmap ---- */
.heatwrap { position: relative; padding: var(--sp-1) var(--sp-3) var(--sp-3); }
.heat-scroll { overflow-x: auto; scrollbar-width: thin; }
.heat-svg { display: block; }
.heat-track { fill: var(--bg-3); }
.heat-fill { fill: var(--pink-fill); }
.heat-focus { fill: none; stroke: var(--pink); stroke-width: 1.5; }
.heat-total { fill: var(--tx-mid); font-weight: 500; }
.heat-veil { fill: var(--bg-1); opacity: 0.86; }
.heat-empty { fill: var(--tx-mid); }

/* ---- D. chain vitals ---- */
.vitals-strip { position: relative; min-height: var(--sp-16); display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4) var(--sp-3); }
.vitals-bar { display: flex; height: 6px; border-radius: var(--r-1); background: var(--bg-4); overflow: hidden; }
.vitals-seg { display: block; height: 100%; }
.vitals-seg.is-revert { background: var(--warn); }
.vitals-seg.is-event { background: var(--pink-fill); }
.vitals-reads { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-6); }
.vitals-read { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vitals-read b { font-size: var(--fs-2); font-weight: 600; line-height: 16px; color: var(--tx-hi); }
.vitals-read b.is-warn { color: var(--warn); }
.vitals-read i { font-style: normal; font-size: var(--fs-0); line-height: 13px; color: var(--tx-low); }

/* ---- tooltips: below the anchor, and pinned inside the card at the edges.
   .panel clips its overflow, so the sheet's default "float above" transform
   puts a top-row tooltip outside the card entirely. ---- */
.chart-tip.tip-below { transform: translate(-50%, var(--sp-2)); white-space: normal; max-width: 17rem; }
.chart-tip.tip-below.tip-l { transform: translate(0, var(--sp-2)); }
.chart-tip.tip-below.tip-r { transform: translate(-100%, var(--sp-2)); }
/* Bottom row of a grid: below would be outside the card, so it sits above the
   cell instead — the offset clears the cell rather than covering it. */
.chart-tip.tip-above { transform: translate(-50%, calc(-100% - var(--sp-6))); white-space: normal; max-width: 17rem; }
.chart-tip.tip-above.tip-l { transform: translate(0, calc(-100% - var(--sp-6))); }
.chart-tip.tip-above.tip-r { transform: translate(-100%, calc(-100% - var(--sp-6))); }

/* ---- method + footer ---- */
.method p + p { padding-top: 0; }
.method ul { margin: 0; padding: 0 var(--sp-3) var(--sp-3) calc(var(--sp-3) + var(--sp-4)); }
.method li { margin: 0 0 2px; }
.method .mono { overflow-wrap: anywhere; }
.foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--sp-2) var(--sp-4); margin-top: var(--sp-6); }
.foot-prov { font-family: var(--mono); font-size: var(--fs-0); color: var(--tx-low); overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .pulsestrip-ticks { display: none; }
  /* The bar gained a language control, and on a 375px phone the four fixed
     items no longer fit: the row pushed ~67px past the viewport and took the
     whole page's horizontal scroll with it. The block readout is the one item
     here that degrades gracefully, so it is the one that gives way — it keeps
     its head number and drops the "· 6.0s avg" tail rather than shoving the
     language buttons off-screen. Everything else stays at full size. */
  .bar { gap: var(--sp-2); }
  .pulsestrip { min-width: 0; flex: 0 1 auto; }
  /* Keep enough width for the head number itself: "#11.481.862" is the claim
     that this page is live, and a readout clipped to "#11.4…" makes it. */
  .pulsestrip-read { overflow: hidden; text-overflow: ellipsis; min-width: 6rem; }
  /* Two lines on a phone: one line of 14px text truncates most of these
     descriptions to uselessness, and the extra row height is what stops the
     list reading as a wall. */
  .idx-l3-t { -webkit-line-clamp: 2; }
  /* The measured figure keeps every word of its window on a phone — the
     denominator is the point of it, and "3 events" without one is not a
     measurement. What gives way is the COLUMN: at 375px a name, a tier badge
     and a wrapped window phrase in one row left "TrueReviews" rendering as
     "Tru…", so the figure drops onto its own full-width line underneath and
     reads as the single sentence it is. */
  .idx-row { flex-wrap: wrap; }
  .idx-val-ev {
    flex-basis: 100%; max-width: none; margin-top: 2px;
    display: flex; justify-content: flex-end; align-items: baseline; gap: var(--sp-1);
  }
  .idx-val-ev b { font-size: var(--fs-2); }
}

/* Below ~420px even the shrunk readout does not fit. The bar then sheds the one
   item that is neither live data nor a control: the static "devnet" badge,
   whose fact the footer states in words anyway. The block height and the
   language buttons both stay. */
@media (max-width: 420px) {
  .bar > .badge { display: none; }
}
`;

const REFRESH_MS = 20_000;
/* ---------------------------------------------- data written by the indexer

   Four static files the hourly indexer commits beside the directory. They ship
   INSIDE this bundle — no per-item Bulletin upload, so the single site publish
   carries them — and every one degrades to an honest empty state.

   discovered.json is re-read here only for the velocity fields buildApps()
   deliberately drops: they are indexer bookkeeping, not chain facts about a
   name, so they never reach AppEntry. The row looks them up by label instead. */

const liveness = livenessData as unknown as {
  series: SurvivalPoint[];
  deaths: Death[];
  medianLifespanDays: number | null;
};

interface ChangelogEntry {
  at: number;
  kind: 'new' | 'updated' | 'unreachable' | 'revived';
  label: string;
  displayName?: string;
}
const changelog = changelogData as unknown as ChangelogEntry[];

interface Shot {
  file: string;
  w: number;
  h: number;
  capturedAt: number;
}
const SHOTS = shotsData as unknown as Record<string, Shot>;

interface Velocity {
  /** Unix seconds the contenthash last changed. Absent = never changed. */
  contenthashChangedAt?: number;
  /** Times it changed since first seen. 0 for an app unchanged since birth. */
  updateCount?: number;
}

/**
 * Velocity per label, from the baked directory. An entry that has never
 * republished has no contenthashChangedAt and shows NOTHING on its row — an app
 * unchanged since birth is not one "updated 0h ago".
 */
const VELOCITY: Record<string, Velocity> = (() => {
  const out: Record<string, Velocity> = {};
  for (const [key, value] of Object.entries(discoveredData as Record<string, unknown>)) {
    if (value && typeof value === 'object' && 'label' in (value as object)) {
      const d = value as Velocity;
      out[key] = { contenthashChangedAt: d.contenthashChangedAt, updateCount: d.updateCount };
    }
  }
  return out;
})();

/** The committed screenshot thumbnail for a label, or null (→ the monogram). */
function shotFor(label: string): Shot | null {
  return SHOTS[label] ?? null;
}

/* ------------------------------------------------------- the app route */

/**
 * `#/app/<label>` — the URL of one row.
 *
 * A HASH and not a path: this bundle is served from a content-addressed
 * gateway, where there is no server to rewrite `/app/foo` back onto index.html.
 * The fragment is the one part of a URL a static host cannot get wrong.
 */
const ROUTE_PREFIX = '#/app/';

/** The DOM id of a row, so a route can find the element to scroll to. */
const rowDomId = (label: string): string => `r-${label}`;

function labelFromHash(hash: string): string | null {
  if (!hash.startsWith(ROUTE_PREFIX)) return null;
  const raw = hash.slice(ROUTE_PREFIX.length);
  let label: string;
  try {
    label = decodeURIComponent(raw);
  } catch {
    // A hand-mangled escape sequence is still a link someone followed: keep the
    // raw text so the "no such name" notice can quote what they actually asked
    // for, rather than silently showing them the plain index.
    label = raw;
  }
  return label.trim().toLowerCase() || null;
}

const routeHref = (label: string): string => ROUTE_PREFIX + encodeURIComponent(label);

/** This page's URL with no route on it — where closing a row returns to. */
const bareHref = (): string => window.location.pathname + window.location.search;

/** The absolute link "copy link" puts on the clipboard. */
const shareUrl = (label: string): string =>
  window.location.origin + bareHref() + routeHref(label);

/**
 * Bring a routed row into view and put the keyboard on it. `false` when the row
 * is not on the page — a link that arrived before the directory did, or one
 * that names nothing.
 *
 * It scrolls only when the row is not already fully visible: a cold link has to
 * move the page, but tapping a row already on screen must not yank it out from
 * under the reader's thumb. The sticky bar's height is read from --bar-h rather
 * than written here as a number, so the two cannot drift apart.
 */
function revealRow(label: string): boolean {
  const el = document.getElementById(rowDomId(label));
  if (!el) return false;
  const barH =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bar-h'), 10) ||
    // A shell that will not compute styles still gets a usable margin.
    56;
  const box = el.getBoundingClientRect();
  if (box.top < barH || box.bottom > window.innerHeight) {
    el.scrollIntoView({ block: 'center' });
  }
  el.focus({ preventScroll: true });
  return true;
}

/** `0x4c8a…983d`. The full address is in the row's detail and in the group's aria-label. */
const shortAddr = (addr: string): string =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

/* ------------------------------------------------------------- formatting */

/**
 * Thousands separators follow the reader — 1,234 in English, 1.234 in Italian.
 *
 * The digits themselves do not move: `font-variant-numeric: tabular-nums` is
 * set globally in styles.css, so a figure ticking from 999 to 1,000 still does
 * not shift the column it sits in.
 */
function fmt(n: number, lang: Lang = getLang()): string {
  return n.toLocaleString(locale(lang));
}

function ago(unixSeconds: number | null): string {
  if (!unixSeconds) return t('ago.none');
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 5) return t('ago.now');
  if (s < 60) return t('ago.s', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('ago.m', { n: m });
  const h = Math.floor(m / 60);
  if (h < 48) return h === 1 ? t('ago.h1') : t('ago.h', { n: h });
  return t('ago.d', { n: Math.floor(h / 24) });
}

/**
 * An absolute UTC timestamp, deliberately NOT localised.
 *
 * This is the one date on the page that stays ISO-8601 in both languages: it is
 * the exact block time, quoted so a reader can check it against a block
 * explorer, and reformatting it per locale would make it harder to match.
 */
function exactUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/* --------------------------------------------------------------- the tiers */

const TIER_KEY = ['tier.0', 'tier.1', 'tier.2'] as const;
const TIER_CLASS = ['is-published', 'is-deployed', 'is-name'] as const;

/**
 * Why this name sits where it sits, in words.
 *
 * A ranking nobody can inspect is a ranking nobody should trust, so every
 * expanded row states the chain fact that produced its tier. None of these
 * sentences is a judgement: they describe records that either exist or do not —
 * and, since this pass, records that any name can publish. The tier that used
 * to sit above these three said "dotmetrics holds a reader for this app", which
 * is a fact about dotmetrics; it is gone.
 */
function tierReason(e: AppEntry): string {
  switch (e.tier) {
    case 0:
      return e.contenthash ? t('tier.reason.0.hash') : t('tier.reason.0.nohash');
    case 1:
      return t('tier.reason.1');
    default:
      return t('tier.reason.2');
  }
}

/**
 * The unreachable line for a row, or null — which is what almost every row gets.
 *
 * Alive is the NORMAL state of a deployed bundle, so an alive app shows nothing
 * at all: reachability is not a badge to earn. The line appears only when the
 * indexer's last probe could not get the bundle served, and it makes the honest
 * one of two different claims: "unreachable · N days" when we know when it was
 * last up, "never seen by our gateway" when we do not — the second must never
 * be dressed up as the first. `alive === undefined` is an unknown (nothing to
 * probe, or a directory copy that predates the probe) and renders nothing,
 * because an unknown and a measured failure are different claims.
 */
function unreachableLine(entry: AppEntry): string | null {
  if (!entry.contenthash || entry.alive !== false) return null;
  if (!entry.lastSeenAliveAt) return t('live.never');
  const days = Math.floor((Date.now() / 1000 - entry.lastSeenAliveAt) / 86400);
  if (days < 1) return t('live.unreachable.today');
  if (days === 1) return t('live.unreachable.one');
  return t('live.unreachable', { days });
}

/**
 * The event count for the address a name declares, over the measured window.
 *
 * `null` means "this name declares no contract" and must render as NOTHING. A
 * zero here is a real measurement — the address exists and emitted nothing —
 * and the two must never look alike: an app that has told us nothing would
 * otherwise be shown as an app we measured and found idle.
 */
function declaredEvents(entry: AppEntry): { events: number; blocks: number; minutes: number } | null {
  const per = eco.perContract;
  if (!entry.contract || !per || per.windowBlocks <= 0) return null;
  return {
    // Absent from a COMPLETE map of the window means zero events, not unknown.
    events: per.events[entry.contract] ?? 0,
    blocks: per.windowBlocks,
    minutes: Math.max(1, Math.round(per.windowSeconds / 60)),
  };
}

/* ------------------------------------------------------------------- data */

interface Ecosystem {
  apps: AppEntry[];
  stats: Record<string, AppStats>;
  online: boolean | null;
  source: DirectorySource;
  directoryCid: string | null;
  excluded: string[];
  beat: HeadBeat | null;
  tailUp: boolean | null;
  /**
   * The directory has finished loading — from Bulletin or from the baked copy,
   * both of which are settled answers.
   *
   * `source` cannot stand in for this: it starts at 'baked' and can also END at
   * 'baked', so it never distinguishes "still fetching" from "fetched nothing".
   * Only one thing needs the difference: a `#/app/<label>` link naming a name
   * the index does not hold must not be called broken while the copy that might
   * contain it is still in flight.
   */
  ready: boolean;
}

function useEcosystem(): Ecosystem {
  // Start from the baked directory so the index renders instantly, then swap in
  // the copy fetched from Bulletin once it arrives.
  const [apps, setApps] = useState<AppEntry[]>(APPS);
  const [source, setSource] = useState<DirectorySource>('baked');
  const [directoryCid, setDirectoryCid] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, AppStats>>({});
  const [online, setOnline] = useState<boolean | null>(null);
  /** The newest head the live tail has seen. Drives the pulse strip, nothing else. */
  const [beat, setBeat] = useState<HeadBeat | null>(null);
  /** `false` once the tail's socket has failed — "no feed" is not "still waiting". */
  const [tailUp, setTailUp] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void loadDirectory().then((result) => {
      if (cancelled) return;
      setReady(true);
      setApps(result.apps);
      setSource(result.source);
      setDirectoryCid(result.cid);
      setExcluded(result.excluded);

      const found: Record<string, Discovered> = {};
      const known = new Set(result.apps.map((a) => a.id));
      const checkpoint = result.apps.reduce((m, a) => Math.max(m, a.firstSeenBlock ?? 0), 0);
      void startLiveTail(
        known,
        checkpoint,
        (app) => {
          if (cancelled) return;
          found[app.label] = app;
          const fresh = buildApps(found).filter((e) => !known.has(e.id));
          setApps((prev) => {
            const have = new Set(prev.map((a) => a.id));
            return [...fresh.filter((e) => !have.has(e.id)), ...prev];
          });
        },
        (up) => {
          if (!cancelled) setTailUp(up);
        },
        (block) => {
          if (!cancelled) setBeat({ number: block, at: Date.now() });
        },
      ).then((t) => {
        stop = t.stop;
        if (cancelled) t.stop();
      });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const load = useCallback(() => {
    void ping().then(setOnline);
    for (const entry of apps) {
      if (!entry.read) continue; // indexed but no reader: listed, not measured
      void entry
        .read(readContract)
        .then((s) => setStats((prev) => ({ ...prev, [entry.id]: s })))
        .catch(() => {
          /* a failed read leaves the previous value standing, never a zero */
        });
    }
  }, [apps]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return { apps, stats, online, source, directoryCid, excluded, beat, tailUp, ready };
}

/* ------------------------------------------------------------ leaving here */

/**
 * Leave for one of the indexed apps.
 *
 * Inside the shell the `.dot` name is the better destination: the host resolves
 * it as a deep link to the sibling app, which is what a directory of .dot apps
 * should hand you. Outside there is no resolver, so only the public gateway URL
 * works — and that is what stays in the anchor's `href` so right-click and
 * standalone use still land somewhere real.
 */
async function openEntry(entry: AppEntry): Promise<void> {
  let url = entry.url;
  try {
    const host = await import('@parity/product-sdk-host');
    if (host.isInsideContainerSync()) url = `https://${entry.domain}`;
  } catch {
    // No SDK at all means no shell, so the gateway URL stands.
  }
  await openExternal(url);
}

/* --------------------------------------------------- the language control */

/**
 * EN / IT / ES / FR — a disclosure button and a panel, in the top bar.
 *
 * This was a segmented chip with one label per language. Two fitted; four do
 * not, on the 375px phone this app is mostly opened on — see .langsw in
 * LAYOUT_CSS for the measured cost, which is paid by the block pulse rather
 * than by a scrollbar. So the control collapses to the current language's code
 * and the four choices move into a panel.
 *
 * Not a `<select>`, for the same reason as before: a native dropdown does not
 * open inside the Polkadot shell's webview, which this codebase has already
 * been bitten by once. This is buttons in a div.
 *
 * Keyboard, in full, because a control that only works under a mouse is not
 * finished: Enter/Space or Down opens it; opening puts focus on the language
 * already in use, so the first arrow press moves relative to where the reader
 * IS; Up/Down step and wrap; Home/End jump; Escape closes and gives focus back
 * to the button; Tab leaves and closes behind itself.
 *
 * Each language is named IN ITSELF — Español, not "Spanish" — because a reader
 * who has landed in a language they cannot read is looking for their own word.
 * The accessible name is the translated sentence, which screen readers speak in
 * the interface language the reader has.
 */
function LanguageSwitch() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // A tap anywhere else means "not this" — including on the page behind the
  // panel, which is why this listens on the document and not on a backdrop
  // element. Pointer events cover mouse, touch and pen in one listener.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Opening moves the keyboard onto the current language rather than the first
  // one, so "open, press Down" means "the next language" and not "the second".
  useEffect(() => {
    if (open) items.current[LANGS.indexOf(lang)]?.focus();
  }, [open, lang]);

  function close(refocus: boolean): void {
    setOpen(false);
    // Only when the keyboard asked. Refocusing after a tap would summon the
    // focus ring on a control the reader is already done with.
    if (refocus) trigger.current?.focus();
  }

  function onItemKey(e: React.KeyboardEvent, i: number): void {
    const last = LANGS.length - 1;
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowUp') to = i === 0 ? last : i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else if (e.key === 'Escape') {
      close(true);
      return;
    } else if (e.key === 'Tab') {
      // Let the browser take focus onwards; the panel just must not be left
      // open behind it, hanging over content the reader has moved on to.
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
    items.current[to]?.focus();
  }

  return (
    <div className="langsw" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="langsw-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('lang.trigger.aria', { language: languageName(lang) })}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      >
        {lang.toUpperCase()}
        <span className="langsw-c" aria-hidden="true" />
      </button>

      {open && (
        <div className="langsw-panel" role="menu" aria-label={t('lang.aria')}>
          {LANGS.map((code, i) => (
            <button
              key={code}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={lang === code}
              aria-label={t('lang.switch.aria', { language: languageName(code) })}
              onKeyDown={(e) => onItemKey(e, i)}
              onClick={() => {
                setLang(code);
                close(true);
              }}
            >
              <span>{ENDONYM[code]}</span>
              <span className="langsw-code" aria-hidden="true">
                {code.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------- third-party app descriptions */

/**
 * An app author's own description, in the author's own language.
 *
 * This is the one block of text on the page that dotmetrics did not write. It
 * comes out of a third party's on-chain manifest, and the rules it follows are
 * different from the rest of the UI:
 *
 *   · THE ORIGINAL IS THE DEFAULT. Always, on every load. The "showing a
 *     translation" state lives in this component and nowhere else — nothing
 *     persists it, so a reload always returns the author's words.
 *   · NOTHING IS TRANSLATED UNPROMPTED. The network is touched only after an
 *     explicit tap, and only for the one description tapped.
 *   · A TRANSLATION IS LABELLED AS ONE. Not with an icon, not with a
 *     hover-only title — with the words "machine translation", the language
 *     pair, and who produced it, on a line under the text.
 *   · A FAILURE IS VISIBLE. Falling back to the original silently would leave a
 *     reader who tapped "translate" with no way to know anything went wrong.
 *
 * When {@link detectLang} is not confident, or the text is already in the
 * reader's language, this renders exactly what it always rendered: the text,
 * with no marker and no controls.
 */
function Description({ text, muted }: { text: string; muted?: boolean }) {
  const lang = useLang();
  const detected = useMemo(() => detectLang(text), [text]);

  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslateError | Error | null>(null);

  // A new language, or a new description, invalidates a translation on screen:
  // an Italian rendering must not survive a switch back to English.
  useEffect(() => {
    setShown(null);
    setError(null);
  }, [text, lang]);

  const foreign = detected != null && detected.lang !== lang;
  // The affordance exists only when an endpoint was actually probed and wired.
  // With `ENDPOINT` null the marker still shows and this never appears.
  const offerTranslate = foreign && ENDPOINT != null;

  const run = async (e: ReactMouseEvent) => {
    // The whole row is a button that expands the entry; translating is not that.
    e.stopPropagation();
    if (!detected || busy) return;
    setBusy(true);
    setError(null);
    try {
      setShown(await translate(text, detected.lang, lang));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };

  const reason =
    error instanceof TranslateError ? t(error.key, error.vars) : (error?.message ?? '');

  return (
    <>
      <span className="idx-l3" style={muted ? { color: 'var(--tx-low)' } : undefined}>
        {foreign && detected && (
          <b
            className="lang-tag"
            aria-label={t('desc.marker.aria', { language: languageName(detected.lang) })}
          >
            {detected.lang.toUpperCase()}
          </b>
        )}
        <span className="idx-l3-t" lang={shown ? lang : (detected?.lang ?? undefined)}>
          {shown ?? text}
        </span>
        {offerTranslate && !shown && (
          <button
            type="button"
            className="lang-do"
            disabled={busy}
            aria-label={t('desc.translate.aria', { language: languageName(lang) })}
            onClick={run}
          >
            {busy ? t('desc.translating') : error ? t('desc.retry') : t('desc.translate')}
          </button>
        )}
      </span>

      {shown && detected && (
        <span className="idx-mt">
          <b>{t('desc.mt')}</b>
          <span>
            {t('desc.mt.via', {
              from: languageName(detected.lang),
              to: languageName(lang),
              service: SERVICE_LABEL,
            })}
          </span>
          <button
            type="button"
            className="lang-do"
            onClick={(e) => {
              e.stopPropagation();
              setShown(null);
            }}
          >
            {t('desc.original')}
          </button>
        </span>
      )}

      {error && !shown && (
        <span className="idx-mt is-err" role="status">
          <span>{t('desc.error', { reason })}</span>
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------- index row */

function AppIcon({ entry }: { entry: AppEntry }) {
  // Two independent failures, because the fallback chain is screenshot → icon →
  // monogram: a broken thumbnail must fall through to the icon, and a broken
  // icon on to the letter, so a hole is never the outcome of either.
  const [shotFailed, setShotFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const mono = (entry.displayName ?? entry.id).trim().slice(0, 1) || '?';
  const shot = shotFor(entry.id);

  // A committed thumbnail is the richest preview, so it wins when one shipped
  // and loads. It lives in the bundle (public/shots/) — no per-item Bulletin
  // upload — and is lazy-loaded because the row is below the fold and must not
  // cost the first paint. Absent or broken, it falls through exactly like an
  // icon does: to the icon, then to the monogram, never to a hole.
  if (shot && !shotFailed) {
    return (
      <span className="idx-ico" aria-hidden="true">
        <img
          src={`${import.meta.env.BASE_URL}${shot.file}`}
          alt=""
          width={shot.w}
          height={shot.h}
          loading="lazy"
          decoding="async"
          onError={() => setShotFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className="idx-ico" aria-hidden="true">
      {entry.iconCid && !iconFailed ? (
        <img
          /* gatewayUrl(), not a gateway written out here. This used to be a
             literal dweb.link URL, and `dotns bulletin verify` measured what
             that was worth: of the four public bridges only the Polkadot
             community one serves our CIDs at all, so nearly every one of the
             names that publishes an icon was falling back to its monogram. The
             fallback below still stands — a gateway can always be down, and a
             broken icon must leave a letter, never a hole. */
          src={gatewayUrl(entry.iconCid)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setIconFailed(true)}
        />
      ) : (
        mono
      )}
    </span>
  );
}

/* ------------------------------------------------------------ copy a link */

/**
 * "copy link" on an open row.
 *
 * Quiet on purpose — it sits beside "Open …↗" as text, not as a button with
 * chrome. A success reverts to the affordance after a moment; a FAILURE does
 * not revert and does not merely apologise: the clipboard is refused outright
 * in some shells, so the link itself is printed for the reader to select, which
 * is the thing the button was for.
 */
function CopyLink({ label, domain }: { label: string; domain: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [link, setLink] = useState('');

  const go = async () => {
    const url = shareUrl(label);
    setLink(url);
    // copyText tries navigator.clipboard and falls back to execCommand; `false`
    // means both were refused, which is a real outcome and gets said out loud.
    if (await copyText(url)) {
      setState('copied');
      window.setTimeout(() => setState('idle'), 3200);
    } else {
      setState('failed');
    }
  };

  return (
    <>
      <button
        type="button"
        className="quiet-do"
        aria-label={t('link.copy.aria', { domain })}
        onClick={go}
      >
        {state === 'copied'
          ? t('link.copied')
          : state === 'failed'
            ? t('link.retry')
            : t('link.copy')}
      </button>
      {state === 'failed' && (
        <span className="idx-mt is-err" role="status">
          <span>{t('link.failed')}</span>
          <span className="mono">{link}</span>
        </span>
      )}
    </>
  );
}

function IndexRow({
  entry,
  stats,
  open,
  onToggle,
}: {
  entry: AppEntry;
  stats: AppStats | null;
  open: boolean;
  onToggle: () => void;
}) {
  const title = entry.displayName ?? entry.name ?? entry.id;
  const tier = entry.tier;
  const detailId = `d-${entry.id}`;
  const measured = declaredEvents(entry);
  const unreachable = unreachableLine(entry);
  // Velocity. `updatedAt` is present only once a name has republished its
  // bundle; an app unchanged since birth has none and shows nothing here — not
  // "updated 0h ago", which would be a claim it never made. The change count
  // rides along only when it is more than one, so a single republish reads as a
  // date, not as "· 1 change".
  const velocity = VELOCITY[entry.id];
  const updatedAt = velocity?.contenthashChangedAt;
  const updateCount = velocity?.updateCount ?? 0;
  return (
    <>
      <div
        /* The row is addressable so `#/app/<label>` can find and scroll to it —
           the element, not a wrapper, because it is also what takes focus. */
        id={rowDomId(entry.id)}
        className={`idx-row${open ? ' is-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        onKeyDown={(e) => {
          // Rows used to be <tr onClick>: clickable with a mouse, invisible to
          // a keyboard. Enter and Space now do what the pointer does.
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <AppIcon entry={entry} />
        <span className="idx-main">
          <span className="idx-l1">
            <span className="idx-title">{title}</span>
            <span className={`badge ${TIER_CLASS[tier]}`}>{t(TIER_KEY[tier])}</span>
          </span>
          <span className="idx-l2">
            {entry.domain}
            <i>
              {entry.firstSeenAt
                ? t('row.registered', { ago: ago(entry.firstSeenAt) })
                : t('row.beforeRange')}
            </i>
            {/* Velocity: present only when the bundle has actually changed
                since we first saw it. Silent otherwise — see the note above. */}
            {updatedAt && (
              <i>
                {updateCount > 1
                  ? t('row.updated.n', { ago: ago(updatedAt), n: fmt(updateCount) })
                  : t('row.updated', { ago: ago(updatedAt) })}
              </i>
            )}
            {/* Quiet, and only ever present in the failing case: an alive
                bundle earns no "alive" marker, because reachable is the normal
                state of a deployed app, not a distinction. */}
            {unreachable && <i className="idx-live-warn">{unreachable}</i>}
          </span>
          {/* Three different kinds of text end up on this line, and only the
              first is the author's: a manifest description, our own tagline for
              an app we read directly, or our sentence about the absence of a
              record. Only the manifest description goes through the language
              marker — the other two are already in the reader's language. */}
          {entry.description ? (
            <Description text={entry.description} />
          ) : (
            <span className="idx-l3">
              <span className="idx-l3-t">
                {entry.read ? t(entry.tagline) : t('row.noManifest')}
              </span>
            </span>
          )}
        </span>
        {/* The one number a row can carry, and the one every app can obtain:
            events emitted by the address the NAME declares, over the window
            that produced it. It used to be whatever our hard-coded reader
            returned, which meant only our own four apps had a number at all.
            A name with no `contract` record shows nothing here — not a zero,
            which would read as "measured and idle" rather than "never said". */}
        {measured && (
          <span
            className="idx-val idx-val-ev"
            aria-label={t('row.events.aria', {
              events: fmt(measured.events),
              name: entry.domain,
              blocks: fmt(measured.blocks),
              minutes: measured.minutes,
            })}
          >
            <b>{fmt(measured.events)}</b>
            <i>
              {t(measured.events === 1 ? 'row.events.one' : 'row.events', {
                blocks: fmt(measured.blocks),
                minutes: measured.minutes,
              })}
            </i>
          </span>
        )}
      </div>

      {open && (
        <div className="idx-detail" id={detailId}>
          <p className="idx-why">{tierReason(entry)}</p>
          <div className="detail-grid">
            <div>
              <span className="detail-l">{t('detail.owner')}</span>
              <span className="detail-v mono">{entry.owner || t('detail.owner.none')}</span>
            </div>
            <div>
              <span className="detail-l">{t('detail.contenthash')}</span>
              <span className="detail-v mono">
                {entry.contenthash ?? t('detail.contenthash.none')}
              </span>
            </div>
            <div>
              <span className="detail-l">{t('detail.executable')}</span>
              <span className="detail-v">
                {entry.hasExecutable
                  ? t('detail.executable.yes', { id: entry.id })
                  : t('detail.executable.no', { id: entry.id })}
              </span>
            </div>
            <div>
              <span className="detail-l">{t('detail.registered')}</span>
              <span className="detail-v mono">
                {entry.firstSeenBlock ? `#${fmt(entry.firstSeenBlock)}` : t('ago.none')}
                {entry.firstSeenAt ? ` · ${exactUtc(entry.firstSeenAt)}` : ''}
              </span>
            </div>
            {/* Stated as an absence, like the contenthash and executable
                records beside it — "this name publishes no contract record" is
                a fact about the name, and the Method block says how to change
                it. */}
            <div>
              <span className="detail-l">{t('detail.contract')}</span>
              <span className={`detail-v${entry.contract ? ' mono' : ''}`}>
                {entry.contract || t('detail.contract.none')}
              </span>
            </div>
          </div>

          {/* The convention, offered where the absence it explains is stated,
              and nowhere else: never in the collapsed row, never as a badge.
              The condition is deliberate — a name with a bundle deployed and no
              contract record is one that HAS something to measure and has not
              said where; a name with nothing deployed would only be nagged. */}
          {!entry.contract && entry.contenthash && (
            <p className="idx-hint">
              {tSplit('hint.contract', {
                record: (
                  <code key="r" className="mono">
                    contract
                  </code>
                ),
                event: (
                  <code key="e" className="mono">
                    revive.ContractEmitted
                  </code>
                ),
                /* The reader's own name in the command, not a placeholder they
                   have to substitute — the point is that it can be run. */
                cmd: (
                  <code key="c" className="mono">
                    dotns text set {entry.domain} contract 0x… --env devnet
                  </code>
                ),
              })}
            </p>
          )}

          {/* OUR instrumentation, under our name, below every chain fact on
              this row. These figures are real, but reading them took an ABI
              only the index's operator can hand-code, so they are presented as
              a reading dotmetrics performs — never as something the app earned,
              and never anywhere it could be mistaken for the tier or the rank. */}
          {entry.read && (
            <div className="ours">
              <p className="ours-h">
                <b>{t('ours.title')}</b>
                {stats ? (
                  <span className="ours-figs">
                    {[stats.headline, ...stats.metrics]
                      .map((m) => `${fmt(m.value)} ${t(m.label)}`)
                      .join(' · ')}
                  </span>
                ) : (
                  <span className="ours-figs">{t('row.reading')}</span>
                )}
              </p>
              <p className="ours-note">{t('ours.note')}</p>
            </div>
          )}

          {/* The old page carried a global "Recent activity" feed. Only one app
              in the index actually produces one, so it belongs to that app's
              row rather than to the ecosystem. */}
          {stats && stats.activity.length > 0 && (
            <div className="feed">
              <ol>
                {stats.activity.map((item, i) => (
                  <li key={i}>
                    <span className="feed-app">{item.at ? ago(item.at) : t('feed.recent')}</span>
                    <span className="feed-text">{item.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="detail-tag">
            <a
              className="detail-open"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                void openEntry(entry);
              }}
            >
              {t('detail.open', { domain: entry.domain })}
            </a>
            {/* A search result that cannot be linked to is not much of an
                index. This is the row's own URL, and it is offered only on an
                open row because that is the state the link reproduces. */}
            <CopyLink label={entry.id} domain={entry.domain} />
          </p>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ chat */

/** One-tap link into the Polkadot app's built-in chat. Footer, not masthead. */
function ChatButton() {
  const lang = useLang();
  // The outcome is held as a key, not as a finished string: the button can sit
  // showing "Room added" for three seconds, and if the reader flips language in
  // that window the message has to flip with it.
  const [state, setState] = useState<
    'idle' | 'busy' | 'outside' | 'failed' | 'registered' | 'opened'
  >('idle');
  const go = async () => {
    setState('busy');
    const r = await openAppChat('dotmetrics', 'dotmetrics community');
    // "registered" is a real outcome, not a failure: the room exists in the
    // user's chat list even when the host refuses to jump there for us.
    if (r.status === 'outside') setState('outside');
    else if (r.status === 'failed') setState('failed');
    else if (r.status === 'registered') setState('registered');
    else setState('opened');
    window.setTimeout(() => setState('idle'), 3200);
  };
  return (
    <button type="button" className="chat-cta" onClick={go} lang={lang}>
      {t(`chat.${state}` as const)}
    </button>
  );
}

/* -------------------------------------------------------------- changelog */

/**
 * "What changed", diffed run to run by the indexer and committed as
 * changelog.json.
 *
 * The strip is always honest, never hidden: its summary states the last 24
 * hours as three counts, and zeroes are shown as zeroes — a quiet day is a fact
 * about a young ecosystem, not a reason to disappear. Expanded, it lists the
 * most recent entries, each naming its app and linking to that app's row, so a
 * change is one tap from the thing it happened to. The window on the summary is
 * fixed at 24h and the entry count carries its denominator ("N most recent of
 * M logged"), because a strip that said "3 changes" without either would be a
 * number with no evidence.
 *
 * A gateway mass-outage does not flood this: the indexer's mass-death guard
 * suppresses the wave of "unreachable" entries upstream, so nothing here has to
 * second-guess what it was handed.
 */
function ChangelogStrip() {
  useLang(); // re-render the localized verbs and times when the language flips
  const since = Math.floor(Date.now() / 1000) - 86_400;
  const last24 = changelog.filter((e) => e.at >= since);
  const nNew = last24.filter((e) => e.kind === 'new').length;
  const nUpd = last24.filter((e) => e.kind === 'updated').length;
  const nDark = last24.filter((e) => e.kind === 'unreachable').length;
  // Newest-first already, capped so the strip is a glance and not a log reader.
  const recent = changelog.slice(0, 30);
  const verb = (k: ChangelogEntry['kind']) => t(`changelog.kind.${k}` as const);

  return (
    <details className="chg">
      <summary aria-label={t('changelog.aria')}>
        <span className="chg-sum">
          {t('changelog.summary', {
            new: fmt(nNew, getLang()),
            updated: fmt(nUpd, getLang()),
            dark: fmt(nDark, getLang()),
          })}
        </span>
      </summary>
      {recent.length === 0 ? (
        <p className="chg-none">{t('changelog.recent.none')}</p>
      ) : (
        <>
          <ol className="chg-list">
            {recent.map((e, i) => {
              const name = e.displayName || e.label;
              return (
                <li key={`${e.label}-${e.at}-${i}`}>
                  {/* An anchor, not a button: it is a real `#/app/<label>` URL,
                      so it can be opened in a new tab, copied, or followed by
                      the router exactly like any other row link. */}
                  <a
                    className="chg-item"
                    href={routeHref(e.label)}
                    aria-label={t('changelog.item.aria', {
                      name,
                      verb: verb(e.kind),
                      ago: ago(e.at),
                    })}
                  >
                    <span className="chg-name">{name}</span>
                    <span className="chg-verb">{verb(e.kind)}</span>
                    <span className="chg-when">{ago(e.at)}</span>
                  </a>
                </li>
              );
            })}
          </ol>
          <p className="chg-count">
            {t('changelog.recent.count', {
              shown: fmt(recent.length, getLang()),
              all: fmt(changelog.length, getLang()),
            })}
          </p>
        </>
      )}
    </details>
  );
}

/* ------------------------------------------------------------------- page */

/**
 * The facets.
 *
 * `published` / `deployed` / `name` PARTITION the index — every name is in
 * exactly one, and the three counts sum to `all`, which is what makes them
 * checkable at a glance. `declared` and `new` cut across them.
 *
 * There used to be a `live` facet for the tier only our own apps could reach.
 * `declared` replaces it in the same position: also about a per-app number, but
 * about a record any name can publish rather than about which ABIs we happened
 * to hand-code.
 *
 * `unreachable` exists only while its count does: the chip appears when at
 * least one deployed bundle failed its last probe and vanishes when none do,
 * because a standing "Unreachable 0" would promote the exception to a category.
 *
 * `owner` is the odd one and is meant to look it: it hides nothing, it regroups.
 * It carries no count on its chip for that reason — every other chip's number
 * is "names that match", and "By owner 39" would read as the same claim about a
 * different quantity. The count line under the facets states both figures.
 */
type Facet =
  | 'all'
  | 'published'
  | 'deployed'
  | 'name'
  | 'declared'
  | 'new'
  | 'updated'
  | 'unreachable'
  | 'owner';

export function App() {
  const lang = useLang();
  const { apps, stats, online, source, directoryCid, excluded, beat, tailUp, ready } =
    useEcosystem();

  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<Facet>('all');
  // Seeded from the URL so a cold `#/app/<label>` is open on the very first
  // paint, against the baked snapshot, rather than after the fetch lands.
  const [openApp, setOpenApp] = useState<string | null>(() =>
    labelFromHash(window.location.hash),
  );

  /**
   * How many history entries this page has pushed and not yet walked back off.
   *
   * It exists to keep one promise: the shell's back gesture returns to the list
   * and never leaves the app. Closing a row by tapping it calls
   * `history.back()` — which is what makes the tap and the gesture the same
   * action — but only when we KNOW the entry underneath is one of ours. A
   * reader who arrived cold on `#/app/<label>` has nothing of ours beneath
   * them, and back() there would exit the app: a bug this codebase has already
   * paid for once. Any user-driven history move resets this to zero, because
   * after one we can no longer prove what is underneath.
   */
  const pushed = useRef(0);

  /** Drop the route without navigating — for the paths that are not a Back. */
  const clearRoute = useCallback(() => {
    if (labelFromHash(window.location.hash)) {
      window.history.replaceState(null, '', bareHref());
    }
    pushed.current = 0;
    setOpenApp(null);
  }, []);

  useEffect(() => {
    const sync = () => {
      pushed.current = 0;
      setOpenApp(labelFromHash(window.location.hash));
    };
    // Both, and not just one: pushState/replaceState fire neither, a Back
    // gesture over our own entries fires popstate, and a hash typed or pasted
    // into the address bar fires hashchange.
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  const toggleApp = useCallback(
    (label: string) => {
      if (openApp === label) {
        if (pushed.current > 0) {
          // Spent BEFORE the call, not after: back() is asynchronous, and until
          // popstate lands `openApp` still names this row. A second tap inside
          // that window would otherwise walk back twice — one entry further
          // than we own, which is the one outcome this counter exists to
          // prevent. Decremented here, a second tap falls to the branch below.
          pushed.current -= 1;
          // popstate does the closing, so the tap and the back gesture take
          // exactly one code path and cannot drift apart.
          window.history.back();
          return;
        }
        clearRoute();
        return;
      }
      if (openApp === null) {
        window.history.pushState(null, '', routeHref(label));
        pushed.current += 1;
      } else {
        // Row to row is one view change, not two: the reader closed one and
        // opened another in a single tap. Pushing here would make Back re-open
        // the row they just left instead of returning them to the list.
        window.history.replaceState(null, '', routeHref(label));
      }
      setOpenApp(label);
    },
    [openApp, clearRoute],
  );

  const startOfTodayUtc = useMemo(() => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  }, []);

  const counts = useMemo(() => {
    let published = 0;
    let deployed = 0;
    let nameOnly = 0;
    let declared = 0;
    let today = 0;
    let updated = 0;
    let unreachable = 0;
    // Lowercased: the registry returns checksummed addresses, but two copies of
    // the directory need not agree on the casing, and one owner must never be
    // able to become two groups because of it.
    const owners = new Set<string>();
    for (const a of apps) {
      owners.add(a.owner.toLowerCase());
      // One tier each, so these three add up to `all`. The old counts were
      // cumulative (`tier <= 1`), which meant "published" and "deployed"
      // overlapped and neither chip's number could be verified against the list
      // it opened.
      if (a.tier === 0) published += 1;
      else if (a.tier === 1) deployed += 1;
      else nameOnly += 1;
      if (a.contract) declared += 1;
      if ((a.firstSeenAt ?? 0) >= startOfTodayUtc) today += 1;
      // Only a bundle that has actually changed since first-seen counts as
      // "updated" — the presence of a change time, never a zero updateCount.
      if (VELOCITY[a.id]?.contenthashChangedAt) updated += 1;
      // A measured failure only: `alive === undefined` is a name never probed
      // (or a directory copy that predates the probe), not one found down.
      if (a.contenthash && a.alive === false) unreachable += 1;
    }
    return {
      all: apps.length,
      published,
      deployed,
      nameOnly,
      declared,
      today,
      updated,
      unreachable,
      owners: owners.size,
    };
  }, [apps, startOfTodayUtc]);

  /** Registrations, for the heatmap and the step spark. Undated names cannot be plotted. */
  const regPoints = useMemo<RegPoint[]>(
    () =>
      apps
        .filter((a) => (a.firstSeenAt ?? 0) > 0)
        .map((a) => ({ label: a.id, at: a.firstSeenAt as number })),
    [apps],
  );

  const searching = query.trim().length > 0;
  /** Grouping is a mode, and search is the one thing that overrides every mode. */
  const grouping = !searching && facet === 'owner';

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Search always runs over the WHOLE index. A filter chip narrows a list;
    // it must never be able to hide a name someone typed the name of.
    //
    // The owner address is part of the haystack: the directory holds 39 of
    // them, they are the answer to "who builds what", and pasting one in has to
    // find that person's apps whether or not the grouping mode is on.
    const pool = q
      ? apps.filter((a) =>
          `${a.id} ${a.displayName ?? ''} ${a.name} ${a.description ?? ''} ${a.owner}`
            .toLowerCase()
            .includes(q),
        )
      : apps.filter((a) => {
          switch (facet) {
            case 'published':
              return a.tier === 0;
            case 'deployed':
              return a.tier === 1;
            case 'name':
              return a.tier === 2;
            case 'declared':
              return Boolean(a.contract);
            case 'new':
              return (a.firstSeenAt ?? 0) >= startOfTodayUtc;
            case 'updated':
              // A name that has republished its bundle at least once — the
              // change time is the proof, an app unchanged since birth has none.
              return Boolean(VELOCITY[a.id]?.contenthashChangedAt);
            case 'unreachable':
              return Boolean(a.contenthash) && a.alive === false;
            // 'owner' regroups the index; it does not filter it. Every name is
            // still here, which is what makes the group counts add up to `all`.
            default:
              return true;
          }
        });
    // 'Recently updated' is the one facet that reorders rather than ranks: the
    // reader asked for what changed last, so the newest change leads. Every
    // other view keeps the index's own order — tier first, then newest — where
    // tier 0 leads not as a score but because a name that publishes a manifest
    // has said more about itself on chain than one that has not.
    if (!q && facet === 'updated') {
      return [...pool].sort(
        (a, b) =>
          (VELOCITY[b.id]?.contenthashChangedAt ?? 0) -
          (VELOCITY[a.id]?.contenthashChangedAt ?? 0),
      );
    }
    return [...pool].sort(
      (a, b) => a.tier - b.tier || (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0),
    );
  }, [apps, query, facet, startOfTodayUtc]);

  /**
   * The same names, gathered under the address that owns them.
   *
   * This invents nothing: `owner` is `registry.owner()` for the name, already
   * read, already printed on every expanded row. All the mode does is stop
   * making the reader open 70 rows to answer "who builds what". Groups are
   * ordered by how many names the address holds — a count, not a score — and
   * names inside a group keep the index's own order.
   */
  const groups = useMemo(() => {
    if (!grouping) return [];
    const byOwner = new Map<string, { owner: string; apps: AppEntry[] }>();
    for (const a of shown) {
      const key = a.owner.toLowerCase();
      const group = byOwner.get(key) ?? { owner: a.owner, apps: [] };
      group.apps.push(a);
      byOwner.set(key, group);
    }
    return [...byOwner.values()].sort(
      (a, b) =>
        // Names with no recorded owner go last however many there are: that
        // group is an absence in the snapshot, not a large holder of names.
        Number(a.owner === '') - Number(b.owner === '') ||
        b.apps.length - a.apps.length ||
        a.owner.localeCompare(b.owner),
    );
  }, [grouping, shown]);

  /**
   * A `#/app/<label>` that names nothing the index holds.
   *
   * Only ever claimed once the directory has settled — the baked snapshot is
   * older than the fetched one, so a link to a name registered this morning is
   * momentarily "unknown" on first paint and calling it broken there would be a
   * lie with a one-second shelf life.
   */
  const routedMissing =
    openApp !== null && ready && !apps.some((a) => a.id === openApp);

  /**
   * Scroll the routed row into view and put the keyboard on it — once per
   * label, whether the reader tapped the row or arrived on the URL cold.
   *
   * `shown` is in the dependencies because a cold link renders against the
   * baked snapshot first: the row it names may not exist until the fetched
   * directory replaces it a moment later, and this has to try again when it
   * does.
   */
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!openApp) {
      revealed.current = null;
      return;
    }
    if (revealed.current === openApp) return;
    if (revealRow(openApp)) revealed.current = openApp;
  }, [openApp, shown]);

  /**
   * Narrowing the list closes the open row.
   *
   * Without this a filter could hide the row the URL still names, leaving a
   * link that says one thing and a page that shows another. Note it does NOT
   * go back: the reader changed a filter, which is not a navigation, so the
   * route is rewritten in place rather than walked off.
   */
  const narrow = useCallback(() => {
    if (openApp !== null) clearRoute();
  }, [openApp, clearRoute]);

  const facets: { key: Facet; label: string; n?: number }[] = [
    { key: 'all', label: t('facet.all'), n: counts.all },
    { key: 'published', label: t('facet.published'), n: counts.published },
    { key: 'deployed', label: t('facet.deployed'), n: counts.deployed },
    { key: 'name', label: t('facet.name'), n: counts.nameOnly },
    // Zero today, and shown as zero. A chip whose count is honestly 0 opens an
    // empty list with a sentence saying so, which is the correct state for a
    // convention nobody has adopted yet — including us.
    { key: 'declared', label: t('facet.declared'), n: counts.declared },
    { key: 'new', label: t('facet.new'), n: counts.today },
    // Also an honest zero, like `declared`: a young ecosystem where nothing has
    // been republished yet opens an empty list that says exactly that, rather
    // than hiding a facet the moment the ecosystem is too new to fill it.
    { key: 'updated', label: t('facet.updated'), n: counts.updated },
  ];
  // Present only while true: zero unreachable bundles is the state this chip
  // must not exist in — unlike `declared`, whose honest zero documents an
  // unadopted convention, an "Unreachable 0" would be a standing insinuation.
  if (counts.unreachable > 0) {
    facets.push({ key: 'unreachable', label: t('facet.unreachable'), n: counts.unreachable });
  }
  // Last, and countless: the filters above all answer "how many names match",
  // and a number on this chip would be read as the same claim about a different
  // quantity. What it did is stated in the count line under the row instead.
  facets.push({ key: 'owner', label: t('facet.owner') });

  const scanned = counts.all + excluded.length;
  const indexAge = Math.floor(Date.now() / 1000) - eco.measuredAt;

  return (
    <div className="app">
      <style>{LAYOUT_CSS}</style>

      {/* 1 ------------------------------------------------------------ bar */}
      <header className="bar">
        {/* The app's name is a name, not a word: it is not translated. */}
        <h1>dotmetrics</h1>
        <span className="badge">{t('bar.devnet')}</span>
        <span className="bar-spacer" />
        <PulseStrip beat={beat} connected={tailUp} />
        <LanguageSwitch />
      </header>

      {/* 2 --------------------------------------------------------- search */}
      <div className="find">
        <input
          className="find-in"
          type="search"
          value={query}
          onChange={(e) => {
            narrow();
            setQuery(e.target.value);
          }}
          placeholder={t('search.placeholder', { n: fmt(counts.all, lang) })}
          aria-label={t('search.aria')}
        />
        {searching && (
          <button
            type="button"
            className="find-clear"
            onClick={() => setQuery('')}
            aria-label={t('search.clear')}
          >
            ×
          </button>
        )}
      </div>

      {/* 3 ------------------------------------------------- headline pair */}
      {/* The size of the ecosystem and the shape of how it got there are the
          two facts worth the top of the page, so they sit side by side at full
          weight rather than one above the fold and one buried under the list. */}
      <div className="hero">
        <div className="panel hero-count">
          <div className="hero-top">
            <span className="hero-n">{fmt(counts.all)}</span>
            <StepSparkline points={regPoints} />
          </div>
          {/* One sentence, one translatable string. The bold figures and the
              staleness colour are dropped into named slots, so Italian is free
              to put "distribuite" after its number instead of before it. */}
          <p className="hero-t">
            {tSplit('hero.line', {
              published: <b key="p">{fmt(counts.published, lang)}</b>,
              deployed: <b key="d">{fmt(counts.deployed, lang)}</b>,
              declared: <b key="c">{fmt(counts.declared, lang)}</b>,
              updated: (
                <span key="u" className={indexAge > 6 * 3600 ? 'is-stale' : undefined}>
                  {t('hero.updated', { ago: ago(eco.measuredAt) })}
                </span>
              ),
            })}
            {/* No manual refresh control: the contract reads re-run every 20s on
                their own and the pulse strip above already shows whether the
                chain is answering. A button here would only be a second way to
                do what the page is already doing. */}
            {online === false && <span className="is-stale"> · {t('hero.rpcDown')}</span>}
          </p>
        </div>

        <div className="panel hero-heat">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{t('reg.title')}</h2>
              <span className="panel-note">{t('reg.note')}</span>
            </div>
            <span className="chart-legend">
              <span className="chart-swatch" aria-hidden="true" />
              {t('reg.legend')}
            </span>
          </div>
          <RegistrationHeatmap points={regPoints} />
        </div>
      </div>

      {/* 4 ---------------------------------------------------------- facets */}
      <div className="facets" role="group" aria-label={t('facets.aria')}>
        {facets.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`facet${!searching && facet === f.key ? ' is-on' : ''}`}
            aria-pressed={!searching && facet === f.key}
            onClick={() => {
              narrow();
              setQuery('');
              setFacet(f.key);
            }}
          >
            {f.label}
            {f.n !== undefined && <span className="facet-n">{fmt(f.n, lang)}</span>}
          </button>
        ))}
      </div>

      {/* what changed — diffed run to run by the indexer, sitting just above the
          list it describes. Always present, zeroes and all. */}
      <ChangelogStrip />

      {/* 5 ----------------------------------------------------- the index */}
      {/* A link someone shared that leads nowhere is a failure, and it says so
          in words rather than quietly showing the plain index as if nothing had
          been asked for. The label is capped: a hostile or fat-fingered URL
          must not be able to paste a paragraph into the page. */}
      {routedMissing && openApp && (
        <p className="idx-notice" role="status">
          {t('route.unknown', { label: openApp.slice(0, 64) })}
          <button type="button" className="quiet-do" onClick={clearRoute}>
            {t('route.unknown.dismiss')}
          </button>
        </p>
      )}

      <div className="idx-count">
        {searching
          ? t('idx.count.search', {
              shown: fmt(shown.length, lang),
              all: fmt(counts.all, lang),
              q: query.trim(),
            })
          : grouping
            ? t('idx.count.owner', {
                n: fmt(shown.length, lang),
                owners: fmt(groups.length, lang),
              })
            : facet === 'updated'
              ? t('idx.count.updated', {
                  n: fmt(shown.length, lang),
                  all: fmt(counts.all, lang),
                })
              : t('idx.count.plain', { n: fmt(shown.length, lang) })}
      </div>

      <div className="idx">
        {/* Two renderings of one list. Grouped, each header names the address
            and how many of the index's names it holds; flat, the index reads
            exactly as it always has. Nothing is filtered out either way. */}
        {grouping
          ? groups.map((group) => (
              <div key={group.owner || 'unowned'} className="idx-group-wrap">
                <div
                  className="idx-group"
                  role="heading"
                  aria-level={3}
                  /* The visible address is abbreviated to fit a phone, so the
                     label a screen reader gets is the whole one. */
                  aria-label={t(
                    group.owner ? 'owner.group.aria' : 'owner.group.aria.none',
                    {
                      owner: group.owner,
                      n: fmt(group.apps.length, lang),
                      all: fmt(counts.all, lang),
                    },
                  )}
                >
                  <span className="idx-group-o" title={group.owner || undefined}>
                    {group.owner ? shortAddr(group.owner) : t('owner.group.none')}
                  </span>
                  <span className="idx-group-n">
                    {t('owner.group.n', {
                      n: fmt(group.apps.length, lang),
                      all: fmt(counts.all, lang),
                    })}
                  </span>
                </div>
                {group.apps.map((entry) => (
                  <IndexRow
                    key={entry.id}
                    entry={entry}
                    stats={stats[entry.id] ?? null}
                    open={openApp === entry.id}
                    onToggle={() => toggleApp(entry.id)}
                  />
                ))}
              </div>
            ))
          : shown.map((entry) => (
              <IndexRow
                key={entry.id}
                entry={entry}
                stats={stats[entry.id] ?? null}
                open={openApp === entry.id}
                onToggle={() => toggleApp(entry.id)}
              />
            ))}
        {shown.length === 0 && (
          <div className="idx-empty">
            {searching
              ? t('idx.empty.search', { q: query.trim() })
              : facet === 'updated'
                ? t('idx.empty.updated')
                : t('idx.empty.filter')}
          </div>
        )}
      </div>

      {/* 6 -------------------------------------------------------- ecosystem */}
      {/* Registrations moved up into the headline pair; chain vitals stay here,
          where they belong: supporting evidence, not the headline. */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{t('vitals.title')}</h2>
            <span className="panel-note">
              {t('vitals.note', {
                ago: ago(eco.measuredAt),
                head: fmt(eco.headBlock, lang),
              })}
            </span>
          </div>
          <span className="chart-legend">
            <span className="chart-swatch is-warn" aria-hidden="true" />
            {t('vitals.legend.reverted')}
            <span className="chart-swatch" aria-hidden="true" />
            {t('vitals.legend.emitted')}
          </span>
        </div>
        <ChainVitals eco={eco} />
      </div>

      {/* survival / mortality — the directory's own health over days, fed by the
          indexer's liveness.json. Ecosystem-level, so it belongs here beside the
          chain vitals rather than in the headline. Renders its frame and states
          its case even when nothing has died and only one day has been probed. */}
      <div className="panel chart-card">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{t('survival.title')}</h2>
            <span className="panel-note">{t('survival.note')}</span>
          </div>
          <span className="chart-legend">
            <span className="chart-swatch" aria-hidden="true" />
            {t('survival.legend.alive')}
            <span className="chart-swatch is-track" aria-hidden="true" />
            {t('survival.legend.deployed')}
          </span>
        </div>
        <SurvivalChart
          series={liveness.series}
          deaths={liveness.deaths}
          medianLifespanDays={liveness.medianLifespanDays}
        />
      </div>

      {/* 7 ----------------------------------------------------------- method */}
      {/* Each paragraph is ONE translatable string with named slots, not a
          chain of fragments around the JSX. These four paragraphs are the page
          admitting what its own numbers cannot show, and they have to read like
          Italian rather than like English word order with Italian words in it —
          which is exactly what splitting them at every <b> and <code> would
          have forced. */}
      <details className="method">
        <summary>{t('method.summary')}</summary>
        <p>{t('method.p1')}</p>
        <p>
          {tSplit('method.p2', {
            scanned: <b key="s">{fmt(scanned, lang)}</b>,
            rejected: <b key="r">{fmt(excluded.length, lang)}</b>,
            kept: <b key="k">{fmt(counts.all, lang)}</b>,
            call: (
              <code key="c" className="mono">
                registry.owner(namehash(label + '.dot'))
              </code>
            ),
          })}
        </p>
        <p className="mono">
          {excluded.length > 0 ? excluded.join(' · ') : t('method.excluded.none')}
        </p>
        <p>
          {tSplit('method.p3', {
            resolver: (
              <code key="a" className="mono">
                {CONTENT_RESOLVER}
              </code>
            ),
            lookup: (
              <code key="b" className="mono">
                registry.resolver(node)
              </code>
            ),
            text: (
              <code key="c" className="mono">
                text()
              </code>
            ),
            contenthash: (
              <code key="d" className="mono">
                contenthash()
              </code>
            ),
            registry: (
              <code key="e" className="mono">
                {REGISTRY}
              </code>
            ),
          })}
        </p>
        <p>
          {tSplit('method.p4', {
            event: (
              <code key="e" className="mono">
                revive.ContractEmitted
              </code>
            ),
            record: (
              <code key="r" className="mono">
                contract
              </code>
            ),
            blocks: fmt(eco.windowBlocks, lang),
            minutes: String(Math.max(1, Math.round(eco.windowSeconds / 60))),
          })}
        </p>
        <ul>
          {eco.topContracts.length > 0 ? (
            eco.topContracts.map((c) => (
              <li key={c.address}>
                {tSplit('method.top.item', {
                  address: (
                    <span key="a" className="mono">
                      {c.address}
                    </span>
                  ),
                  events: fmt(c.events, lang),
                  total: fmt(eco.contractEvents, lang),
                })}
              </li>
            ))
          ) : (
            <li>{t('method.top.none')}</li>
          )}
        </ul>
        {/* The page saying what it got wrong, in the same voice as the rest of
            the block. It names the flaw, says who it favoured, and gives the
            one command that puts every app on the same footing. */}
        <p>
          {tSplit('method.p5', {
            cmd: (
              <code key="c" className="mono">
                dotns text set &lt;name&gt;.dot contract 0xYourContract --env devnet
              </code>
            ),
            event: (
              <code key="e" className="mono">
                revive.ContractEmitted
              </code>
            ),
            declared: <b key="d">{fmt(counts.declared, lang)}</b>,
            all: <b key="a">{fmt(counts.all, lang)}</b>,
          })}
        </p>
        {/* How "unreachable" is measured, and — more importantly — what it
            cannot prove. One gateway is one door, not the network. */}
        <p>
          {tSplit('method.p6', {
            gateway: (
              <code key="g" className="mono">
                {new URL(gatewayUrl('')).host}
              </code>
            ),
          })}
        </p>
      </details>

      {/* 8 ----------------------------------------------------------- footer */}
      <div className="foot-row">
        <span className="foot-prov">
          {/* Which of the three sources actually won: the mutable record, the
              build-time pin, or the compiled-in snapshot. Three different
              freshness claims — the reader gets the real one. The CID links
              through the gateway that actually serves our objects. */}
          {source !== 'baked' && directoryCid
            ? tSplit(source === 'record' ? 'foot.prov.record' : 'foot.prov.pinned', {
                cid: (
                  <a
                    key="cid"
                    href={gatewayUrl(directoryCid)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      void openExternal(gatewayUrl(directoryCid));
                    }}
                  >
                    {directoryCid}
                  </a>
                ),
              })
            : t('foot.prov.baked')}
        </span>
        <ChatButton />
      </div>

      {/* The feed. Quiet, one line, for the audience the rest of the page is not
          for: not a reader looking up an app, but a program listing them. The
          index has no other machine-readable discovery surface, so this is it —
          two static files built into the same publish, linked plainly. */}
      <p className="feed-links">
        <b>{t('feed.lead')}</b>
        <span>{t('feed.blurb')}</span>
        <a
          href={`${import.meta.env.BASE_URL}feed.json`}
          target="_blank"
          rel="noreferrer"
          aria-label={t('feed.aria.json')}
        >
          feed.json
        </a>
        <a
          href={`${import.meta.env.BASE_URL}feed.xml`}
          target="_blank"
          rel="noreferrer"
          aria-label={t('feed.aria.xml')}
        >
          feed.xml
        </a>
      </p>

      <footer className="foot">{t('foot.note')}</footer>
    </div>
  );
}

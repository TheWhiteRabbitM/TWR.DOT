import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Database } from 'lucide-react';
import { APPS, buildApps, type Discovered } from './lib/registry';
import { gatewayUrl, loadDirectory, type DirectorySource } from './lib/directory';
import { startLiveTail } from './lib/livetail';
import { readContract } from './lib/chain';
import {
  ChainVitals,
  PulseStrip,
  SurvivalChart,
  type Death,
  type EcoSnapshot,
  type HeadBeat,
  type SurvivalPoint,
} from './Charts';
import { openExternal } from './lib/host-nav';
import ecosystemSnapshot from './lib/ecosystem.json';
import livenessData from './lib/liveness.json';
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
import StoreHero from './components/StoreHero';
import AppCard from './components/AppCard';
import CategoryGrid from './components/CategoryGrid';
import ReviewsSection from './components/ReviewsSection';
import FAQSection from './components/FAQSection';
import NewsletterSection from './components/NewsletterSection';
import StoreFooter from './components/StoreFooter';

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

/* ---- All Apple Store layout moved to styles.css ---- */
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
/* exactUtc removed */

/* --------------------------------------------------------------- the tiers */



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
/* tierReason removed */

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
/* unreachableLine removed */

/**
 * The event count for the address a name declares, over the measured window.
 *
 * `null` means "this name declares no contract" and must render as NOTHING. A
 * zero here is a real measurement — the address exists and emitted nothing —
 * and the two must never look alike: an app that has told us nothing would
 * otherwise be shown as an app we measured and found idle.
 */
/* declaredEvents removed */

/* ------------------------------------------------------------------- data */

interface Ecosystem {
  apps: AppEntry[];
  stats: Record<string, AppStats>;
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

  return { apps, stats, source, directoryCid, excluded, beat, tailUp, ready };
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
/* openEntry removed */

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

/* ------------------------------------------------------------- index row */

/* AppIcon removed */

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
  const { apps, source, directoryCid, excluded, beat, tailUp, ready } =
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

  const hasShot = (id: string) => SHOTS[id] != null;
  const featured = shown.filter((a) => hasShot(a.id)).slice(0, 8);

  return (
    <motion.div
      className="as-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <style>{LAYOUT_CSS}</style>

      {/* ---- Sticky Header ---- */}
      <header className="as-head">
        <div className="as-head-inner">
          <motion.h1
            className="as-logo"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          >
            dot-store
          </motion.h1>
          <span className="badge is-deployed" style={{ height: 20, fontSize: 10, padding: '0 8px' }}>
            {t('bar.devnet')}
          </span>
          <span style={{ flex: 1 }} />
          <PulseStrip beat={beat} connected={tailUp} />
          <LanguageSwitch />
        </div>
      </header>

      {/* ---- Hero ---- */}
      <StoreHero
        title={t('hero.title')}
        subtitle={t('hero.sub')}
        exploreLabel={t('hero.explore')}
        learnLabel={t('hero.learn')}
        onExplore={() => document.querySelector('.as-filter')?.scrollIntoView({ behavior: 'smooth' })}
        onLearn={() => document.querySelector('.as-eco')?.scrollIntoView({ behavior: 'smooth' })}
        totalApps={counts.all}
      />

      {/* ---- Section: Browse by Category ---- */}
      {!searching && (
        <CategoryGrid
          onSelect={(id) => { narrow(); setQuery(''); setFacet(id as Facet); }}
          active={facet}
        />
      )}

      {/* ---- Filter + Search ---- */}
      <div className="as-section-wrapper" style={{ paddingBottom: 0 }}>
        <div className="as-section-inner">
          <motion.div
            className="as-filter"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            style={{ padding: 0, maxWidth: 'none' }}
          >
            <div className="as-search" style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#8C8C8C', pointerEvents: 'none' }} />
              <input
                className="as-search-input"
                type="search"
                value={query}
                onChange={(e) => { narrow(); setQuery(e.target.value); }}
                placeholder={t('search.placeholder', { n: fmt(counts.all, lang) })}
                aria-label={t('search.aria')}
                style={{ paddingLeft: 44 }}
              />
            </div>
          </motion.div>

          {!searching && (
            <motion.div
              className="as-facets"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              style={{ padding: '12px 0 0', maxWidth: 'none' }}
              role="group"
              aria-label={t('facets.aria')}
            >
              {facets.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`as-facet${facet === f.key ? ' is-on' : ''}`}
                  aria-pressed={facet === f.key}
                  onClick={() => { narrow(); setQuery(''); setFacet(f.key); }}
                >
                  {f.label}
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* ---- Featured horizontal scroll ---- */}
      {!searching && featured.length > 0 && (
        <section className="as-section-wrapper" style={{ paddingTop: 24, paddingBottom: 0 }}>
          <div className="as-section-inner">
            <motion.h2
              className="as-section-heading"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              style={{ fontSize: 28, marginBottom: 24 }}
            >
              <span style={{ color: '#8C8C8C', fontWeight: 400 }}>Editor's</span> Picks
            </motion.h2>
            <motion.div
              className="as-featured-scroll"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.15 }}
            >
              {featured.map((entry) => {
                const s = SHOTS[entry.id];
                const title = entry.displayName ?? entry.name ?? entry.id;
                return (
                  <motion.div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    className="as-feat-card"
                    onClick={() => toggleApp(entry.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleApp(entry.id); } }}
                    whileHover={{ y: -6, boxShadow: '0 20px 60px rgba(0,0,0,0.1)' }}
                    transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <div className="as-feat-img">
                      <img src={`${import.meta.env.BASE_URL}${s.file}`} alt="" loading="lazy" />
                    </div>
                    <div className="as-feat-meta">
                      <span className="idx-ico" style={{ width: 28, height: 28, fontSize: 10, borderRadius: 7, background: '#f5f5f7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontWeight: 600 }}>
                        {(entry.displayName ?? entry.name ?? entry.id).trim().slice(0, 1) || '?'}
                      </span>
                      <span className="as-feat-name">{title}</span>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>
      )}

      {/* ---- Count line ---- */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 48px 0' }}>
        <motion.div
          className="as-count"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          style={{ padding: 0 }}
        >
          {searching
            ? t('idx.count.search', { shown: fmt(shown.length, lang), all: fmt(counts.all, lang), q: query.trim() })
            : grouping
              ? t('idx.count.owner', { n: fmt(shown.length, lang), owners: fmt(groups.length, lang) })
              : facet === 'updated'
                ? t('idx.count.updated', { n: fmt(shown.length, lang), all: fmt(counts.all, lang) })
                : t('idx.count.plain', { n: fmt(shown.length, lang) })}
        </motion.div>
      </div>

      {/* ---- Route missing notice ---- */}
      {routedMissing && openApp && (
        <p className="idx-notice" role="status" style={{ margin: '0 48px 12px', maxWidth: 1280 }}>
          {t('route.unknown', { label: openApp.slice(0, 64) })}
          <button type="button" className="quiet-do" onClick={clearRoute}>{t('route.unknown.dismiss')}</button>
        </p>
      )}

      {/* ---- App Grid ---- */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '12px 48px 48px' }}>
        <motion.div
          className="as-grid"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5 }}
          style={{ padding: 0, maxWidth: 'none' }}
        >
          {shown.length === 0 ? (
            <div className="as-empty" style={{ gridColumn: '1/-1', padding: '48px 24px' }}>
              {searching
                ? t('idx.empty.search', { q: query.trim() })
                : facet === 'updated'
                  ? t('idx.empty.updated')
                  : t('idx.empty.filter')}
            </div>
          ) : grouping ? (
            groups.map((group) => (
              <div key={group.owner || 'unowned'} style={{ gridColumn: '1/-1' }}>
                <div className="idx-group" role="heading" aria-level={3}
                  aria-label={t(group.owner ? 'owner.group.aria' : 'owner.group.aria.none', { owner: group.owner, n: fmt(group.apps.length, lang), all: fmt(counts.all, lang) })}>
                  <span className="idx-group-o">{group.owner ? shortAddr(group.owner) : t('owner.group.none')}</span>
                  <span className="idx-group-n">{t('owner.group.n', { n: fmt(group.apps.length, lang), all: fmt(counts.all, lang) })}</span>
                </div>
                <div className="as-grid" style={{ padding: 0, maxWidth: 'none' }}>
                  {group.apps.map((entry) => (
                    <AppCard key={entry.id} entry={entry} isOpen={openApp === entry.id} onToggle={() => toggleApp(entry.id)} shot={shotFor(entry.id)} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            shown.map((entry) => (
              <AppCard key={entry.id} entry={entry} isOpen={openApp === entry.id} onToggle={() => toggleApp(entry.id)} shot={shotFor(entry.id)} />
            ))
          )}
        </motion.div>
      </div>

      {/* ---- Reviews ---- */}
      {!searching && <ReviewsSection />}

      {/* ---- FAQ ---- */}
      {!searching && <FAQSection />}

      {/* ---- Newsletter ---- */}
      {!searching && <NewsletterSection />}

      {/* ---- Ecosystem Data ---- */}
      <section className="as-section-wrapper" style={{ paddingBottom: 0 }}>
        <div className="as-section-inner">
          <details className="as-eco" style={{ margin: 0, maxWidth: 'none' }}>
            <summary className="as-eco-summary">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Database size={18} /> Ecosystem Data & Methodology
              </span>
            </summary>
            <div className="as-eco-body">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">{t('vitals.title')}</h2>
                  <span className="panel-note">{t('vitals.note', { ago: ago(eco.measuredAt), head: fmt(eco.headBlock, lang) })}</span>
                </div>
                <span className="chart-legend">
                  <span className="chart-swatch is-warn" aria-hidden="true" />{t('vitals.legend.reverted')}
                  <span className="chart-swatch" aria-hidden="true" />{t('vitals.legend.emitted')}
                </span>
              </div>
              <ChainVitals eco={eco} />
              <div className="panel chart-card" style={{ marginTop: 'var(--sp-3)' }}>
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title">{t('survival.title')}</h2>
                    <span className="panel-note">{t('survival.note')}</span>
                  </div>
                  <span className="chart-legend">
                    <span className="chart-swatch" aria-hidden="true" />{t('survival.legend.alive')}
                    <span className="chart-swatch is-track" aria-hidden="true" />{t('survival.legend.deployed')}
                  </span>
                </div>
                <SurvivalChart series={liveness.series} deaths={liveness.deaths} medianLifespanDays={liveness.medianLifespanDays} />
              </div>
              <details className="method"><summary>{t('method.summary')}</summary>
                <p>{t('method.p1')}</p>
                <p>{tSplit('method.p2', { scanned: <b key="s">{fmt(scanned, lang)}</b>, rejected: <b key="r">{fmt(excluded.length, lang)}</b>, kept: <b key="k">{fmt(counts.all, lang)}</b>, call: (<code key="c" className="mono">registry.owner(namehash(label + '.dot'))</code>) })}</p>
                <p className="mono">{excluded.length > 0 ? excluded.join(' · ') : t('method.excluded.none')}</p>
              </details>
            </div>
          </details>
        </div>
      </section>

      {/* ---- Premium Footer ---- */}
      <StoreFooter
        sourceText={
          source !== 'baked' && directoryCid
            ? tSplit(source === 'record' ? 'foot.prov.record' : 'foot.prov.pinned', {
                cid: (<a key="cid" href={gatewayUrl(directoryCid)} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); void openExternal(gatewayUrl(directoryCid)); }}>{directoryCid.slice(0, 8)}…{directoryCid.slice(-4)}</a>)
              })
            : t('foot.prov.baked')
        }
        note={t('foot.note')}
      />
    </motion.div>
  );
}

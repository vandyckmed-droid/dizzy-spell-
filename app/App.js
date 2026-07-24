/* ======================================================================
   Sharpe Momentum Screener — Expo (iPhone) app
   Runs in Expo Go via a single Snack link. Market data is a bundled,
   key-free snapshot (pull-to-refresh pulls the latest from public GitHub raw).
   All ranking / HRP / constraint math comes from ./engine (validated against
   a NumPy reference — see build/validate_js.mjs).
   ====================================================================== */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, FlatList, Pressable, TextInput, Modal, RefreshControl, Switch, Alert, Image,
  StyleSheet, useColorScheme, Animated, Easing, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Defs, LinearGradient, RadialGradient, Stop, Line, Circle, Rect, Text as SvgText } from 'react-native-svg';
import * as E from './engine';
// First paint loads a LIGHT snapshot (recent ~300 days, marked partial); the full
// 800-day history is fetched in the background and hot-swapped in (see Root).
import snapshot from './snapshot.lite.json';

const STORE_KEY = 'sms.state.v1';
// Full 800-day snapshot on the public repo — background-hydrated on launch and
// re-pulled by pull-to-refresh. The bundled light copy is the instant fallback.
const DATA_URL =
  'https://raw.githubusercontent.com/vandyckmed-droid/dizzy-spell-/refs/heads/main/data/snapshot.json';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.create(
  220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

/* ---- palette (Robinhood-inspired: near-black, white type, vivid green/red) ---- */
const palettes = {
  dark: {
    ground: '#000000', surface: '#0F1113', surface2: '#191C1F', raised: '#23272B',
    line: 'rgba(255,255,255,0.06)', lineStrong: 'rgba(255,255,255,0.12)',
    text: '#FFFFFF', muted: '#A2A9B0', faint: '#6B7178',
    accent: '#00C805', accentInk: '#00140A', accentSoft: 'rgba(0,200,5,0.14)',
    gain: '#00C805', loss: '#FF5000',
    gainSoft: 'rgba(0,200,5,0.14)', lossSoft: 'rgba(255,80,0,0.14)',
    div: '#3DD6C0', divSoft: 'rgba(61,214,192,0.16)',
    red: '#FF5F73', redSoft: 'rgba(255,95,115,0.16)',   // redundant cue — complement of the teal diversifier
    selRow: '#0C1A0E',
  },
  light: {
    ground: '#FFFFFF', surface: '#FFFFFF', surface2: '#F2F4F6', raised: '#E9ECEF',
    line: 'rgba(0,0,0,0.07)', lineStrong: 'rgba(0,0,0,0.14)',
    text: '#0A0B0D', muted: '#5B6169', faint: '#8B9199',
    accent: '#00A804', accentInk: '#FFFFFF', accentSoft: 'rgba(0,168,4,0.12)',
    gain: '#00A804', loss: '#E63A00',
    gainSoft: 'rgba(0,168,4,0.12)', lossSoft: 'rgba(230,58,0,0.12)',
    div: '#0E9E8C', divSoft: 'rgba(14,158,140,0.12)',
    red: '#E23B54', redSoft: 'rgba(226,59,84,0.12)',   // redundant cue — complement of the teal diversifier
    selRow: '#EAF7EC',
  },
};

// categorical palette tuned for the near-black theme (distinct from the semantic green/red)
const SECTOR_COLORS = ['#5AC8FA','#BF5AF2','#FF9F0A','#5E5CE6','#64D2FF','#FF6482','#FFD60A','#40C8B0','#C7A06A','#FF8A5B','#9CA3AF'];
const PERIODS = [['5-day',5],['10-day',10],['1-month',21],['3-month',63],['6-month',126],['1-year',252]];
// Default 12–1 momentum window, rounded (250→20 instead of 252→21): cleaner and
// leaves a day of slack for occasional end-of-day data lag.
const DEF_START = 250, DEF_END = 20;
// Macro dashboard chart config
const MACRO_TFS = ['1D', '6M', '1Y'];
const CHART_TYPES = [{ key: 'line', label: 'Line' }, { key: 'ohlc', label: 'Bars' }];
const EMA_COLORS = ['#5AC8FA', '#FF9F0A'];   // EMA-1 (blue), EMA-2 (amber)

// Ranking modes. The score is: return (annualized), volatility (annualized), or
// their ratio (Sharpe). Return/vol windows are configurable; market influence is
// optionally residualized out.
const MODES = [
  { key: 'sharpe', label: 'Sharpe', short: 'Sharpe' },
  { key: 'return', label: 'Return', short: 'Return' },
  { key: 'vol', label: 'Volatility', short: 'Vol' },
];
// portfolio weighting schemes for the compare card
const SCHEMES = [
  { key: 'hrp', label: 'HRP', blurb: 'Hierarchical risk parity' },
  { key: 'minvar', label: 'Min-var', blurb: 'Long-only minimum variance' },
  { key: 'invvol', label: 'Inverse-vol', blurb: 'Weight ∝ 1/σ' },
  { key: 'equal', label: 'Equal', blurb: 'Equal weight (1/N)' },
];
function cfgOf(st, betaWindow) {
  return {
    retStart: st.start, retEnd: st.end,
    volStart: st.volStart, volEnd: st.volEnd,
    matchVol: st.matchVol, mode: st.mode, removeMkt: st.removeMkt,
    betaWindow: betaWindow || 756,
  };
}
// second window shares the mode / market-removal settings but uses its own
// return offsets, with volatility matched to that same window
function cfgOfB(st, betaWindow) {
  return {
    retStart: st.bStart, retEnd: st.bEnd,
    volStart: st.bStart, volEnd: st.bEnd,
    matchVol: true, mode: st.mode, removeMkt: st.removeMkt,
    betaWindow: betaWindow || 756,
  };
}
// months-style window label, e.g. 250→20 ⇒ "12–1", 126→20 ⇒ "6–1"
const winLabel = (start, end) => `${Math.round(start / 21)}–${Math.round(end / 21)}`;
function marketReturns(snap) {
  const primary = Object.keys(snap.universes)[0];
  const pool = snap.tickers.filter(t => t.universes.includes(primary));
  const totalCap = pool.reduce((a, t) => a + (t.marketCap || 0), 0) || 1;
  const M = snap.dates.length - 1;
  const mret = new Array(M).fill(0);
  for (const t of pool) {
    const wgt = (t.marketCap || 0) / totalCap, c = t.closes;
    for (let k = 0; k < M; k++) mret[k] += wgt * (c[k + 1] / c[k] - 1);
  }
  return mret;
}
const CAP_BANDS = [
  { key: 'all', label: 'All caps', test: () => true },
  { key: 'mega', label: '≥ $500B', test: mc => mc >= 500e9 },
  { key: 'large', label: '$100–500B', test: mc => mc >= 100e9 && mc < 500e9 },
  { key: 'mid', label: '< $100B', test: mc => mc < 100e9 },
];
const EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX'];

const shortDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+m}/${+d}/${y.slice(2)}`; };

const haptic = (kind = 'select') => {
  try {
    if (kind === 'select') Haptics.selectionAsync();
    else if (kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'warn') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {}
};

/* ====================================================================== */
export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const scheme = useColorScheme();
  const C = palettes[scheme === 'light' ? 'light' : 'dark'];
  const insets = useSafeAreaInsets();

  const [snap, setSnap] = useState(snapshot);   // bundled; replaced by pull-to-refresh
  const [st, setSt] = useState(null);           // persisted UI state
  const [tab, setTab] = useState('screener');
  const [detail, setDetail] = useState(null);   // symbol or null
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  // fixed-ETF (VTI) daily market returns embedded in the snapshot; fallback for old snapshots
  const market = useMemo(() => (Array.isArray(snap.market) && snap.market.length ? snap.market : marketReturns(snap)), [snap]);

  /* ---- load persisted UI state (selections + window + caps + sort/filter) ---- */
  useEffect(() => {
    (async () => {
      let saved = {};
      try { saved = JSON.parse(await AsyncStorage.getItem(STORE_KEY)) || {}; } catch (e) {}
      setSt(clampState(normalizeState(saved), snap));
    })();
  }, []);

  // re-clamp when the snapshot changes (e.g. after refresh)
  useEffect(() => { setSt(s => (s ? clampState(s, snap) : s)); }, [snap]);

  // background-hydrate the full history after first paint, then hot-swap it in.
  // The as-of is persisted by DATE, so the light→full calendar change is seamless.
  useEffect(() => {
    if (!snapshot.partial) return;                 // already the full snapshot
    let cancelled = false;
    (async () => {
      try {
        const url = DATA_URL + (DATA_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          const full = await res.json();
          if (!cancelled && full && Array.isArray(full.tickers) && full.tickers.length && !full.partial)
            setSnap(full);
        }
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);

  // fade the main content in on tab change
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [tab]);

  const persist = useCallback((next) => {
    // keep asofDate (the durable key) in sync with the numeric asof index so
    // the window survives snapshot rebuilds that shift the calendar
    const dated = next && typeof next.asof === 'number' && snap.dates[next.asof]
      ? { ...next, asofDate: snap.dates[next.asof] } : next;
    // mirror the live `selected` back into the active book before saving
    const synced = syncBooks(dated);
    setSt(synced);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(synced)).catch(() => {});
  }, [snap]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); haptic('light');
    try {
      const url = DATA_URL + (DATA_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const fresh = await res.json();
        if (fresh && Array.isArray(fresh.tickers) && fresh.tickers.length) {
          setSnap(fresh); haptic('success');
        }
      }
    } catch (e) {}
    setRefreshing(false);
  }, []);

  if (!st) return <ScreenerSkeleton C={C} insets={insets} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ground }} edges={['top', 'left', 'right']}>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <Animated.View style={{ flex: 1, opacity: fade }}>
        {tab === 'screener'
          ? <Screener C={C} snap={snap} market={market} st={st} persist={persist} query={query} setQuery={setQuery}
              onOpen={setDetail} refreshing={refreshing} onRefresh={onRefresh} />
          : tab === 'portfolio'
          ? <Portfolio C={C} snap={snap} market={market} st={st} persist={persist} onOpen={setDetail}
              refreshing={refreshing} onRefresh={onRefresh} />
          : <Macro C={C} snap={snap} st={st} persist={persist} refreshing={refreshing} onRefresh={onRefresh} />}
      </Animated.View>
      <TabBar C={C} tab={tab} setTab={setTab} count={st.selected.length} insets={insets} />
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)} presentationStyle="fullScreen">
        {detail && <Detail C={C} snap={snap} market={market} st={st} sym={detail}
          onClose={() => setDetail(null)} onToggle={(s) => persist(toggleSel(st, s))} onOpen={setDetail}
          onSector={(uid) => { animateNext(); persist({ ...st, universe: uid }); setDetail(null); setTab('screener'); }} />}
      </Modal>
    </SafeAreaView>
  );
}

/* ---------------- state helpers ---------------- */
// Holdings live in named "books" — a book is a portfolio (HRP-weighted) or a
// watchlist (unweighted tracked list). `st.selected` always mirrors the ACTIVE
// book's holdings, so every existing read/write of `st.selected` keeps working;
// `syncBooks` (called in persist) writes those edits back into the active book.
function parseBooks(saved) {
  const raw = Array.isArray(saved.books) && saved.books.length ? saved.books : null;
  const books = (raw || [{ id: 'b1', name: 'Portfolio', kind: 'portfolio',
                           selected: Array.isArray(saved.selected) ? saved.selected : [] }])
    .map((b, i) => ({
      id: String(b.id || 'b' + (i + 1)),
      name: String(b.name || 'Book ' + (i + 1)).slice(0, 24) || 'Book ' + (i + 1),
      kind: b.kind === 'watchlist' ? 'watchlist' : 'portfolio',
      selected: Array.isArray(b.selected) ? b.selected.filter(x => typeof x === 'string') : [],
    }));
  const activeBook = books.some(b => b.id === saved.activeBook) ? saved.activeBook : books[0].id;
  return { books, activeBook, selected: books.find(b => b.id === activeBook).selected };
}
function syncBooks(s) {
  if (!Array.isArray(s.books) || !s.activeBook) return s;
  return { ...s, books: s.books.map(b => b.id === s.activeBook ? { ...b, selected: s.selected } : b) };
}
let bookSeq = 0;
function newBookId() { return 'b' + Date.now() + '_' + (bookSeq++); }
function activeBookOf(st) { return st.books.find(b => b.id === st.activeBook) || st.books[0]; }
function switchBook(st, id) {
  const b = st.books.find(x => x.id === id);
  return b ? { ...st, activeBook: id, selected: b.selected } : st;
}
function addBook(st, kind) {
  const id = newBookId();
  const n = st.books.filter(b => b.kind === kind).length + 1;
  const name = (kind === 'watchlist' ? 'Watchlist ' : 'Portfolio ') + n;
  return { ...st, books: [...st.books, { id, name, kind, selected: [] }], activeBook: id, selected: [] };
}
function renameBook(st, id, name) {
  const nm = (name || '').trim().slice(0, 24) || activeBookOf(st).name;
  return { ...st, books: st.books.map(b => b.id === id ? { ...b, name: nm } : b) };
}
function setBookKind(st, id, kind) {
  return { ...st, books: st.books.map(b => b.id === id ? { ...b, kind } : b) };
}
function deleteBook(st, id) {
  if (st.books.length <= 1) return st;                    // always keep one book
  const books = st.books.filter(b => b.id !== id);
  const activeBook = st.activeBook === id ? books[0].id : st.activeBook;
  return { ...st, books, activeBook, selected: books.find(b => b.id === activeBook).selected };
}

function normalizeState(saved) {
  const bk = parseBooks(saved);
  return {
    universe: saved.universe || null,
    asof: saved.asof ?? null,
    asofDate: saved.asofDate || null,
    start: saved.start ?? DEF_START,
    end: saved.end ?? DEF_END,
    books: bk.books,
    activeBook: bk.activeBook,
    selected: bk.selected,
    maxStock: saved.maxStock ?? 0,
    maxSector: saved.maxSector ?? 0,
    minStock: saved.minStock ?? 0,
    weightScheme: ['hrp', 'equal', 'invvol', 'minvar'].includes(saved.weightScheme) ? saved.weightScheme : 'hrp',
    scoreNorm: !!saved.scoreNorm,       // show the score as a 0–100 rank of the universe
    mode: ['sharpe', 'return', 'vol'].includes(saved.mode) ? saved.mode : 'sharpe',
    removeMkt: !!saved.removeMkt,
    matchVol: saved.matchVol == null ? true : !!saved.matchVol,
    volStart: saved.volStart ?? 252,
    volEnd: saved.volEnd ?? 21,
    sortDir: saved.sortDir || 'desc',
    capBand: saved.capBand || 'all',
    exch: Array.isArray(saved.exch) ? saved.exch : [],
    // second (blended / side-by-side) return window — default 6–1
    winB: saved.winB == null ? true : !!saved.winB,
    bStart: saved.bStart ?? 126,
    bEnd: saved.bEnd ?? 20,
    // basket-correlation cue thresholds (max daily-return ρ vs a held name)
    cueOn: saved.cueOn == null ? true : !!saved.cueOn,
    divRho: saved.divRho ?? 0.45,
    redRho: saved.redRho ?? 0.60,
    // macro dashboard prefs
    macroSym: saved.macroSym || null,
    macroTf: MACRO_TFS.includes(saved.macroTf) ? saved.macroTf : '1D',
    macroType: ['line', 'ohlc'].includes(saved.macroType) ? saved.macroType : 'line',
    ema1On: saved.ema1On == null ? true : !!saved.ema1On,
    ema1P: saved.ema1P ?? 50,
    ema2On: saved.ema2On == null ? true : !!saved.ema2On,
    ema2P: saved.ema2P ?? 200,
    maCross: saved.maCross == null ? true : !!saved.maCross,
  };
}
function clampState(s, snap) {
  const N = snap.dates.length;
  const uni = snap.universes[s.universe] ? s.universe : Object.keys(snap.universes)[0];
  // Resolve as-of from the persisted date string, not a stale numeric index —
  // a rebuilt snapshot shifts every index, so an old index silently points at
  // the wrong day (which broke residual momentum after the 520→800d expansion).
  // Fall back to the latest date when the saved date isn't in this calendar.
  const di = s.asofDate ? snap.dates.indexOf(s.asofDate) : -1;
  const asof = di >= 0 ? di : N - 1;
  const start = Math.max(3, Math.min(N - 1, s.start | 0));
  const end = Math.max(1, Math.min(start - 2, s.end | 0));
  const volStart = Math.max(3, Math.min(N - 1, s.volStart | 0));
  const volEnd = Math.max(1, Math.min(volStart - 2, s.volEnd | 0));
  const bStart = Math.max(3, Math.min(N - 1, s.bStart | 0));
  const bEnd = Math.max(1, Math.min(bStart - 2, s.bEnd | 0));
  // EMA periods snap to multiples of 5 (repairs any off-by legacy values like 37/147)
  const snap5 = (p, d) => Math.max(5, Math.min(400, Math.round((p || d) / 5) * 5));
  const ema1P = snap5(s.ema1P, 50), ema2P = snap5(s.ema2P, 200);
  return { ...s, universe: uni, asof, asofDate: snap.dates[asof], start, end, volStart, volEnd, bStart, bEnd, ema1P, ema2P };
}
function toggleSel(st, sym) {
  const set = new Set(st.selected);
  set.has(sym) ? set.delete(sym) : set.add(sym);
  haptic(set.has(sym) ? 'select' : 'light');
  return { ...st, selected: [...set] };
}

/* ====================== Screener ====================== */
function Screener({ C, snap, market, st, persist, query, setQuery, onOpen, refreshing, onRefresh }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [cueOpen, setCueOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);
  const activeBk = activeBookOf(st);
  const pulse = useRef(new Animated.Value(1)).current;
  const dir = st.sortDir === 'asc' ? 1 : -1;
  const betaWindow = snap.betaWindow || 756;
  const cfg = cfgOf(st, betaWindow);

  // score every ticker with the configured window / mode / residual settings, then rank.
  // In residual mode, names lacking the 756d beta window are marked unavailable (hidden), not faked.
  const { rows: ranked, hidden } = useMemo(() => {
    const band = CAP_BANDS.find(b => b.key === st.capBand) || CAP_BANDS[0];
    const exchSet = st.exch && st.exch.length ? new Set(st.exch) : null;
    const c = cfgOf(st, betaWindow);
    const cB = cfgOfB(st, betaWindow);
    // window B, when on, always blends 50/50 with window A into one score.
    // Both windows are annualized (mean·252 / σ·√252 / their ratio), so a 6–1
    // and a 12–1 window land on the same per-year scale and combine fairly.
    const blend = st.winB;
    const out = [];
    let hidden = 0;
    for (const t of snap.tickers) {
      if (!t.universes.includes(st.universe) || !band.test(t.marketCap || 0) || (exchSet && !exchSet.has(t.exchange))) continue;
      const r = E.momentumScore(t.closes, market, st.asof, c);
      if (!r || r.score == null || Number.isNaN(r.score)) {
        if (c.removeMkt && E.momentumDaily(t.closes, st.asof, st.start, st.end)) hidden++;
        continue;
      }
      const rB = st.winB ? E.momentumScore(t.closes, market, st.asof, cB) : null;
      const rbOk = rB && rB.score != null && !Number.isNaN(rB.score);
      // ranking basis: blended average of the two windows, else primary window A
      const score = blend && rbOk ? (r.score + rB.score) / 2 : r.score;
      out.push({ t, m: r, mB: rbOk ? rB : null, score });
    }
    out.sort((a, b) => {
      const av = a.score, bv = b.score;
      const an = av == null || Number.isNaN(av), bn = bv == null || Number.isNaN(bv);
      if (an && bn) return 0; if (an) return 1; if (bn) return -1;
      return dir * (av - bv);
    });
    out.forEach((o, i) => (o.rank = i + 1));
    return { rows: out, hidden };
  }, [snap, market, betaWindow, st.universe, st.asof, st.start, st.end, st.volStart, st.volEnd,
      st.matchVol, st.mode, st.removeMkt, st.capBand, st.exch, st.sortDir,
      st.winB, st.bStart, st.bEnd]);

  const q = query.trim().toUpperCase();
  const displayed = useMemo(() =>
    q ? ranked.filter(o => o.t.symbol.includes(q) || o.t.name.toUpperCase().includes(q)) : ranked,
    [ranked, q]);

  // 0–100 normalization: a plain rank percentile over the universe (post-filter,
  // pre-search), so the number just says where in the ranked order a name sits —
  // 100 = rank 1 (top), 0 = last, 50 = median, and each decile spans 10 points.
  const norm = st.scoreNorm && ranked.length > 1 ? { n: ranked.length } : null;

  const selSet = new Set(st.selected);
  const selInView = ranked.reduce((n, o) => n + (selSet.has(o.t.symbol) ? 1 : 0), 0);
  // correlation of each ranked name vs the current basket → fade the redundant,
  // flag the diversifiers. Recomputed only when the basket or window shifts.
  const bySym = useMemo(() => Object.fromEntries(snap.tickers.map(t => [t.symbol, t])), [snap]);
  const corrMap = useMemo(
    () => basketCorrMap(ranked, st.selected, (s) => bySym[s], st.asof),
    [ranked, st.selected, st.asof, bySym]);
  const sig = `${st.universe}|${st.mode}|${st.removeMkt}|${st.matchVol}|${st.sortDir}|${st.capBand}|${st.exch.join(',')}`;
  useEffect(() => {
    pulse.setValue(0.4);
    Animated.timing(pulse, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [sig]);

  const setWin = (patch) => {
    let next = { ...st, ...patch };
    next.start = Math.max(next.end + 2, Math.min(snap.dates.length - 1, next.start));
    next.end = Math.max(1, Math.min(next.start - 2, next.end));
    next.asof = Math.max(next.start, Math.min(snap.dates.length - 1, next.asof));
    haptic('select'); persist(next);
  };
  const setVol = (patch) => {
    let next = { ...st, ...patch };
    next.volStart = Math.max(next.volEnd + 2, Math.min(snap.dates.length - 1, next.volStart));
    next.volEnd = Math.max(1, Math.min(next.volStart - 2, next.volEnd));
    haptic('select'); persist(next);
  };
  const setWinB = (patch) => {
    let next = { ...st, ...patch };
    next.bStart = Math.max(next.bEnd + 2, Math.min(snap.dates.length - 1, next.bStart));
    next.bEnd = Math.max(1, Math.min(next.bStart - 2, next.bEnd));
    haptic('select'); persist(next);
  };
  const setMode = (m) => { animateNext(); haptic('select'); persist({ ...st, mode: m, sortDir: m === 'vol' ? 'asc' : 'desc' }); };
  const setFilter = (patch) => { animateNext(); haptic('select'); persist({ ...st, ...patch }); };
  const activeFilters = (st.capBand !== 'all' ? 1 : 0) + (st.exch.length ? 1 : 0);
  const modeLabel = (MODES.find(m => m.key === st.mode) || MODES[0]).short;

  const header = (
    <View>
      <AppHeader C={C} snap={snap} />
      <Pressable onPress={() => setBooksOpen(true)} accessibilityLabel="Switch or manage book"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface2, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 10 }}>
        <Text style={{ color: C.faint, fontSize: 12 }}>Adding to</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
            {activeBk.kind === 'watchlist' ? '☆ ' : '◆ '}{activeBk.name}
          </Text>
          <Text style={[TNUM, { color: C.faint, fontSize: 12, fontWeight: '700' }]}>{st.selected.length}</Text>
          <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>Switch ›</Text>
        </View>
      </Pressable>
      <Card C={C}>
        <Eyebrow C={C}>Universe</Eyebrow>
        <Segmented C={C}
          options={Object.entries(snap.universes).map(([id, u]) => ({ id, label: u.label }))}
          value={st.universe}
          onChange={(id) => { animateNext(); haptic('select'); persist({ ...st, universe: id }); }} />
        <TextInput
          value={query} onChangeText={setQuery}
          placeholder="Search ticker or company" placeholderTextColor={C.faint}
          autoCapitalize="characters" autoCorrect={false}
          style={[styles.search, { backgroundColor: C.surface2, color: C.text, borderColor: C.line }]} />
      </Card>

      <Card C={C}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Eyebrow C={C}>Return window · trading days</Eyebrow>
          {(() => {
            const isDef = st.start === DEF_START && st.end === DEF_END && st.asof === snap.dates.length - 1;
            return (
              <Pressable disabled={isDef} accessibilityLabel="Reset window to default 12-1"
                onPress={() => setWin({ start: DEF_START, end: DEF_END, asof: snap.dates.length - 1 })}
                style={[styles.resetBtn, { borderColor: isDef ? C.line : C.accent, opacity: isDef ? 0.4 : 1 }]}>
                <Text style={{ color: isDef ? C.faint : C.accent, fontSize: 11.5, fontWeight: '800' }}>↺ 12–1</Text>
              </Pressable>
            );
          })()}
        </View>
        <Stepper C={C} label="As-of date" sub={snap.dates[st.asof]}
          value={snap.dates[st.asof].slice(5)}
          onDec={() => st.asof > st.start && setWin({ asof: st.asof - 1 })}
          onInc={() => st.asof < snap.dates.length - 1 && setWin({ asof: st.asof + 1 })} />
        <Stepper C={C} label="Start offset" sub="days ago window opens" value={String(st.start)}
          onDec={() => setWin({ start: st.start - 1 })} onInc={() => setWin({ start: st.start + 1 })} border />
        <Stepper C={C} label="End offset" sub="days ago window closes (skip)" value={String(st.end)}
          onDec={() => setWin({ end: st.end - 1 })} onInc={() => setWin({ end: st.end + 1 })} border />
        <WindowNote C={C} snap={snap} st={st} />
      </Card>

      <Card C={C}>
        <Eyebrow C={C}>Score</Eyebrow>
        <Text style={{ color: C.muted, fontSize: 12.5, marginBottom: 8 }}>Rank by</Text>
        <ModeSeg C={C} value={st.mode} onChange={setMode} />
        <ToggleRow C={C} label="Remove market influence" sub="rank on residual (market-neutral) return"
          value={st.removeMkt} onChange={(v) => { animateNext(); haptic('select'); persist({ ...st, removeMkt: v }); }} />
        {st.mode !== 'return' ? (
          <ToggleRow C={C} border label="Match return window" sub="use the return window for volatility"
            value={st.matchVol} onChange={(v) => { animateNext(); haptic('select'); persist({ ...st, matchVol: v }); }} />
        ) : null}
        {st.mode !== 'return' && !st.matchVol ? (
          <>
            <Stepper C={C} border label="Vol start offset" sub="σ window opens" value={String(st.volStart)}
              onDec={() => setVol({ volStart: st.volStart - 1 })} onInc={() => setVol({ volStart: st.volStart + 1 })} />
            <Stepper C={C} border label="Vol end offset" sub="σ window closes" value={String(st.volEnd)}
              onDec={() => setVol({ volEnd: st.volEnd - 1 })} onInc={() => setVol({ volEnd: st.volEnd + 1 })} />
          </>
        ) : null}
        <ToggleRow C={C} border label="Normalized 0–100 score" sub="rank percentile · 100 = top of the universe, 0 = bottom"
          value={st.scoreNorm} onChange={(v) => { animateNext(); haptic('select'); persist({ ...st, scoreNorm: v }); }} />
        <ScoreNote C={C} snap={snap} st={st} />
      </Card>

      <Card C={C}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Eyebrow C={C}>Second window · {winLabel(st.bStart, st.bEnd)}</Eyebrow>
          <Switch value={st.winB} onValueChange={(v) => { animateNext(); haptic('select'); persist({ ...st, winB: v }); }}
            trackColor={{ false: C.surface2, true: C.accent }} thumbColor="#fff" ios_backgroundColor={C.surface2} />
        </View>
        {st.winB ? (
          <>
            <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 6, marginBottom: 8 }}>
              Blended 50/50 with the {winLabel(st.start, st.end)} window into one ranking score.
            </Text>
            <Stepper C={C} border label="B · start offset" sub="days ago window opens" value={String(st.bStart)}
              onDec={() => setWinB({ bStart: st.bStart - 1 })} onInc={() => setWinB({ bStart: st.bStart + 1 })} />
            <Stepper C={C} border label="B · end offset" sub="days ago window closes (skip)" value={String(st.bEnd)}
              onDec={() => setWinB({ bEnd: st.bEnd - 1 })} onInc={() => setWinB({ bEnd: st.bEnd + 1 })} />
            <Text style={{ color: C.faint, fontSize: 11.5, marginTop: 8, lineHeight: 16 }}>
              Rank = average of the {winLabel(st.start, st.end)} and {winLabel(st.bStart, st.bEnd)} {st.mode}.
              Both are annualized, so the shorter and longer windows are on the same scale and combine fairly.
            </Text>
          </>
        ) : null}
      </Card>

      <View style={styles.countLine}>
        <Text style={{ color: C.muted, fontSize: 12 }}>
          <Text style={{ color: C.text, fontWeight: '700' }}>{displayed.length}</Text> ranked · {selInView} selected here{st.removeMkt && hidden ? ` · ${hidden} n/a` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setFilterOpen(true)} accessibilityLabel="Filter"
            style={[styles.miniBtn, { backgroundColor: activeFilters ? C.accentSoft : C.surface2, borderColor: activeFilters ? C.accent : C.line }]}>
            <Text style={{ color: activeFilters ? C.accent : C.muted, fontSize: 12, fontWeight: '700' }}>
              ⚑ Filter{activeFilters ? ` · ${activeFilters}` : ''}
            </Text>
          </Pressable>
          <Pressable accessibilityLabel="Flip direction"
            onPress={() => { haptic('select'); persist({ ...st, sortDir: st.sortDir === 'desc' ? 'asc' : 'desc' }); }}
            style={[styles.miniBtn, { backgroundColor: C.surface2, borderColor: C.line }]}>
            <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>
              {modeLabel}{st.removeMkt ? '·resid' : ''} {st.sortDir === 'desc' ? '↓' : '↑'}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 8 }}>
        {st.winB ? (
          <Text style={[TNUM, { color: C.muted, fontSize: 11, fontWeight: '700' }]}>
            {winLabel(st.start, st.end)} + {winLabel(st.bStart, st.bEnd)} blend
          </Text>
        ) : <View />}
        <Text style={{ color: C.faint, fontSize: 11 }}>tap ＋ to add · row opens detail</Text>
      </View>
      {st.selected.length ? (
        <Pressable onPress={() => setCueOpen(true)} accessibilityLabel="Basket cue settings"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingBottom: 8 }}>
          {st.cueOn ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.div }} />
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.red }} />
            </View>
          ) : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.faint }} />}
          <Text style={{ color: C.faint, fontSize: 11 }}>
            {st.cueOn
              ? `diversifies < ${st.divRho.toFixed(2)} · redundant ≥ ${st.redRho.toFixed(2)} ρ`
              : 'basket cue off'}
          </Text>
          <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>· adjust</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Animated.View style={{ flex: 1, opacity: pulse }}>
      <FlatList
        data={displayed}
        keyExtractor={(o) => o.t.symbol}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={{ color: C.muted, textAlign: 'center', paddingVertical: 40 }}>
          {st.removeMkt && snap.partial ? 'Loading full history for residual momentum…' : 'No matches for this filter.'}
        </Text>}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14} maxToRenderPerBatch={16} windowSize={10} removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} />}
        renderItem={({ item }) => (
          <RankCard C={C} o={item} mode={st.mode} removeMkt={st.removeMkt} selected={selSet.has(item.t.symbol)}
            corr={selSet.has(item.t.symbol) ? null : corrMap.get(item.t.symbol)}
            active={st.selected.length > 0 && st.cueOn} divRho={st.divRho} redRho={st.redRho}
            dual={{ on: st.winB }} norm={norm}
            onOpen={() => onOpen(item.t.symbol)}
            onToggle={() => persist(toggleSel(st, item.t.symbol))} />
        )} />

      <FilterSheet C={C} visible={filterOpen} onClose={() => setFilterOpen(false)}
        st={st} setFilter={setFilter} />
      <CueSheet C={C} visible={cueOpen} onClose={() => setCueOpen(false)} st={st} persist={persist} />
      <BooksSheet C={C} visible={booksOpen} onClose={() => setBooksOpen(false)} st={st} persist={persist} />
    </Animated.View>
  );
}

// Basket-correlation cue controls: on/off + the two ρ thresholds (0.05 steps).
function CueSheet({ C, visible, onClose, st, persist }) {
  const set = (patch) => { haptic('select'); persist({ ...st, ...patch }); };
  const r2 = (x) => Math.round(x * 100) / 100;
  const setDiv = (d) => set({ divRho: Math.max(0.1, Math.min(st.redRho - 0.05, r2(d))) });
  const setRed = (d) => set({ redRho: Math.max(st.divRho + 0.05, Math.min(0.95, r2(d))) });
  return (
    <Sheet C={C} visible={visible} onClose={onClose}>
      <Text style={[styles.sheetTitle, { color: C.text }]}>Basket cue</Text>
      <Text style={{ color: C.muted, fontSize: 12.5, marginBottom: 6 }}>
        As you scroll, names are compared to your basket by max daily-return correlation (latest 252d).
      </Text>
      <ToggleRow C={C} label="Show cue" sub="fade the redundant, flag the diversifiers"
        value={st.cueOn} onChange={(v) => set({ cueOn: v })} />
      {st.cueOn ? (
        <>
          <Stepper C={C} border label="Diversifies below" sub="teal dot when ρ is under this" value={st.divRho.toFixed(2)}
            onDec={() => setDiv(st.divRho - 0.05)} onInc={() => setDiv(st.divRho + 0.05)} />
          <Stepper C={C} border label="Redundant above" sub="fade + ≈ twin when ρ is over this" value={st.redRho.toFixed(2)}
            onDec={() => setRed(st.redRho - 0.05)} onInc={() => setRed(st.redRho + 0.05)} />
          <Text style={{ color: C.faint, fontSize: 11.5, marginTop: 8, lineHeight: 16 }}>
            Higher “diversifies below” lets more names qualify as diversifiers. Names between the two
            thresholds are left neutral.
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

// correlation-with-basket cue: fade redundant names, flag diversifiers.
// Thresholds are user-configurable (divRho / redRho).
function rankCue(corr, active, divRho, redRho) {
  if (!active || !corr || corr.rho == null) return { opacity: 1, kind: null };
  const rho = corr.rho;
  if (rho >= redRho) {
    const opacity = Math.max(0.42, 0.82 - ((rho - redRho) / Math.max(0.05, 0.9 - redRho)) * 0.40);
    return { opacity, kind: 'redundant', twin: corr.twin };
  }
  if (rho < divRho) return { opacity: 1, kind: 'div' };
  return { opacity: 1, kind: null };
}

// the score's display string + color under the active ranking mode
function metricStr(v, mode) {
  if (v == null || Number.isNaN(v)) return '—';
  return mode === 'return' ? E.signPct(v, 0) : mode === 'vol' ? E.pct(v, 0) : E.fmtSharpe(v);
}
const metricColor = (v, mode, C) => mode === 'vol' ? C.text : (v >= 0 ? C.gain : C.loss);

function RankCard({ C, o, mode, removeMkt, selected, corr, active, divRho, redRho, dual, norm, onOpen, onToggle }) {
  const { t, m, rank } = o;
  const cue = rankCue(corr, active, divRho, redRho);
  const vol = m.annVol != null ? E.pct(m.annVol, 0) : '—';
  const rp = (removeMkt ? 'α ' : '');   // α = residual (market-neutral) return

  // selection is the round + / ✓ checkmark button on the right (tap to add/remove,
  // with a little bounce); tapping the row body opens the stock detail. The button
  // picks up the basket cue — teal when the name diversifies, filled green once held.
  const scale = useRef(new Animated.Value(1)).current;
  const onSel = () => {
    haptic(selected ? 'light' : 'select');
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.8, duration: 70, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
    ]).start();
    onToggle();
  };

  // right column: 0–100 normalized score (if enabled), one blended score (window B
  // on), or a single score + context
  let right;
  if (norm) {
    const has = o.score != null && !Number.isNaN(o.score);
    // linear rank percentile: rank 1 → 100, last → 0
    const n100 = has ? Math.round(100 * (norm.n - o.rank) / (norm.n - 1)) : null;
    right = (
      <View style={{ alignItems: 'flex-end', minWidth: 84 }}>
        <Text style={[styles.big, { color: C.text }]}>{n100 == null ? '—' : n100}</Text>
        <Text style={[styles.metricSub, { color: C.faint }]}>{has ? `${metricStr(o.score, mode)}${dual && dual.on ? ' blend' : ''}` : '/ 100'}</Text>
      </View>
    );
  } else if (dual && dual.on) {
    right = (
      <View style={{ alignItems: 'flex-end', minWidth: 84 }}>
        <Text style={[styles.big, { color: metricColor(o.score, mode, C) }]}>{metricStr(o.score, mode)}</Text>
        <Text style={[styles.metricSub, { color: C.faint }]}>blend</Text>
      </View>
    );
  } else {
    let big, sub;
    if (mode === 'return') { big = E.signPct(m.annRet, 0); sub = `σ ${vol} · ${rp}${E.signPct(m.cum, 0)} cum`; }
    else if (mode === 'vol') { big = vol; sub = `${rp}${E.signPct(m.annRet, 0)} ann. ret`; }
    else { big = E.fmtSharpe(m.score); sub = `${rp}${E.signPct(m.annRet, 0)} · σ ${vol}`; }
    right = (
      <View style={{ alignItems: 'flex-end', minWidth: 84 }}>
        <Text style={[styles.big, { color: metricColor(mode === 'vol' ? 0 : m.annRet, mode, C) }]}>{big}</Text>
        <Text style={[styles.metricSub, { color: C.muted }]}>{sub}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: selected ? C.accentSoft : 'transparent', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }]}>
      <Pressable style={[styles.cardTap, { opacity: cue.opacity }]} onPress={onOpen} hitSlop={4}>
        <Text style={[styles.rank, { color: selected ? C.accent : C.faint }]}>{rank}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.tick, { color: C.text }]}>{t.symbol}</Text>
            {cue.kind === 'div' ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.div }} /> : null}
            {cue.kind === 'redundant' ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.red }} /> : null}
          </View>
          <Text numberOfLines={1} style={[styles.cname, { color: C.muted }]}>{t.name}</Text>
          <Text numberOfLines={1} style={[styles.csec, { color: C.faint }]}>
            {t.sector}
            {cue.kind === 'redundant' ? <Text style={{ color: C.red }}>{`  ≈ ${cue.twin}`}</Text> : null}
            {cue.kind === 'div' ? <Text style={{ color: C.div }}>  diversifies</Text> : null}
          </Text>
        </View>
        {right}
      </Pressable>
      <Pressable onPress={onSel} hitSlop={8} accessibilityRole="button"
        accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${t.symbol}${cue.kind === 'div' ? ', diversifies your basket' : cue.kind === 'redundant' ? `, correlated with ${cue.twin}` : ''}`}>
        <Animated.View style={[styles.selBtn, { transform: [{ scale }],
          backgroundColor: selected ? C.accent : cue.kind === 'div' ? C.divSoft : cue.kind === 'redundant' ? C.redSoft : C.surface2 }]}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: selected ? C.accentInk : cue.kind === 'div' ? C.div : cue.kind === 'redundant' ? C.red : C.muted, marginTop: -2 }}>
            {selected ? '✓' : '+'}
          </Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

function WindowNote({ C, snap, st }) {
  const lo = st.asof - st.start, hi = st.asof - st.end;
  let msg, warn = false;
  if (lo < 0) { warn = true; msg = `⚠︎ Not enough history: window opens ${-lo} day(s) before the earliest date. Reduce start offset or move as-of later.`; }
  else if (st.start <= st.end) { warn = true; msg = `⚠︎ Start offset must exceed end offset (${st.start} ≤ ${st.end}).`; }
  else msg = `Window ${snap.dates[lo]} → ${snap.dates[hi]} · ${hi - lo} daily returns.`;
  return <Text style={{ color: warn ? C.loss : C.faint, fontSize: 11.5, marginTop: 8, lineHeight: 16 }}>{msg}</Text>;
}

/* ---- sort / filter sheets ---- */
function Sheet({ C, visible, onClose, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.surface, borderColor: C.line }]}>
        <View style={[styles.sheetHandle, { backgroundColor: C.lineStrong }]} />
        {children}
      </View>
    </Modal>
  );
}
// 3-way equal-width segmented control (Return / Volatility / Sharpe)
function ModeSeg({ C, value, onChange }) {
  return (
    <View style={[styles.modeSeg, { backgroundColor: C.surface2, borderColor: C.line }]}>
      {MODES.map(m => {
        const on = m.key === value;
        return (
          <Pressable key={m.key} onPress={() => onChange(m.key)} accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.modeBtn, on && { backgroundColor: C.accent }]}>
            <Text style={{ color: on ? C.accentInk : C.muted, fontSize: 13.5, fontWeight: '700' }}>{m.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function ToggleRow({ C, label, sub, value, onChange, border }) {
  return (
    <View style={[styles.ctlRow, border && { borderTopColor: C.line, borderTopWidth: 1 }]}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: C.text, fontSize: 13.5 }}>{label}</Text>
        {sub ? <Text style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ false: C.surface2, true: C.accent }}
        thumbColor="#fff" ios_backgroundColor={C.surface2} />
    </View>
  );
}
// explains the current scoring formula
function ScoreNote({ C, snap, st }) {
  const vStart = st.matchVol ? st.start : st.volStart;
  const vEnd = st.matchVol ? st.end : st.volEnd;
  const bw = snap.betaWindow || 756;
  const mkt = snap.marketSymbol || 'the market';
  const noHist = st.removeMkt && st.asof < bw;
  let base;
  if (st.mode === 'return') base = `Annualized return over the return window (mean daily × 252).`;
  else if (st.mode === 'vol') base = `Annualized volatility (sample σ × √252) over the ${vStart}→${vEnd} window.`;
  else base = `Sharpe = annualized return (${st.start}→${st.end}) ÷ annualized σ (${vStart}→${vEnd}), rf = 0.`;
  const resid = st.removeMkt
    ? ` Residual momentum: α and β estimated by OLS over the trailing ${bw} days vs ${mkt}, then residuals e = r − α − β·m are taken over your window (cumulative shown is the residual). Names without ${bw}d of history are marked n/a.`
    : '';
  return (
    <View>
      <Text style={{ color: C.faint, fontSize: 11.5, marginTop: 10, lineHeight: 16 }}>{base}{resid}</Text>
      {st.removeMkt && snap.partial ? (
        <Text style={{ color: C.div, fontSize: 11.5, marginTop: 6, fontWeight: '600' }}>
          ⏳ Full history is loading — residual momentum will populate in a moment.
        </Text>
      ) : noHist ? (
        <Text style={{ color: C.loss, fontSize: 11.5, marginTop: 6, fontWeight: '600' }}>
          ⚠︎ Residual momentum needs {bw} trading days before the as-of date — move the as-of later.
        </Text>
      ) : null}
    </View>
  );
}
function FilterSheet({ C, visible, onClose, st, setFilter }) {
  const toggleExch = (ex) => {
    const set = new Set(st.exch);
    set.has(ex) ? set.delete(ex) : set.add(ex);
    setFilter({ exch: [...set] });
  };
  return (
    <Sheet C={C} visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[styles.sheetTitle, { color: C.text, marginBottom: 0 }]}>Filter</Text>
        <Pressable onPress={() => setFilter({ capBand: 'all', exch: [] })}>
          <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Reset</Text>
        </Pressable>
      </View>
      <Text style={[styles.filterLabel, { color: C.muted }]}>Market cap</Text>
      <View style={styles.chipWrap}>
        {CAP_BANDS.map(b => {
          const on = st.capBand === b.key;
          return (
            <Pressable key={b.key} onPress={() => setFilter({ capBand: b.key })}
              style={[styles.chip, { backgroundColor: on ? C.accent : C.surface2, borderColor: on ? C.accent : C.line }]}>
              <Text style={{ color: on ? C.accentInk : C.muted, fontSize: 13, fontWeight: '700' }}>{b.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.filterLabel, { color: C.muted }]}>Exchange</Text>
      <View style={styles.chipWrap}>
        {EXCHANGES.map(ex => {
          const on = st.exch.includes(ex);
          return (
            <Pressable key={ex} onPress={() => toggleExch(ex)}
              style={[styles.chip, { backgroundColor: on ? C.accent : C.surface2, borderColor: on ? C.accent : C.line }]}>
              <Text style={{ color: on ? C.accentInk : C.muted, fontSize: 13, fontWeight: '700' }}>{ex}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: C.faint, fontSize: 11.5, marginTop: 12 }}>No exchange selected = all exchanges.</Text>
    </Sheet>
  );
}

/* ====================== Portfolio ====================== */
/* ---- saved books: portfolio (HRP) or watchlist (unweighted) ---- */
function BookSwitcher({ C, st, persist, onManage }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 2 }} style={{ flex: 1 }}>
        {st.books.map(b => {
          const on = b.id === st.activeBook;
          return (
            <Pressable key={b.id} onPress={() => { if (!on) { animateNext(); haptic('select'); persist(switchBook(st, b.id)); } }}
              accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Book ${b.name}`}
              style={[styles.bookPill, { backgroundColor: on ? C.accent : C.surface2, borderColor: on ? C.accent : C.line }]}>
              <Text style={{ color: on ? C.accentInk : C.muted, fontSize: 12.5, fontWeight: '700' }}>
                {b.kind === 'watchlist' ? '☆ ' : '◆ '}{b.name}
              </Text>
              <Text style={{ color: on ? C.accentInk : C.faint, fontSize: 11, fontWeight: '800', ...TNUM }}>{b.selected.length}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => { animateNext(); haptic('select'); persist(addBook(st, 'portfolio')); }}
          accessibilityLabel="New book"
          style={[styles.bookPill, { backgroundColor: 'transparent', borderColor: C.line, borderStyle: 'dashed' }]}>
          <Text style={{ color: C.accent, fontSize: 12.5, fontWeight: '700' }}>＋ New</Text>
        </Pressable>
      </ScrollView>
      {onManage ? (
        <Pressable onPress={onManage} hitSlop={8} accessibilityLabel="Manage book"
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line }}>
          <Text style={{ color: C.muted, fontSize: 16, marginTop: -5, fontWeight: '800' }}>⋯</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BooksSheet({ C, visible, onClose, st, persist }) {
  const b = activeBookOf(st);
  const [name, setName] = useState(b.name);
  useEffect(() => { if (visible) setName(b.name); }, [visible, b.id]);
  const commitName = () => { const v = name.trim(); if (v && v !== b.name) persist(renameBook(st, b.id, v)); };
  const del = () => {
    if (st.books.length <= 1) return;
    Alert.alert('Delete book?', `Delete “${b.name}” and its ${b.selected.length} name${b.selected.length === 1 ? '' : 's'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { haptic('warn'); persist(deleteBook(st, b.id)); } },
    ]);
  };
  return (
    <Sheet C={C} visible={visible} onClose={onClose}>
      <Text style={[styles.sheetTitle, { color: C.text }]}>Books</Text>
      <BookSwitcher C={C} st={st} persist={persist} />
      <View style={{ height: 1, backgroundColor: C.line, marginBottom: 14 }} />
      <Text style={{ color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 6 }}>ACTIVE BOOK · NAME</Text>
      <TextInput value={name} onChangeText={setName} onBlur={commitName} onSubmitEditing={commitName}
        placeholder="Book name" placeholderTextColor={C.faint} maxLength={24} returnKeyType="done"
        style={{ color: C.text, fontSize: 15, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 }} />
      <Text style={{ color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 6 }}>TYPE</Text>
      <SegBar C={C} value={b.kind} onChange={(k) => { if (k !== b.kind) { haptic('select'); persist(setBookKind(st, b.id, k)); } }}
        options={[{ key: 'portfolio', label: '◆ Portfolio' }, { key: 'watchlist', label: '☆ Watchlist' }]} />
      <Text style={{ color: C.faint, fontSize: 11.5, lineHeight: 16, marginTop: 8 }}>
        Portfolio books get HRP weights, caps and the min-weight floor. Watchlist books are an unweighted tracked list — just the blended momentum score.
      </Text>
      <Pressable onPress={del} disabled={st.books.length <= 1}
        style={{ alignSelf: 'flex-start', marginTop: 18, opacity: st.books.length <= 1 ? 0.4 : 1, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: C.lossSoft, borderWidth: 1, borderColor: C.loss }}>
        <Text style={{ color: C.loss, fontSize: 12.5, fontWeight: '700' }}>Delete book</Text>
      </Pressable>
    </Sheet>
  );
}

// watchlist rows: holdings scored by the same blended momentum as the screener
function watchlistRows(snap, BYSYM, market, st) {
  const bw = snap.betaWindow || 756;
  const c = cfgOf(st, bw), cB = cfgOfB(st, bw);
  const rows = [];
  for (const s of st.selected) {
    const t = BYSYM[s]; if (!t) continue;
    const r = E.momentumScore(t.closes, market, st.asof, c);
    const rB = st.winB ? E.momentumScore(t.closes, market, st.asof, cB) : null;
    const okB = rB && rB.score != null && !Number.isNaN(rB.score);
    const score = r && r.score != null && !Number.isNaN(r.score)
      ? (st.winB && okB ? (r.score + rB.score) / 2 : r.score) : null;
    rows.push({ s, t, m: r, score });
  }
  rows.sort((a, b) => (b.score ?? -1e18) - (a.score ?? -1e18));
  return rows;
}

function WatchlistBody({ C, snap, BYSYM, market, st, persist, onOpen }) {
  const rows = useMemo(() => watchlistRows(snap, BYSYM, market, st),
    [snap, BYSYM, market, st.selected, st.asof, st.start, st.end, st.winB, st.bStart, st.bEnd, st.mode, st.removeMkt, st.matchVol, st.volStart, st.volEnd]);
  const colorFor = useMemo(() => makeColorFor(), [snap]);
  if (!rows.length) return <Empty C={C} watch />;
  const clear = () => Alert.alert('Clear watchlist?', `Remove all ${rows.length} name${rows.length === 1 ? '' : 's'}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => { haptic('warn'); persist({ ...st, selected: [] }); } },
  ]);
  return (
    <>
      <View style={styles.statRow}>
        <Stat C={C} v={String(rows.length)} l="Names" />
        <Stat C={C} v={String(new Set(rows.map(r => r.t.sector)).size)} l="Sectors" />
      </View>
      <Card C={C} pad={false}>
        {rows.map((r, idx) => (
          <View key={r.s} style={[styles.wrow, { borderTopColor: C.line, borderTopWidth: idx ? 1 : 0 }]}>
            <Text style={[styles.rank, { color: C.faint }]}>{idx + 1}</Text>
            <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => onOpen(r.s)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={[styles.sw, { backgroundColor: colorFor(r.t.sector) }]} />
                <Text style={{ color: C.text, fontWeight: '700', fontSize: 14.5 }}>{r.t.symbol}</Text>
              </View>
              <Text numberOfLines={1} style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>{r.t.name}</Text>
            </Pressable>
            <Text style={[styles.big, { color: r.score == null ? C.faint : metricColor(st.mode === 'vol' ? 0 : (r.m ? r.m.annRet : 0), st.mode, C), marginRight: 8 }]}>
              {metricStr(r.score, st.mode)}
            </Text>
            <Pressable onPress={() => persist(toggleSel(st, r.s))} hitSlop={8}
              style={[styles.removeBtn, { backgroundColor: C.surface2, borderColor: C.line }]}>
              <Text style={{ color: C.muted, fontSize: 16, marginTop: -2 }}>×</Text>
            </Pressable>
          </View>
        ))}
      </Card>
      <Pressable onPress={clear} accessibilityLabel="Clear watchlist"
        style={{ alignSelf: 'center', marginTop: 18, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 22, backgroundColor: C.lossSoft, borderWidth: 1, borderColor: C.loss }}>
        <Text style={{ color: C.loss, fontSize: 13, fontWeight: '700' }}>✕ Clear watchlist · {rows.length}</Text>
      </Pressable>
    </>
  );
}

// compare HRP vs equal / inverse-vol / min-variance for the same basket, pick the
// active one. Each row shows the scheme's annualized vol, effective bets, and top
// weight — all on the post-caps weights, so it's what you'd actually hold.
function WeightingCard({ C, compare, active, onPick }) {
  const bestVol = Math.min(...compare.map(c => c.vol));
  const bestBets = Math.max(...compare.map(c => c.effBets));
  return (
    <Card C={C}>
      <Eyebrow C={C}>Weighting</Eyebrow>
      <View style={{ flexDirection: 'row', paddingHorizontal: 4, marginTop: 2, marginBottom: 2 }}>
        <Text style={{ flex: 1, color: C.faint, fontSize: 10.5, fontWeight: '700' }}>SCHEME</Text>
        <Text style={{ width: 70, textAlign: 'right', color: C.faint, fontSize: 10.5, fontWeight: '700' }}>ANN VOL</Text>
        <Text style={{ width: 62, textAlign: 'right', color: C.faint, fontSize: 10.5, fontWeight: '700' }}>EFF BETS</Text>
        <Text style={{ width: 52, textAlign: 'right', color: C.faint, fontSize: 10.5, fontWeight: '700' }}>TOP W</Text>
      </View>
      {compare.map(c => {
        const on = c.key === active;
        return (
          <Pressable key={c.key} onPress={() => onPick(c.key)} accessibilityRole="button"
            accessibilityState={{ selected: on }} accessibilityLabel={`Weight by ${c.label}`}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, marginTop: 4, backgroundColor: on ? C.accentSoft : C.surface2, borderWidth: 1, borderColor: on ? C.accent : C.line }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <View style={{ width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: on ? C.accent : C.faint, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent }} /> : null}
              </View>
              <Text numberOfLines={1} style={{ color: on ? C.text : C.muted, fontSize: 13.5, fontWeight: '700' }}>{c.label}</Text>
            </View>
            <Text style={[TNUM, { width: 70, textAlign: 'right', fontSize: 13, fontWeight: '700', color: c.vol <= bestVol + 1e-9 ? C.gain : C.text }]}>{E.pct(c.vol, 1)}</Text>
            <Text style={[TNUM, { width: 62, textAlign: 'right', fontSize: 13, fontWeight: '700', color: c.effBets >= bestBets - 1e-9 ? C.gain : C.text }]}>{c.effBets.toFixed(2)}</Text>
            <Text style={[TNUM, { width: 52, textAlign: 'right', fontSize: 13, color: C.muted }]}>{E.pct(c.maxW, 0)}</Text>
          </Pressable>
        );
      })}
      <Text style={{ color: C.faint, fontSize: 11, lineHeight: 15, marginTop: 8 }}>
        Lower vol and more effective bets (green) are better; top weight shows concentration. All figures use the latest 252d, after your caps and floor. Tap to weight the book by that scheme.
      </Text>
    </Card>
  );
}

function Portfolio({ C, snap, market, st, persist, onOpen, refreshing, onRefresh }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);
  const activeKind = activeBookOf(st).kind;
  const BYSYM = useMemo(() => Object.fromEntries(snap.tickers.map(t => [t.symbol, t])), [snap]);
  const pf = useMemo(() => computePortfolio(snap, BYSYM, st), [snap, st.selected, st.asof, st.maxStock, st.maxSector, st.minStock, st.weightScheme]);
  const guide = useMemo(() => portfolioGuidance(snap, BYSYM, st, market, pf),
    [snap, market, pf, st.asof, st.universe, st.mode, st.removeMkt, st.start, st.end, st.sortDir, st.matchVol, st.volStart, st.volEnd]);
  const colorFor = useMemo(() => makeColorFor(), [snap]);

  const setCap = (key, d) => {
    const step = key === 'minStock' ? 0.005 : 0.05;         // min weight scales by 0.5%
    const onDefault = key === 'maxStock' ? 0.25 : key === 'maxSector' ? 0.40 : 0.005;
    let v = st[key] || 0;
    if (v === 0 && d > 0) v = onDefault;
    else v = Math.round((v + d * step) * 1000) / 1000;
    if (v < step) v = 0;                                     // step below the smallest → Off
    if (v > 1) v = 1;
    haptic('select');
    persist({ ...st, [key]: v });
  };
  const clearBasket = () => {
    Alert.alert('Clear basket?', `Remove all ${pf.syms.length} holding${pf.syms.length === 1 ? '' : 's'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { haptic('warn'); persist({ ...st, selected: [] }); } },
    ]);
  };

  const total = pf.weights.reduce((a, b) => a + b, 0);
  const sectorTot = {};
  pf.syms.forEach((s, i) => { const sec = BYSYM[s].sector; sectorTot[sec] = (sectorTot[sec] || 0) + pf.weights[i]; });
  const secEntries = Object.entries(sectorTot).sort((a, b) => b[1] - a[1]);
  const rows = pf.syms.map((s, i) => ({ s, w: pf.weights[i] })).sort((a, b) => b.w - a.w);
  const maxW = Math.max(...rows.map(r => r.w), 0.0001);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} />}>
      <AppHeader C={C} snap={snap} />
      <BookSwitcher C={C} st={st} persist={persist} onManage={() => setBooksOpen(true)} />
      {activeKind === 'watchlist' ? (
        <WatchlistBody C={C} snap={snap} BYSYM={BYSYM} market={market} st={st} persist={persist} onOpen={onOpen} />
      ) : (
      <>
      <View style={styles.statRow}>
        <Stat C={C} v={String(pf.syms.length)} l="Holdings" />
        <Stat C={C} v={pf.syms.length ? (total * 100).toFixed(total > 0.9999 && total < 1.0001 ? 0 : 1) + '%' : '0%'} l="Allocated" />
        <Stat C={C} v={String(new Set(pf.syms.map(s => BYSYM[s].sector)).size)} l="Sectors" />
      </View>
      <Card C={C}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Eyebrow C={C}>Constraints</Eyebrow>
          <InfoDot C={C} onPress={() => setInfoOpen(true)} />
        </View>
        <Stepper C={C} label="Max stock weight" sub="per-name cap"
          value={st.maxStock ? E.pct(st.maxStock) : 'Off'}
          onDec={() => setCap('maxStock', -1)} onInc={() => setCap('maxStock', 1)} />
        <Stepper C={C} label="Max sector weight" sub="per-sector cap" border
          value={st.maxSector ? E.pct(st.maxSector) : 'Off'}
          onDec={() => setCap('maxSector', -1)} onInc={() => setCap('maxSector', 1)} />
        <Stepper C={C} label="Min stock weight" sub="per-name floor · 0.5% steps" border
          value={st.minStock ? E.pct(st.minStock, 1) : 'Off'}
          onDec={() => setCap('minStock', -1)} onInc={() => setCap('minStock', 1)} />
      </Card>

      {pf.syms.length === 0 ? (
        <Empty C={C} />
      ) : (
        <>
          {pf.compare ? <WeightingCard C={C} compare={pf.compare} active={pf.scheme}
            onPick={(k) => { if (k !== st.weightScheme) { animateNext(); haptic('select'); persist({ ...st, weightScheme: k }); } }} /> : null}
          {!pf.feasible ? (
            <View style={[styles.warn, { backgroundColor: C.lossSoft, borderColor: C.loss }]}>
              <Text style={{ color: C.loss, fontWeight: '600', fontSize: 13, lineHeight: 18 }}>⚠︎ {pf.msg}</Text>
            </View>
          ) : (st.maxStock || st.maxSector) ? (
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: C.gain, backgroundColor: C.gainSoft, fontSize: 11.5, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, overflow: 'hidden' }}>
                ✓ Constraints satisfied · weights total 100%
              </Text>
            </View>
          ) : null}

          {guide ? <GuidanceCard C={C} guide={guide} holdings={pf.syms.length} BYSYM={BYSYM}
            onOpen={onOpen} onAdd={(s) => persist(toggleSel(st, s))} onInfo={() => setInfoOpen(true)} /> : null}

          <Card C={C}>
            <Eyebrow C={C}>Sector allocation</Eyebrow>
            <View style={[styles.sectorBar, { borderColor: C.line }]}>
              {secEntries.map(([sec, wt]) => (
                <View key={sec} style={{ width: `${wt * 100}%`, backgroundColor: colorFor(sec) }} />
              ))}
            </View>
            <View style={styles.legend}>
              {secEntries.map(([sec, wt]) => (
                <View key={sec} style={styles.legendItem}>
                  <View style={[styles.sw, { backgroundColor: colorFor(sec) }]} />
                  <Text style={{ color: C.muted, fontSize: 11.5 }}>{sec} {E.pct(wt, 1)}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Card C={C} pad={false}>
            {rows.map((r, idx) => {
              const t = BYSYM[r.s];
              return (
                <View key={r.s} style={[styles.wrow, { borderTopColor: C.line, borderTopWidth: idx ? 1 : 0 }]}>
                  <Text style={[styles.wt, { color: C.text }]}>{E.pct(r.w, r.w < 0.1 ? 1 : 0)}</Text>
                  <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => onOpen(r.s)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <View style={[styles.sw, { backgroundColor: colorFor(t.sector) }]} />
                      <Text style={{ color: C.text, fontWeight: '700', fontSize: 14.5 }}>{t.symbol}</Text>
                      <Text style={{ color: C.faint, fontSize: 12 }}>{t.sector}</Text>
                    </View>
                    <AnimatedBar C={C} frac={r.w / maxW} />
                  </Pressable>
                  <Pressable onPress={() => persist(toggleSel(st, r.s))} hitSlop={8}
                    style={[styles.removeBtn, { backgroundColor: C.surface2, borderColor: C.line }]}>
                    <Text style={{ color: C.muted, fontSize: 16, marginTop: -2 }}>×</Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>

          <Pressable onPress={clearBasket} accessibilityLabel="Clear basket"
            style={{ alignSelf: 'center', marginTop: 18, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 22, backgroundColor: C.lossSoft, borderWidth: 1, borderColor: C.loss }}>
            <Text style={{ color: C.loss, fontSize: 13, fontWeight: '700' }}>✕ Clear basket · {pf.syms.length}</Text>
          </Pressable>
        </>
      )}
      </>
      )}
      <PortfolioInfoSheet C={C} visible={infoOpen} onClose={() => setInfoOpen(false)} snap={snap} />
      <BooksSheet C={C} visible={booksOpen} onClose={() => setBooksOpen(false)} st={st} persist={persist} />
    </ScrollView>
  );
}

// small tappable ⓘ that opens an explanation sheet
function InfoDot({ C, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel="What is this?"
      style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.3, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.faint, fontSize: 13, fontWeight: '800', fontStyle: 'italic', marginTop: -1 }}>i</Text>
    </Pressable>
  );
}

function PortfolioInfoSheet({ C, visible, onClose, snap }) {
  const bw = snap.betaWindow || 756;
  return (
    <Sheet C={C} visible={visible} onClose={onClose}>
      <Text style={[styles.sheetTitle, { color: C.text }]}>How the portfolio works</Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        Weights come from your chosen scheme in the <Text style={{ color: C.text, fontWeight: '700' }}>Weighting</Text> card —
        long-only <Text style={{ color: C.text, fontWeight: '700' }}>Hierarchical Risk Parity</Text> by default, or equal /
        inverse-vol / long-only minimum-variance — on the latest 252 trading days (as-of), independent of the ranking skip
        window. Weights are redistributed to honor the per-name caps, the sector cap and the minimum-weight floor, and total
        exactly 100%.
      </Text>
      <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>Effective bets</Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        A correlation-adjusted count of your <Text style={{ color: C.text }}>independent</Text> positions: 1 ÷ (wʹRw), using
        the weights and the return-correlation matrix. Names that move together count as fewer bets — for a single equal-corr
        basket it reduces to N ÷ (1 + (N−1)·ρ̄). Adding a diversifier lifts it; adding a look-alike barely moves it.
      </Text>
      <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>How many names?</Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19 }}>
        There's no magic number: ~20–30 names capture most of the diversifiable-risk reduction at typical equity correlations,
        and beyond that a momentum basket mostly dilutes its signal toward the index. Watch <Text style={{ color: C.text }}>effective
        bets</Text> instead of the raw count — when adding names stops lifting it, you're adding redundancy, not diversification.
      </Text>
    </Sheet>
  );
}

// Effective bets + a suggested add (strong + diversifying) and a trim candidate
function GuidanceCard({ C, guide, holdings, BYSYM, onOpen, onAdd, onInfo }) {
  const { effBets, add, trim, n } = guide;
  const frac = effBets != null && n ? Math.max(0, Math.min(1, effBets / n)) : 0;
  return (
    <Card C={C}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Eyebrow C={C}>Guidance</Eyebrow>
        <InfoDot C={C} onPress={onInfo} />
      </View>
      {effBets != null ? (
        <View style={{ marginTop: 4, marginBottom: add || trim ? 12 : 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={[TNUM, { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }]}>{effBets.toFixed(1)}</Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>effective bets · {holdings} holdings</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.surface2, marginTop: 8, overflow: 'hidden' }}>
            <View style={{ width: `${frac * 100}%`, height: '100%', borderRadius: 3, backgroundColor: C.div }} />
          </View>
          <Text style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>correlation-adjusted independent positions</Text>
        </View>
      ) : null}
      {add ? (
        <GuidanceRow C={C} tone="add" label="Add" sym={add.sym} name={BYSYM[add.sym] ? BYSYM[add.sym].name : ''}
          note={`diversifies · ρ ${add.rho.toFixed(2)}`} onOpen={() => onOpen(add.sym)}
          action="+" onAction={() => onAdd(add.sym)} border={effBets != null} />
      ) : null}
      {trim ? (
        <GuidanceRow C={C} tone="trim" label="Trim" sym={trim.sym} name={BYSYM[trim.sym] ? BYSYM[trim.sym].name : ''}
          note={`≈ ${trim.twin} · ρ ${trim.rho.toFixed(2)} · weaker`} onOpen={() => onOpen(trim.sym)}
          action="×" onAction={() => onAdd(trim.sym)} border />
      ) : null}
    </Card>
  );
}

function GuidanceRow({ C, tone, label, sym, name, note, onOpen, action, onAction, border }) {
  const accent = tone === 'add' ? C.div : C.loss;
  const soft = tone === 'add' ? C.divSoft : C.lossSoft;
  return (
    <View style={[styles.ctlRow, border && { borderTopColor: C.line, borderTopWidth: 1 }]}>
      <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }} onPress={onOpen}>
        <Text style={{ color: accent, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', width: 34 }}>{label}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{sym}</Text>
          <Text numberOfLines={1} style={[TNUM, { color: C.faint, fontSize: 11.5, marginTop: 1 }]}>{note}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onAction} hitSlop={8} accessibilityLabel={`${label} ${sym}`}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: soft, borderWidth: 1, borderColor: accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: accent, fontSize: 20, fontWeight: '700', marginTop: -2 }}>{action}</Text>
      </Pressable>
    </View>
  );
}

function AnimatedBar({ C, frac }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: Math.max(0, Math.min(1, frac)), duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [frac]);
  const width = a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={[styles.bar, { backgroundColor: C.surface2 }]}>
      <Animated.View style={{ width, height: '100%', borderRadius: 4, backgroundColor: C.accent }} />
    </View>
  );
}

function computePortfolio(snap, BYSYM, st) {
  const TD = 252;
  const syms = st.selected.filter(s => BYSYM[s]);
  if (syms.length === 0) return { syms: [], weights: [], feasible: true };
  if (syms.length === 1) return { syms, weights: [1], feasible: true };
  const cols = syms.map(s => {
    const c = BYSYM[s].closes; const hi = st.asof; const lo = Math.max(0, hi - TD);
    return c.slice(lo, hi + 1);
  });
  const minLen = Math.min(...cols.map(c => c.length));
  const R = [];
  for (let t = 1; t < minLen; t++) {
    R.push(syms.map((_, j) => { const c = cols[j]; const off = c.length - minLen; return c[off + t] / c[off + t - 1] - 1; }));
  }
  const sectors = syms.map(s => BYSYM[s].sector);
  // all four weighting schemes on the same basket, each run through the caps/floor.
  // Stats (annualized vol, effective bets, top weight) are computed on the capped
  // weights so the compare reflects what you'd actually hold.
  const cov = E.covMatrix(R), corr = E.corrFromCov(cov);
  const rawOf = { hrp: E.hrpWeights(R), equal: E.equalWeights(R), invvol: E.inverseVolWeights(R), minvar: E.minVarWeights(R) };
  const stats = (wv) => {
    let varD = 0, q = 0;
    for (let i = 0; i < wv.length; i++) for (let j = 0; j < wv.length; j++) {
      varD += wv[i] * wv[j] * cov[i][j];
      q += wv[i] * wv[j] * (i === j ? 1 : corr[i][j]);
    }
    return { vol: Math.sqrt(Math.max(0, varD) * TD), effBets: q > 0 ? 1 / q : wv.length, maxW: Math.max(...wv) };
  };
  const compare = SCHEMES.map(sc => {
    const cap = E.applyCaps(rawOf[sc.key], sectors, st.maxStock, st.maxSector, st.minStock);
    return { key: sc.key, label: sc.label, weights: cap.w, feasible: cap.feasible, msg: cap.msg, ...stats(cap.w) };
  });
  const active = compare.find(c => c.key === st.weightScheme) || compare[0];
  return { syms, weights: active.weights, feasible: active.feasible, msg: active.msg, sectors, compare, scheme: active.key };
}

// Selection guidance from data we already compute: a correlation-adjusted
// "effective bets" count (1/wʹRw), plus a suggested add (a strong momentum name
// that diversifies the basket) and a trim candidate (the weaker half of the most
// redundant pair). Correlations over the latest 252d ending at as-of.
function portfolioGuidance(snap, BYSYM, st, market, pf) {
  const syms = pf.syms;
  if (!syms || syms.length < 2) return null;
  const hi = st.asof, lo = Math.max(0, hi - 252);
  if (hi - lo < 20) return null;
  const dir = st.sortDir === 'asc' ? -1 : 1;           // higher goodness = better rank
  const cfg = cfgOf(st, snap.betaWindow || 756);
  const scoreCache = {};
  const scoreOf = (sym) => {
    if (sym in scoreCache) return scoreCache[sym];
    const r = E.momentumScore(BYSYM[sym].closes, market, st.asof, cfg);
    const s = r && r.score != null && !Number.isNaN(r.score) ? r.score : null;
    return (scoreCache[sym] = s);
  };
  const good = (sym) => { const s = scoreOf(sym); return s == null ? null : dir * s; };

  // demeaned return vectors for the basket
  const vec = syms.map(s => demeanedReturns(BYSYM[s].closes, lo, hi));
  const idx = []; for (let i = 0; i < syms.length; i++) if (vec[i]) idx.push(i);
  const corr = (a, b) => {
    const va = vec[a].d, vb = vec[b].d; let dot = 0;
    for (let k = 0; k < va.length; k++) dot += va[k] * vb[k];
    return dot / Math.sqrt(vec[a].ss * vec[b].ss);
  };

  // effective bets = 1 / (wʹRw), weights renormalized over names with a vector
  let effBets = null;
  if (idx.length >= 2) {
    let wsum = 0; for (const i of idx) wsum += pf.weights[i];
    const w = idx.map(i => pf.weights[i] / (wsum || 1));
    let q = 0;
    for (let a = 0; a < idx.length; a++)
      for (let b = 0; b < idx.length; b++)
        q += w[a] * w[b] * (a === b ? 1 : corr(idx[a], idx[b]));
    effBets = q > 0 ? 1 / q : idx.length;
  }

  // trim: the weaker-scoring half of the most correlated held pair (if genuinely redundant)
  let trim = null, hi2 = 0.6;
  for (let a = 0; a < idx.length; a++)
    for (let b = a + 1; b < idx.length; b++) {
      const c = corr(idx[a], idx[b]);
      if (c > hi2) {
        hi2 = c;
        const sa = syms[idx[a]], sb = syms[idx[b]];
        const ga = good(sa), gb = good(sb);
        const weaker = (gb == null || (ga != null && ga <= gb)) ? sa : sb;
        trim = { sym: weaker, twin: weaker === sa ? sb : sa, rho: c };
      }
    }

  // suggested add: among the top-ranked unselected names, the one that diversifies most
  const sel = new Set(st.selected);
  const scored = [];
  for (const t of snap.tickers) {
    if (sel.has(t.symbol) || !t.universes.includes(st.universe)) continue;
    const g = good(t.symbol);
    if (g != null) scored.push({ sym: t.symbol, g });
  }
  scored.sort((x, y) => y.g - x.g);
  let add = null, lowRho = 2;
  for (const cand of scored.slice(0, 40)) {
    const v = demeanedReturns(BYSYM[cand.sym].closes, lo, hi);
    if (!v) continue;
    let mx = -2, twin = null;
    for (const i of idx) {
      const va = vec[i].d, vb = v.d; let dot = 0;
      for (let k = 0; k < va.length; k++) dot += va[k] * vb[k];
      const c = dot / Math.sqrt(vec[i].ss * v.ss);
      if (c > mx) { mx = c; twin = syms[i]; }
    }
    if (mx < lowRho) { lowRho = mx; add = { sym: cand.sym, score: scoreOf(cand.sym), rho: mx, twin }; }
  }
  return { effBets, trim, add, n: idx.length };
}

/* ====================== Ticker detail ====================== */
function Detail({ C, snap, market, st, sym, onClose, onToggle, onOpen, onSector }) {
  const t = snap.tickers.find(x => x.symbol === sym);
  const insets = useSafeAreaInsets();
  const peers = useMemo(() =>
    t ? topCorrelated(t, snap.tickers, st.asof, 3) : [],
    [snap, t, st.asof]);
  if (!t) return null;
  const inPf = st.selected.includes(sym);
  // sector tag jumps to that sector's universe if one exists
  const sectorUni = Object.entries(snap.universes).find(([, u]) => u.label === t.sector);
  const m = E.momentumScore(t.closes, market, st.asof, cfgOf(st, snap.betaWindow));
  const asofDate = snap.dates[st.asof];
  const scoreLabel = st.removeMkt
    ? (st.mode === 'vol' ? 'Idio. vol' : st.mode === 'return' ? 'Resid ret.' : 'Resid Sharpe')
    : (st.mode === 'return' ? 'Ann. return' : st.mode === 'vol' ? 'Volatility' : 'Sharpe');
  const scoreShow = m == null ? 'n/a' : (st.mode === 'sharpe' ? E.fmtSharpe(m.score) : st.mode === 'vol' ? E.pct(m.annVol, 0) : E.signPct(m.annRet, 0));
  const scoreColor = m == null ? C.faint : (st.mode === 'vol' ? C.text : ((st.mode === 'sharpe' ? m.score : m.annRet) >= 0 ? C.gain : C.loss));
  const retLabel = st.removeMkt ? 'Resid cum' : 'Window ret.';

  return (
    <View style={{ flex: 1, backgroundColor: C.ground, paddingTop: insets.top }}>
      <View style={[styles.dback, { borderBottomColor: C.line }]}>
        <Pressable onPress={() => { haptic('light'); onClose(); }} hitSlop={10}>
          <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>‹ Back</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
        <View style={{ padding: 18, paddingBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TickerLogo C={C} symbol={t.symbol} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 }}>{t.symbol}</Text>
              <Text numberOfLines={1} style={{ color: C.muted, fontSize: 15, marginTop: 1 }}>{t.name}</Text>
            </View>
          </View>
          <View style={styles.tags}>
            {sectorUni ? (
              <Pressable onPress={() => { haptic('select'); onSector(sectorUni[0]); }} accessibilityLabel={`See ${t.sector} names`}>
                <Text style={[styles.tag, { backgroundColor: C.accentSoft, borderColor: C.accent, color: C.accent }]}>{t.sector} ›</Text>
              </Pressable>
            ) : (
              <Text style={[styles.tag, { backgroundColor: C.surface2, borderColor: C.line, color: C.muted }]}>{t.sector}</Text>
            )}
            {[t.industry, t.exchange, E.fmtCap(t.marketCap)].map((x, i) => (
              <Text key={i} style={[styles.tag, { backgroundColor: C.surface2, borderColor: C.line, color: C.muted }]}>{x}</Text>
            ))}
          </View>
        </View>

        <View style={styles.dstat}>
          <Stat C={C} v={scoreShow} l={scoreLabel} color={scoreColor} />
          <Stat C={C} v={m ? E.signPct(m.cum, 0) : 'n/a'} l={retLabel} color={m ? (m.cum >= 0 ? C.gain : C.loss) : C.faint} />
          <Stat C={C} v={m && m.annVol != null ? E.pct(m.annVol, 0) : 'n/a'} l={st.removeMkt ? 'Idio. vol' : 'Ann. vol'} />
        </View>
        {st.removeMkt ? (
          <View style={{ marginHorizontal: 16, marginTop: -6, marginBottom: 12 }}>
            <Text style={{ color: C.faint, fontSize: 11.5 }}>
              {m ? `β ${m.beta.toFixed(2)} · α ${E.signPct(m.alpha * 252, 1)}/yr  ·  vs ${snap.marketSymbol || 'market'}, ${snap.betaWindow || 756}d OLS` : `Residual n/a — needs ${snap.betaWindow || 756}d of history before this as-of date.`}
            </Text>
          </View>
        ) : null}

        <View style={{ marginHorizontal: 16, marginBottom: 14 }}>
          <ScrubChart C={C} snap={snap} ticker={t} st={st} />
        </View>

        <View style={{ marginHorizontal: 16 }}>
        <Card C={C} pad={false}>
          <Text style={{ color: C.faint, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', padding: 16, paddingBottom: 6 }}>
            Performance · adjusted close · as of {asofDate}
          </Text>
          {PERIODS.map(([lab, d], i) => {
            const r = E.periodReturn(t.closes, st.asof, d);
            return (
              <View key={lab} style={[styles.perfRow, { borderTopColor: C.line, borderTopWidth: i ? 1 : 0 }]}>
                <Text style={{ color: C.muted, fontSize: 16, fontWeight: '600' }}>{lab}</Text>
                <Text style={[TNUM, { color: r == null ? C.faint : (r >= 0 ? C.gain : C.loss), fontSize: 23, fontWeight: '800', letterSpacing: -0.5 }]}>
                  {r == null ? '—' : E.signPct(r, 2)}
                </Text>
              </View>
            );
          })}
        </Card>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
          <Pressable
            onPress={() => onToggle(sym)}
            style={[styles.cta, { backgroundColor: inPf ? C.surface2 : C.accent, borderColor: inPf ? C.lineStrong : C.accent }]}>
            <Text style={{ color: inPf ? C.text : C.accentInk, fontSize: 16, fontWeight: '700' }}>
              {inPf ? '✓ In portfolio — tap to remove' : '+ Add to portfolio'}
            </Text>
          </Pressable>
        </View>

        {peers.length ? (
          <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
            <Card C={C} pad={false}>
              <Text style={{ color: C.faint, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', padding: 16, paddingBottom: 8 }}>
                Most correlated · latest 252d
              </Text>
              {peers.map((pr, i) => (
                <Pressable key={pr.t.symbol} onPress={() => { haptic('light'); onOpen(pr.t.symbol); }}
                  style={[styles.peerRow, { borderTopColor: C.line, borderTopWidth: i ? 1 : 0 }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: C.text, fontSize: 15.5, fontWeight: '700' }}>{pr.t.symbol}
                      <Text style={{ color: C.faint, fontSize: 12, fontWeight: '500' }}>  {pr.t.sector}</Text>
                    </Text>
                    <Text numberOfLines={1} style={{ color: C.muted, fontSize: 12, marginTop: 1 }}>{pr.t.name}</Text>
                  </View>
                  <Text style={{ color: C.accent, fontSize: 17, fontWeight: '800', marginLeft: 10 }}>ρ {pr.rho.toFixed(2)}</Text>
                  <Text style={{ color: C.faint, fontSize: 18, marginLeft: 8 }}>›</Text>
                </Pressable>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/* ---- interactive, scrubbable price chart with the ranking window shaded ---- */
function ScrubChart({ C, snap, ticker, st }) {
  const [w, setW] = useState(0);
  const [idx, setIdx] = useState(null);
  const H = 210, padX = 6, padTop = 12, padBot = 16;

  const end = st.asof;
  const start0 = ticker.histStart || 0;   // skip leading nulls (pre-listing)
  const series = ticker.closes.slice(start0, end + 1);
  const dates = snap.dates.slice(start0, end + 1);
  const n = series.length;
  const winLo = Math.max(0, Math.min(n - 1, (st.asof - st.start) - start0));
  const winHi = Math.max(0, Math.min(n - 1, (st.asof - st.end) - start0));

  const lo = Math.min(...series), hi = Math.max(...series), rng = (hi - lo) || 1;
  const X = (i) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (w - 2 * padX));
  const Y = (v) => padTop + (1 - (v - lo) / rng) * (H - padTop - padBot);

  const active = idx == null ? n - 1 : idx;
  const base = series[winLo] || series[0];
  const price = series[active];
  const chg = price / base - 1;
  const up = series[n - 1] >= (series[0] || series[n - 1]);
  const col = up ? C.gain : C.loss;

  const onTouch = (e) => {
    if (!w) return;
    const x = e.nativeEvent.locationX;
    let i = Math.round(((x - padX) / (w - 2 * padX)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    if (i !== idx) { setIdx(i); haptic('light'); }
  };

  let line = '', area = '';
  if (w > 0 && n > 1) {
    line = `M ${X(0)} ${Y(series[0])}`;
    for (let i = 1; i < n; i++) line += ` L ${X(i)} ${Y(series[i])}`;
    area = line + ` L ${X(n - 1)} ${H - padBot} L ${X(0)} ${H - padBot} Z`;
  }

  return (
    <View style={[styles.cardPanel, { backgroundColor: C.surface, padding: 16 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
        <View>
          <Text style={{ color: C.faint, fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
            {idx == null ? 'Adjusted close · as-of' : dates[active]}
          </Text>
          <Text style={[TNUM, { color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }]}>
            ${price != null ? price.toFixed(2) : '—'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[TNUM, { color: chg >= 0 ? C.gain : C.loss, fontSize: 17, fontWeight: '800' }]}>{E.signPct(chg, 1)}</Text>
          <Text style={{ color: C.faint, fontSize: 10.5 }}>vs window open</Text>
        </View>
      </View>

      <View onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch} onResponderMove={onTouch} onResponderRelease={() => setIdx(null)}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={col} stopOpacity="0.26" />
                <Stop offset="1" stopColor={col} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {winHi > winLo ? (
              <Rect x={X(winLo)} y={padTop - 4} width={Math.max(1, X(winHi) - X(winLo))} height={H - padTop - padBot + 8}
                fill={C.accentSoft} stroke={C.accent} strokeOpacity="0.35" strokeWidth="1" rx="3" />
            ) : null}
            {winHi > winLo ? (
              <SvgText x={X(winLo) + 2} y={H - 3} fontSize="9" fontWeight="600" fill={C.accent} textAnchor="start">{shortDate(dates[winLo])}</SvgText>
            ) : null}
            {winHi > winLo ? (
              <SvgText x={X(winHi) - 2} y={H - 3} fontSize="9" fontWeight="600" fill={C.accent} textAnchor="end">{shortDate(dates[winHi])}</SvgText>
            ) : null}
            <Path d={area} fill="url(#cg)" />
            <Path d={line} stroke={col} strokeWidth="2.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {idx != null ? (
              <Line x1={X(active)} y1={padTop - 4} x2={X(active)} y2={H - padBot} stroke={C.text} strokeOpacity="0.4" strokeWidth="1" />
            ) : null}
            {idx != null ? (
              <Circle cx={X(active)} cy={Y(price)} r="4.5" fill={col} stroke={C.surface} strokeWidth="2" />
            ) : null}
          </Svg>
        ) : <View style={{ height: H }} />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <View style={{ width: 12, height: 8, borderRadius: 2, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accent }} />
        <Text style={{ color: C.faint, fontSize: 11 }}>Shaded = ranking window · touch & drag to inspect</Text>
      </View>
    </View>
  );
}

/* ====================== Macro dashboard ====================== */
// Exponential moving average, seeded with the SMA of the first `period` points.
// Returns an array aligned to `vals` (null until the average is warm).
function emaSeries(vals, period) {
  const out = new Array(vals.length).fill(null);
  if (!vals || period < 2 || vals.length < period) return out;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += vals[i];
  let prev = sma / period;
  out[period - 1] = prev;
  for (let i = period; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

// Slice a macro symbol's stored series to the chosen timeframe. Daily timeframes
// carry the full daily closes (fullC) + offset (from) so EMAs stay warm at the
// left edge; the 1D view is the latest intraday session, based off prior close.
function macroView(ser, tf) {
  if (tf === '1D') {
    const it = ser.intraday, t = (it && it.t) || [], n = t.length;
    if (!n) return { isIntraday: true, from: 0, fullC: null, labels: [], o: [], h: [], l: [], c: [], baseline: 0 };
    const day = t[n - 1].slice(0, 10);
    let s = n - 1;
    while (s > 0 && t[s - 1].slice(0, 10) === day) s--;
    const dd = ser.daily.d; let prev = null;
    for (let i = dd.length - 1; i >= 0; i--) { if (dd[i] < day) { prev = ser.daily.c[i]; break; } }
    return { isIntraday: true, from: 0, fullC: null,
      labels: t.slice(s), o: it.o.slice(s), h: it.h.slice(s), l: it.l.slice(s), c: it.c.slice(s),
      baseline: prev != null ? prev : it.o[s] };
  }
  const dl = ser.daily, n = dl.c.length, count = tf === '6M' ? 126 : 252;
  const from = Math.max(0, n - count), sl = (a) => a.slice(from);
  const c = sl(dl.c);
  return { isIntraday: false, from, fullC: dl.c,
    labels: sl(dl.d), o: sl(dl.o), h: sl(dl.h), l: sl(dl.l), c, baseline: c[0] };
}

const fmtLabel = (s, intraday) => !s ? '' : (intraday ? s.slice(11, 16) : shortDate(s));

function MacroChart({ C, ser, tf, type, ema1On, ema1P, ema2On, ema2P, maCross }) {
  const [w, setW] = useState(0);
  const [idx, setIdx] = useState(null);
  const H = 244, padX = 8, padTop = 16, padBot = 22;
  const v = useMemo(() => macroView(ser, tf), [ser, tf]);
  const n = v.c.length;
  const daily = !v.isIntraday;
  // drop any scrub position when the view (symbol/timeframe) changes — a stale
  // index from a longer series would otherwise overrun a shorter one's arrays
  useEffect(() => { setIdx(null); }, [ser, tf]);
  const ema1 = useMemo(() => (daily && ema1On && v.fullC) ? emaSeries(v.fullC, ema1P).slice(v.from) : null, [daily, ema1On, ema1P, v]);
  const ema2 = useMemo(() => (daily && ema2On && v.fullC) ? emaSeries(v.fullC, ema2P).slice(v.from) : null, [daily, ema2On, ema2P, v]);

  let lo = Infinity, hi = -Infinity;
  const bump = (x) => { if (x != null) { if (x < lo) lo = x; if (x > hi) hi = x; } };
  if (type === 'ohlc') for (let i = 0; i < n; i++) { bump(v.h[i]); bump(v.l[i]); }
  else for (let i = 0; i < n; i++) bump(v.c[i]);
  if (ema1) ema1.forEach(bump);
  if (ema2) ema2.forEach(bump);
  if (v.isIntraday) bump(v.baseline);
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  const rng = (hi - lo) || 1;
  const X = (i) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (w - 2 * padX));
  const Y = (val) => padTop + (1 - (val - lo) / rng) * (H - padTop - padBot);

  const active = Math.max(0, Math.min(n - 1, idx == null ? n - 1 : idx));
  const price = v.c[active];
  const last = v.c[n - 1];
  const chg = price / v.baseline - 1;
  const up = last >= v.baseline;
  const col = up ? C.gain : C.loss;
  const ctx = v.isIntraday ? 'vs prev close' : (tf === '6M' ? 'over 6 months' : 'over 1 year');

  const onTouch = (e) => {
    if (!w) return;
    let i = Math.round(((e.nativeEvent.locationX - padX) / (w - 2 * padX)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    if (i !== idx) { setIdx(i); haptic('light'); }
  };

  // geometry
  let line = '', area = '', upP = '', dnP = '';
  const step = n > 1 ? (w - 2 * padX) / (n - 1) : w;
  const tick = Math.max(1.4, Math.min(4.5, step * 0.34));
  if (w > 0 && n > 1) {
    if (type === 'line') {
      line = `M ${X(0)} ${Y(v.c[0])}`;
      for (let i = 1; i < n; i++) line += ` L ${X(i)} ${Y(v.c[i])}`;
      area = line + ` L ${X(n - 1)} ${H - padBot} L ${X(0)} ${H - padBot} Z`;
    } else {
      for (let i = 0; i < n; i++) {
        const x = X(i), seg = `M ${x} ${Y(v.h[i])} L ${x} ${Y(v.l[i])} M ${x - tick} ${Y(v.o[i])} L ${x} ${Y(v.o[i])} M ${x} ${Y(v.c[i])} L ${x + tick} ${Y(v.c[i])} `;
        if (v.c[i] >= v.o[i]) upP += seg; else dnP += seg;
      }
    }
  }
  const emaPath = (arr) => {
    let d = '', started = false;
    for (let i = 0; i < n; i++) { const yv = arr[i]; if (yv == null) { started = false; continue; } d += (started ? ' L' : ' M') + ` ${X(i)} ${Y(yv)}`; started = true; }
    return d;
  };

  // golden/death-cross effect: the fast EMA is drawn green where it's above the
  // slow EMA and red where it's below, with a matching translucent fill between the
  // two lines; a thin regime strip runs along the base and a soft round glow marks
  // each crossover.
  const crossFx = daily && maCross && ema1 && ema2;
  let bull = '', bear = '', fillUp = '', fillDown = '', fastUp = '', fastDown = '';
  const crosses = [];
  const yRib = H - padBot + 8;
  let regimeUp = null;
  if (crossFx && w > 0 && n > 1) {
    for (let i = 0; i < n; i++) {
      const a = ema1[i], b = ema2[i];
      if (a == null || b == null) continue;
      const upNow = a >= b;
      regimeUp = upNow;                                          // ends on the latest bar
      const x1 = X(Math.max(0, i - 0.5)), x2 = X(Math.min(n - 1, i + 0.5));
      const rib = `M ${x1} ${yRib} L ${x2} ${yRib} `;
      if (upNow) bull += rib; else bear += rib;
      const a0 = ema1[i - 1], b0 = ema2[i - 1];
      if (i > 0 && a0 != null && b0 != null) {
        // fill the gap between fast & slow for this interval, colored by regime
        const quad = `M ${X(i - 1)} ${Y(a0)} L ${X(i)} ${Y(a)} L ${X(i)} ${Y(b)} L ${X(i - 1)} ${Y(b0)} Z `;
        const fseg = `M ${X(i - 1)} ${Y(a0)} L ${X(i)} ${Y(a)} `;
        if (upNow) { fillUp += quad; fastUp += fseg; } else { fillDown += quad; fastDown += fseg; }
        if ((a0 >= b0) !== upNow) crosses.push({ x: X(i), y: Y(a), golden: upNow });
      }
    }
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
        <View>
          <Text style={{ color: C.faint, fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
            {idx == null ? (v.isIntraday ? 'Last · 5-min' : 'Close') : fmtLabel(v.labels[active], v.isIntraday)}
          </Text>
          <Text style={[TNUM, { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }]}>
            ${price != null ? price.toFixed(2) : '—'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[TNUM, { color: chg >= 0 ? C.gain : C.loss, fontSize: 18, fontWeight: '800' }]}>{E.signPct(chg, 2)}</Text>
          <Text style={{ color: C.faint, fontSize: 10.5 }}>{ctx}</Text>
          {idx != null && type === 'ohlc' ? (
            <Text style={[TNUM, { color: C.muted, fontSize: 10, marginTop: 2 }]}>
              O {v.o[active].toFixed(2)} · H {v.h[active].toFixed(2)} · L {v.l[active].toFixed(2)}
            </Text>
          ) : null}
        </View>
      </View>

      <View onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch} onResponderMove={onTouch} onResponderRelease={() => setIdx(null)}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={col} stopOpacity="0.24" />
                <Stop offset="1" stopColor={col} stopOpacity="0" />
              </LinearGradient>
              <RadialGradient id="glowUp" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={C.gain} stopOpacity="0.8" />
                <Stop offset="0.45" stopColor={C.gain} stopOpacity="0.32" />
                <Stop offset="1" stopColor={C.gain} stopOpacity="0" />
              </RadialGradient>
              <RadialGradient id="glowDn" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={C.loss} stopOpacity="0.8" />
                <Stop offset="0.45" stopColor={C.loss} stopOpacity="0.32" />
                <Stop offset="1" stopColor={C.loss} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            {v.isIntraday ? (
              <Line x1={padX} y1={Y(v.baseline)} x2={w - padX} y2={Y(v.baseline)}
                stroke={C.muted} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3,4" />
            ) : null}
            {type === 'line' ? <Path d={area} fill="url(#mg)" /> : null}
            {type === 'line' ? <Path d={line} stroke={col} strokeWidth="2.4" fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {type === 'ohlc' ? <Path d={upP} stroke={C.gain} strokeWidth="1.5" fill="none" /> : null}
            {type === 'ohlc' ? <Path d={dnP} stroke={C.loss} strokeWidth="1.5" fill="none" /> : null}
            {/* translucent fill between fast & slow, colored by regime */}
            {crossFx ? <Path d={fillUp} fill={C.gain} fillOpacity="0.16" stroke="none" /> : null}
            {crossFx ? <Path d={fillDown} fill={C.loss} fillOpacity="0.16" stroke="none" /> : null}
            {/* thin regime strip along the base */}
            {crossFx ? <Path d={bull} stroke={C.gain} strokeWidth="3" fill="none" strokeOpacity="0.9" strokeLinecap="round" /> : null}
            {crossFx ? <Path d={bear} stroke={C.loss} strokeWidth="3" fill="none" strokeOpacity="0.9" strokeLinecap="round" /> : null}
            {/* slow EMA (steady reference) */}
            {ema2 ? <Path d={emaPath(ema2)} stroke={EMA_COLORS[1]} strokeWidth="1.6" fill="none" strokeOpacity="0.95" /> : null}
            {/* fast EMA — bi-colored by regime when the cross effect is on, else its plain color */}
            {crossFx ? <Path d={fastUp} stroke={C.gain} strokeWidth="2.1" fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {crossFx ? <Path d={fastDown} stroke={C.loss} strokeWidth="2.1" fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {ema1 && !crossFx ? <Path d={emaPath(ema1)} stroke={EMA_COLORS[0]} strokeWidth="1.6" fill="none" strokeOpacity="0.95" /> : null}
            {/* soft round glow at each crossover */}
            {crossFx ? crosses.map((cr, i) => (
              <React.Fragment key={i}>
                <Circle cx={cr.x} cy={cr.y} r="11" fill={cr.golden ? 'url(#glowUp)' : 'url(#glowDn)'} />
                <Circle cx={cr.x} cy={cr.y} r="2.6" fill={cr.golden ? C.gain : C.loss} fillOpacity="0.92" />
              </React.Fragment>
            )) : null}
            <SvgText x={padX} y={H - 5} fontSize="9" fontWeight="600" fill={C.faint} textAnchor="start">{fmtLabel(v.labels[0], v.isIntraday)}</SvgText>
            <SvgText x={w - padX} y={H - 5} fontSize="9" fontWeight="600" fill={C.faint} textAnchor="end">{fmtLabel(v.labels[n - 1], v.isIntraday)}</SvgText>
            {idx != null ? <Line x1={X(active)} y1={padTop - 6} x2={X(active)} y2={H - padBot} stroke={C.text} strokeOpacity="0.4" strokeWidth="1" /> : null}
            {idx != null && type === 'line' ? <Circle cx={X(active)} cy={Y(price)} r="4.5" fill={col} stroke={C.surface} strokeWidth="2" /> : null}
          </Svg>
        ) : <View style={{ height: H }} />}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {daily && ema1On ? <Legend C={C} color={crossFx ? (regimeUp ? C.gain : C.loss) : EMA_COLORS[0]} text={`EMA ${ema1P}`} /> : null}
        {daily && ema2On ? <Legend C={C} color={EMA_COLORS[1]} text={`EMA ${ema2P}`} /> : null}
        {crossFx ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: regimeUp ? C.gain : C.loss, opacity: 0.9 }} />
            <Text style={{ color: C.faint, fontSize: 11 }}>{regimeUp ? 'golden' : 'death'} cross · shaded regime</Text>
          </View>
        ) : (
          <Text style={{ color: C.faint, fontSize: 11 }}>
            {v.isIntraday ? '5-min bars · dashed = prev close · touch to inspect' : 'touch & drag to inspect'}
          </Text>
        )}
      </View>
    </View>
  );
}

function Legend({ C, color, text }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: color }} />
      <Text style={[TNUM, { color: C.muted, fontSize: 11 }]}>{text}</Text>
    </View>
  );
}

// generic equal-width segmented control
function SegBar({ C, options, value, onChange }) {
  return (
    <View style={[styles.modeSeg, { backgroundColor: C.surface2, borderColor: C.line }]}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button"
            accessibilityState={{ selected: on }} style={[styles.modeBtn, on && { backgroundColor: C.accent }]}>
            <Text style={{ color: on ? C.accentInk : C.muted, fontSize: 13.5, fontWeight: '700' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// today's session change + closes for a macro symbol
function macroDay(ser) {
  const it = ser.intraday, n = (it && it.t) ? it.t.length : 0;
  if (!n) return { last: null, chg: 0, closes: [] };
  const day = it.t[n - 1].slice(0, 10);
  let s = n - 1;
  while (s > 0 && it.t[s - 1].slice(0, 10) === day) s--;
  const dd = ser.daily.d; let prev = null;
  for (let i = dd.length - 1; i >= 0; i--) { if (dd[i] < day) { prev = ser.daily.c[i]; break; } }
  const closes = it.c.slice(s), last = closes[closes.length - 1], base = prev != null ? prev : it.o[s];
  return { last, chg: last / base - 1, closes };
}

function Spark({ C, vals, up, w = 74, h = 30 }) {
  if (!vals || vals.length < 2 || !w) return <View style={{ width: w, height: h }} />;
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = (hi - lo) || 1;
  const X = (i) => (i / (vals.length - 1)) * w;
  const Y = (v) => 2 + (1 - (v - lo) / rng) * (h - 4);
  let d = `M ${X(0)} ${Y(vals[0])}`;
  for (let i = 1; i < vals.length; i++) d += ` L ${X(i)} ${Y(vals[i])}`;
  return <Svg width={w} height={h}><Path d={d} stroke={up ? C.gain : C.loss} strokeWidth="1.6" fill="none" strokeLinejoin="round" /></Svg>;
}

function MacroTile({ C, meta, ser, selected, onPress }) {
  const day = macroDay(ser);
  const up = day.chg >= 0;
  return (
    <Pressable onPress={onPress} accessibilityLabel={`${meta.symbol} ${meta.label}`}
      style={[styles.tile, { backgroundColor: C.surface, borderColor: selected ? C.accent : 'transparent', borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.tick, { color: C.text, fontSize: 16 }]}>{meta.disp || meta.symbol}</Text>
          <Text numberOfLines={1} style={{ color: C.faint, fontSize: 10.5, marginTop: 1 }}>{meta.label}</Text>
        </View>
        <Spark C={C} vals={day.closes} up={up} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
        <Text style={[TNUM, { color: C.text, fontSize: 15, fontWeight: '800' }]}>{day.last != null ? day.last.toFixed(2) : '—'}</Text>
        <Text style={[TNUM, { color: up ? C.gain : C.loss, fontSize: 13, fontWeight: '800' }]}>{E.signPct(day.chg, 2)}</Text>
      </View>
    </Pressable>
  );
}

function Macro({ C, snap, st, persist, refreshing, onRefresh }) {
  const macro = snap.macro;
  const setP = (patch) => { haptic('select'); persist({ ...st, ...patch }); };
  if (!macro || !macro.symbols || !macro.symbols.length) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 38, color: C.muted, marginBottom: 10 }}>∿</Text>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>No macro data yet</Text>
        <Text style={{ color: C.muted, fontSize: 13.5, textAlign: 'center', lineHeight: 20 }}>
          Pull to refresh once the snapshot includes the intraday macro layer.
        </Text>
      </View>
    );
  }
  const syms = macro.symbols;
  const cur = syms.find(s => s.symbol === st.macroSym) ? st.macroSym : syms[0].symbol;
  const meta = syms.find(s => s.symbol === cur);
  const ser = macro.series[cur];

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, paddingBottom: 4, paddingHorizontal: 2 }}>
        <Text style={{ color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.6 }}>Markets</Text>
        <Text style={{ color: C.faint, fontSize: 11 }}>intraday · 5-min</Text>
      </View>

      <View style={styles.tileGrid}>
        {syms.map(s => (
          <MacroTile key={s.symbol} C={C} meta={s} ser={macro.series[s.symbol]}
            selected={s.symbol === cur} onPress={() => setP({ macroSym: s.symbol })} />
        ))}
      </View>

      <View style={[styles.cardPanel, { backgroundColor: C.surface, padding: 16, marginTop: 2 }]}>
        <View style={{ marginBottom: 10 }}>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{(meta.disp || meta.symbol)} · {meta.label}</Text>
          <Text style={{ color: C.faint, fontSize: 12, marginTop: 1 }}>{meta.desc}</Text>
        </View>
        <MacroChart C={C} ser={ser} tf={st.macroTf} type={st.macroType}
          ema1On={st.ema1On} ema1P={st.ema1P} ema2On={st.ema2On} ema2P={st.ema2P} maCross={st.maCross} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1 }}>
            <SegBar C={C} value={st.macroTf} onChange={(k) => setP({ macroTf: k })}
              options={MACRO_TFS.map(t => ({ key: t, label: t }))} />
          </View>
          <View style={{ flex: 1 }}>
            <SegBar C={C} value={st.macroType} onChange={(k) => setP({ macroType: k })} options={CHART_TYPES} />
          </View>
        </View>

        {st.macroTf === '1D' ? (
          <Text style={{ color: C.faint, fontSize: 11.5, marginTop: 12 }}>Moving averages show on the 6M · 1Y daily views.</Text>
        ) : (
          <View style={{ marginTop: 6 }}>
            {(() => {
              const isDef = st.ema1P === 50 && st.ema2P === 200 && st.ema1On && st.ema2On;
              return (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 }}>
                  <Pressable disabled={isDef} accessibilityLabel="Reset EMAs to 50 / 200"
                    onPress={() => { haptic('select'); setP({ ema1P: 50, ema2P: 200, ema1On: true, ema2On: true }); }}
                    style={[styles.resetBtn, { borderColor: isDef ? C.line : C.accent, opacity: isDef ? 0.4 : 1 }]}>
                    <Text style={{ color: isDef ? C.faint : C.accent, fontSize: 11.5, fontWeight: '800' }}>↺ 50 / 200</Text>
                  </Pressable>
                </View>
              );
            })()}
            <EmaRow C={C} color={EMA_COLORS[0]} on={st.ema1On} period={st.ema1P}
              onToggle={(v) => setP({ ema1On: v })} onSet={(p) => setP({ ema1P: p })} />
            <EmaRow C={C} color={EMA_COLORS[1]} on={st.ema2On} period={st.ema2P}
              onToggle={(v) => setP({ ema2On: v })} onSet={(p) => setP({ ema2P: p })} border />
            <ToggleRow C={C} border label="Golden / death cross"
              sub={st.ema1On && st.ema2On ? 'bi-color fast EMA + shaded fill + glow markers' : 'needs both EMAs on'}
              value={st.maCross} onChange={(v) => setP({ maCross: v })} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// EMA control: colored swatch + on/off + period stepper (multiples of 5, 5–400)
function EmaRow({ C, color, on, period, onToggle, onSet, border }) {
  const clamp = (p) => Math.max(5, Math.min(400, p));
  // snap to the previous / next multiple of 5, so the sequence is 5,10,15,… not 2,7,12
  const dec = () => onSet(clamp((Math.ceil(period / 5) - 1) * 5));
  const inc = () => onSet(clamp((Math.floor(period / 5) + 1) * 5));
  return (
    <View style={[styles.ctlRow, border && { borderTopColor: C.line, borderTopWidth: 1 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: on ? color : C.faint }} />
        <Text style={{ color: C.text, fontSize: 13.5 }}>EMA</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.stepper, { backgroundColor: C.surface2, borderColor: C.line, opacity: on ? 1 : 0.4 }]}>
          <Pressable disabled={!on} onPress={dec} style={styles.stepBtn} hitSlop={6}>
            <Text style={{ color: C.accent, fontSize: 22, fontWeight: '600' }}>−</Text></Pressable>
          <Text style={[TNUM, { color: C.text, fontSize: 15, fontWeight: '700', minWidth: 40, textAlign: 'center' }]}>{period}</Text>
          <Pressable disabled={!on} onPress={inc} style={styles.stepBtn} hitSlop={6}>
            <Text style={{ color: C.accent, fontSize: 20, fontWeight: '600' }}>+</Text></Pressable>
        </View>
        <Switch value={on} onValueChange={onToggle}
          trackColor={{ false: C.surface2, true: C.accent }} thumbColor="#fff" ios_backgroundColor={C.surface2} />
      </View>
    </View>
  );
}

/* ====================== shared UI ====================== */
function AppHeader({ C, snap }) {
  const when = (snap.generatedAt || '').replace('T', ' ').replace('Z', ' UTC');
  return (
    <View style={{ paddingTop: 10, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gain }} />
        <Text style={{ color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 }}>Momentum</Text>
      </View>
      <Text style={{ color: C.faint, fontSize: 12, marginTop: 4 }}>
        {snap.counts?.eligible ?? snap.tickers.length} names · adj. close · as of {when}
        {snap.partial ? <Text style={{ color: C.div }}>  · syncing full history…</Text> : null}
      </Text>
    </View>
  );
}
function Card({ C, children, pad = true }) {
  return <View style={[styles.cardPanel, { backgroundColor: C.surface, padding: pad ? 16 : 4, paddingHorizontal: pad ? 16 : 4 }]}>{children}</View>;
}
function Eyebrow({ C, children }) {
  return <Text style={{ color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>{children}</Text>;
}
function Stat({ C, v, l, color }) {
  return (
    <View style={[styles.statBox, { backgroundColor: C.surface }]}>
      <Text style={[TNUM, { color: color || C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 }]}>{v}</Text>
      <Text style={{ color: C.faint, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4 }}>{l}</Text>
    </View>
  );
}
function Segmented({ C, options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: 8 }}
      style={{ marginTop: 4, marginHorizontal: -2 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)}
            accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[styles.pill, { backgroundColor: on ? C.accent : C.surface2, borderColor: on ? C.accent : C.line }]}>
            <Text numberOfLines={1} style={{ color: on ? C.accentInk : C.muted, fontSize: 13, fontWeight: '700' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
function Stepper({ C, label, sub, value, onDec, onInc, border }) {
  return (
    <View style={[styles.ctlRow, border && { borderTopColor: C.line, borderTopWidth: 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 13.5 }}>{label}</Text>
        {sub ? <Text style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <View style={[styles.stepper, { backgroundColor: C.surface2, borderColor: C.line }]}>
        <Pressable onPress={onDec} style={styles.stepBtn} hitSlop={6}><Text style={{ color: C.accent, fontSize: 22, fontWeight: '600' }}>−</Text></Pressable>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', minWidth: 54, textAlign: 'center' }}>{value}</Text>
        <Pressable onPress={onInc} style={styles.stepBtn} hitSlop={6}><Text style={{ color: C.accent, fontSize: 20, fontWeight: '600' }}>+</Text></Pressable>
      </View>
    </View>
  );
}
function TabBar({ C, tab, setTab, count, insets }) {
  const go = (t) => { haptic('light'); setTab(t); };
  return (
    <View style={[styles.tabbar, { backgroundColor: C.ground, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingBottom: Math.max(insets.bottom, 8) }]}>
      {[['screener', '▚', 'Screener'], ['portfolio', '◈', 'Portfolio'], ['macro', '∿', 'Markets']].map(([id, ic, label]) => {
        const on = tab === id;
        return (
          <Pressable key={id} style={styles.tabBtn} onPress={() => go(id)}>
            <View>
              <Text style={{ fontSize: 21, color: on ? C.accent : C.faint, textAlign: 'center' }}>{ic}</Text>
              {id === 'portfolio' && count > 0 ? (
                <View style={[styles.badge, { backgroundColor: C.accent }]}>
                  <Text style={[TNUM, { color: C.accentInk, fontSize: 10, fontWeight: '800' }]}>{count}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: on ? C.text : C.faint, marginTop: 3 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Empty({ C, watch }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 40, color: C.muted, marginBottom: 10 }}>{watch ? '☆' : '◈'}</Text>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 6 }}>
        {watch ? 'Nothing on this watchlist' : 'No holdings yet'}
      </Text>
      <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        {watch
          ? 'Add names from the Screener with the + button. They’re tracked by momentum score — no weighting.'
          : 'Add names from the Screener with the + button. HRP weights compute automatically.'}
      </Text>
    </View>
  );
}

/* ---- skeleton shown during the brief initial state load ---- */
function ScreenerSkeleton({ C, insets }) {
  const a = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, []);
  const Box = ({ h, w, mt, r }) => (
    <Animated.View style={{ height: h, width: w || '100%', marginTop: mt || 0, borderRadius: r ?? 8, backgroundColor: C.surface2, opacity: a }} />
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ground, paddingHorizontal: 14 }} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={{ paddingTop: 10 }}><Box h={26} w={'62%'} r={7} /><Box h={12} w={'80%'} mt={8} /></View>
      <View style={{ marginTop: 16 }}><Box h={92} r={18} /></View>
      <View style={{ marginTop: 12 }}><Box h={150} r={18} /></View>
      {[0, 1, 2, 3, 4].map(i => <View key={i} style={{ marginTop: 8 }}><Box h={70} r={14} /></View>)}
    </SafeAreaView>
  );
}
function makeColorFor() {
  const map = {};
  return (sec) => {
    if (!(sec in map)) map[sec] = SECTOR_COLORS[Object.keys(map).length % SECTOR_COLORS.length];
    return map[sec];
  };
}

// Company logo from FMP's public image CDN (no key). Falls back to a ticker-
// initials tile if the image is missing or offline.
function TickerLogo({ C, symbol, size = 46 }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: 14 };
  if (failed) {
    return (
      <View style={[box, { backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: C.muted, fontWeight: '800', fontSize: size * 0.32 }}>{symbol.slice(0, 2)}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `https://images.financialmodelingprep.com/symbol/${symbol}.png` }}
      onError={() => setFailed(true)} resizeMode="contain"
      style={[box, { backgroundColor: '#fff' }]} />
  );
}

// Top-k names by daily-return correlation with `target` over the latest 252 days.
// Demeaned daily-return vector over the latest ~252d ending at `asof`, plus its
// sum of squares. Returns null if the name lacks a clean window there.
function demeanedReturns(closes, lo, hi) {
  if (closes.length <= hi) return null;
  const r = [];
  for (let i = lo; i < hi; i++) {
    const a = closes[i], b = closes[i + 1];
    if (!(a > 0) || !(b > 0)) return null;
    r.push(b / a - 1);
  }
  let mean = 0; for (const x of r) mean += x; mean /= r.length;
  let ss = 0; for (let i = 0; i < r.length; i++) { r[i] -= mean; ss += r[i] * r[i]; }
  return ss > 0 ? { d: r, ss } : null;
}

// For each candidate name, its MAX daily-return correlation against the already-
// selected basket (and which held name is that nearest "twin"). Used to fade
// redundant names and flag diversifiers as you walk the ranked list. Empty
// basket → empty map (no cue). Keyed by symbol.
function basketCorrMap(candidates, selected, byField, asof) {
  const m = new Map();
  if (!selected.length) return m;
  const hi = asof, lo = Math.max(0, hi - 252);
  if (hi - lo < 20) return m;
  const selVecs = [];
  for (const s of selected) {
    const t = byField(s);
    const v = t && demeanedReturns(t.closes, lo, hi);
    if (v) selVecs.push({ sym: s, ...v });
  }
  if (!selVecs.length) return m;
  const n = selVecs[0].d.length;
  const selSet = new Set(selected);
  for (const o of candidates) {
    const sym = o.t.symbol;
    if (selSet.has(sym)) continue;
    const v = demeanedReturns(o.t.closes, lo, hi);
    if (!v || v.d.length !== n) continue;
    let best = -2, twin = null;
    for (const sv of selVecs) {
      let dot = 0; const vd = v.d, sd = sv.d;
      for (let i = 0; i < n; i++) dot += vd[i] * sd[i];
      const rho = dot / Math.sqrt(v.ss * sv.ss);
      if (rho > best) { best = rho; twin = sv.sym; }
    }
    m.set(sym, { rho: best, twin });
  }
  return m;
}

function topCorrelated(target, pool, asof, k = 3) {
  const lo = Math.max(0, asof - 252), hi = asof;
  if (hi - lo < 20) return [];
  const ret = (c) => { const r = []; for (let i = lo; i < hi; i++) r.push(c[i + 1] / c[i] - 1); return r; };
  const a = ret(target.closes);
  const n = a.length;
  let am = 0; for (const x of a) am += x; am /= n;
  let ass = 0; const ad = a.map(x => { const d = x - am; ass += d * d; return d; });
  const out = [];
  for (const p of pool) {
    if (p.symbol === target.symbol || p.closes.length <= hi) continue;
    const b = ret(p.closes);
    let bm = 0; for (const x of b) bm += x; bm /= b.length;
    let bss = 0, dot = 0;
    for (let i = 0; i < n; i++) { const db = b[i] - bm; bss += db * db; dot += ad[i] * db; }
    const denom = Math.sqrt(ass * bss);
    out.push({ t: p, rho: denom > 0 ? dot / denom : 0 });
  }
  out.sort((x, y) => y.rho - x.rho);
  return out.slice(0, k);
}

/* ====================== styles ====================== */
const TNUM = { fontVariant: ['tabular-nums'] };
const styles = StyleSheet.create({
  cardPanel: { borderRadius: 22, marginBottom: 14 },
  search: { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, marginTop: 12 },
  countLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, paddingTop: 6 },
  miniBtn: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18 },
  bookPill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  resetBtn: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 14 },
  tile: { width: '47.8%', flexGrow: 1, borderRadius: 18, padding: 13 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, paddingHorizontal: 10, borderRadius: 14 },
  cardTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minWidth: 0 },
  rank: { width: 24, textAlign: 'center', fontSize: 13, fontWeight: '700', ...TNUM },
  tick: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  cname: { fontSize: 12.5, marginTop: 2 },
  csec: { fontSize: 11, marginTop: 2 },
  big: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5, ...TNUM },
  metricSub: { fontSize: 11.5, marginTop: 2, ...TNUM },
  selBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  statBox: { flex: 1, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  dstat: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 14 },
  ctlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12 },
  stepBtn: { width: 44, height: 38, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  modeSeg: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  modeBtn: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center' },
  warn: { borderRadius: 16, padding: 14, marginBottom: 14 },
  sectorBar: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', marginTop: 10, marginBottom: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 6 },
  sw: { width: 10, height: 10, borderRadius: 3 },
  wrow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  wt: { width: 58, textAlign: 'right', fontSize: 17, fontWeight: '800', ...TNUM },
  bar: { height: 8, borderRadius: 4, marginTop: 7, overflow: 'hidden' },
  removeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dback: { paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  tag: { fontSize: 12, fontWeight: '600', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  perfRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 18 },
  peerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  cta: { paddingVertical: 17, borderRadius: 26, alignItems: 'center' },
  tabbar: { flexDirection: 'row', paddingTop: 10 },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -6, left: 14, minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 36 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 14 },
  sheetTitle: { fontSize: 19, fontWeight: '800', marginBottom: 8 },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth },
  filterLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 18, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22 },
});

/* ======================================================================
   Sharpe Momentum Screener — Expo (iPhone) app
   Runs in Expo Go via a single Snack link. Market data is the pre-built,
   key-free snapshot fetched at runtime from GitHub raw and cached on device.
   All ranking / HRP / constraint math comes from ./engine (validated against
   a NumPy reference — see build/validate_js.mjs).
   ====================================================================== */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, FlatList, Pressable, TextInput, Modal,
  StyleSheet, useColorScheme, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import * as E from './engine';
import snapshot from './snapshot.json';   // bundled, key-free market-data snapshot

const STORE_KEY = 'sms.state.v1';

/* ---- palette (light / dark) ---- */
const palettes = {
  dark: {
    ground: '#0b1220', surface: '#151e2e', surface2: '#1c2740', raised: '#22304d',
    line: 'rgba(255,255,255,0.09)', lineStrong: 'rgba(255,255,255,0.16)',
    text: '#eaeef5', muted: '#93a0b8', faint: '#65728c',
    accent: '#e8b24a', accentInk: '#231a06', accentSoft: 'rgba(232,178,74,0.16)',
    gain: '#2fb574', loss: '#f0524a',
    gainSoft: 'rgba(47,181,116,0.16)', lossSoft: 'rgba(240,82,74,0.16)',
  },
  light: {
    ground: '#f4f6f9', surface: '#ffffff', surface2: '#eef2f7', raised: '#e5ebf3',
    line: 'rgba(16,26,48,0.10)', lineStrong: 'rgba(16,26,48,0.18)',
    text: '#101a2c', muted: '#5a6a86', faint: '#8b97ad',
    accent: '#b7791f', accentInk: '#fff6e2', accentSoft: 'rgba(183,121,31,0.14)',
    gain: '#1f9d63', loss: '#d63a34',
    gainSoft: 'rgba(31,157,99,0.14)', lossSoft: 'rgba(214,58,52,0.14)',
  },
};

const SECTOR_COLORS = ['#e8b24a','#2fb574','#5b9df0','#c86bd6','#f0894a','#54c7c7','#e0607e','#9aa7bd','#8bd450','#d64a4a','#6a7bd6'];
const PERIODS = [['5-day',5],['10-day',10],['1-month',21],['3-month',63],['6-month',126],['1-year',252]];

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

  const snap = snapshot;                        // bundled, key-free market data
  const [st, setSt] = useState(null);           // persisted UI state
  const [tab, setTab] = useState('screener');
  const [detail, setDetail] = useState(null);   // symbol or null
  const [query, setQuery] = useState('');

  /* ---- load persisted UI state (selections + window + caps) ---- */
  useEffect(() => {
    (async () => {
      let saved = {};
      try { saved = JSON.parse(await AsyncStorage.getItem(STORE_KEY)) || {}; } catch (e) {}
      setSt(clampState(normalizeState(saved), snap));
    })();
  }, []);

  const persist = useCallback((next) => {
    setSt(next);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  if (!st) return <Splash C={C} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ground }} edges={['top','left','right']}>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <View style={{ flex: 1 }}>
        {tab === 'screener'
          ? <Screener C={C} snap={snap} st={st} persist={persist} query={query} setQuery={setQuery} onOpen={setDetail} />
          : <Portfolio C={C} snap={snap} st={st} persist={persist} onOpen={setDetail} />}
      </View>
      <TabBar C={C} tab={tab} setTab={setTab} count={st.selected.length} insets={insets} />
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)} presentationStyle="fullScreen">
        {detail && <Detail C={C} snap={snap} st={st} sym={detail} onClose={() => setDetail(null)} onToggle={(s) => persist(toggleSel(st, s))} />}
      </Modal>
    </SafeAreaView>
  );
}

/* ---------------- state helpers ---------------- */
function normalizeState(saved) {
  return {
    universe: saved.universe || null,
    asof: saved.asof ?? null,
    start: saved.start ?? 252,
    end: saved.end ?? 21,
    selected: Array.isArray(saved.selected) ? saved.selected : [],
    maxStock: saved.maxStock ?? 0,
    maxSector: saved.maxSector ?? 0,
  };
}
function clampState(s, snap) {
  const N = snap.dates.length;
  const uni = snap.universes[s.universe] ? s.universe : Object.keys(snap.universes)[0];
  const asof = s.asof == null ? N - 1 : Math.max(0, Math.min(N - 1, s.asof | 0));
  const start = Math.max(3, Math.min(N - 1, s.start | 0));
  const end = Math.max(1, Math.min(start - 2, s.end | 0));
  return { ...s, universe: uni, asof, start, end };
}
function toggleSel(st, sym) {
  const set = new Set(st.selected);
  set.has(sym) ? set.delete(sym) : set.add(sym);
  haptic(set.has(sym) ? 'select' : 'light');
  return { ...st, selected: [...set] };
}

/* ====================== Screener ====================== */
function Screener({ C, snap, st, persist, query, setQuery, onOpen }) {
  const ranked = useMemo(() => {
    const list = snap.tickers.filter(t => t.universes.includes(st.universe));
    const out = [];
    for (const t of list) {
      const m = E.sharpeMomentum(t.closes, st.asof, st.start, st.end);
      if (m) out.push({ t, m });
    }
    out.sort((a, b) => b.m.sharpe - a.m.sharpe);
    out.forEach((o, i) => (o.rank = i + 1));
    return out;
  }, [snap, st.universe, st.asof, st.start, st.end]);

  const q = query.trim().toUpperCase();
  const filtered = q
    ? ranked.filter(o => o.t.symbol.includes(q) || o.t.name.toUpperCase().includes(q))
    : ranked;
  const selSet = new Set(st.selected);

  const setWin = (patch) => {
    let next = { ...st, ...patch };
    next.start = Math.max(next.end + 2, Math.min(snap.dates.length - 1, next.start));
    next.end = Math.max(1, Math.min(next.start - 2, next.end));
    next.asof = Math.max(next.start, Math.min(snap.dates.length - 1, next.asof));
    haptic('select');
    persist(next);
  };

  const header = (
    <View>
      <AppHeader C={C} snap={snap} />
      <Card C={C}>
        <Eyebrow C={C}>Universe</Eyebrow>
        <Segmented C={C}
          options={Object.entries(snap.universes).map(([id, u]) => ({ id, label: u.label }))}
          value={st.universe}
          onChange={(id) => { haptic('select'); persist({ ...st, universe: id }); }} />
        <TextInput
          value={query} onChangeText={setQuery}
          placeholder="Search ticker or company" placeholderTextColor={C.faint}
          autoCapitalize="characters" autoCorrect={false}
          style={[styles.search, { backgroundColor: C.surface2, color: C.text, borderColor: C.line }]} />
      </Card>

      <Card C={C}>
        <Eyebrow C={C}>Ranking window · trading days</Eyebrow>
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

      <View style={styles.countLine}>
        <Text style={{ color: C.muted, fontSize: 12 }}>
          <Text style={{ color: C.text, fontWeight: '700' }}>{filtered.length}</Text> ranked · {selSet.size} selected
        </Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>Sharpe momentum ▾</Text>
      </View>
    </View>
  );

  return (
    <FlatList
      data={filtered}
      keyExtractor={(o) => o.t.symbol}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={14}
      maxToRenderPerBatch={16}
      windowSize={10}
      removeClippedSubviews
      renderItem={({ item }) => (
        <RankCard C={C} o={item} selected={selSet.has(item.t.symbol)}
          onOpen={() => onOpen(item.t.symbol)}
          onToggle={() => persist(toggleSel(st, item.t.symbol))} />
      )} />
  );
}

function RankCard({ C, o, selected, onOpen, onToggle }) {
  const { t, m, rank } = o;
  const sc = m.sharpe >= 0 ? C.gain : C.loss;
  return (
    <View style={[styles.card, { backgroundColor: C.surface, borderColor: selected ? C.accent : C.line }]}>
      <Pressable style={styles.cardTap} onPress={onOpen} hitSlop={4}>
        <Text style={[styles.rank, { color: selected ? C.accent : C.muted }]}>{rank}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.tick, { color: C.text }]}>{t.symbol}</Text>
          <Text numberOfLines={1} style={[styles.cname, { color: C.muted }]}>{t.name}</Text>
          <Text style={[styles.csec, { color: C.faint }]}>{t.sector}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', minWidth: 78 }}>
          <Text style={[styles.big, { color: sc }]}>{E.fmtSharpe(m.sharpe)}</Text>
          <Text style={[styles.metricSub, { color: C.muted }]}>{E.signPct(m.cum)} · σ {E.pct(m.annVol, 0)}</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onToggle} hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${t.symbol}`}
        style={[styles.selBtn, { backgroundColor: selected ? C.accent : C.surface2, borderColor: selected ? C.accent : C.lineStrong }]}>
        <Text style={{ fontSize: 22, fontWeight: '600', color: selected ? C.accentInk : C.muted, marginTop: -2 }}>
          {selected ? '✓' : '+'}
        </Text>
      </Pressable>
    </View>
  );
}

function WindowNote({ C, snap, st }) {
  const lo = st.asof - st.start, hi = st.asof - st.end;
  let msg, warn = false;
  if (lo < 0) { warn = true; msg = `⚠︎ Not enough history: window opens ${-lo} day(s) before the earliest date. Reduce start offset or move as-of later.`; }
  else if (st.start <= st.end) { warn = true; msg = `⚠︎ Start offset must exceed end offset (${st.start} ≤ ${st.end}).`; }
  else msg = `Window ${snap.dates[lo]} → ${snap.dates[hi]} · ${hi - lo} daily returns · zero risk-free, sample σ, ×252 annualization.`;
  return <Text style={{ color: warn ? C.loss : C.faint, fontSize: 11.5, marginTop: 8, lineHeight: 16 }}>{msg}</Text>;
}

/* ====================== Portfolio ====================== */
function Portfolio({ C, snap, st, persist, onOpen }) {
  const BYSYM = useMemo(() => Object.fromEntries(snap.tickers.map(t => [t.symbol, t])), [snap]);
  const pf = useMemo(() => computePortfolio(snap, BYSYM, st), [snap, st.selected, st.asof, st.maxStock, st.maxSector]);
  const colorFor = useMemo(() => makeColorFor(), [snap]);

  const setCap = (key, d) => {
    let v = st[key];
    if (v === 0 && d > 0) v = key === 'maxStock' ? 0.25 : 0.40;
    else v = Math.round((v + d * 0.05) * 100) / 100;
    if (v < 0.05) v = 0;
    if (v > 1) v = 1;
    haptic('select');
    persist({ ...st, [key]: v });
  };

  const total = pf.weights.reduce((a, b) => a + b, 0);
  const sectorTot = {};
  pf.syms.forEach((s, i) => { const sec = BYSYM[s].sector; sectorTot[sec] = (sectorTot[sec] || 0) + pf.weights[i]; });
  const secEntries = Object.entries(sectorTot).sort((a, b) => b[1] - a[1]);
  const rows = pf.syms.map((s, i) => ({ s, w: pf.weights[i] })).sort((a, b) => b.w - a.w);
  const maxW = Math.max(...rows.map(r => r.w), 0.0001);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 96 }}>
      <AppHeader C={C} snap={snap} />
      <View style={styles.statRow}>
        <Stat C={C} v={String(pf.syms.length)} l="Holdings" />
        <Stat C={C} v={pf.syms.length ? (total * 100).toFixed(total > 0.9999 && total < 1.0001 ? 0 : 1) + '%' : '0%'} l="Allocated" />
        <Stat C={C} v={String(new Set(pf.syms.map(s => BYSYM[s].sector)).size)} l="Sectors" />
      </View>

      <Card C={C}>
        <Eyebrow C={C}>HRP constraints</Eyebrow>
        <Stepper C={C} label="Max stock weight" sub="per-name cap"
          value={st.maxStock ? E.pct(st.maxStock) : 'Off'}
          onDec={() => setCap('maxStock', -1)} onInc={() => setCap('maxStock', 1)} />
        <Stepper C={C} label="Max sector weight" sub="per-sector cap" border
          value={st.maxSector ? E.pct(st.maxSector) : 'Off'}
          onDec={() => setCap('maxSector', -1)} onInc={() => setCap('maxSector', 1)} />
        <Text style={{ color: C.faint, fontSize: 11.5, marginTop: 8, lineHeight: 16 }}>
          Long-only Hierarchical Risk Parity on the latest 252 trading days (as-of), independent of the ranking skip window. Capped excess is redistributed proportionally until weights total exactly 100%.
        </Text>
      </Card>

      {pf.syms.length === 0 ? (
        <Empty C={C} />
      ) : (
        <>
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
                    <View style={[styles.bar, { backgroundColor: C.surface2 }]}>
                      <View style={{ width: `${(r.w / maxW * 100).toFixed(1)}%`, height: '100%', borderRadius: 4, backgroundColor: C.accent }} />
                    </View>
                  </Pressable>
                  <Pressable onPress={() => persist(toggleSel(st, r.s))} hitSlop={8}
                    style={[styles.removeBtn, { backgroundColor: C.surface2, borderColor: C.line }]}>
                    <Text style={{ color: C.muted, fontSize: 16, marginTop: -2 }}>×</Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
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
  const w = E.hrpWeights(R);
  const sectors = syms.map(s => BYSYM[s].sector);
  const capped = E.applyCaps(w, sectors, st.maxStock, st.maxSector);
  return { syms, weights: capped.w, feasible: capped.feasible, msg: capped.msg, sectors };
}

/* ====================== Ticker detail ====================== */
function Detail({ C, snap, st, sym, onClose, onToggle }) {
  const t = snap.tickers.find(x => x.symbol === sym);
  const insets = useSafeAreaInsets();
  const [inPf, setInPf] = useState(st.selected.includes(sym));
  if (!t) return null;
  const m = E.sharpeMomentum(t.closes, st.asof, st.start, st.end);
  const asofDate = snap.dates[st.asof];
  const series = t.closes.slice(Math.max(0, st.asof - 252), st.asof + 1);

  return (
    <View style={{ flex: 1, backgroundColor: C.ground, paddingTop: insets.top }}>
      <View style={[styles.dback, { borderBottomColor: C.line }]}>
        <Pressable onPress={() => { haptic('light'); onClose(); }} hitSlop={10}>
          <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>‹ Back</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
        <View style={{ padding: 18, paddingBottom: 6 }}>
          <Text style={{ color: C.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }}>{t.symbol}</Text>
          <Text style={{ color: C.muted, fontSize: 15, marginTop: 2 }}>{t.name}</Text>
          <View style={styles.tags}>
            {[t.sector, t.industry, t.exchange, E.fmtCap(t.marketCap)].map((x, i) => (
              <Text key={i} style={[styles.tag, { backgroundColor: C.surface2, borderColor: C.line, color: C.muted }]}>{x}</Text>
            ))}
          </View>
        </View>

        <View style={styles.dstat}>
          <Stat C={C} v={m ? E.fmtSharpe(m.sharpe) : '—'} l="Sharpe mom." color={m ? (m.sharpe >= 0 ? C.gain : C.loss) : C.text} />
          <Stat C={C} v={m ? E.signPct(m.cum, 0) : '—'} l="Window ret." color={m ? (m.cum >= 0 ? C.gain : C.loss) : C.text} />
          <Stat C={C} v={m ? E.pct(m.annVol, 0) : '—'} l="Ann. vol" />
        </View>

        <Card C={C}>
          <Eyebrow C={C}>Adjusted close · last 12 months</Eyebrow>
          <Sparkline C={C} series={series} />
        </Card>

        <Card C={C} pad={false}>
          <Text style={{ color: C.faint, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', padding: 16, paddingBottom: 6 }}>
            Performance · adjusted close · as of {asofDate}
          </Text>
          {PERIODS.map(([lab, d], i) => {
            const r = E.periodReturn(t.closes, st.asof, d);
            return (
              <View key={lab} style={[styles.perfRow, { borderTopColor: C.line, borderTopWidth: i ? 1 : 0 }]}>
                <Text style={{ color: C.muted, fontSize: 16, fontWeight: '600' }}>{lab}</Text>
                <Text style={{ color: r == null ? C.faint : (r >= 0 ? C.gain : C.loss), fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>
                  {r == null ? '—' : E.signPct(r, 2)}
                </Text>
              </View>
            );
          })}
        </Card>

        <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
          <Pressable
            onPress={() => { onToggle(sym); setInPf(!inPf); }}
            style={[styles.cta, { backgroundColor: inPf ? C.surface2 : C.accent, borderColor: inPf ? C.lineStrong : C.accent }]}>
            <Text style={{ color: inPf ? C.text : C.accentInk, fontSize: 16, fontWeight: '700' }}>
              {inPf ? '✓ In portfolio — tap to remove' : '+ Add to portfolio'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Sparkline({ C, series }) {
  const W = 320, H = 76, pad = 6;
  if (!series || series.length < 2) return <View style={{ height: H }} />;
  const lo = Math.min(...series), hi = Math.max(...series), rng = (hi - lo) || 1;
  const up = series[series.length - 1] >= series[0];
  const col = up ? C.gain : C.loss;
  const X = i => pad + (i / (series.length - 1)) * (W - 2 * pad);
  const Y = v => H - pad - ((v - lo) / rng) * (H - 2 * pad);
  let d = `M ${X(0)} ${Y(series[0])}`;
  for (let i = 1; i < series.length; i++) d += ` L ${X(i)} ${Y(series[i])}`;
  const area = d + ` L ${X(series.length - 1)} ${H - pad} L ${X(0)} ${H - pad} Z`;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 4 }}>
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={col} stopOpacity="0.28" />
          <Stop offset="1" stopColor={col} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#g)" />
      <Path d={d} stroke={col} strokeWidth="2.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/* ====================== shared UI ====================== */
function AppHeader({ C, snap }) {
  const when = (snap.generatedAt || '').replace('T', ' ').replace('Z', ' UTC');
  return (
    <View style={{ paddingTop: 8, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gain }} />
        <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 }}>Momentum Screener</Text>
      </View>
      <Text style={{ color: C.muted, fontSize: 11.5, marginTop: 3 }}>
        FMP adj. close · {snap.counts?.eligible ?? snap.tickers.length} names · as of {when}
      </Text>
    </View>
  );
}
function Card({ C, children, pad = true }) {
  return <View style={[styles.cardPanel, { backgroundColor: C.surface, borderColor: C.line, padding: pad ? 14 : 4, paddingHorizontal: pad ? 14 : 14 }]}>{children}</View>;
}
function Eyebrow({ C, children }) {
  return <Text style={{ color: C.muted, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>{children}</Text>;
}
function Stat({ C, v, l, color }) {
  return (
    <View style={[styles.statBox, { backgroundColor: C.surface, borderColor: C.line }]}>
      <Text style={{ color: color || C.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 }}>{v}</Text>
      <Text style={{ color: C.muted, fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 3 }}>{l}</Text>
    </View>
  );
}
function Segmented({ C, options, value, onChange }) {
  return (
    <View style={[styles.seg, { backgroundColor: C.surface2, borderColor: C.line }]}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.segBtn, on && { backgroundColor: C.raised }]}>
            <Text numberOfLines={1} style={{ color: on ? C.text : C.muted, fontSize: 12.5, fontWeight: '600', textAlign: 'center' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
    <View style={[styles.tabbar, { backgroundColor: C.surface, borderTopColor: C.line, paddingBottom: Math.max(insets.bottom, 8) }]}>
      {[['screener', '▚', 'Screener'], ['portfolio', '◈', 'Portfolio']].map(([id, ic, label]) => {
        const on = tab === id;
        return (
          <Pressable key={id} style={styles.tabBtn} onPress={() => go(id)}>
            <View>
              <Text style={{ fontSize: 21, color: on ? C.accent : C.faint, textAlign: 'center' }}>{ic}</Text>
              {id === 'portfolio' && count > 0 ? (
                <View style={[styles.badge, { backgroundColor: C.accent }]}>
                  <Text style={{ color: C.accentInk, fontSize: 10, fontWeight: '800' }}>{count}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 10.5, fontWeight: '600', color: on ? C.accent : C.faint, marginTop: 3 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Empty({ C }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 40, color: C.muted, marginBottom: 10 }}>◈</Text>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 6 }}>No holdings yet</Text>
      <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        Add names from the Screener with the + button. HRP weights compute automatically.
      </Text>
    </View>
  );
}
function Splash({ C }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={C.accent} size="large" />
      <Text style={{ color: C.muted, marginTop: 14, fontSize: 14 }}>Loading market snapshot…</Text>
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

/* ====================== styles ====================== */
const styles = StyleSheet.create({
  cardPanel: { borderRadius: 20, borderWidth: 1, marginBottom: 12 },
  search: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, marginTop: 10 },
  countLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 10, paddingTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
  cardTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  rank: { width: 30, textAlign: 'center', fontSize: 13, fontWeight: '800' },
  tick: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
  cname: { fontSize: 12, marginTop: 1 },
  csec: { fontSize: 10.5, marginTop: 2 },
  big: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  metricSub: { fontSize: 10.5, marginTop: 1 },
  selBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statBox: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  dstat: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 14 },
  ctlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1 },
  stepBtn: { width: 40, height: 34, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, gap: 3, marginTop: 2 },
  segBtn: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center' },
  warn: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
  sectorBar: { flexDirection: 'row', height: 26, borderRadius: 8, overflow: 'hidden', borderWidth: 1, marginTop: 8, marginBottom: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 6 },
  sw: { width: 10, height: 10, borderRadius: 3 },
  wrow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 14 },
  wt: { width: 56, textAlign: 'right', fontSize: 16, fontWeight: '800' },
  bar: { height: 7, borderRadius: 4, marginTop: 6, overflow: 'hidden' },
  removeBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dback: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { fontSize: 11, fontWeight: '600', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  perfRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 18 },
  cta: { paddingVertical: 15, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8 },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -6, left: 14, minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});

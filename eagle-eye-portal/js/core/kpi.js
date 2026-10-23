/* KPI Rate scoring, totals, targets and rankings. */

const KPI_PARTS = [
    ['collection', 'Collection', 'EFF % (Collection ÷ Collectibles)'],
    ['penalty', 'Penalty', '% vs Collection (Penalty ÷ Collection)'],
    ['provision', 'Provision', 'ACH % (Fixed Provision ÷ To Retain)'],
    ['repo', 'Repo', 'Repo rate (Repo ÷ # Accs)']
];

function kpiCfg() { return state.kpi || DEFAULT_KPI; }

// Each metric: actual ÷ target (capped), weighted. Provision is skipped (weights re-scaled) while TO RETAIN is blank.
function kpiBreakdown(i) {
    const cfg = kpiCfg(), t = cfg[i.team === 'recovery' ? 'recovery' : 'curing'], cap = (cfg.cap || 120) / 100;
    const actual = { collection: pct(i.collection, i.collectibles), penalty: pct(i.penalty, i.collection),
        provision: i.toRetain === null ? null : pct(i.fixedProv, i.toRetain), repo: pct(i.repo, i.accs1) };
    const parts = {}; let total = 0, wsum = 0;
    KPI_PARTS.forEach(([k]) => {
        if (actual[k] === null) { parts[k] = null; return; }
        const target = num(t.targets[k]), weight = num(t.weights[k]);
        const score = target > 0 ? Math.min(actual[k] / target, cap) : 0;
        parts[k] = { actual: actual[k], target, weight, score: score * 100 };
        total += score * weight; wsum += weight;
    });
    return { kpi: wsum ? (total / wsum) * 100 : 0, parts };
}
// KPI Rate of one telecollector, worked out once per record and KPI settings (records are replaced, never changed in place).
let _kpiCache = { cfg: undefined, sig: '', map: new WeakMap() };
function calculateKPIRate(i) {
    calculateKPIRate.sync();
    let v = _kpiCache.map.get(i);
    if (v === undefined) { v = kpiBreakdown(i).kpi; _kpiCache.map.set(i, v); }
    return v;
}
// Starts a fresh cache when the KPI settings really changed (a new but identical settings object keeps it).
calculateKPIRate.sync = () => {
    if (_kpiCache.cfg === state.kpi) return;
    const sig = JSON.stringify(state.kpi);
    _kpiCache = sig === _kpiCache.sig ? { ..._kpiCache, cfg: state.kpi } : { cfg: state.kpi, sig, map: new WeakMap() };
};

/* ---------- totals ----------
   Optional figures (To Retain, Target Repo, last-month figures) are summed only over the telecollectors that have them,
   and each is compared with the actuals of exactly those telecollectors, so a partly-filled file never skews a %.
   One pass over the list for everything. */
const SUM_FIELDS = ['collectibles', 'collection', 'penalty', 'repo', 'repoProv', 'beginning', 'principalBal', 'fixedProv', 'accs1',
    'ending', 'endingAccs', 'beginningAccs', 'toRetainAccs', 'fixedAccs', 'repoAge2', 'repoAge3', 'repoAge4'];
// [optional field, the actual it is compared with, total name, actual-total name]
const OPT_SUMS = [['toRetain', 'fixedProv', 'toRetain', 'fixedForRetain'], ['targetRepo', 'repo', 'targetRepoMonth', 'repoForTarget'],
    ['lmCollection', 'collection', 'lmCollection', 'collectionForLm'], ['lmSpCollection', 'collection', 'lmSpCollection', 'collectionForSp'],
    ['lmFixedProv', 'fixedProv', 'lmFixedProv', 'fixedForLm'], ['lmSpFixedProv', 'fixedProv', 'lmSpFixedProv', 'fixedForSp'],
    ['lmRepo', 'repo', 'lmRepo', 'repoForLm'], ['lmSpRepo', 'repo', 'lmSpRepo', 'repoForSp']];
// Raw (not yet rounded) totals of a list. Parts of several lists can be added together before rounding (addParts).
function sumParts(list) {
    const s = {}, n = new Array(OPT_SUMS.length).fill(0), val = n.slice(), act = n.slice();
    for (const k of SUM_FIELDS) s[k] = 0;
    for (const i of list) {
        for (const k of SUM_FIELDS) s[k] += num(i[k]);
        for (let j = 0; j < OPT_SUMS.length; j++) {
            const v = i[OPT_SUMS[j][0]];
            if (v !== null && v !== undefined) { n[j]++; val[j] += num(v); act[j] += num(i[OPT_SUMS[j][1]]); }
        }
    }
    return { s, n, val, act };
}
function addParts(a, b) {   // returns new parts; a and b are not changed (they may be cached)
    const s = {};
    for (const k of SUM_FIELDS) s[k] = a.s[k] + b.s[k];
    return { s, n: a.n.map((x, j) => x + b.n[j]), val: a.val.map((x, j) => x + b.val[j]), act: a.act.map((x, j) => x + b.act[j]) };
}
function finishStats({ s: raw, n, val, act }) {
    const s = {};
    for (const k of SUM_FIELDS) s[k] = round2(raw[k]);
    OPT_SUMS.forEach(([, , total, actual], j) => { s[total] = n[j] ? round2(val[j]) : null; s[actual] = n[j] ? round2(act[j]) : 0; });
    s.effRate = pct(s.collection, s.collectibles);
    s.penRate = pct(s.penalty, s.collection);
    s.achRate = s.toRetain === null ? null : pct(s.fixedForRetain, s.toRetain);
    return s;
}
function sumStats(list) { return finishStats(sumParts(list)); }

// ON TRACK figures for a set of totals as of `prog` (from bdProgress):
//   Collection = Collectibles ÷ business days in the month × business days up to today (today included)
//   Provision  = To Retain ÷ business days × elapsed · Repo = monthly TARGET ÷ business days × elapsed
function targetsFor(s, prog) {
    const r = prog.ratio;
    return {
        collection: round2(s.collectibles * r),
        provision: s.toRetain === null ? null : round2(s.toRetain * r),
        repo: s.targetRepoMonth === null ? null : Math.round(s.targetRepoMonth * r * 10) / 10
    };
}
// % change of this month vs last month's same period (null when last month's figure is missing or zero).
function samePeriodChange(current, lmSp) { return lmSp === null || !(lmSp > 0) ? null : ((current - lmSp) / lmSp) * 100; }

// Per-campaign totals (raw parts + KPI sums), worked out once per telecollector list and KPI settings.
let _campaignTotals = { list: null, kpi: null, map: null };
function campaignTotals() {
    calculateKPIRate.sync();
    if (_campaignTotals.list === state.collectors && _campaignTotals.kpi === _kpiCache.sig) return _campaignTotals.map;
    const map = new Map();
    dataIndex().byCampaign.forEach((members, campaign) => {
        let wsum = 0, wkpi = 0, kpiSum = 0;
        for (const m of members) { const k = calculateKPIRate(m); wsum += m.collectibles; wkpi += k * m.collectibles; kpiSum += k; }
        map.set(campaign, { parts: sumParts(members), count: members.length, wsum, wkpi, kpiSum });
    });
    _campaignTotals = { list: state.collectors, kpi: _kpiCache.sig, map };
    return map;
}
// Leader (TL/OM/GM) stats: totals of their campaigns; KPI = collectibles-weighted average of member KPIs.
// Adds up the cached campaign totals instead of going through every telecollector again for every leader.
function getConsolidatedStats(campaigns) {
    const totals = campaignTotals();
    let parts = null, count = 0, wsum = 0, wkpi = 0, kpiSum = 0;
    for (const c of uniq(campaigns)) {
        const t = totals.get(c); if (!t) continue;
        parts = parts ? addParts(parts, t.parts) : t.parts;
        count += t.count; wsum += t.wsum; wkpi += t.wkpi; kpiSum += t.kpiSum;
    }
    const s = finishStats(parts || sumParts([]));
    s.kpiRate = count ? (wsum > 0 ? wkpi / wsum : kpiSum / count) : 0;
    s.memberCount = count;
    return s;
}

// Rank by a field (descending). Ties share a rank and the next rank follows without a gap (1, 1, 2, 3), e.g. an OM and
// an AOM who handle the same campaigns. Blank (null) values rank last.
// Rows that fail `rankable` (e.g. no figures yet) get no rank (null, shown as "—") instead of all tying at Rank 1.
function getAssignedRanks(list, field = 'kpiRate', rankable = () => true) {
    const v = x => (x[field] === null || x[field] === undefined ? -Infinity : x[field]);
    const ranked = list.filter(rankable).sort((a, b) => v(b) - v(a)), rest = list.filter(x => !rankable(x));
    let rank = 1;
    return ranked.map((x, i) => { if (i > 0 && Math.abs(v(x) - v(ranked[i - 1])) > 0.001) rank++; return { ...x, assignedRank: rank }; })
        .concat(rest.map(x => ({ ...x, assignedRank: null })));
}
// A KPI Rate of 0 means there are no figures to score yet (e.g. right after Start new month, or a file without numbers).
const hasKpi = x => x.kpiRate > 0.0001;

/* ---------- ranked lists shared by the dashboard and the Excel / PDF exports ---------- */
function rankedTeles(team, list = state.collectors) {
    return getAssignedRanks(list.filter(i => i.team === team).map(i => ({ ...i, kpiRate: calculateKPIRate(i) })), 'kpiRate', hasKpi);
}
function rankedLeaders(type, campaignFilter = 'ALL') {
    return getAssignedRanks((state.leaders[type] || [])
        .map((l, idx) => ({ idx, name: l.name, campaigns: l.campaigns, ...getConsolidatedStats(l.campaigns) }))
        .filter(i => campaignFilter === 'ALL' || i.campaigns.includes(campaignFilter)), 'kpiRate', hasKpi);
}
function campaignStatsList(list = state.collectors) {
    const groups = list === state.collectors ? dataIndex().byCampaign : groupBy(list, c => c.campaign);
    return [...groups].filter(([name]) => name).map(([name, members]) => ({ name, ...sumStats(members) }));
}

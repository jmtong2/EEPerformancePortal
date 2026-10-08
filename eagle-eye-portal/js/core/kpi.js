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
function calculateKPIRate(i) { return kpiBreakdown(i).kpi; }

/* ---------- totals ----------
   Optional figures (To Retain, Target Repo, last-month figures) are summed only over the telecollectors that have them,
   and each is compared with the actuals of exactly those telecollectors, so a partly-filled file never skews a %. */
function sumOpt(list, field, actualField) {
    const have = list.filter(i => i[field] !== null && i[field] !== undefined);
    if (!have.length) return { value: null, actual: 0 };
    return { value: round2(have.reduce((a, i) => a + num(i[field]), 0)), actual: round2(have.reduce((a, i) => a + num(i[actualField]), 0)) };
}
function sumStats(list) {
    const s = { collectibles: 0, collection: 0, penalty: 0, repo: 0, repoProv: 0, beginning: 0, principalBal: 0, fixedProv: 0, accs1: 0,
        ending: 0, endingAccs: 0, beginningAccs: 0, toRetainAccs: 0, fixedAccs: 0, repoAge2: 0, repoAge3: 0, repoAge4: 0 };
    list.forEach(i => Object.keys(s).forEach(k => s[k] += num(i[k])));
    Object.keys(s).forEach(k => s[k] = round2(s[k]));
    const ret = sumOpt(list, 'toRetain', 'fixedProv'), trep = sumOpt(list, 'targetRepo', 'repo');
    const lmC = sumOpt(list, 'lmCollection', 'collection'), spC = sumOpt(list, 'lmSpCollection', 'collection');
    const lmF = sumOpt(list, 'lmFixedProv', 'fixedProv'), spF = sumOpt(list, 'lmSpFixedProv', 'fixedProv');
    const lmR = sumOpt(list, 'lmRepo', 'repo'), spR = sumOpt(list, 'lmSpRepo', 'repo');
    Object.assign(s, {
        toRetain: ret.value, fixedForRetain: ret.actual,
        targetRepoMonth: trep.value, repoForTarget: trep.actual,
        lmCollection: lmC.value, collectionForLm: lmC.actual, lmSpCollection: spC.value, collectionForSp: spC.actual,
        lmFixedProv: lmF.value, fixedForLm: lmF.actual, lmSpFixedProv: spF.value, fixedForSp: spF.actual,
        lmRepo: lmR.value, repoForLm: lmR.actual, lmSpRepo: spR.value, repoForSp: spR.actual
    });
    s.effRate = pct(s.collection, s.collectibles);
    s.penRate = pct(s.penalty, s.collection);
    s.achRate = s.toRetain === null ? null : pct(s.fixedForRetain, s.toRetain);
    return s;
}

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

// Leader (TL/OM/GM) stats: totals of their campaigns; KPI = collectibles-weighted average of member KPIs.
function getConsolidatedStats(campaigns) {
    const members = state.collectors.filter(c => campaigns.includes(c.campaign));
    const s = sumStats(members);
    const wsum = members.reduce((a, m) => a + m.collectibles, 0);
    s.kpiRate = members.length ? (wsum > 0 ? members.reduce((a, m) => a + calculateKPIRate(m) * m.collectibles, 0) / wsum : members.reduce((a, m) => a + calculateKPIRate(m), 0) / members.length) : 0;
    s.memberCount = members.length;
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
    return uniq(list.map(c => c.campaign)).map(name => ({ name, ...sumStats(list.filter(c => c.campaign === name)) }));
}

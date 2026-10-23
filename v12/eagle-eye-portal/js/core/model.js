/* App state, roles and the telecollector data model (keys, normalisation, de-duplication). */

let state = emptyState();
let currentUser = null;
let currentActiveTab = 'co-collection';
let Backend = null; // SupabaseBackend (set in app.js)

function emptyState() {
    return { campaigns: [], collectors: [], leaders: { tl: [], om: [], gm: [] }, entries: [], kpi: null, lastImportAt: 0, snapshot: null,
        currentPeriod: null, asOf: null, holidays: [], resetRequests: [], schemaVersion: null, dataRev: null, fullRev: null, settingsRev: null, kpiCap: null };
}

/* ---------- roles ---------- */
const ROLE = { ADMIN: 'Admin', MGMT: 'Management', ANALYST: 'Analyst' };
const ROLES = [ROLE.ADMIN, ROLE.MGMT, ROLE.ANALYST];
const isAdmin = () => !!currentUser && currentUser.role === ROLE.ADMIN;                                   // users, TL/OM/GM, Data menu
const canEdit = () => !!currentUser && (currentUser.role === ROLE.ADMIN || currentUser.role === ROLE.MGMT); // teles, daily entries
const canChangeOwnPassword = () => canEdit();                                                             // Analysts cannot

/* ---------- names & keys ---------- */
// "kim - mark  moreno" -> "KIM-MARK MORENO"
function cleanName(s) { return String(s || '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim(); }
// Matching ignores spaces/punctuation, so "KIM MARK MORENO" and "KIM-MARK MORENO" are the same person.
function slug(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9Ñ]/g, ''); }
// One tele = one record per campaign + bucket. This key is what prevents duplicates.
function collectorKey(campaign, team, name) { return `${slug(campaign)}__${team}__${slug(name)}`; }

// Optional number: blank / missing -> null (shown as "—"), otherwise rounded to 2 decimals.
const optNum = v => (v === null || v === undefined || v === '' ? null : (isFinite(parseFloat(v)) ? round2(parseFloat(v)) : null));
// Fields that may legitimately be blank until the source file provides them.
//   lmSp* = SAME PERIOD figures (last month at the same point of the month). The other lm* / principalBal / repoProv
//   fields are from v7 sources; they are kept in the database but no longer shown.
const OPTIONAL_FIELDS = ['toRetain', 'targetRepo', 'lmCollection', 'lmSpCollection', 'lmFixedProv', 'lmSpFixedProv', 'lmRepo', 'lmSpRepo'];

function makeCollector(o) {
    const team = o.team === 'recovery' ? 'recovery' : 'curing';
    const campaign = cleanName(o.campaign), name = cleanName(o.name);
    const int = v => Math.trunc(num(v)), amt = v => round2(num(v));
    return {
        key: collectorKey(campaign, team, name), team, campaign, name,
        // COLLECTION
        accs1: int(o.accs1), collectibles: amt(o.collectibles), collection: amt(o.collection), penalty: amt(o.penalty), lmSpCollection: optNum(o.lmSpCollection),
        // PROVISION: each figure has its own # of accounts
        endingAccs: int(o.endingAccs), ending: amt(o.ending), beginningAccs: int(o.beginningAccs), beginning: amt(o.beginning),
        toRetainAccs: int(o.toRetainAccs), toRetain: optNum(o.toRetain), fixedAccs: int(o.fixedAccs), fixedProv: amt(o.fixedProv), lmSpFixedProv: optNum(o.lmSpFixedProv),
        // REPO: by age (2nd month, 3rd month, 4th month and up), monthly TARGET, ACTUAL (= repo)
        repoAge2: amt(o.repoAge2), repoAge3: amt(o.repoAge3), repoAge4: amt(o.repoAge4), targetRepo: optNum(o.targetRepo), repo: int(o.repo), lmSpRepo: optNum(o.lmSpRepo),
        // kept for older data
        principalBal: amt(o.principalBal), repoProv: amt(o.repoProv), lmCollection: optNum(o.lmCollection), lmFixedProv: optNum(o.lmFixedProv), lmRepo: optNum(o.lmRepo)
    };
}

// Merges records that are the same person (protects against duplicates in imported data).
function dedupeCollectors(list) {
    const map = new Map(); let merged = 0;
    (list || []).forEach(raw => {
        const c = makeCollector(raw), ex = map.get(c.key);
        if (!ex) { map.set(c.key, c); return; }
        merged++;
        ['collection', 'penalty', 'repo', 'repoProv', 'repoAge2', 'repoAge3', 'repoAge4'].forEach(k => ex[k] += c[k]);
        ['accs1', 'collectibles', 'beginning', 'beginningAccs', 'ending', 'endingAccs', 'toRetainAccs', 'fixedAccs', 'principalBal', 'fixedProv'].forEach(k => ex[k] = Math.max(ex[k], c[k]));
        OPTIONAL_FIELDS.forEach(k => { if (ex[k] === null) ex[k] = c[k]; });
    });
    return { list: [...map.values()], merged };
}

/* ---------- sanitising anything that comes from the database or imports ---------- */
// KPI settings from the database; anything missing or invalid falls back to DEFAULT_KPI (the standard targets and weights).
// (A missing weight must NOT count as 0 — that made every KPI Rate 0% and put everyone at Rank 1.)
function sanitizeKpi(k) {
    const d = DEFAULT_KPI, given = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
    const cap = k && given(k.cap) ? Number(k.cap) : NaN;
    const out = { cap: cap >= 100 && cap <= 200 ? cap : d.cap };
    ['curing', 'recovery'].forEach(t => {
        out[t] = { weights: {}, targets: {} };
        const src = k && k[t] ? k[t] : {};
        ['collection', 'penalty', 'provision', 'repo'].forEach(p => {
            const w = src.weights && given(src.weights[p]) ? Number(src.weights[p]) : NaN;
            const g = src.targets && given(src.targets[p]) ? Number(src.targets[p]) : NaN;
            out[t].weights[p] = w >= 0 && w <= 100 ? w : d[t].weights[p];
            out[t].targets[p] = g > 0 && g <= 100 ? g : d[t].targets[p];
        });
        if (!Object.values(out[t].weights).some(w => w > 0)) out[t].weights = { ...d[t].weights };   // all-zero weights are never valid
    });
    return out;
}
function sanitizeLeaders(L) {
    const out = { tl: [], om: [], gm: [] };
    ['tl', 'om', 'gm'].forEach(t => (Array.isArray(L && L[t]) ? L[t] : []).forEach(l => {
        const name = cleanName(sanitizeText(l && l.name, 80));
        const campaigns = uniq((Array.isArray(l && l.campaigns) ? l.campaigns : []).map(c => cleanName(sanitizeText(c, 60))));
        if (name && campaigns.length) out[t].push({ name, campaigns });
    }));
    return out;
}
function sanitizeHolidays(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map(h => (typeof h === 'string' ? { date: h, name: '' } : { date: h && h.date, name: sanitizeText(h && h.name, 60) }))
        .filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date || '') && !seen.has(h.date) && seen.add(h.date))
        .sort((a, b) => a.date.localeCompare(b.date));
}
function sanitizeEntry(e) {
    return {
        id: sanitizeText(e.id, 64) || ('e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        key: sanitizeText(e.key, 200), campaign: cleanName(sanitizeText(e.campaign, 60)), team: e.team === 'recovery' ? 'recovery' : 'curing',
        name: cleanName(sanitizeText(e.name, 80)), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : todayStr(),
        collection: round2(num(e.collection)), penalty: round2(num(e.penalty)), beginning: round2(num(e.beginning)), toRetain: round2(num(e.toRetain)),
        fixedProv: round2(num(e.fixedProv)), repo: Math.trunc(num(e.repo)), repoProv: round2(num(e.repoProv)),
        by: sanitizeText(e.by, 128), byName: sanitizeText(e.byName, 80), ts: num(e.ts) || Date.now()
    };
}

/* ---------- lookups, built once per telecollector list ----------
   state.collectors is always replaced, never changed in place, so the list's identity tells whether these are current.
   byKey: key -> telecollector · byCampaign / byGroup ("CAMPAIGN|team"): lists in list order, first-seen campaign order
   · colorIndex: campaign -> position in the alphabetical list (fixed chart colours). */
let _index = { list: null };
function dataIndex() {
    if (_index.list === state.collectors) return _index;
    const byKey = new Map(), byCampaign = groupBy(state.collectors, c => c.campaign), byGroup = groupBy(state.collectors, c => `${c.campaign}|${c.team}`);
    for (const c of state.collectors) byKey.set(c.key, c);
    const sorted = [...byCampaign.keys()].filter(Boolean).sort();
    _index = { list: state.collectors, byKey, byCampaign, byGroup, colorIndex: new Map(sorted.map((c, i) => [c, i])) };
    return _index;
}
// Campaigns from the settings, then the ones in the data. The same (frozen) array until either changes.
let _campaigns = { list: null, extra: null, out: [] };
function allCampaigns() {
    if (_campaigns.list !== state.collectors || _campaigns.extra !== state.campaigns)
        _campaigns = { list: state.collectors, extra: state.campaigns, out: Object.freeze(uniq([...state.campaigns, ...dataIndex().byCampaign.keys()])) };
    return _campaigns.out;
}
function leaderCampaigns(leaders = state.leaders) { return uniq(['tl', 'om', 'gm'].flatMap(t => (leaders[t] || []).flatMap(l => l.campaigns || []))); }
function findCollector(key) { return dataIndex().byKey.get(key); }
// slug(name) per telecollector, worked out once (used by the similar-name checks).
const _slugs = new WeakMap();
function nameSlug(c) { let s = _slugs.get(c); if (s === undefined) { s = slug(c.name); _slugs.set(c, s); } return s; }
function dupError(c) {
    const ex = findCollector(c.key) || c;
    const e = new Error(`${ex.name} already exists in ${ex.campaign} (${ex.team}). Use "Daily Log-in Entry" to add production to the existing record.`);
    e.dupKey = c.key; return e;
}

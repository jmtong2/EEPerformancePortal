/* App state, roles and the telecollector data model (keys, normalisation, de-duplication). */

let state = emptyState();
let currentUser = null;
let currentActiveTab = 'co-collection';
let Backend = null; // SupabaseBackend (set in app.js)

function emptyState() {
    return { campaigns: [], collectors: [], leaders: { tl: [], om: [], gm: [] }, entries: [], kpi: null, lastImportAt: 0, snapshot: null,
        currentPeriod: null, asOf: null, holidays: [] };
}

/* ---------- roles ---------- */
const ROLE = { ADMIN: 'Admin', MGMT: 'Management', ANALYST: 'Analyst' };
const ROLES = [ROLE.ADMIN, ROLE.MGMT, ROLE.ANALYST];
const isAdmin = () => !!currentUser && currentUser.role === ROLE.ADMIN;                                   // users + Data menu
const canEdit = () => !!currentUser && (currentUser.role === ROLE.ADMIN || currentUser.role === ROLE.MGMT); // teles, TL/OM/GM, daily entries
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
const OPTIONAL_FIELDS = ['toRetain', 'targetRepo', 'lmCollection', 'lmSpCollection', 'lmFixedProv', 'lmSpFixedProv', 'lmRepo', 'lmSpRepo'];

function makeCollector(o) {
    const team = o.team === 'recovery' ? 'recovery' : 'curing';
    const campaign = cleanName(o.campaign), name = cleanName(o.name);
    return {
        key: collectorKey(campaign, team, name), team, campaign, name,
        accs1: Math.trunc(num(o.accs1)), collectibles: round2(num(o.collectibles)), collection: round2(num(o.collection)), penalty: round2(num(o.penalty)),
        beginning: round2(num(o.beginning)), principalBal: round2(num(o.principalBal)), toRetain: optNum(o.toRetain),
        fixedProv: round2(num(o.fixedProv)), targetRepo: optNum(o.targetRepo), repo: Math.trunc(num(o.repo)), repoProv: round2(num(o.repoProv)),
        lmCollection: optNum(o.lmCollection), lmSpCollection: optNum(o.lmSpCollection), lmFixedProv: optNum(o.lmFixedProv),
        lmSpFixedProv: optNum(o.lmSpFixedProv), lmRepo: optNum(o.lmRepo), lmSpRepo: optNum(o.lmSpRepo)
    };
}

// Merges records that are the same person (protects against duplicates in imported data).
function dedupeCollectors(list) {
    const map = new Map(); let merged = 0;
    (list || []).forEach(raw => {
        const c = makeCollector(raw), ex = map.get(c.key);
        if (!ex) { map.set(c.key, c); return; }
        merged++;
        ['collection', 'penalty', 'repo', 'repoProv'].forEach(k => ex[k] += c[k]);
        ['accs1', 'collectibles', 'beginning', 'principalBal', 'fixedProv'].forEach(k => ex[k] = Math.max(ex[k], c[k]));
        OPTIONAL_FIELDS.forEach(k => { if (ex[k] === null) ex[k] = c[k]; });
    });
    return { list: [...map.values()], merged };
}

/* ---------- sanitising anything that comes from the database or imports ---------- */
function sanitizeKpi(k) {
    const d = DEFAULT_KPI, out = { cap: num(k && k.cap) >= 100 && num(k && k.cap) <= 200 ? num(k.cap) : d.cap };
    ['curing', 'recovery'].forEach(t => {
        out[t] = { weights: {}, targets: {} };
        ['collection', 'penalty', 'provision', 'repo'].forEach(p => {
            const w = num(k && k[t] && k[t].weights && k[t].weights[p]), g = num(k && k[t] && k[t].targets && k[t].targets[p]);
            out[t].weights[p] = w >= 0 && w <= 100 ? w : d[t].weights[p];
            out[t].targets[p] = g > 0 && g <= 100 ? g : d[t].targets[p];
        });
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

function allCampaigns() { return uniq([...state.campaigns, ...state.collectors.map(c => c.campaign)]); }
function leaderCampaigns(leaders = state.leaders) { return uniq(['tl', 'om', 'gm'].flatMap(t => (leaders[t] || []).flatMap(l => l.campaigns || []))); }
function findCollector(key) { return state.collectors.find(c => c.key === key); }
function dupError(c) {
    const ex = findCollector(c.key) || c;
    const e = new Error(`${ex.name} already exists in ${ex.campaign} (${ex.team}). Use "Daily Log-in Entry" to add production to the existing record.`);
    e.dupKey = c.key; return e;
}

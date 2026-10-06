/* LOCAL backend: runs the portal without Supabase. Everything is stored in THIS browser on THIS PC (localStorage).
   It is an in-browser stand-in for the Supabase client, so the rest of the portal works exactly the same way:
   · the same database functions as database/supabase-setup.sql (role checks, data checks, all-or-nothing changes);
   · the same login flow (passwords are stored only as salted PBKDF2 hashes);
   · live refresh between tabs of the same browser.
   Data is NOT shared with other PCs or browsers. Back it up with Data → Export to Excel; to move to Supabase, import that file there.
   Note: on a shared PC, anyone with access to this browser profile can read the stored data. */

const LOCAL_STORE_KEY = 'eeportal-local-v7';

const EELocal = (() => {
    const clone = o => JSON.parse(JSON.stringify(o));
    const r2 = n => Math.round(Number(n || 0) * 100) / 100;
    const optR2 = v => (v === null || v === undefined || v === '' ? null : r2(v));
    const today = () => todayStr();
    const nowMs = () => Date.now();
    const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'l-' + nowMs().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
    const OPT = ['to_retain', 'target_repo', 'lm_collection', 'lm_sp_collection', 'lm_fixed_prov', 'lm_sp_fixed_prov', 'lm_repo', 'lm_sp_repo'];

    class PgError extends Error { constructor(message, code = 'P0001') { super(message); this.code = code; } }
    const raise = (m, c) => { throw new PgError(m, c); };

    /* ---------- storage: one JSON document in localStorage, written all at once ---------- */
    const emptyStore = () => ({ v: 1, users: [], db: { profiles: [], collectors: [], entries: [], snapshots: null, snapshot_data: null, baseline: null, reset_requests: [],
        config: { id: 1, campaigns: [], leaders: { tl: [], om: [], gm: [] }, kpi: null, last_import_at: 0, current_period: null, as_of: null,
            holidays: clone(DEFAULT_HOLIDAYS), schema_version: 7 } } });
    function readStore() {
        const raw = localStorage.getItem(LOCAL_STORE_KEY);
        if (!raw) return emptyStore();
        const s = JSON.parse(raw);
        if (!s || !s.db || !Array.isArray(s.users)) throw new Error('The local data in this browser is damaged. Use Data → Undo if available, or clear this site\'s data and import the Excel file again.');
        return s;
    }
    function writeStore(s) {
        try { localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(s)); }
        catch (e) { raise('This browser\'s storage is full (about 5 MB). Export to Excel, then import a new month\'s file with "Replace all data" (it clears the old entries log).', 'LOCAL_FULL'); }
    }

    /* ---------- passwords: PBKDF2-SHA256, random salt ---------- */
    const toB64 = bytes => btoa(String.fromCharCode(...bytes));
    const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    async function hashPassword(password, saltB64) {
        const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
        return { salt: toB64(salt), hash: toB64(new Uint8Array(bits)) };
    }
    // Same e-mail format rule as Supabase Auth.
    const badEmail = email => !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email);

    /* ---------- the database functions (same names, parameters and rules as supabase-setup.sql) ---------- */
    const me = (d, uid) => d.profiles.find(p => p.id === uid);
    const isActive = (d, uid) => { const p = me(d, uid); return !!p && p.active; };
    const isEditor = (d, uid) => { const p = me(d, uid); return !!p && p.active && ['Admin', 'Management'].includes(p.role); };
    const isAdmin = (d, uid) => { const p = me(d, uid); return !!p && p.active && p.role === 'Admin'; };

    function checkCollector(c) {
        const bad = !['curing', 'recovery'].includes(c.team) || !/^[A-ZÑ0-9 .,'-]{1,60}$/.test(c.campaign || '') || !/^[A-ZÑ .,'-]{1,80}$/.test(c.name || '')
            || !(c.accs1 >= 0) || !(c.collectibles >= 0) || !(c.beginning >= 0) || !(c.principal_bal >= 0)
            || ['ending', 'ending_accs', 'beginning_accs', 'to_retain_accs', 'fixed_accs', 'repo_age2', 'repo_age3', 'repo_age4'].some(f => !(c[f] >= 0))
            || OPT.some(f => c[f] !== null && !(c[f] >= 0))
            || !(c.beginning === 0 || c.to_retain === null || c.to_retain <= c.beginning + 1e-9)
            || !c.key || c.key.length > 200;
        if (bad) raise('new row for relation "collectors" violates check constraint', '23514');
    }
    function checkEntry(e) { if (['collection', 'penalty', 'beginning', 'to_retain', 'fixed_prov', 'repo', 'repo_prov'].some(f => !(e[f] >= 0))) raise('entries check constraint', '23514'); }
    // Same defaults as _upsert_collectors: required numbers -> 0, optional ones stay blank (null).
    const colRow = p => ({ key: p.key, team: p.team, campaign: p.campaign, name: p.name, accs1: Math.trunc(Number(p.accs1 || 0)), collectibles: r2(p.collectibles),
        collection: r2(p.collection), penalty: r2(p.penalty), beginning: r2(p.beginning), principal_bal: r2(p.principal_bal), to_retain: optR2(p.to_retain),
        fixed_prov: r2(p.fixed_prov), target_repo: optR2(p.target_repo), repo: Math.trunc(Number(p.repo || 0)), repo_prov: r2(p.repo_prov),
        lm_collection: optR2(p.lm_collection), lm_sp_collection: optR2(p.lm_sp_collection), lm_fixed_prov: optR2(p.lm_fixed_prov), lm_sp_fixed_prov: optR2(p.lm_sp_fixed_prov),
        lm_repo: optR2(p.lm_repo), lm_sp_repo: optR2(p.lm_sp_repo),
        ending: r2(p.ending), ending_accs: Math.trunc(Number(p.ending_accs || 0)), beginning_accs: Math.trunc(Number(p.beginning_accs || 0)),
        to_retain_accs: Math.trunc(Number(p.to_retain_accs || 0)), fixed_accs: Math.trunc(Number(p.fixed_accs || 0)),
        repo_age2: r2(p.repo_age2), repo_age3: r2(p.repo_age3), repo_age4: r2(p.repo_age4),
        updated_at: new Date().toISOString(), updated_by: p.updated_by || null });
    function upsert(d, rows, who) {
        rows.forEach(x => { const row = colRow({ ...x, updated_by: who || x.updated_by }); checkCollector(row); const i = d.collectors.findIndex(y => y.key === row.key); if (i >= 0) d.collectors[i] = row; else d.collectors.push(row); });
    }
    const currentData = d => ({ collectors: d.collectors.map(c => { const x = { ...c }; delete x.updated_at; return x; }), entries: clone(d.entries),
        config: (() => { const c = clone(d.config); delete c.id; delete c.schema_version; return c; })() });
    function takeSnapshot(d, uid, reason) {
        d.snapshot_data = { id: 1, data: clone(currentData(d)) };
        d.snapshots = { id: 1, reason, taken_at: nowMs(), taken_by: (me(d, uid) || {}).display_name || '', counts: { collectors: d.collectors.length, entries: d.entries.length } };
    }
    function restoreData(d, p) {
        d.entries = []; d.collectors = [];
        const cf = (p && p.config) || {};
        d.config.campaigns = cf.campaigns || []; d.config.leaders = cf.leaders || { tl: [], om: [], gm: [] }; d.config.kpi = cf.kpi === undefined ? null : cf.kpi;
        d.config.last_import_at = Number(cf.last_import_at || 0);
        d.config.current_period = cf.current_period || null; d.config.as_of = cf.as_of || null;
        if (Array.isArray(cf.holidays)) d.config.holidays = cf.holidays;
        upsert(d, p.collectors || [], null);
        (p.entries || []).forEach(x => { const e = { id: x.id || newId(), key: x.key, campaign: x.campaign, team: x.team, name: x.name, date: x.date || today(),
            collection: r2(x.collection), penalty: r2(x.penalty), beginning: r2(x.beginning), to_retain: r2(x.to_retain), fixed_prov: r2(x.fixed_prov), repo: Math.trunc(Number(x.repo || 0)),
            repo_prov: r2(x.repo_prov), by_uid: x.by_uid || null, by_name: x.by_name || null, ts: x.ts || new Date().toISOString() }; checkEntry(e); d.entries.push(e); });
    }
    const validPeriod = p => p === null || /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(p);
    const validDate = s => s === null || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)));
    const shiftMonth = p => { const [y, m] = p.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

    // run(store, uid, args): changes store.db (and store.users) in place; prepare(args) runs first for async work (password hashing).
    const FN = {
        needs_setup: { params: [], anon: true, readOnly: true, run: s => s.db.profiles.length === 0 },
        // Forgot password: anyone may ask; the answer is the same whether or not the username exists.
        request_password_reset: { params: ['p_username'], anon: true, run: (s, uid, a) => {
            const d = s.db, u = String(a.p_username || '').trim().toLowerCase();
            d.reset_requests = d.reset_requests || [];
            if (!/^[a-z0-9._-]{3,30}$/.test(u) || !d.profiles.some(p => p.username === u) || d.reset_requests.length >= 100) return;
            d.reset_requests = d.reset_requests.filter(r => r.username !== u);
            d.reset_requests.push({ id: newId(), username: u, requested_at: new Date().toISOString() });
        } },
        admin_dismiss_reset_request: { params: ['p_id'], run: (s, uid, a) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can manage password requests');
            d.reset_requests = (d.reset_requests || []).filter(r => r.id !== a.p_id);
        } },
        claim_first_admin: { params: ['p_username', 'p_display_name'], run: (s, uid, a) => {
            const d = s.db; if (!uid) raise('Not signed in'); if (d.profiles.length) raise('Setup was already completed');
            d.profiles.push({ id: uid, username: String(a.p_username).toLowerCase(), display_name: String(a.p_display_name).toUpperCase(), role: 'Admin', active: true, created_at: new Date().toISOString() });
        } },
        admin_create_profile: { params: ['p_uid', 'p_username', 'p_display_name', 'p_role'], run: (s, uid, a) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can add users'); if (!['Admin', 'Management', 'Analyst'].includes(a.p_role)) raise('Unknown role');
            if (!s.users.some(u => u.id === a.p_uid)) raise('Login not found');
            if (!/^[a-z0-9._-]{3,30}$/.test(String(a.p_username).toLowerCase())) raise('new row for relation "profiles" violates check constraint', '23514');
            if (d.profiles.some(p => p.username === String(a.p_username).toLowerCase())) raise('Username already exists');
            d.profiles.push({ id: a.p_uid, username: String(a.p_username).toLowerCase(), display_name: a.p_display_name, role: a.p_role, active: true, created_at: new Date().toISOString() });
        } },
        admin_update_user: { params: ['p_uid', 'p_role', 'p_active'], optional: ['p_role', 'p_active'], run: (s, uid, a) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can manage users'); if (a.p_uid === uid) raise('You cannot change your own role or status');
            if (a.p_role != null && !['Admin', 'Management', 'Analyst'].includes(a.p_role)) raise('Unknown role');
            const p = d.profiles.find(x => x.id === a.p_uid); if (!p) raise('User not found');
            if (a.p_role != null) p.role = a.p_role; if (a.p_active != null) p.active = !!a.p_active;
        } },
        admin_delete_user: { params: ['p_uid'], run: (s, uid, a) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can delete users'); if (a.p_uid === uid) raise('You cannot delete yourself');
            s.users = s.users.filter(u => u.id !== a.p_uid);
            d.profiles = d.profiles.filter(p => p.id !== a.p_uid);
        } },
        admin_set_password: { params: ['p_uid', 'p_password'],
            prepare: async a => { if (String(a.p_password || '').length < minPasswordLength()) raise(`Password must be at least ${minPasswordLength()} characters`); return { ...a, hashed: await hashPassword(a.p_password) }; },
            run: (s, uid, a) => {
                if (!isAdmin(s.db, uid)) raise('Only the Admin can reset passwords');
                const u = s.users.find(x => x.id === a.p_uid); if (!u) raise('User not found');
                Object.assign(u, a.hashed);
                const p = s.db.profiles.find(x => x.id === a.p_uid);
                if (p) s.db.reset_requests = (s.db.reset_requests || []).filter(r => r.username !== p.username);   // request handled
            } },
        add_daily_entry: { params: ['p_key', 'p_date', 'p_collection', 'p_penalty', 'p_fixed_prov', 'p_repo', 'p_repo_prov'], run: (s, uid, a) => {
            const d = s.db, m = me(d, uid); if (!m || !m.active || !['Admin', 'Management'].includes(m.role)) raise('Only Admin and Management can submit daily entries');
            const v = { c: Number(a.p_collection || 0), pe: Number(a.p_penalty || 0), f: Number(a.p_fixed_prov || 0), r: Number(a.p_repo || 0), rp: Number(a.p_repo_prov || 0) };
            if (!Number.isInteger(v.r)) raise('invalid input syntax for type integer', '22P02');
            if (Object.values(v).some(x => !isFinite(x) || x < 0)) raise('Amounts cannot be negative');
            if (Object.values(v).every(x => x === 0)) raise('Enter at least one amount');
            if (!validDate(a.p_date || null) || !a.p_date || a.p_date > today()) raise('Date cannot be in the future');
            const c = d.collectors.find(x => x.key === a.p_key); if (!c) raise('Telecollector not found. Add them first via Add Tele Collector.');
            if (c.accs1 > 0 && c.repo + v.r > c.accs1) raise(`Repo cannot exceed the number of accounts (${c.accs1})`);
            Object.assign(c, { collection: r2(c.collection + v.c), penalty: r2(c.penalty + v.pe), fixed_prov: r2(c.fixed_prov + v.f), repo: c.repo + v.r,
                repo_prov: r2(c.repo_prov + v.rp), updated_at: new Date().toISOString(), updated_by: m.username });
            checkCollector(c);
            const e = { id: newId(), key: c.key, campaign: c.campaign, team: c.team, name: c.name, date: a.p_date, collection: r2(v.c), penalty: r2(v.pe), beginning: 0,
                to_retain: 0, fixed_prov: r2(v.f), repo: v.r, repo_prov: r2(v.rp), by_uid: uid, by_name: m.display_name, ts: new Date().toISOString() };
            checkEntry(e); d.entries.push(e);
            if (d.config.current_period === null || d.config.current_period === a.p_date.slice(0, 7)) d.config.as_of = d.config.as_of && d.config.as_of > a.p_date ? d.config.as_of : a.p_date;
        } },
        delete_entry: { params: ['p_id'], run: (s, uid, a) => {
            const d = s.db; if (!isEditor(d, uid)) raise('Only Admin and Management can undo entries');
            const e = d.entries.find(x => x.id === a.p_id); if (!e) return;
            d.entries = d.entries.filter(x => x.id !== a.p_id);
            if (d.config.last_import_at > 0 && Date.parse(e.ts) < d.config.last_import_at) raise('This entry was made before the last Excel import or new month, so it cannot be undone');
            const c = d.collectors.find(x => x.key === e.key);
            if (c) {
                Object.assign(c, { collection: r2(c.collection - e.collection), penalty: r2(c.penalty - e.penalty), beginning: r2(c.beginning - e.beginning),
                    to_retain: c.to_retain === null ? null : r2(c.to_retain - e.to_retain), fixed_prov: r2(c.fixed_prov - e.fixed_prov), repo: c.repo - e.repo, repo_prov: r2(c.repo_prov - e.repo_prov) });
                try { checkCollector(c); } catch { raise('Undoing this entry would make Beginning lower than To Retain. Edit To Retain first.'); }
            }
        } },
        save_collector: { params: ['p_old_key', 'p'], run: (s, uid, a) => {
            const d = s.db; if (!isEditor(d, uid)) raise('Only Admin and Management can add or edit telecollectors');
            const p = a.p || {}, k = p.key; if (!k) raise('Missing telecollector key');
            if ((a.p_old_key == null || a.p_old_key !== k) && d.collectors.some(x => x.key === k)) raise('DUPLICATE:' + k);
            if (a.p_old_key != null && a.p_old_key !== k) d.collectors = d.collectors.filter(x => x.key !== a.p_old_key);
            try { upsert(d, [p], (me(d, uid) || {}).username); } catch { raise('Invalid telecollector data (check the name, negative values, and that To Retain is not more than Beginning)'); }
            if (a.p_old_key != null && a.p_old_key !== k) d.entries.forEach(e => { if (e.key === a.p_old_key) Object.assign(e, { key: k, name: p.name, campaign: p.campaign, team: p.team }); });
            if (!d.config.campaigns.includes(p.campaign)) d.config.campaigns.push(p.campaign);
        } },
        delete_collector: { params: ['p_key'], run: (s, uid, a) => {
            const d = s.db; if (!isEditor(d, uid)) raise('Only Admin and Management can delete telecollectors');
            d.collectors = d.collectors.filter(x => x.key !== a.p_key);
        } },
        save_config: { params: ['p'], run: (s, uid, a) => {
            const d = s.db; if (!isEditor(d, uid)) raise('Only Admin and Management can change settings');
            const p = a.p || {};
            if (['kpi', 'current_period', 'as_of', 'holidays'].some(k => k in p) && !isAdmin(d, uid)) raise('Only the Admin can change KPI settings, the month and holidays');
            if ('campaigns' in p && !Array.isArray(p.campaigns)) raise('Invalid campaigns');
            if ('leaders' in p && (!p.leaders || typeof p.leaders !== 'object' || Array.isArray(p.leaders))) raise('Invalid TL/OM/GM data');
            if ('holidays' in p && !Array.isArray(p.holidays)) raise('Invalid holidays');
            if (('current_period' in p && !validPeriod(p.current_period || null)) || ('as_of' in p && !validDate(p.as_of || null))) raise('Invalid month or date (month must look like 2026-10, dates like 2026-10-05)');
            ['campaigns', 'leaders', 'kpi', 'holidays'].forEach(k => { if (k in p) d.config[k] = p[k]; });
            if ('current_period' in p) d.config.current_period = p.current_period || null;
            if ('as_of' in p) d.config.as_of = p.as_of || null;
        } },
        admin_delete_all: { params: [], run: (s, uid) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can delete all data');
            takeSnapshot(d, uid, 'Delete all data'); d.entries = []; d.collectors = [];
        } },
        admin_undo_last: { params: [], run: (s, uid) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can undo');
            if (!d.snapshots) raise('Nothing to undo');
            if (!d.snapshot_data) raise('The undo copy is missing, so it cannot be restored');
            const m = d.snapshots; restoreData(d, d.snapshot_data.data); d.snapshots = null; d.snapshot_data = null;
            return { reason: m.reason, takenAt: m.taken_at, takenBy: m.taken_by };
        } },
        admin_import_collectors: { params: ['p_records', 'p_mode', 'p_label', 'p_meta'], run: (s, uid, a) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can import Excel files');
            if (!['replace', 'merge'].includes(a.p_mode)) raise('Unknown import mode');
            if (!Array.isArray(a.p_records) || !a.p_records.length) raise('Nothing to import: the file has no telecollector rows');
            if (a.p_records.length > 5000) raise('Too many rows (maximum 5000)');
            const keys = a.p_records.map(x => x.key); if (new Set(keys).size !== keys.length) raise('ON CONFLICT DO UPDATE command cannot affect row a second time', '21000');
            const meta = a.p_meta || {};
            takeSnapshot(d, uid, `Excel import (${a.p_mode === 'replace' ? 'replace all' : 'update & add'}) – ${String(a.p_label || '').slice(0, 120)}`);
            if (a.p_mode === 'replace') { d.entries = []; d.collectors = []; }
            try { upsert(d, a.p_records, (me(d, uid) || {}).username); }
            catch (e) { if (e.code === '23514') raise('Some rows have invalid values (check names, negative values, and To Retain vs Beginning)'); throw e; }
            const leaders = meta.leaders && typeof meta.leaders === 'object' && !Array.isArray(meta.leaders) ? meta.leaders : null;
            if (leaders) d.config.leaders = leaders;
            const fileCamps = [...new Set(a.p_records.map(x => x.campaign).filter(Boolean))];
            if (a.p_mode === 'replace') {
                const lead = Object.values(d.config.leaders || {}).flatMap(arr => (arr || []).flatMap(l => l.campaigns || []));
                d.config.campaigns = [...new Set([...fileCamps, ...lead])].filter(Boolean).sort();
            } else d.config.campaigns = [...d.config.campaigns, ...fileCamps.filter(c => !d.config.campaigns.includes(c))];
            if (meta.period) { if (!validPeriod(meta.period)) raise('The MONTH in the file is not valid'); d.config.current_period = meta.period; }
            if (meta.as_of) { if (!validDate(meta.as_of)) raise('The AS OF DATE in the file is not a valid date'); d.config.as_of = meta.as_of; }
            if (Array.isArray(meta.holidays) && meta.holidays.length) d.config.holidays = meta.holidays;
            d.config.last_import_at = nowMs();
            d.baseline = { id: 1, data: { ...clone(currentData(d)), entries: [] }, label: String(a.p_label || '').slice(0, 120), saved_at: nowMs() };
        } },
        admin_reset_to_baseline: { params: [], run: (s, uid) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can reset the data');
            if (!d.baseline) raise('No Excel file has been imported yet, so there is nothing to reset to');
            takeSnapshot(d, uid, 'Reset to last imported file');
            restoreData(d, d.baseline.data);
            return { label: d.baseline.label, savedAt: d.baseline.saved_at };
        } },
        admin_start_new_month: { params: [], run: (s, uid) => {
            const d = s.db; if (!isAdmin(d, uid)) raise('Only the Admin can start a new month');
            takeSnapshot(d, uid, 'Start new month');
            const period = d.config.current_period || today().slice(0, 7), next = shiftMonth(period);
            d.collectors.forEach(c => Object.assign(c, { lm_collection: c.collection, lm_fixed_prov: c.fixed_prov, lm_repo: c.repo, lm_sp_collection: null, lm_sp_fixed_prov: null, lm_sp_repo: null,
                collection: 0, penalty: 0, fixed_prov: 0, fixed_accs: 0, repo: 0, repo_prov: 0, repo_age2: 0, repo_age3: 0, repo_age4: 0, updated_at: new Date().toISOString() }));
            Object.assign(d.config, { current_period: next, as_of: null, last_import_at: nowMs() });
            return next;
        } }
    };
    const TABLES_FOR_FN = { add_daily_entry: ['collectors', 'entries', 'config'], delete_entry: ['collectors', 'entries'], save_collector: ['collectors', 'entries', 'config'], delete_collector: ['collectors'],
        save_config: ['config'], admin_delete_all: ['collectors', 'entries', 'snapshots'], admin_undo_last: ['collectors', 'entries', 'config', 'snapshots'],
        admin_import_collectors: ['collectors', 'entries', 'config', 'snapshots'], admin_reset_to_baseline: ['collectors', 'entries', 'config', 'snapshots'],
        admin_start_new_month: ['collectors', 'config', 'snapshots'], claim_first_admin: ['profiles'], admin_create_profile: ['profiles'],
        admin_update_user: ['profiles'], admin_delete_user: ['profiles'], admin_set_password: ['password_reset_requests'],
        request_password_reset: ['password_reset_requests'], admin_dismiss_reset_request: ['password_reset_requests'] };

    /* ---------- live refresh: same tab after each change, other tabs through the browser's "storage" event ---------- */
    const channels = [];
    const notify = tables => tables.forEach(t => channels.forEach(ch => ch.handlers.filter(h => h.table === t).forEach(h => setTimeout(() => h.cb({ table: t }), 0))));
    window.addEventListener('storage', e => { if (e.key === LOCAL_STORE_KEY) notify(['collectors', 'config', 'entries', 'snapshots', 'profiles', 'password_reset_requests']); });

    /* ---------- reads, with the same row-level security as Supabase ---------- */
    function visibleRows(d, table, uid) {
        if (table === 'profiles') return d.profiles.filter(p => p.id === uid || isAdmin(d, uid));
        if (table === 'collectors') return isActive(d, uid) ? d.collectors : [];
        if (table === 'config') return isActive(d, uid) ? [d.config] : [];
        if (table === 'entries') return isEditor(d, uid) ? d.entries : [];
        if (table === 'snapshots') return isAdmin(d, uid) && d.snapshots ? [d.snapshots] : [];
        if (table === 'password_reset_requests') return isAdmin(d, uid) ? (d.reset_requests || []) : [];
        if (table === 'snapshot_data' || table === 'baseline') return [];
        throw new PgError(`relation "public.${table}" does not exist`, '42P01');
    }
    function query(client, table) {
        const q = { filters: [], order: null, from: null, to: null, lim: null, single: false };
        const api = {
            select() { return api; },
            eq(col, v) { q.filters.push([col, v]); return api; },
            order(col, opts) { q.order = [col, !opts || opts.ascending !== false]; return api; },
            range(a, b) { q.from = a; q.to = b; return api; },
            limit(n) { q.lim = n; return api; },
            maybeSingle() { q.single = true; return api; },
            then(res) {
                try {
                    const uid = client._session && client._session.user.id;
                    let rows = clone(visibleRows(readStore().db, table, uid));
                    q.filters.forEach(([c, v]) => { rows = rows.filter(r => r[c] === v); });
                    if (q.order) { const [c, asc] = q.order; rows.sort((x, y) => (x[c] > y[c] ? 1 : x[c] < y[c] ? -1 : 0) * (asc ? 1 : -1)); }
                    if (q.from !== null) rows = rows.slice(q.from, Math.min(q.to + 1, q.from + 1000)); else rows = rows.slice(0, 1000);
                    if (q.lim !== null) rows = rows.slice(0, q.lim);
                    if (q.single) return res(rows.length > 1 ? { data: null, error: { message: 'multiple rows', code: 'PGRST116' } } : { data: rows[0] || null, error: null });
                    res({ data: rows, error: null });
                } catch (e) { res({ data: null, error: { message: e.message, code: e.code } }); }
            }
        };
        return api;
    }

    /* ---------- the client (same shape as supabase-js) ---------- */
    function createClient(url, key, opts) {
        const auth = (opts && opts.auth) || {};
        const ss = auth.persistSession ? (auth.storage || window.sessionStorage) : null, storageKey = auth.storageKey || 'eeportal-local-auth';
        const client = { _session: null, _cbs: [] };
        const sessionFor = u => ({ access_token: 'local-' + u.id, user: { id: u.id, email: u.email } });
        const saveSession = () => { if (!ss) return; try { client._session ? ss.setItem(storageKey, JSON.stringify(client._session)) : ss.removeItem(storageKey); } catch { } };
        if (ss) { try { const s = JSON.parse(ss.getItem(storageKey) || 'null'); if (s && s.user && readStore().users.some(u => u.id === s.user.id)) client._session = s; } catch { } }
        const setSession = (s, ev) => { client._session = s; saveSession(); client._cbs.forEach(cb => setTimeout(() => cb(ev, client._session), 0)); };
        const fail = message => ({ data: { user: null, session: null }, error: { message, status: 400 } });

        client.auth = {
            async signUp({ email, password }) {
                email = String(email || '').toLowerCase();
                if (badEmail(email)) return fail('Unable to validate email address: invalid format');
                if (String(password || '').length < 6) return fail('Password should be at least 6 characters');
                const hashed = await hashPassword(password);
                try {
                    const s = readStore();
                    if (s.users.some(u => u.email === email)) return fail('User already registered');
                    const u = { id: newId(), email, ...hashed };
                    s.users.push(u); writeStore(s);
                    setSession(sessionFor(u), 'SIGNED_IN');
                    return { data: { user: { id: u.id, email }, session: client._session }, error: null };
                } catch (e) { return fail(e.message); }
            },
            async signInWithPassword({ email, password }) {
                email = String(email || '').toLowerCase();
                if (badEmail(email)) return fail('Unable to validate email address: invalid format');
                let u;
                try { u = readStore().users.find(x => x.email === email); } catch (e) { return fail(e.message); }
                if (!u || (await hashPassword(password, u.salt)).hash !== u.hash) return fail('Invalid login credentials');
                setSession(sessionFor(u), 'SIGNED_IN');
                return { data: { user: { id: u.id, email }, session: client._session }, error: null };
            },
            async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
            async getSession() { return { data: { session: client._session } }; },
            async updateUser({ password }) {
                if (!client._session) return { data: null, error: { message: 'Not signed in' } };
                if (String(password || '').length < 6) return { data: null, error: { message: 'Password should be at least 6 characters' } };
                const hashed = await hashPassword(password);
                try {
                    const s = readStore(), u = s.users.find(x => x.id === client._session.user.id);
                    if (!u) return { data: null, error: { message: 'Not signed in' } };
                    Object.assign(u, hashed); writeStore(s);
                    return { data: { user: { id: u.id } }, error: null };
                } catch (e) { return { data: null, error: { message: e.message } }; }
            },
            onAuthStateChange(cb) { client._cbs.push(cb); setTimeout(() => cb('INITIAL_SESSION', client._session), 0); return { data: { subscription: { unsubscribe() { } } } }; }
        };
        client.from = table => query(client, table);
        client.rpc = async (fn, args) => {
            const def = FN[fn], given = Object.keys(args || {}), opt = (def && def.optional) || [];
            if (!def || given.some(k => !def.params.includes(k)) || def.params.some(k => !opt.includes(k) && !given.includes(k)))
                return { data: null, error: { message: `Could not find the function public.${fn}(${given.join(', ')}) in the schema cache`, code: 'PGRST202' } };
            const uid = client._session && client._session.user.id;
            if (!uid && !def.anon) return { data: null, error: { message: 'Not signed in', code: 'P0001' } };
            try {
                const a = def.prepare ? await def.prepare(clone(args || {})) : clone(args || {});
                const work = readStore();                 // fresh copy (another tab may have changed it)
                const out = def.run(work, uid, a);
                if (!def.readOnly) { writeStore(work); notify(TABLES_FOR_FN[fn] || []); }   // all-or-nothing: saved only if every check passed
                return { data: out === undefined ? null : out, error: null };
            } catch (e) { return { data: null, error: { message: e.message, code: e.code || 'P0001' } }; }
        };
        client.channel = name => {
            const ch = { name, handlers: [] };
            ch.on = (type, filter, cb) => { ch.handlers.push({ table: filter.table, cb }); return ch; };
            ch.subscribe = statusCb => { channels.push(ch); if (statusCb) setTimeout(() => statusCb('SUBSCRIBED'), 0); return ch; };
            return ch;
        };
        client.removeChannel = ch => { const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); };
        return client;
    }

    /* ---------- once per browser: v8 update + the starter accounts (js/config.js LOCAL_STARTER_ACCOUNTS) ---------- */
    async function prepareStore() {
        let s = readStore();
        if (!s.v8) { s.db.config.kpi = null; s.db.reset_requests = s.db.reset_requests || []; s.v8 = true; writeStore(s); }   // KPI back to the standard targets and weights
        if (s.starterSeeded) return;
        const starters = typeof LOCAL_STARTER_ACCOUNTS !== 'undefined' && Array.isArray(LOCAL_STARTER_ACCOUNTS) ? LOCAL_STARTER_ACCOUNTS : [];
        const hashed = await Promise.all(starters.map(a => hashPassword(a.password)));
        s = readStore();
        starters.forEach((a, i) => {
            const username = String(a.username || '').trim().toLowerCase();
            if (!/^[a-z0-9._-]{3,30}$/.test(username) || !['Admin', 'Management', 'Analyst'].includes(a.role)) return;
            const email = sbEmail(username);
            if (s.db.profiles.some(p => p.username === username) || s.users.some(u => u.email === email)) return;   // never overwrite an existing login
            const id = newId();
            s.users.push({ id, email, ...hashed[i] });
            s.db.profiles.push({ id, username, display_name: cleanName(a.displayName || username), role: a.role, active: true, created_at: new Date().toISOString() });
        });
        s.starterSeeded = true;
        writeStore(s);
    }
    // Last resort when no Admin can log in (Local mode): open the browser console (F12) on the portal and run
    //   eeLocalSetPassword('admin', 'NewPassword')
    async function setPassword(username, password) {
        if (String(password || '').length < minPasswordLength()) throw new Error(`Use at least ${minPasswordLength()} characters.`);
        const hashed = await hashPassword(password), s = readStore(), email = sbEmail(username);
        const u = s.users.find(x => x.email === email);
        if (!u) throw new Error('No local login with that username.');
        Object.assign(u, hashed); writeStore(s);
        return `Password changed for ${String(username).toLowerCase()}.`;
    }

    return { createClient, readStore, prepareStore, setPassword };
})();
window.eeLocalSetPassword = (username, password) => EELocal.setPassword(username, password);

const LocalBackend = Object.assign(Object.create(SupabaseBackend), {
    mode: 'local',
    provider: 'Local',
    timers: {},
    usersNote: 'Local mode: these accounts exist only in this browser on this PC. Reset PW sets a new password immediately.',
    async init(onData, onAuth) {
        this.onData = onData; this.onAuth = onAuth;
        if (!(window.crypto && crypto.subtle)) throw new Error('Local mode needs the portal opened on this PC: double-click index.html, or use http://localhost.');
        try { localStorage.setItem(LOCAL_STORE_KEY + '-test', '1'); localStorage.removeItem(LOCAL_STORE_KEY + '-test'); EELocal.readStore(); }
        catch (e) { throw new Error('This browser blocks saving data for this page (local storage). Use Chrome or Edge, and do not use a private / incognito window. ' + (e.message || '')); }
        await EELocal.prepareStore();
        this.lib = EELocal; this.url = 'local'; this.key = 'local';
        this.sb = this.lib.createClient(this.url, this.key, { auth: { persistSession: true, storage: window.sessionStorage, storageKey: 'eeportal-local-auth' } });
        this.watchAuth();
    },
    storageText() { return '<i class="fa-solid fa-laptop"></i> Local mode: stored in this browser on this PC only. Export to Excel regularly as a backup.'; }
});

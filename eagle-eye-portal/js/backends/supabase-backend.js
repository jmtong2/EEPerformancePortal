/* SUPABASE backend: Supabase Auth + Postgres + Realtime (the portal's only storage).
   Requires database/supabase-setup.sql to have been run (docs/SUPABASE-SETUP.md).
   Tables are read-only through the API; every change is a database function (RPC) that checks the
   caller's role and runs as one transaction. */

// Usernames become placeholder login e-mails (username@domain); no e-mails are ever sent.
// The domain is cleaned up so common config mistakes ("@company.com", a full e-mail address, "https://…", spaces) still work.
function sbNormalizeDomain(raw) {
    const d = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^[^@]*@/, '').replace(/[/\s].*$/, '');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d))
        throw new Error(`SUPABASE_EMAIL_DOMAIN in js/config.js looks wrong ("${String(raw).slice(0, 60)}"). Use only a domain such as yourcompany.com (no @, no https://, no spaces), or leave it empty ('').`);
    return d;
}
function sbEmail(username) {
    const u = String(username || '').trim().toLowerCase();
    if (u.includes('@')) throw new Error('Type your portal username only (for example jgvillaluz), not an e-mail address.');
    if (!validUsername(u)) throw new Error('Usernames have 3–30 letters, numbers, dots, dashes or underscores, with no spaces.');
    return `${u}@${sbNormalizeDomain(SUPABASE_EMAIL_DOMAIN || USERNAME_EMAIL_DOMAIN)}`;
}
const SB_COLLECTOR_FIELDS = [ // [app field, database column]
    ['key', 'key'], ['team', 'team'], ['campaign', 'campaign'], ['name', 'name'], ['accs1', 'accs1'], ['collectibles', 'collectibles'],
    ['collection', 'collection'], ['penalty', 'penalty'], ['beginning', 'beginning'], ['principalBal', 'principal_bal'], ['toRetain', 'to_retain'],
    ['fixedProv', 'fixed_prov'], ['targetRepo', 'target_repo'], ['repo', 'repo'], ['repoProv', 'repo_prov'],
    ['lmCollection', 'lm_collection'], ['lmSpCollection', 'lm_sp_collection'], ['lmFixedProv', 'lm_fixed_prov'], ['lmSpFixedProv', 'lm_sp_fixed_prov'],
    ['lmRepo', 'lm_repo'], ['lmSpRepo', 'lm_sp_repo'],
    // v8 (Summary_Campaign_Revised layout)
    ['ending', 'ending'], ['endingAccs', 'ending_accs'], ['beginningAccs', 'beginning_accs'], ['toRetainAccs', 'to_retain_accs'], ['fixedAccs', 'fixed_accs'],
    ['repoAge2', 'repo_age2'], ['repoAge3', 'repo_age3'], ['repoAge4', 'repo_age4']
];
const sbToDbCollector = c => Object.fromEntries(SB_COLLECTOR_FIELDS.map(([a, d]) => [d, c[a] === undefined ? null : c[a]]));
const sbFromDbCollector = r => ({ ...makeCollector(Object.fromEntries(SB_COLLECTOR_FIELDS.map(([a, d]) => [a, r[d]]))), key: r.key });
const sbFromDbEntry = r => sanitizeEntry({ id: r.id, key: r.key, campaign: r.campaign, team: r.team, name: r.name, date: r.date, collection: r.collection,
    penalty: r.penalty, beginning: r.beginning, toRetain: r.to_retain, fixedProv: r.fixed_prov, repo: r.repo, repoProv: r.repo_prov,
    by: r.by_uid, byName: r.by_name, ts: Date.parse(r.ts) });
const sbFromDbProfile = (r, uid) => r ? { uid: r.id || uid, username: r.username, displayName: r.display_name, role: r.role, active: r.active } : null;
function sbError(e) { return Object.assign(new Error((e && e.message) || String(e)), { code: (e && (e.code || e.status)) || '' }); }
// Fixes common copy-paste mistakes in SUPABASE_URL: the dashboard link, a trailing "/", or an API path like "/rest/v1/".
function sbNormalizeUrl(raw) {
    let u = String(raw || '').trim();
    const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
    if (dash) return `https://${dash[1]}.supabase.co`;
    if (/^[a-z0-9]{15,30}$/i.test(u)) return `https://${u}.supabase.co`;   // only the project ref was pasted
    u = u.replace(/\/(rest|auth|realtime|storage|functions|graphql)\/v1\b.*$/i, '').replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s?#]+$/i.test(u)) throw new Error(`SUPABASE_URL in js/config.js looks wrong ("${String(raw).slice(0, 80)}"). It must look like https://abcdefghijkl.supabase.co with nothing after .co (Supabase → Project Settings → Data API → Project URL).`);
    return u;
}

const SupabaseBackend = {
    mode: 'cloud',
    provider: 'Supabase',
    canResetPasswords: true,
    usersNote: 'Reset PW sets a new password immediately. Delete removes the login completely, so the username can be reused.',
    uid: null,
    email: null,
    profile: null,
    channel: null,
    timers: {},
    settingUp: false,

    async init(onData, onAuth) {
        this.onData = onData; this.onAuth = onAuth;
        this.url = sbNormalizeUrl(SUPABASE_URL);
        this.key = String(SUPABASE_ANON_KEY).trim();
        await loadScript(LIB.supabase);
        this.lib = window.supabase;   // supabase-js (Local mode swaps in its own stand-in, js/backends/local-backend.js)
        this.sb = this.lib.createClient(this.url, this.key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: window.sessionStorage, storageKey: 'eeportal-sb-auth' }
        });
        this.watchAuth();
    },
    watchAuth() {
        this.sb.auth.onAuthStateChange((event, session) => {
            if (this.settingUp) return;
            // Supabase advises not to await other Supabase calls inside this callback -> defer.
            if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) setTimeout(() => this.handleSession(session), 0);
        });
    },
    // Separate client without a stored session: creates users / checks passwords without touching the main login.
    second() {
        if (!this._second) this._second = this.lib.createClient(this.url, this.key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'eeportal-sb-secondary' }
        });
        return this._second;
    },
    async rpc(fn, args) { const { data, error } = await this.sb.rpc(fn, args || {}); if (error) throw sbError(error); return data; },
    isEditorProfile() { return !!this.profile && (this.profile.role === ROLE.ADMIN || this.profile.role === ROLE.MGMT); },
    isAdminProfile() { return !!this.profile && this.profile.role === ROLE.ADMIN; },
    pubProfile() { const p = this.profile; return { uid: p.uid, username: p.username, displayName: p.displayName, role: p.role, active: true }; },

    async handleSession(session) {
        const uid = session && session.user ? session.user.id : null;
        if (uid && uid === this.uid && this.profile) return;   // same user (e.g. tab refocus)
        this.stop();
        this.uid = uid;
        this.email = session && session.user ? session.user.email : null;
        if (!uid) { this.profile = null; state = emptyState(); this.onAuth(null); return; }
        try {
            const p = await this.fetchOwnProfile();
            if (!p || !p.active || !ROLES.includes(p.role)) {
                showLoginError(!p ? 'This login has no portal access. Ask the Admin to add you.' : !p.active ? 'This account is disabled. Please contact the Admin.' : 'Unknown role on this account.');
                this.uid = null; await this.sb.auth.signOut({ scope: 'local' }); return;
            }
            this.profile = p;
            await this.fetchAll();
            this.subscribe();
            this.onAuth(this.pubProfile());
        } catch (e) { showLoginError(friendlyError(e)); this.uid = null; await this.sb.auth.signOut({ scope: 'local' }); }
    },

    /* ---------- loading ---------- */
    async selectAll(table, orderCol, ascending = true) {   // pages through results (the API returns max 1000 rows per request)
        const out = [];
        for (let from = 0; ; from += 1000) {
            let q = this.sb.from(table).select('*');
            if (orderCol) q = q.order(orderCol, { ascending });
            const { data, error } = await q.range(from, from + 999);
            if (error) throw sbError(error);
            out.push(...data);
            if (data.length < 1000) break;
        }
        return out;
    },
    async fetchOwnProfile() {
        const { data, error } = await this.sb.from('profiles').select('*').eq('id', this.uid).maybeSingle();
        if (error) throw sbError(error);
        return sbFromDbProfile(data, this.uid);
    },
    async fetchCollectors() { state.collectors = (await this.selectAll('collectors', 'key')).map(sbFromDbCollector); },
    async fetchConfig() {
        const { data, error } = await this.sb.from('config').select('*').eq('id', 1).maybeSingle();
        if (error) throw sbError(error);
        const d = data || {};
        state.campaigns = Array.isArray(d.campaigns) ? d.campaigns : [];
        state.leaders = sanitizeLeaders(d.leaders);
        state.kpi = sanitizeKpi(d.kpi);
        state.lastImportAt = num(d.last_import_at);
        state.currentPeriod = d.current_period || null;
        state.asOf = d.as_of || null;
        state.holidays = sanitizeHolidays(d.holidays);
        state.schemaVersion = d.schema_version === undefined || d.schema_version === null ? null : num(d.schema_version);
    },
    async fetchEntries() {
        if (!this.isEditorProfile()) { state.entries = []; return; }
        const { data, error } = await this.sb.from('entries').select('*').order('ts', { ascending: false }).limit(CLOUD_ENTRY_LIMIT);
        if (error) throw sbError(error);
        state.entries = data.map(sbFromDbEntry);
    },
    async fetchSnapshot() {
        if (!this.isAdminProfile()) { state.snapshot = null; return; }
        const { data, error } = await this.sb.from('snapshots').select('*').eq('id', 1).maybeSingle();
        if (error) throw sbError(error);
        state.snapshot = data ? { reason: data.reason, takenAt: num(data.taken_at), takenBy: data.taken_by, counts: data.counts } : null;
    },
    async fetchResetRequests() {
        if (!this.isAdminProfile()) { state.resetRequests = []; return; }
        const { data, error } = await this.sb.from('password_reset_requests').select('*').order('requested_at', { ascending: false }).limit(100);
        if (error) { state.resetRequests = []; return; }   // table missing until the v8 SQL is run: not fatal
        state.resetRequests = data.map(r => ({ id: r.id, username: r.username, at: Date.parse(r.requested_at) }));
    },
    async fetchAll() { await Promise.all([this.fetchCollectors(), this.fetchConfig(), this.fetchEntries(), this.fetchSnapshot(), this.fetchResetRequests()]); },
    async refresh(...names) { await Promise.all(names.map(n => this['fetch' + n]())); this.onData(); },

    /* ---------- realtime ---------- */
    subscribe() {
        const later = name => {
            clearTimeout(this.timers[name]);
            this.timers[name] = setTimeout(() => this.refresh(name).catch(e => toast('Cloud sync error: ' + friendlyError(e), 'err')), 300);
        };
        let ch = this.sb.channel('eeportal-' + this.uid)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'collectors' }, () => later('Collectors'))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, () => later('Config'))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
                clearTimeout(this.timers.profile);
                this.timers.profile = setTimeout(() => this.onProfileChange(), 300);
            });
        if (this.isEditorProfile()) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => later('Entries'));
        if (this.isAdminProfile()) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'snapshots' }, () => later('Snapshot'))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'password_reset_requests' }, () => later('ResetRequests'));
        this.channel = ch.subscribe(status => setLiveBadge(status === 'SUBSCRIBED'));
    },
    // The Admin changed my role, disabled me or deleted me -> react immediately.
    async onProfileChange() {
        if (!this.uid || !this.profile) return;
        const p = await this.fetchOwnProfile().catch(() => null);
        if (!p || !p.active || !ROLES.includes(p.role)) { toast('Your access was changed by the Admin. Logging out.', 'info'); return this.logout(); }
        if (p.role !== this.profile.role || p.displayName !== this.profile.displayName) {
            const roleChanged = p.role !== this.profile.role;
            this.profile = p;
            if (roleChanged) { this.stop(); await this.fetchAll(); this.subscribe(); }
            this.onAuth(this.pubProfile());
        }
    },
    stop() {
        Object.values(this.timers).forEach(t => clearTimeout(t)); this.timers = {};
        if (this.channel) { try { this.sb.removeChannel(this.channel); } catch { } this.channel = null; }
    },

    /* ---------- first-time setup: the first account becomes Admin (data then comes from an Excel import) ---------- */
    async needsSetup() { return (await this.rpc('needs_setup')) === true; },
    async setupFirstAdmin(username, displayName, password) {
        this.settingUp = true;
        try {
            const email = sbEmail(username);
            let res = await this.sb.auth.signUp({ email, password });
            if (res.error && /already registered/i.test(res.error.message)) res = await this.sb.auth.signInWithPassword({ email, password });
            if (res.error) throw sbError(res.error);
            if (!res.data.session) throw new Error('Turn OFF "Confirm email" in Supabase (Authentication → Sign In / Providers → Email), then try again.');
            await this.rpc('claim_first_admin', { p_username: username, p_display_name: displayName });
        } finally { this.settingUp = false; }
        const { data } = await this.sb.auth.getSession();
        await this.handleSession(data.session);
    },

    /* ---------- auth ---------- */
    async login(username, password) {
        const { error } = await this.sb.auth.signInWithPassword({ email: sbEmail(username), password });
        if (error) throw sbError(error);
    },
    async logout() { await this.sb.auth.signOut({ scope: 'local' }); },   // 'local' = only this browser, not the user's other PCs
    async verifyPassword(password) {
        const s = this.second();
        const { error } = await s.auth.signInWithPassword({ email: this.email, password });
        if (error) throw new Error(/invalid login credentials/i.test(error.message) ? 'Password is incorrect.' : friendlyError(sbError(error)));
        await s.auth.signOut({ scope: 'local' });
    },
    async changeOwnPassword(cur, next) {
        if (!canChangeOwnPassword()) throw new Error('Your role cannot change passwords. Ask the Admin.');
        await this.verifyPassword(cur);
        const { error } = await this.sb.auth.updateUser({ password: next });
        if (error) throw sbError(error);
    },

    /* ---------- users (Admin only; enforced by the database functions) ---------- */
    async listUsers() { return (await this.selectAll('profiles', 'username')).map(r => sbFromDbProfile(r)); },
    async addUser({ username, displayName, role, password }) {
        if (!ROLES.includes(role)) throw new Error('Unknown role.');
        const { data: ex, error: exErr } = await this.sb.from('profiles').select('id').eq('username', username).maybeSingle();
        if (exErr) throw sbError(exErr);
        if (ex) throw new Error('Username already exists.');
        const s = this.second();
        const res = await s.auth.signUp({ email: sbEmail(username), password });
        if (res.error) throw new Error(/already registered/i.test(res.error.message) ? 'That username still has a login. Delete it in Supabase → Authentication → Users, or choose another username.' : friendlyError(sbError(res.error)));
        const newUid = res.data.user && res.data.user.id;
        if (!newUid) throw new Error('The login could not be created.');
        await s.auth.signOut({ scope: 'local' });
        if (!res.data.session) {
            await this.rpc('admin_delete_user', { p_uid: newUid }).catch(() => { });
            throw new Error('Turn OFF "Confirm email" in Supabase (Authentication → Sign In / Providers → Email), then add the user again.');
        }
        await this.rpc('admin_create_profile', { p_uid: newUid, p_username: username, p_display_name: displayName, p_role: role });
    },
    async updateUser(uid, patch) {
        await this.rpc('admin_update_user', { p_uid: uid, p_role: patch.role !== undefined ? patch.role : null, p_active: patch.active !== undefined ? patch.active : null });
    },
    async deleteUser(uid) { await this.rpc('admin_delete_user', { p_uid: uid }); },
    async resetUserPassword(uid, pw) { await this.rpc('admin_set_password', { p_uid: uid, p_password: pw }); await this.refresh('ResetRequests'); },

    /* ---------- forgot password: a request the Admin sees under Users ---------- */
    async requestPasswordReset(username) { await this.rpc('request_password_reset', { p_username: String(username || '').trim().toLowerCase() }); },
    async dismissResetRequest(id) { await this.rpc('admin_dismiss_reset_request', { p_id: id }); await this.refresh('ResetRequests'); },

    /* ---------- daily entries ---------- */
    async addDailyEntry(e) {
        await this.rpc('add_daily_entry', { p_key: e.key, p_date: e.date, p_collection: e.collection, p_penalty: e.penalty,
            p_fixed_prov: e.fixedProv, p_repo: e.repo, p_repo_prov: e.repoProv });
        await this.refresh('Collectors', 'Entries', 'Config');
    },
    async deleteEntry(id) { await this.rpc('delete_entry', { p_id: id }); await this.refresh('Collectors', 'Entries'); },

    /* ---------- telecollectors & config ---------- */
    async saveCollector(oldKey, c) {
        try { await this.rpc('save_collector', { p_old_key: oldKey || null, p: sbToDbCollector(c) }); }
        catch (e) { if (/DUPLICATE/.test(e.message)) throw dupError(c); throw e; }
        await this.refresh('Collectors', 'Config', 'Entries');
    },
    async deleteCollector(key) { await this.rpc('delete_collector', { p_key: key }); await this.refresh('Collectors'); },
    async saveConfig(patch) {
        const map = { campaigns: 'campaigns', leaders: 'leaders', kpi: 'kpi', currentPeriod: 'current_period', asOf: 'as_of', holidays: 'holidays' };
        const p = {};
        Object.entries(map).forEach(([a, d]) => { if (patch[a] !== undefined) p[d] = patch[a]; });
        await this.rpc('save_config', { p });
        await this.refresh('Config');
    },

    /* ---------- Data menu (Admin): delete all / reset / undo / import / new month ---------- */
    async deleteAllData() { await this.rpc('admin_delete_all'); await this.refresh('Collectors', 'Entries', 'Snapshot'); },
    async resetToBaseline() {
        const meta = await this.rpc('admin_reset_to_baseline');
        await this.refresh('Collectors', 'Config', 'Entries', 'Snapshot');
        return meta || {};
    },
    async undoLast() {
        const meta = await this.rpc('admin_undo_last');
        await this.refresh('Collectors', 'Config', 'Entries', 'Snapshot');
        return meta || {};
    },
    async startNewMonth() {
        const next = await this.rpc('admin_start_new_month');
        await this.refresh('Collectors', 'Config', 'Entries', 'Snapshot');
        return next;
    },
    async importCollectors({ records, mode, label, meta }) {
        if (!Array.isArray(records) || !records.length) throw new Error('Nothing to import: the file has no telecollector rows.');
        if (!['replace', 'merge'].includes(mode)) throw new Error('Unknown import mode.');
        const incoming = dedupeCollectors(records).list.map(sbToDbCollector);
        await this.rpc('admin_import_collectors', { p_records: incoming, p_mode: mode, p_label: label, p_meta: meta || {} });
        await this.refresh('Collectors', 'Config', 'Entries', 'Snapshot');
    },
    async exportAll() {
        const [collectors, entries] = await Promise.all([this.selectAll('collectors', 'key'), this.selectAll('entries', 'ts', false)]);
        await this.fetchConfig();
        return { collectors: collectors.map(sbFromDbCollector), entries: entries.map(sbFromDbEntry) };
    },

    storageText() { return '<i class="fa-solid fa-cloud"></i> Stored in Supabase (PostgreSQL)'; }
};

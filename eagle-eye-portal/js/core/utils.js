/* Generic helpers: DOM, formatting, toasts, modals, errors, script loading. No business logic here. */

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const uniq = arr => [...new Set(arr.filter(Boolean))];
const num = v => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const round2 = n => Math.round(n * 100) / 100;
const DASH = '<span class="text-slate-300">—</span>';

// Strips control / zero-width characters and limits length (used for anything from files or the database).
function sanitizeText(s, max = 120) {
    return String(s ?? '').replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function formatPHP(n) { n = Number(n || 0); return (n < 0 ? '-' : '') + '₱' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtNum(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtInt(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
function fmtUnits(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }); }
// Same as above but blank values show as "—" (HTML).
const optPHP = n => (n === null || n === undefined ? DASH : formatPHP(n));
const optNumFmt = n => (n === null || n === undefined ? DASH : fmtNum(n));
const optUnits = n => (n === null || n === undefined ? DASH : fmtUnits(n));
const optPct = n => (n === null || n === undefined || !isFinite(n) ? DASH : n.toFixed(1) + '%');
function pct(a, b) { return b > 0 ? (a / b) * 100 : 0; }
function todayStr() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function fmtDateTime(ms) { return ms ? new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function validUsername(u) { return /^[a-z0-9._-]{3,30}$/.test(u); }
// Minimum length for new passwords (js/config.js; 6 if an older config.js does not set it).
const minPasswordLength = () => (typeof MIN_PASSWORD_LENGTH === 'number' && MIN_PASSWORD_LENGTH >= 6 ? MIN_PASSWORD_LENGTH : 6);

// True when a and b differ by at most `max` single-letter edits (add, remove, replace): used to spot spelling variants.
// Two rows of memory, and it stops as soon as a whole row is over `max` (most names fail after a few letters).
function withinEdits(a, b, max = 2) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > max) return false;
    let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return false;
        [prev, cur] = [cur, prev];
    }
    return prev[b.length] <= max;
}

// Runs fn once the calls stop for `ms` (e.g. typing in Search re-renders once, not on every key).
function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
// Groups a list by key in one pass; groups keep the list order and appear in first-seen order.
function groupBy(list, keyFn) {
    const m = new Map();
    for (const x of list) { const k = keyFn(x), g = m.get(k); if (g) g.push(x); else m.set(k, [x]); }
    return m;
}

function toast(msg, type = 'ok') {
    const colors = { ok: 'bg-emerald-600', err: 'bg-rose-600', info: 'bg-slate-800' };
    const el = document.createElement('div');
    el.className = `${colors[type] || colors.info} text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-lg`;
    el.textContent = msg;
    $('toastHost').appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
}
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }
function deny(msg) { toast(msg || 'Access denied for your role.', 'err'); }

// Disables the button while saving (prevents double-click double entries) and reports errors.
async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { console.error(e); toast(friendlyError(e), 'err'); throw e; }
    finally { if (btn) btn.disabled = false; }
}

const _loaded = {};
function loadScript(src) {
    if (_loaded[src]) return _loaded[src];
    _loaded[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res; s.onerror = () => { delete _loaded[src]; rej(new Error('Could not load a required library (check the internet connection): ' + src)); };
        document.head.appendChild(s);
    });
    return _loaded[src];
}

function friendlyError(e) {
    const code = String((e && e.code) || '');
    const m = (e && e.message) || String(e || 'Unknown error');
    if (/failed to fetch|networkerror|network request/i.test(m)) return 'No internet connection or the cloud server cannot be reached.';
    if (/invalid path specified in request url|requested path is invalid/i.test(m)) return 'SUPABASE_URL in js/config.js is wrong. It must look like https://abcdefghijkl.supabase.co with nothing after .co (Supabase → Project Settings → Data API → Project URL).';
    if (/invalid api key|no api key found/i.test(m)) return 'SUPABASE_ANON_KEY in js/config.js is wrong. Copy the anon / publishable key from Supabase → Project Settings → API Keys.';
    if (/invalid login credentials/i.test(m)) return 'Incorrect username or password.';
    if (/email not confirmed/i.test(m)) return 'This login is not confirmed. In Supabase turn OFF "Confirm email" (Authentication → Sign In / Providers → Email).';
    if (/user already registered/i.test(m)) return 'That username is already taken.';
    if (/unable to validate email address/i.test(m)) return 'Supabase could not accept this login name. Type your username only (no @, no spaces). If it keeps happening, SUPABASE_EMAIL_DOMAIN in js/config.js must be just a domain such as yourcompany.com, or empty.';
    if (/email address .*invalid|email_address_invalid/i.test(m)) return 'Supabase rejected the login e-mail domain. Set SUPABASE_EMAIL_DOMAIN in js/config.js to your company e-mail domain (before creating users).';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'In Supabase, turn ON "Allow new users to sign up" (Authentication → Sign In / Providers).';
    if (code === 'PGRST202' || /could not find the function|schema cache|relation .* does not exist|column .* does not exist/i.test(m)) return 'The Supabase database is not set up for this version yet. Run database/supabase-setup.sql again (docs/SUPABASE-SETUP.md, step 3).';
    if (code === '42501' || /permission denied/i.test(m)) return 'Permission denied for your role.';
    if (/jwt expired|invalid jwt|refresh token/i.test(m)) return 'Your session expired. Please log in again.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
    return m;
}

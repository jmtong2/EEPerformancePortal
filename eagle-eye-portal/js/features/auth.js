/* Login, first-time cloud setup, role-based visibility, inactivity logout, change own password. */

function showLoginError(msg) { $('loginErrorText').innerText = msg; $('loginError').classList.remove('hidden'); }

const isLocalMode = () => !!Backend && Backend.mode === 'local';

function setLiveBadge(live) {
    const b = $('modeBadge'), local = isLocalMode();
    b.className = 'admin-only text-[10px] font-bold px-2 py-0.5 rounded-full border ' + (local ? 'bg-slate-100 text-slate-700 border-slate-300' : live ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-amber-100 text-amber-800 border-amber-300') + (isAdmin() ? '' : ' hidden');
    b.innerHTML = local ? '<i class="fa-solid fa-laptop"></i> Local · this PC only' : `<i class="fa-solid fa-cloud"></i> ${esc(Backend ? Backend.provider : 'Cloud')} · ${live ? 'Live' : 'Connecting…'}`;
}

// Shows/hides everything tagged with a role class.
//   .admin-only  -> Admin
//   .edit-only   -> Admin + Management
function applyRoleVisibility() {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
    document.querySelectorAll('.edit-only').forEach(el => el.classList.toggle('hidden', !canEdit()));
}

async function showAuthModal() {
    showModal('authModal');
    $('loginPassword').value = '';
    const local = isLocalMode();
    $('authConnectingText').innerText = local ? 'Opening local data…' : 'Connecting to cloud…';
    $('localModeHint').classList.toggle('hidden', !local);
    $('setupIntro').innerHTML = local
        ? '<i class="fa-solid fa-laptop text-amber-400"></i> <b>Local mode</b>: there is no data in this browser yet. Create the first <b>Admin</b> account, then load the data with <b>Data → Import Excel file</b>. Everything stays in this browser on this PC.'
        : '<i class="fa-solid fa-cloud text-amber-400"></i> This cloud database is empty. Create the first <b>Admin</b> account. After logging in, load the data with <b>Data → Import Excel file</b>.';
    $('authConnecting').classList.remove('hidden');
    $('loginForm').classList.add('hidden'); $('setupForm').classList.add('hidden');
    let setup = false;
    try { setup = await Backend.needsSetup(); } catch (e) { showLoginError(friendlyError(e)); }
    $('authConnecting').classList.add('hidden');
    $('setupForm').classList.toggle('hidden', !setup);
    $('loginForm').classList.toggle('hidden', setup);
    $('authSubtitle').innerText = setup ? 'First-time Setup' : 'Authentication Required';
}

let starterLogin = false;   // logged in with an unchanged Local-mode starter password -> remind to change it
async function handleLogin(ev) {
    ev.preventDefault();
    $('loginError').classList.add('hidden');
    const u = $('loginUsername').value.trim().toLowerCase(), pw = $('loginPassword').value;
    starterLogin = isLocalMode() && typeof LOCAL_STARTER_ACCOUNTS !== 'undefined' && LOCAL_STARTER_ACCOUNTS.some(a => a.username === u && a.password === pw);
    try { await busy($('loginBtn'), () => Backend.login(u, pw)); }
    catch (e) { starterLogin = false; showLoginError(friendlyError(e)); }
}

/* ---------- forgot password: sends a request the Admin sees under Users ---------- */
function openForgotModal() {
    $('forgotUsername').value = $('loginUsername').value.trim();
    $('forgotResult').classList.add('hidden');
    $('forgotAdminTip').innerText = isLocalMode()
        ? 'With no other Admin: see "Forgotten passwords" in README.md (Local mode).'
        : 'With no other Admin: see "Forgotten passwords" in docs/SUPABASE-SETUP.md.';
    showModal('forgotModal');
    setTimeout(() => $('forgotUsername').focus(), 50);
}
async function handleForgotPassword(ev) {
    ev.preventDefault();
    const u = $('forgotUsername').value.trim().toLowerCase(), box = $('forgotResult');
    const show = (ok, msg) => { box.className = `rounded-xl p-3 text-[11px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`; box.innerText = msg; };
    if (u.includes('@')) return show(false, 'Type your portal username (for example jgvillaluz), not an e-mail address.');
    if (!validUsername(u)) return show(false, 'Usernames have 3–30 letters, numbers, dots, dashes or underscores, with no spaces.');
    try {
        await busy($('forgotBtn'), () => Backend.requestPasswordReset(u));
        show(true, 'Request sent. If this username exists, the Admin will see it under Users and give you a new password.');
    } catch (e) { show(false, friendlyError(e)); }
}

async function handleSetup(ev) {
    ev.preventDefault();
    const username = $('setupUsername').value.trim().toLowerCase(), errEl = $('setupError');
    errEl.classList.add('hidden');
    if (!validUsername(username)) { errEl.innerText = 'Username: 3–30 characters, letters/numbers/._- only.'; errEl.classList.remove('hidden'); return; }
    if ($('setupPassword').value.length < minPasswordLength()) { errEl.innerText = `Use at least ${minPasswordLength()} characters for the Admin password.`; errEl.classList.remove('hidden'); return; }
    try {
        await busy($('setupBtn'), () => Backend.setupFirstAdmin(username, cleanName(sanitizeText($('setupDisplayName').value, 80)), $('setupPassword').value));
        toast('Welcome, Admin! Next: Data → Import Excel file to load the telecollectors.', 'ok');
    } catch (e) { errEl.innerText = friendlyError(e); errEl.classList.remove('hidden'); }
}

// Called by the backend whenever someone logs in, logs out, or their role changes.
function onAuthChanged(user) {
    currentUser = user;
    if (!user) {
        ['changePassModal', 'usersModal', 'editLeaderModal', 'entryModal', 'teleModal', 'kpiModal', 'guideModal', 'importModal', 'periodModal', 'pwConfirmModal'].forEach(hideModal);
        starterLogin = false;
        clearTimeout(inactivityTimer);
        applyRoleVisibility();
        showAuthModal();
        return;
    }
    hideModal('authModal'); hideModal('forgotModal');
    $('loginError').classList.add('hidden');
    if (starterLogin) { starterLogin = false; setTimeout(() => toast(canChangeOwnPassword() ? 'You are using the starter password. Change it with the Password button.' : 'You are using the starter password. Ask the Admin to change it.', 'info'), 600); }
    $('currentUserNameDisplay').innerText = user.displayName || user.username.toUpperCase();
    $('currentUserRoleDisplay').innerText = user.role;
    if (!canEdit()) ['entryModal', 'teleModal', 'editLeaderModal', 'changePassModal'].forEach(hideModal);
    if (!isAdmin()) { ['usersModal', 'importModal', 'kpiModal', 'periodModal', 'pwConfirmModal'].forEach(hideModal); closeDataMenu(); }
    resetInactivityTimer();
    renderDashboard();
}

/* ---------- inactivity logout ---------- */
let inactivityTimer;
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (!currentUser) return;
    inactivityTimer = setTimeout(() => { toast('Logged out after 10 minutes of inactivity.', 'info'); Backend.logout(); }, INACTIVITY_LIMIT);
}
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => window.addEventListener(ev, resetInactivityTimer, true));

/* ---------- change own password (Admin & Management only) ---------- */
function openChangePassModal() {
    if (!canChangeOwnPassword()) return deny('Analysts cannot change passwords. Please ask the Admin.');
    ['currentPassInput', 'newPassInput', 'confirmPassInput'].forEach(id => $(id).value = '');
    showModal('changePassModal');
}
async function handleChangePassword(ev) {
    ev.preventDefault();
    if ($('newPassInput').value.length < minPasswordLength()) return toast(`Use at least ${minPasswordLength()} characters.`, 'err');
    if ($('newPassInput').value !== $('confirmPassInput').value) return toast('New passwords do not match.', 'err');
    try {
        await busy(ev.submitter, () => Backend.changeOwnPassword($('currentPassInput').value, $('newPassInput').value));
        hideModal('changePassModal'); toast('Password updated.', 'ok');
    } catch { }
}

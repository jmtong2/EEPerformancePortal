/* Login, first-time cloud setup, role-based visibility, inactivity logout, change own password. */

function showLoginError(msg) { $('loginErrorText').innerText = msg; $('loginError').classList.remove('hidden'); }

function setLiveBadge(live) {
    const b = $('modeBadge');
    b.className = 'admin-only text-[10px] font-bold px-2 py-0.5 rounded-full border ' + (live ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-amber-100 text-amber-800 border-amber-300') + (isAdmin() ? '' : ' hidden');
    const name = Backend && Backend.provider ? Backend.provider : 'Cloud';
    b.innerHTML = `<i class="fa-solid fa-cloud"></i> ${esc(name)} · ${live ? 'Live' : 'Connecting…'}`;
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
    $('authConnecting').classList.remove('hidden');
    $('loginForm').classList.add('hidden'); $('setupForm').classList.add('hidden');
    let setup = false;
    try { setup = await Backend.needsSetup(); } catch (e) { showLoginError(friendlyError(e)); }
    $('authConnecting').classList.add('hidden');
    $('setupForm').classList.toggle('hidden', !setup);
    $('loginForm').classList.toggle('hidden', setup);
    $('authSubtitle').innerText = setup ? 'First-time Setup' : 'Authentication Required';
}

async function handleLogin(ev) {
    ev.preventDefault();
    $('loginError').classList.add('hidden');
    try { await busy($('loginBtn'), () => Backend.login($('loginUsername').value, $('loginPassword').value)); }
    catch (e) { showLoginError(friendlyError(e)); }
}

async function handleSetup(ev) {
    ev.preventDefault();
    const username = $('setupUsername').value.trim().toLowerCase(), errEl = $('setupError');
    errEl.classList.add('hidden');
    if (!validUsername(username)) { errEl.innerText = 'Username: 3–30 characters, letters/numbers/._- only.'; errEl.classList.remove('hidden'); return; }
    if ($('setupPassword').value.length < 8) { errEl.innerText = 'Use at least 8 characters for the Admin password.'; errEl.classList.remove('hidden'); return; }
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
        clearTimeout(inactivityTimer);
        applyRoleVisibility();
        showAuthModal();
        return;
    }
    hideModal('authModal');
    $('loginError').classList.add('hidden');
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
    if ($('newPassInput').value.length < 8) return toast('Use at least 8 characters.', 'err');
    if ($('newPassInput').value !== $('confirmPassInput').value) return toast('New passwords do not match.', 'err');
    try {
        await busy(ev.submitter, () => Backend.changeOwnPassword($('currentPassInput').value, $('newPassInput').value));
        hideModal('changePassModal'); toast('Password updated.', 'ok');
    } catch { }
}

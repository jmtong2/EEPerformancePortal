/* App entry point: picks the storage (Local or Supabase — see js/config.js) and starts the portal. Loaded last. */

window.addEventListener('load', async () => {
    buildScaffold();
    $('teleForm').addEventListener('input', () => renderChecks('teleChecks', validateTele(false)));
    $('teleForm').addEventListener('change', () => renderChecks('teleChecks', validateTele(false)));
    $('versionBadge').innerText = `Performance Portal ${APP_VERSION}`;

    // STORAGE_MODE may be missing in a config.js from an older version -> 'auto'.
    const mode = String(typeof STORAGE_MODE === 'undefined' ? 'auto' : STORAGE_MODE).trim().toLowerCase();
    const supabaseFilled = !!(String(SUPABASE_URL).trim() && String(SUPABASE_ANON_KEY).trim());
    if (mode === 'supabase' && !supabaseFilled) {
        $('loginForm').classList.add('hidden');
        showLoginError('STORAGE_MODE is \'supabase\' but SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js are empty (see docs/SUPABASE-SETUP.md), or set STORAGE_MODE to \'local\'.');
        return;
    }
    Backend = mode === 'local' || (mode !== 'supabase' && !supabaseFilled) ? LocalBackend : SupabaseBackend;

    setLiveBadge(false);
    $('loginForm').classList.add('hidden');
    $('authConnecting').classList.remove('hidden');
    try { await Backend.init(() => renderDashboard(), onAuthChanged); }
    catch (e) {
        $('authConnecting').classList.add('hidden');
        $('loginForm').classList.remove('hidden');
        showLoginError('Could not start: ' + friendlyError(e));
    }
});

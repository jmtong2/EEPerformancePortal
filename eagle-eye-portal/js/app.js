/* App entry point: connects to Supabase (see js/config.js) and starts the portal. Loaded last. */

window.addEventListener('load', async () => {
    buildScaffold();
    $('teleForm').addEventListener('input', () => renderChecks('teleChecks', validateTele(false)));
    $('teleForm').addEventListener('change', () => renderChecks('teleChecks', validateTele(false)));
    $('versionBadge').innerText = `Performance Portal ${APP_VERSION}`;
    Backend = SupabaseBackend;

    if (!(String(SUPABASE_URL).trim() && String(SUPABASE_ANON_KEY).trim())) {
        $('loginForm').classList.add('hidden');
        showLoginError('Supabase is not connected yet. Fill in SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js (see docs/SUPABASE-SETUP.md).');
        return;
    }
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

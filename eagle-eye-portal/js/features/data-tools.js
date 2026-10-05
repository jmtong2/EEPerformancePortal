/* Data menu (Admin only): month / as-of date / holidays, start new month, delete all, undo, reset to last import,
   plus the shared "busy" overlay and the Admin password confirmation used by the Excel import. */

function closeDataMenu() { $('dataMenu').classList.add('hidden'); }
function toggleDataMenu() {
    if (!isAdmin()) return deny('Only the Admin can open the Data menu.');
    renderDataMenu();
    $('dataMenu').classList.toggle('hidden');
}
document.addEventListener('click', e => { if (!e.target.closest('#dataMenu') && !e.target.closest('#dataMenuBtn')) closeDataMenu(); });

function renderDataMenu() {
    const s = state.snapshot;
    $('undoBtn').disabled = !s;
    $('undoLabel').innerText = s ? `Undo: ${s.reason}` : 'Undo (nothing to undo)';
    $('undoInfo').innerText = s ? `${fmtDateTime(s.takenAt)} · by ${s.takenBy}` : 'Delete-all, reset, imports and new month can be undone';
    $('newMonthLabel').innerText = `Start new month (${periodLabel(shiftPeriod(currentPeriod(), 1))})…`;
    $('storageInfo').innerHTML = Backend.storageText();
}

/* ---------- blocking progress overlay for long operations ---------- */
async function withProgress(label, fn) {
    $('busyLabel').innerText = label;
    showModal('busyOverlay');
    try { return await fn(); } finally { hideModal('busyOverlay'); }
}

/* ---------- Admin password confirmation (security check before an Excel import) ---------- */
let pwConfirm = null;
function askAdminPassword(title, message) {
    return new Promise(resolve => {
        pwConfirm = { resolve, attempts: 0 };
        $('pwConfirmTitle').innerText = title;
        $('pwConfirmMsg').innerText = message;
        $('pwConfirmInput').value = '';
        $('pwConfirmError').classList.add('hidden');
        showModal('pwConfirmModal');
        setTimeout(() => $('pwConfirmInput').focus(), 50);
    });
}
async function handlePwConfirm(ev) {
    ev.preventDefault();
    if (!pwConfirm) return;
    const btn = ev.submitter;
    if (btn) btn.disabled = true;
    try {
        await Backend.verifyPassword($('pwConfirmInput').value);
        hideModal('pwConfirmModal'); pwConfirm.resolve(true); pwConfirm = null;
    } catch (e) {
        pwConfirm.attempts++;
        if (pwConfirm.attempts >= 3) { hideModal('pwConfirmModal'); pwConfirm.resolve(false); pwConfirm = null; toast('Too many wrong passwords. Action cancelled.', 'err'); return; }
        $('pwConfirmError').innerText = `${friendlyError(e)} (${3 - pwConfirm.attempts} attempt${3 - pwConfirm.attempts === 1 ? '' : 's'} left)`;
        $('pwConfirmError').classList.remove('hidden');
        $('pwConfirmInput').value = '';
    } finally { if (btn) btn.disabled = false; }
}
function cancelPwConfirm() { hideModal('pwConfirmModal'); if (pwConfirm) { pwConfirm.resolve(false); pwConfirm = null; } }

/* ---------- Month, as-of date & holidays (business days for the targets) ---------- */
function openPeriodModal() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can change the month and holidays.');
    $('periodMonth').value = currentPeriod();
    $('periodAsOf').value = state.asOf || '';
    $('periodHolidays').value = (state.holidays || []).map(h => `${h.date}${h.name ? ' ' + h.name : ''}`).join('\n');
    $('periodChecks').dataset.sig = '';
    livePeriod();
    showModal('periodModal');
}
function parseHolidayLines(text, errors) {
    const out = [];
    String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
        const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
        if (!m || isNaN(parseYmd(m[1]).getTime()) || ymdLocal(parseYmd(m[1])) !== m[1]) { errors.push(`Holiday line ${i + 1} "${line.slice(0, 40)}" must start with a date like 2026-12-25.`); return; }
        out.push({ date: m[1], name: sanitizeText(m[2], 60) });
    });
    return sanitizeHolidays(out);
}
function validatePeriod() {
    const errors = [], warnings = [];
    const month = $('periodMonth').value, asOf = $('periodAsOf').value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) errors.push('Choose the month.');
    if (asOf) {
        if (periodOf(asOf) !== month) errors.push('The "as of" date must be inside the chosen month.');
        if (asOf > todayStr()) errors.push('The "as of" date cannot be in the future.');
    }
    const holidays = parseHolidayLines($('periodHolidays').value, errors);
    if (!errors.length) {
        const saved = state.holidays; state.holidays = holidays;
        const prog = bdProgress(asOf || (periodOf(todayStr()) === month ? todayStr() : (todayStr() > month ? lastDayOf(month) : month + '-01')));
        state.holidays = saved;
        $('periodInfo').innerText = `${periodLabel(month)}: ${prog.total} business days (Mon–Fri minus ${holidays.filter(h => periodOf(h.date) === month).length} holiday(s)). As of ${dateLabel(prog.asOf)}: business day ${prog.elapsed} of ${prog.total}.`;
    } else $('periodInfo').innerText = '';
    return { errors, warnings, month, asOf, holidays };
}
function livePeriod() { renderChecks('periodChecks', validatePeriod()); }
async function handleSavePeriod(ev) {
    ev.preventDefault();
    if (!isAdmin()) return deny();
    const v = validatePeriod();
    if (!checksPass('periodChecks', v)) return;
    try {
        await busy(ev.submitter, () => Backend.saveConfig({ currentPeriod: v.month, asOf: v.asOf || null, holidays: v.holidays }));
        hideModal('periodModal'); toast('Month, as-of date and holidays saved. Targets updated.', 'ok');
    } catch { }
}

/* ---------- start new month / delete all / undo / reset (Admin only) ---------- */
async function handleStartNewMonth() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can start a new month.');
    const cur = currentPeriod(), next = shiftPeriod(cur, 1);
    const answer = prompt(`Close ${periodLabel(cur)} and start ${periodLabel(next)}?\n\n• This month's Collection, Fixed Provision and Repo become "last month" figures (shown in the comparison columns).\n• This month's actuals (collection, penalty, fixed provision, repo, provision of repo) restart at zero.\n• Telecollectors, accounts, collectibles, beginning, principal balance, To Retain and targets are kept until you import the new month's file.\n\nYou can undo this from Data → Undo.\n\nType NEW MONTH to confirm.`);
    if (answer === null) return;
    if (answer.trim().toUpperCase() !== 'NEW MONTH') return toast('Not started — you must type NEW MONTH exactly.', 'info');
    try { const p = await withProgress('Starting the new month…', () => Backend.startNewMonth()); toast(`${periodLabel(p || next)} started. Use Data → Undo to go back.`, 'ok'); }
    catch (e) { toast(friendlyError(e), 'err'); }
}

async function handleDeleteAll() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can delete all data.');
    const answer = prompt(`This deletes ALL ${state.collectors.length} telecollectors and the daily entries log for EVERY user.\nLeaders (TL/OM/GM), campaigns, KPI settings, month and holidays are kept.\nYou can undo this from Data → Undo.\n\nType DELETE to confirm.`);
    if (answer === null) return;
    if (answer.trim() !== 'DELETE') return toast('Not deleted — you must type DELETE exactly.', 'info');
    try { await withProgress('Deleting all data…', () => Backend.deleteAllData()); toast('All data deleted. Use Data → Undo to bring it back.', 'ok'); }
    catch (e) { toast(friendlyError(e), 'err'); }
}

async function handleUndo() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can undo.');
    const s = state.snapshot;
    if (!s) return toast('Nothing to undo.', 'info');
    const counts = s.counts ? ` (${s.counts.collectors} telecollectors, ${s.counts.entries} entries)` : '';
    if (!confirm(`Undo "${s.reason}" from ${fmtDateTime(s.takenAt)} by ${s.takenBy}?\n\nAll data goes back to exactly how it was before${counts}. Changes made since then will be replaced.`)) return;
    try { const meta = await withProgress('Restoring data…', () => Backend.undoLast()); toast(`Restored the data from before "${meta.reason}".`, 'ok'); }
    catch (e) { toast(friendlyError(e), 'err'); }
}

async function handleReset() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can reset the data.');
    const answer = prompt('Reset ALL data to exactly how it was right after the last Excel import?\nChanges made since then (edits, daily entries, TL/OM/GM, KPI settings) are replaced and the entries log is cleared, for EVERY user.\nYou can undo this from Data → Undo.\n\nType RESET to confirm.');
    if (answer === null) return;
    if (answer.trim() !== 'RESET') return toast('Not reset — you must type RESET exactly.', 'info');
    try { const m = await withProgress('Resetting data…', () => Backend.resetToBaseline()); toast(`Data reset to the import of ${m.label || 'the last file'}. Use Data → Undo to go back.`, 'ok'); }
    catch (e) { toast(friendlyError(e), 'err'); }
}

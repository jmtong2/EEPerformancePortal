/* Daily Log-in Entry (Admin & Management). Adds to an EXISTING tele's month-to-date totals; never creates a tele.
   Beside Collection, Fixed Provision and Repo it shows that telecollector's ON TRACK figure for the entry date. */

function openEntryModal(prefKey) {
    if (!canEdit()) return deny('Only Admin and Management can submit daily entries.');
    const c = prefKey ? findCollector(prefKey) : null;
    $('entryCampaign').innerHTML = allCampaigns().map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if (c) { $('entryCampaign').value = c.campaign; $('entryTeam').value = c.team; }
    $('entryDate').value = todayStr();
    $('entryDate').max = todayStr();
    ['entryCollection', 'entryPenalty', 'entryFixedProv', 'entryRepo'].forEach(id => $(id).value = '');
    $('entryChecks').dataset.sig = '';
    refreshEntryNames(c ? c.key : null);
    showModal('entryModal');
}

function refreshEntryNames(selectKey) {
    const camp = $('entryCampaign').value, team = $('entryTeam').value;
    const list = state.collectors.filter(c => c.campaign === camp && c.team === team).sort((a, b) => a.name.localeCompare(b.name));
    $('entryName').innerHTML = list.length ? list.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('') : `<option value="">— No ${team} teles in this campaign —</option>`;
    if (selectKey) $('entryName').value = selectKey;
    updateEntryPreview();
}

// ON TRACK figures for one telecollector, counted up to the entry date (today by default).
function entryTargets(c, date) {
    const prog = bdProgress(/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayStr());
    return { prog, ...targetsFor(sumStats([c]), prog) };
}

function validateEntry(submit) {
    const errors = [], warnings = [];
    const c = findCollector($('entryName').value), date = $('entryDate').value;
    if (!c) errors.push('Select an existing telecollector (add them first via "Add Tele Collector").');
    if (!date) errors.push('Date is required.');
    else if (date > todayStr()) errors.push('Date cannot be in the future.');
    else {
        if ((new Date(todayStr()) - new Date(date)) / 864e5 > 45) warnings.push('Date is more than 45 days ago — is this correct?');
        if (periodOf(date) !== currentPeriod()) warnings.push(`This date is not in the current month (${periodLabel(currentPeriod())}).`);
    }
    const collection = readMoney('entryCollection', 'Collection', errors), penalty = readMoney('entryPenalty', 'Penalty', errors),
        fixedProv = readMoney('entryFixedProv', 'Fixed Provision', errors), repo = readInt('entryRepo', 'Repo', errors);
    if (submit && !errors.length && !collection && !penalty && !fixedProv && !repo) errors.push('Enter at least one amount.');
    if (c && !errors.length) {
        if (c.accs1 > 0 && c.repo + repo > c.accs1) errors.push(`Repo would become ${c.repo + repo}, but ${c.name} only has ${c.accs1} accounts.`);
        if (c.collectibles > 0 && c.collection + collection > c.collectibles) warnings.push(`Total collection would be ${formatPHP(c.collection + collection)}, higher than collectibles of ${formatPHP(c.collectibles)} (EFF ${pct(c.collection + collection, c.collectibles).toFixed(1)}%).`);
        if (c.collectibles > 0 && collection > c.collectibles * 0.3) warnings.push(`Unusually large for one day: ${pct(collection, c.collectibles).toFixed(0)}% of total collectibles.`);
        if (penalty > 0 && penalty > collection) warnings.push('Penalty is higher than the collection entered for the day.');
        if (c.toRetain !== null && c.fixedProv + fixedProv > c.toRetain) warnings.push(`Fixed provision would exceed To Retain (ACH ${pct(c.fixedProv + fixedProv, c.toRetain).toFixed(1)}%).`);
        const same = state.entries.filter(e => e.key === c.key && e.date === date).length;
        if (same) warnings.push(`${c.name} already has ${same} entr${same > 1 ? 'ies' : 'y'} for ${date}. Possible double entry.`);
    }
    return { errors, warnings, c, date, collection, penalty, fixedProv, repo };
}

function updateEntryPreview() {
    const v = validateEntry(false), c = v.c, box = $('entryPreview');
    if (!c) {
        box.innerHTML = '<span class="text-rose-600 font-semibold">No telecollector selected.</span> Use "Add Tele Collector" to create them first.';
        ['otCollection', 'otFixedProv', 'otRepo'].forEach(id => $(id).innerHTML = DASH);
        $('otInfo').innerText = '';
    } else {
        const t = entryTargets(c, v.date);
        // ON TRACK figure, plus the month-to-date total after this entry and ON TRACK % (On Track ÷ actual).
        const after = (actual, onTrack, f) => `<span class="ot-sub">After this entry: ${f(actual)}${actual > 0 ? ` · ON TRACK % ${((onTrack / actual) * 100).toFixed(1)}%` : ''}</span>`;
        $('otCollection').innerHTML = formatPHP(t.collection) + after(c.collection + v.collection, t.collection, formatPHP);
        $('otFixedProv').innerHTML = t.provision === null ? `${DASH}<span class="ot-sub">Needs TO RETAIN from the Excel file</span>` : formatPHP(t.provision) + after(c.fixedProv + v.fixedProv, t.provision, formatPHP);
        $('otRepo').innerHTML = t.repo === null ? `${DASH}<span class="ot-sub">Needs the repo TARGET from the Excel file</span>` : fmtUnits(t.repo) + after(c.repo + v.repo, t.repo, fmtInt);
        $('otInfo').innerText = `ON TRACK as of ${dateLabel(t.prog.asOf)} — business day ${t.prog.elapsed} of ${t.prog.total} in ${periodLabel(t.prog.period)}.`;
        box.innerHTML = `<div class="font-bold text-slate-800 mb-1">${esc(c.name)} · ${esc(c.campaign)} · ${c.team} — month-to-date</div>
        <div class="grid grid-cols-2 gap-2">
            <div>Collection <span class="text-slate-400">(EFF ${pct(c.collection + v.collection, c.collectibles).toFixed(1)}%)</span><br><b>${formatPHP(c.collection)}</b> <span class="text-emerald-600">→ ${formatPHP(c.collection + v.collection)}</span></div>
            <div>Penalty<br><b>${formatPHP(c.penalty)}</b> <span class="text-emerald-600">→ ${formatPHP(c.penalty + v.penalty)}</span></div>
            <div>Fixed Provision<br><b>${fmtNum(c.fixedProv)}</b> <span class="text-emerald-600">→ ${fmtNum(c.fixedProv + v.fixedProv)}</span></div>
            <div>Repo (actual) <span class="text-slate-400">(of ${c.accs1} accts)</span><br><b>${c.repo}</b> <span class="text-emerald-600">→ ${c.repo + v.repo}</span></div>
        </div>`;
    }
    renderChecks('entryChecks', v);
}

async function handleSaveEntry(ev) {
    ev.preventDefault();
    if (!canEdit()) return deny();
    const v = validateEntry(true);
    if (!checksPass('entryChecks', v)) return;
    const c = v.c;
    try {
        await busy($('entrySaveBtn'), () => Backend.addDailyEntry({
            key: c.key, campaign: c.campaign, team: c.team, name: c.name, date: v.date,
            collection: v.collection, penalty: v.penalty, fixedProv: v.fixedProv, repo: v.repo, repoProv: 0,
            by: currentUser.uid, byName: currentUser.displayName || currentUser.username
        }));
        hideModal('entryModal');
        toast(`Added to ${c.name}'s month-to-date totals.`, 'ok');
    } catch { }
}

// An entry can be undone only if it was made after the last Excel import / new month (older entries no longer match the totals).
function entryUndoable(e) { return !state.lastImportAt || e.ts >= state.lastImportAt; }

async function handleDeleteEntry(id) {
    if (!canEdit()) return deny();
    const e = state.entries.find(x => x.id === id); if (!e) return;
    if (!entryUndoable(e)) return deny('This entry was made before the last Excel import or new month, so undoing it would give wrong totals.');
    if (!confirm(`Undo this entry? This subtracts ${formatPHP(e.collection)} collection / ${formatPHP(e.penalty)} penalty / ${fmtNum(e.fixedProv)} fixed provision / ${e.repo} repo from ${e.name}.`)) return;
    try { await Backend.deleteEntry(id); toast('Entry removed and totals reversed.', 'ok'); } catch (err) { toast(friendlyError(err), 'err'); }
}

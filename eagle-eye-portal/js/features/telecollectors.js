/* Add / edit / delete telecollectors (Admin & Management). */

// [input id, field, kind]  kind: int | money | optMoney | optInt   (same fields as the Excel file)
const TELE_FIELDS = [
    ['teleAccs', 'accs1', 'int'], ['teleCollectibles', 'collectibles', 'money'], ['teleCollection', 'collection', 'money'], ['telePenalty', 'penalty', 'money'],
    ['teleSpCollection', 'lmSpCollection', 'optMoney'],
    ['teleEndingAccs', 'endingAccs', 'int'], ['teleEnding', 'ending', 'money'], ['teleBeginningAccs', 'beginningAccs', 'int'], ['teleBeginning', 'beginning', 'money'],
    ['teleToRetainAccs', 'toRetainAccs', 'int'], ['teleToRetain', 'toRetain', 'optMoney'], ['teleFixedAccs', 'fixedAccs', 'int'], ['teleFixedProv', 'fixedProv', 'money'],
    ['teleSpFixedProv', 'lmSpFixedProv', 'optMoney'],
    ['teleRepoAge2', 'repoAge2', 'money'], ['teleRepoAge3', 'repoAge3', 'money'], ['teleRepoAge4', 'repoAge4', 'money'],
    ['teleTargetRepo', 'targetRepo', 'optMoney'], ['teleRepo', 'repo', 'int'], ['teleSpRepo', 'lmSpRepo', 'optMoney']
];
const TELE_LABELS = { accs1: '# Of Accounts', collectibles: 'Collectibles', collection: 'Collection', penalty: 'Penalty', lmSpCollection: 'Same Period (Collection)',
    endingAccs: '# Of Accounts (Ending)', ending: 'Ending', beginningAccs: '# Of Accounts (Beginning)', beginning: 'Beginning',
    toRetainAccs: '# Of Accounts (To Retain)', toRetain: 'To Retain', fixedAccs: '# Of Accounts (Fixed Provision)', fixedProv: 'Fixed Provision',
    lmSpFixedProv: 'Same Period (Provision)', repoAge2: '2nd Month', repoAge3: '3rd Month', repoAge4: '4th Month and Up',
    targetRepo: 'Target (repo)', repo: 'Actual (repo)', lmSpRepo: 'Same Period (Repo)' };

function openTeleModal(key) {
    if (!canEdit()) return deny('Only Admin and Management can add or edit telecollectors.');
    const c = key ? findCollector(key) : null;
    $('teleOldKey').value = key || '';
    $('teleModalTitle').innerHTML = c ? '<i class="fa-solid fa-pen-to-square text-amber-600"></i> Edit Tele Collector' : '<i class="fa-solid fa-user-plus text-emerald-600"></i> Add Tele Collector';
    $('teleCampaign').innerHTML = allCampaigns().map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('') + '<option value="__new__">+ New campaign…</option>';
    $('teleCampaign').value = c ? c.campaign : ($('campaignFilterSelect').value !== 'ALL' ? $('campaignFilterSelect').value : (allCampaigns()[0] || '__new__'));
    $('teleNewCampaignWrap').classList.toggle('hidden', $('teleCampaign').value !== '__new__'); $('teleNewCampaign').value = '';
    $('teleTeam').value = c ? c.team : (currentActiveTab === 'recovery' ? 'recovery' : 'curing');
    $('teleName').value = c ? c.name : '';
    TELE_FIELDS.forEach(([id, f]) => $(id).value = c && c[f] !== null && c[f] !== undefined ? c[f] : '');
    $('deleteTeleBtn').classList.toggle('invisible', !c);
    $('teleChecks').dataset.sig = '';
    renderChecks('teleChecks', c ? validateTele(false) : { errors: [], warnings: [] });
    showModal('teleModal');
}

function validateTele(submit) {
    const errors = [], warnings = [];
    let campaign = $('teleCampaign').value;
    if (campaign === '__new__') campaign = cleanName(sanitizeText($('teleNewCampaign').value, 60));
    const name = cleanName(sanitizeText($('teleName').value, 80)), team = $('teleTeam').value, oldKey = $('teleOldKey').value;
    if (!campaign) { if (submit) errors.push('Campaign is required.'); }
    else if (!NAME_RE.test(campaign)) errors.push('Campaign name has invalid characters.');
    if (!name) { if (submit) errors.push('Full name is required.'); }
    else if (!PERSON_RE.test(name)) errors.push('Name can only contain letters, spaces, period, comma, apostrophe and hyphen (no numbers).');
    else if (name.replace(/[^A-ZÑ]/g, '').length < 3) errors.push('Name is too short.');

    const f = {};
    TELE_FIELDS.forEach(([id, field, kind]) => {
        const label = TELE_LABELS[field];
        f[field] = kind === 'int' ? readInt(id, label, errors) : kind === 'optInt' ? readOptInt(id, label, errors)
            : kind === 'optMoney' ? readOptMoney(id, label, errors) : readMoney(id, label, errors);
    });

    if (f.toRetain !== null && f.beginning > 0 && f.toRetain > f.beginning) errors.push('To Retain cannot be greater than Beginning.');
    if (f.accs1 > 0 && f.repo > f.accs1) errors.push('Repo actual (units) cannot be more than # of accounts.');
    if (submit || oldKey) {
        if (!f.accs1) warnings.push('# of accounts is 0.');
        if (!f.collectibles) warnings.push('Collectibles is 0, so EFF % and On Track Collection will show 0.');
    }
    if (f.collectibles > 0 && f.collection > f.collectibles) warnings.push('Collection is higher than Collectibles (EFF over 100%).');
    if (f.toRetain !== null && f.toRetain > 0 && f.fixedProv > f.toRetain) warnings.push('Fixed Provision is higher than To Retain (ACH over 100%).');
    if (f.penalty > 0 && f.penalty > f.collection) warnings.push('Penalty is higher than Collection.');
    if (f.toRetainAccs > 0 && f.fixedAccs > f.toRetainAccs) warnings.push('# of accounts for Fixed Provision is higher than for To Retain.');

    // Older fields that are no longer on the form (from earlier source files) are kept as they are.
    const before = oldKey ? findCollector(oldKey) : null;
    const c = makeCollector({ ...(before || {}), campaign, team, name, ...f });
    let dupKey = null;
    if (name && campaign && c.key !== oldKey) {
        const ex = findCollector(c.key);
        if (ex) { dupKey = ex.key; errors.push(`${ex.name} already exists in ${ex.campaign} (${ex.team}). Use "Daily Log-in Entry" to add production instead.`); }
        else state.collectors.filter(o => o.campaign === campaign && o.key !== oldKey && levenshtein(slug(o.name), slug(name)) <= 2)
            .forEach(o => warnings.push(`Similar name already exists: ${o.name} (${o.team}). Make sure this is not the same person.`));
    }
    return { errors, warnings, c, oldKey, dupKey };
}

async function handleSaveTele(ev) {
    ev.preventDefault();
    if (!canEdit()) return deny();
    const v = validateTele(true);
    if (v.dupKey && !v.oldKey && v.errors.length === 1) {
        renderChecks('teleChecks', v);
        if (confirm(v.errors[0] + '\n\nOpen Daily Log-in Entry for this person now?')) { hideModal('teleModal'); openEntryModal(v.dupKey); }
        return;
    }
    if (!checksPass('teleChecks', v)) return;
    try {
        await busy($('teleSaveBtn'), () => Backend.saveCollector(v.oldKey, v.c));
        hideModal('teleModal');
        toast(v.oldKey ? 'Telecollector updated.' : `${v.c.name} added.`, 'ok');
    } catch { }
}

async function handleDeleteTele() {
    if (!canEdit()) return deny();
    const key = $('teleOldKey').value, c = findCollector(key);
    if (!c || !confirm(`Permanently delete ${c.name} (${c.campaign}, ${c.team})? Their entries stay in the log.`)) return;
    try { await Backend.deleteCollector(key); hideModal('teleModal'); toast('Deleted.', 'ok'); } catch (e) { toast(friendlyError(e), 'err'); }
}

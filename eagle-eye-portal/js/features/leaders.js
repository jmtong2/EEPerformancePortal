/* Team Leaders / OM & AOM / General Managers: Admin only (add, change the handled campaigns, delete).
   The standard TL, OM & AOM and GM lists are in js/data/defaults.js (DEFAULT_LEADERS). */

const LEADER_TYPE_NAMES = { tl: 'TL', om: 'OM / AOM', gm: 'GM' };

function openLeaderModal(type, index) {
    if (!isAdmin()) return deny('Only the Admin can add or change TL, OM & AOM and GM.');
    const item = index >= 0 ? state.leaders[type][index] : null;
    $('editLeaderType').value = type; $('editLeaderIndex').value = index;
    $('editLeaderModalTitle').innerHTML = `<i class="fa-solid ${item ? 'fa-pen-to-square' : 'fa-user-plus'} text-amber-600"></i> ${item ? 'Edit' : 'Add'} ${esc(LEADER_TYPE_NAMES[type] || type.toUpperCase())}`;
    $('editLeaderName').value = item ? item.name : '';
    const sel = item ? item.campaigns : [];
    // Every campaign in the data, plus campaigns already given to a leader (they may have no telecollectors yet).
    const withData = new Set(state.collectors.map(c => c.campaign));
    const list = uniq([...allCampaigns(), ...leaderCampaigns(), ...sel]).sort();
    $('editLeaderCampaigns').innerHTML = list.map(c => `<label class="flex items-center gap-1.5"><input type="checkbox" value="${esc(c)}" ${sel.includes(c) ? 'checked' : ''}> ${esc(c)}${withData.has(c) ? '' : ' <span class="text-[10px] text-slate-400">(no telecollectors yet)</span>'}</label>`).join('')
        || '<p class="col-span-2 text-slate-400">No campaigns yet. Import the Excel file first.</p>';
    $('deleteLeaderBtn').classList.toggle('invisible', !item);
    showModal('editLeaderModal');
}

async function saveLeaders(mutator) {
    const leaders = clone(state.leaders); mutator(leaders);
    await Backend.saveConfig({ campaigns: uniq([...allCampaigns(), ...leaderCampaigns(leaders)]), leaders });
}

async function handleSaveLeader(ev) {
    ev.preventDefault();
    if (!isAdmin()) return deny('Only the Admin can add or change TL, OM & AOM and GM.');
    const type = $('editLeaderType').value, index = parseInt($('editLeaderIndex').value);
    const item = { name: cleanName(sanitizeText($('editLeaderName').value, 80)), campaigns: [...$('editLeaderCampaigns').querySelectorAll('input:checked')].map(i => i.value) };
    if (!PERSON_RE.test(item.name) || item.name.length < 3) return toast('Enter a valid name (letters, spaces, period, hyphen).', 'err');
    if (!item.campaigns.length) return toast('Select at least one campaign.', 'err');
    if (state.leaders[type].some((l, i) => i !== index && slug(l.name) === slug(item.name))) return toast(`${item.name} is already listed as ${LEADER_TYPE_NAMES[type]}.`, 'err');
    try {
        await busy(ev.submitter, () => saveLeaders(L => { if (index < 0) L[type].push(item); else L[type][index] = item; }));
        hideModal('editLeaderModal'); toast(`${LEADER_TYPE_NAMES[type]} saved.`, 'ok');
    } catch { }
}

async function handleDeleteLeader() {
    if (!isAdmin()) return deny('Only the Admin can add or change TL, OM & AOM and GM.');
    const type = $('editLeaderType').value, index = parseInt($('editLeaderIndex').value), item = state.leaders[type][index];
    if (!item || !confirm(`Remove ${item.name} from the ${LEADER_TYPE_NAMES[type]} list?`)) return;
    try { await saveLeaders(L => L[type].splice(index, 1)); hideModal('editLeaderModal'); toast(`${item.name} removed.`, 'ok'); } catch (e) { toast(friendlyError(e), 'err'); }
}

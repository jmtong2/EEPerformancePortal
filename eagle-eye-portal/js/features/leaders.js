/* Team Leaders / OM & AOM / General Managers (Admin & Management edit). */

function openLeaderModal(type, index) {
    if (!canEdit()) return deny('Only Admin and Management can edit leaders.');
    const item = index >= 0 ? state.leaders[type][index] : null;
    $('editLeaderType').value = type; $('editLeaderIndex').value = index;
    $('editLeaderModalTitle').innerHTML = `<i class="fa-solid ${item ? 'fa-pen-to-square' : 'fa-user-plus'} text-amber-600"></i> ${item ? 'Edit' : 'Add New'} ${esc(type.toUpperCase())}`;
    $('editLeaderName').value = item ? item.name : '';
    const sel = item ? item.campaigns : [];
    $('editLeaderCampaigns').innerHTML = allCampaigns().map(c => `<label class="flex items-center gap-1.5"><input type="checkbox" value="${esc(c)}" ${sel.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('');
    $('deleteLeaderBtn').classList.toggle('invisible', !item);
    showModal('editLeaderModal');
}

async function saveLeaders(mutator) {
    const leaders = clone(state.leaders); mutator(leaders);
    await Backend.saveConfig({ campaigns: allCampaigns(), leaders });
}

async function handleSaveLeader(ev) {
    ev.preventDefault();
    if (!canEdit()) return deny();
    const type = $('editLeaderType').value, index = parseInt($('editLeaderIndex').value);
    const item = { name: cleanName(sanitizeText($('editLeaderName').value, 80)), campaigns: [...$('editLeaderCampaigns').querySelectorAll('input:checked')].map(i => i.value) };
    if (!PERSON_RE.test(item.name) || item.name.length < 3) return toast('Enter a valid name (letters, spaces, period, hyphen).', 'err');
    if (!item.campaigns.length) return toast('Select at least one campaign.', 'err');
    if (state.leaders[type].some((l, i) => i !== index && slug(l.name) === slug(item.name))) return toast(`${item.name} is already listed as ${type.toUpperCase()}.`, 'err');
    try {
        await busy(ev.submitter, () => saveLeaders(L => { if (index < 0) L[type].push(item); else L[type][index] = item; }));
        hideModal('editLeaderModal'); toast('Leader saved.', 'ok');
    } catch { }
}

async function handleDeleteLeader() {
    if (!canEdit()) return deny();
    const type = $('editLeaderType').value, index = parseInt($('editLeaderIndex').value);
    if (!confirm('Delete this leader?')) return;
    try { await saveLeaders(L => L[type].splice(index, 1)); hideModal('editLeaderModal'); toast('Leader deleted.', 'ok'); } catch (e) { toast(friendlyError(e), 'err'); }
}

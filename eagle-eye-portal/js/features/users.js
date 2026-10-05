/* User accounts — Admin only (the only role that can add users). */

async function openUsersModal() {
    if (!isAdmin()) return deny('Only the Admin can manage users.');
    $('usersCloudNote').innerText = Backend.usersNote || '';
    $('usersCloudNote').classList.toggle('hidden', !Backend.usersNote);
    showModal('usersModal');
    try { await renderUsers(); } catch (e) { toast(friendlyError(e), 'err'); }
}

async function renderUsers() {
    const users = await Backend.listUsers();
    const order = { [ROLE.ADMIN]: 0, [ROLE.MGMT]: 1, [ROLE.ANALYST]: 2 };
    $('usersTableBody').innerHTML = users.sort((a, b) => (order[a.role] - order[b.role]) || a.username.localeCompare(b.username)).map(u => {
        const self = u.uid === currentUser.uid, lock = self ? 'disabled title="You cannot change your own role/status"' : '';
        return `<tr class="border-b border-slate-100">
            <td class="py-2 px-2 font-bold">${esc(u.username)}${self ? ' <span class="text-[10px] text-emerald-600">(you)</span>' : ''}</td>
            <td class="py-2 px-2">${esc(u.displayName)}</td>
            <td class="py-2 px-2"><select class="inp !py-1" ${lock} onchange="userAction('role','${esc(u.uid)}',this.value)">
                ${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
            <td class="py-2 px-2 text-center"><input type="checkbox" ${u.active ? 'checked' : ''} ${lock} onchange="userAction('active','${esc(u.uid)}',this.checked)"></td>
            <td class="py-2 px-2 text-center whitespace-nowrap">
                <button onclick="userAction('reset','${esc(u.uid)}')" class="text-amber-600 hover:underline mr-2"><i class="fa-solid fa-key"></i> Reset PW</button>
                ${self ? '' : `<button onclick="userAction('delete','${esc(u.uid)}')" class="text-rose-600 hover:underline"><i class="fa-solid fa-trash"></i> Delete</button>`}
            </td></tr>`;
    }).join('');
}

async function userAction(kind, uid, value) {
    if (!isAdmin()) return deny('Only the Admin can manage users.');
    if (uid === currentUser.uid && kind !== 'reset') return deny('You cannot change your own role or status.');
    try {
        if (kind === 'role') { if (!ROLES.includes(value)) return; await Backend.updateUser(uid, { role: value }); }
        if (kind === 'active') await Backend.updateUser(uid, { active: value });
        if (kind === 'delete') { if (!confirm('Delete this user? They will lose access immediately.')) return; await Backend.deleteUser(uid); }
        if (kind === 'reset') {
            if (!Backend.canResetPasswords) return Backend.resetUserPassword(uid).catch(e => alert(e.message));
            const pw = prompt('New password for this user (min 8 characters):');
            if (!pw) return;
            if (pw.length < 8) return toast('Password must be at least 8 characters.', 'err');
            await Backend.resetUserPassword(uid, pw);
        }
        toast('User updated.', 'ok');
    } catch (e) { toast(friendlyError(e), 'err'); }
    renderUsers().catch(() => { });
}

async function handleAddUser(ev) {
    ev.preventDefault();
    if (!isAdmin()) return deny('Only the Admin can add users.');
    const username = $('newUserUsername').value.trim().toLowerCase();
    const role = $('newUserRole').value;
    if (!validUsername(username)) return toast('Username: 3–30 characters, letters/numbers/._- only (no spaces).', 'err');
    if (!ROLES.includes(role)) return toast('Choose a role.', 'err');
    if ($('newUserPassword').value.length < 8) return toast('Password must be at least 8 characters.', 'err');
    try {
        await busy(ev.submitter, () => Backend.addUser({ username, displayName: cleanName(sanitizeText($('newUserDisplay').value, 80)), role, password: $('newUserPassword').value }));
        ['newUserUsername', 'newUserDisplay', 'newUserPassword'].forEach(id => $(id).value = '');
        toast(`User "${username}" created as ${role}.`, 'ok');
        renderUsers();
    } catch { }
}

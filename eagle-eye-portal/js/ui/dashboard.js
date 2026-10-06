/* Dashboard rendering: company + telecollector tabs, KPI cards, last month's collection, and the
   telecollector / leader / campaign / entries tables. Company tabs: js/ui/company.js · charts: js/ui/charts.js. */

const TD = 'py-3 px-3';
const ROW = 'border-b border-slate-100 hover:bg-slate-50/80 text-xs transition';
// No rank (null) = no figures to score yet.
const rankBadge = r => (r === null || r === undefined ? '<span class="text-slate-400 font-semibold">—</span>' : r === 1 ? '👑 Rank 1' : `Rank ${r}`);

const TABS = [
    ['all', 'fa-layer-group', '', 'All Telecollectors'], ['curing', 'fa-heart-pulse', 'text-amber-600', 'Curing Teles'],
    ['recovery', 'fa-rotate-left', 'text-blue-600', 'Recovery Teles'], ['tl', 'fa-user-tie', 'text-blue-600', 'Team Leaders (TL)'],
    ['om', 'fa-user-shield', 'text-indigo-600', 'OM & AOM Ranking'], ['gm', 'fa-crown', 'text-amber-600', 'General Managers (GM)'],
    ['summary', 'fa-chart-column', 'text-indigo-600', 'Campaign Summary & Race'], ['entries', 'fa-clock-rotate-left', 'text-emerald-600', 'Entries Log', true /* Admin + Management */]
];
const LEADER_TYPES = {
    tl: { title: 'TEAM LEADERS (TL) RANKING & PERFORMANCE (AUTO-CONSOLIDATED)', icon: 'fa-user-tie', c: 'blue', btn: 'Add TL' },
    om: { title: 'OPERATION MANAGERS & ASSISTANT OM RANKING (AUTO-CONSOLIDATED)', icon: 'fa-user-shield', c: 'indigo', btn: 'Add OM / AOM' },
    gm: { title: 'GENERAL MANAGERS (GM) RANKING & PERFORMANCE (AUTO-CONSOLIDATED)', icon: 'fa-crown', c: 'amber', btn: 'Add GM' }
};

// The 12 standard metric columns: COLLECTIBLES ... REPO
const METRIC_COLS = [['COLLECTIBLES'], ['COLLECTION'], ['EFF %', 'text-amber-600'], ['VARIANCE COLLECTION', 'text-indigo-600'], ['PENALTY'], ['% (vs Collection)', 'text-rose-600'], ['BEGINNING'], ['TO RETAIN'], ['FIXED PROVISION'], ['ACH %', 'text-emerald-600'], ['VARIANCE PROVISION', 'text-indigo-600'], ['REPO', 'text-center']];

// Works for one telecollector and for totals (sumStats): To Retain may be blank (null) until the source provides it.
function metricCells(i, repoColor = 'text-indigo-600') {
    const ret = i.toRetain === null || i.toRetain === undefined ? null : i.toRetain;
    const fixedForRet = i.fixedForRetain !== undefined ? i.fixedForRetain : i.fixedProv;
    return `<td class="${TD} font-medium">${formatPHP(i.collectibles)}</td>
        <td class="${TD} font-semibold text-amber-600">${formatPHP(i.collection)}</td>
        <td class="${TD} font-bold text-amber-600">${pct(i.collection, i.collectibles).toFixed(1)}%</td>
        <td class="${TD} font-medium text-indigo-600">${formatPHP(i.collectibles - i.collection)}</td>
        <td class="${TD} font-semibold text-rose-600">${formatPHP(i.penalty)}</td>
        <td class="${TD} font-bold text-rose-600">${pct(i.penalty, i.collection).toFixed(1)}%</td>
        <td class="${TD} font-medium text-slate-700">${i.beginning ? fmtNum(i.beginning) : DASH}</td>
        <td class="${TD} font-medium text-slate-700">${optNumFmt(ret)}</td>
        <td class="${TD} font-medium text-emerald-700">${fmtNum(i.fixedProv)}</td>
        <td class="${TD} font-bold text-emerald-600">${ret === null ? DASH : pct(fixedForRet, ret).toFixed(1) + '%'}</td>
        <td class="${TD} font-medium text-indigo-600">${ret === null ? DASH : fmtNum(ret - fixedForRet)}</td>
        <td class="${TD} text-center font-bold ${repoColor}">${i.repo}</td>`;
}

// Plain table header row (column meanings are in the Column Guide, not on hover).
function th(cells) {
    return `<tr class="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">${cells.map(([t, cls = '']) =>
        `<th class="py-3 px-3 whitespace-nowrap ${cls}">${t}</th>`).join('')}</tr>`;
}

/* ---------- one-time scaffold (tabs, table headers, leader + summary sections) ---------- */
function buildScaffold() {
    const tabBtn = ([id, icon, color, label, editOnly]) =>
        `<button onclick="switchTab('${id}')" id="tab-${id}" class="tab-btn ${editOnly ? 'edit-only hidden' : ''} font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition whitespace-nowrap"><i class="fa-solid ${icon} ${color}"></i> ${label}</button>`;
    $('companyTabNav').innerHTML = CO_TABS.map(tabBtn).join('');
    $('tabNav').innerHTML = TABS.map(tabBtn).join('');

    // ACTION columns are only shown to the roles that can use them (Analysts are view only): teles = Admin + Management, leaders = Admin.
    const teleHead = kpi => th([['RANK', 'text-center'], ['CAMPAIGN'], ['FULL NAME'], ['# ACCS', 'text-center'], ...METRIC_COLS, ['KPI RATE', `text-center font-extrabold ${kpi}`], ['ACTION', 'text-center edit-only hidden']]);
    $('curingHead').innerHTML = teleHead('bg-amber-50/50 text-amber-900 border-l border-r border-amber-100');
    $('recoveryHead').innerHTML = teleHead('bg-blue-50/50 text-blue-900 border-l border-r border-blue-100');

    $('leaderSections').innerHTML = Object.entries(LEADER_TYPES).map(([k, t]) => `
        <div id="${k}Section" class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6 hidden">
            <div class="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div class="flex items-center gap-2"><i class="fa-solid ${t.icon} text-${t.c}-600"></i><h3 class="font-bold text-${t.c}-700 text-xs tracking-wide uppercase">${t.title}</h3></div>
                <div class="flex items-center gap-3">
                    <button onclick="openLeaderModal('${k}', -1)" class="admin-only hidden bg-${t.c}-600 hover:bg-${t.c}-700 text-white px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1"><i class="fa-solid fa-plus"></i> ${t.btn}</button>
                    <span id="${k}Count" class="bg-${t.c}-100 text-${t.c}-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full"></span>
                </div>
            </div>
            <div class="overflow-x-auto"><table class="w-full text-left border-collapse"><thead>${th([['RANK', 'text-center'], ['FULL NAME'], ['HANDLED CAMPAIGNS'], ['# ACCS', 'text-center'], ...METRIC_COLS, ['KPI RATE', `text-center font-extrabold bg-${t.c}-50/50 text-${t.c}-900`], ['ACTION', 'text-center admin-only hidden']])}</thead><tbody id="${k}TableBody"></tbody></table></div>
        </div>`).join('');

    const chartCard = (icon, color, title, canvasId) => `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="pb-3 border-b border-slate-100 mb-3">
                <h3 class="font-bold text-slate-900 text-sm uppercase tracking-wide flex items-center gap-2"><i class="fa-solid ${icon} ${color}"></i> ${title}</h3>
                <p id="${canvasId}Sub" class="text-[11px] text-slate-500 mt-0.5"></p>
            </div>
            <div class="relative" style="height:160px"><canvas id="${canvasId}" role="img" aria-label="${title}"></canvas></div>
        </div>`;
    $('campaignSummarySection').innerHTML = `
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
            ${chartCard('fa-trophy', 'text-amber-500', 'Collection Ranking (Per Campaign)', 'chartCollection')}
            ${chartCard('fa-trophy', 'text-rose-500', 'Penalty Ranking (Per Campaign)', 'chartPenalty')}
            ${chartCard('fa-trophy', 'text-emerald-500', 'Provision Ranking (Per Campaign)', 'chartProvision')}
            ${chartCard('fa-trophy', 'text-indigo-500', 'Repo Ranking (Per Campaign)', 'chartRepo')}
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="pb-3 border-b border-slate-100 mb-3"><h3 class="font-bold text-slate-900 text-sm uppercase tracking-wide flex items-center gap-2"><i class="fa-solid fa-table text-indigo-600"></i> Campaign Summary Table</h3>
                <p class="text-[11px] text-slate-500 mt-0.5">The figures behind the charts above.</p></div>
            <div class="overflow-x-auto"><table class="w-full text-left border-collapse"><thead>${th([['CAMPAIGN'], ['# ACCS', 'text-center'], ...METRIC_COLS])}</thead><tbody id="campaignSummaryTableBody"></tbody></table></div>
        </div>`;
}

/* ---------- main render ---------- */
function switchTab(tabId) { currentActiveTab = tabId; renderDashboard(); }

function renderDashboard() {
    if (!currentUser) return;
    applyRoleVisibility();
    const valid = CO_TABS.some(t => t[0] === currentActiveTab) || TABS.some(t => t[0] === currentActiveTab);
    if (!valid || (!canEdit() && currentActiveTab === 'entries')) currentActiveTab = 'co-collection';
    document.querySelectorAll('.tab-btn').forEach(b => {
        const on = b.id === `tab-${currentActiveTab}`;
        b.classList.toggle('bg-amber-500', on); b.classList.toggle('text-slate-950', on); b.classList.toggle('shadow-sm', on);
        b.classList.toggle('text-slate-600', !on); b.classList.toggle('hover:bg-slate-100', !on);
    });
    if (!$('dataMenu').classList.contains('hidden')) renderDataMenu();
    renderResetBadge();
    if (!$('usersModal').classList.contains('hidden')) renderResetRequests();

    const sel = $('campaignFilterSelect'), prev = sel.value || 'ALL';
    sel.innerHTML = `<option value="ALL">ALL CAMPAIGNS UNIFIED</option>` + allCampaigns().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = allCampaigns().includes(prev) ? prev : 'ALL';

    const q = $('searchInput').value.toLowerCase(), camp = sel.value;
    const filtered = state.collectors.filter(i => (i.name.toLowerCase().includes(q) || i.campaign.toLowerCase().includes(q)) && (camp === 'ALL' || i.campaign === camp));

    renderCards(filtered);
    renderLastMonthCard(filtered);

    ['companySection', 'curingSection', 'recoverySection', 'campaignSummarySection', 'tlSection', 'omSection', 'gmSection', 'entriesSection'].forEach(id => $(id).classList.add('hidden'));
    const tele = ['all', 'curing', 'recovery'].includes(currentActiveTab);
    $('telemetryHeaderContainer').style.display = tele ? '' : 'none';
    $('accessLevelNotice').innerText = isAdmin() ? 'Mode: Admin (Full Access)' : canEdit() ? 'Mode: Management (Edit Access)' : 'Mode: Analyst (View Only)';
    $('emptyNotice').classList.toggle('hidden', state.collectors.length > 0);
    // Supabase database still on an older setup script (the v9 SQL adds the TL / OM & AOM lists and Admin-only leader changes).
    $('upgradeNotice').classList.toggle('hidden', !(isAdmin() && Backend && Backend.mode === 'cloud' && state.schemaVersion !== null && state.schemaVersion < 9));

    if (currentActiveTab.startsWith('co-')) {
        $('companySection').classList.remove('hidden');
        const scope = (camp === 'ALL' ? 'ALL CAMPAIGNS' : camp) + (q ? ` · SEARCH "${q.toUpperCase()}"` : '');
        renderCompany(currentActiveTab, filtered, scope);
    } else if (tele) {
        $('sectionTitleHeader').innerText = { all: 'LIVE TELECOLLECTOR PERFORMANCE TELEMETRY (ALL TEAMS)', curing: 'CURING TELES TELEMETRY', recovery: 'RECOVERY TELES TELEMETRY' }[currentActiveTab];
        if (currentActiveTab !== 'recovery') $('curingSection').classList.remove('hidden');
        if (currentActiveTab !== 'curing') $('recoverySection').classList.remove('hidden');
        renderTeleTable('curing', filtered, 'amber');
        renderTeleTable('recovery', filtered, 'blue');
    } else if (LEADER_TYPES[currentActiveTab]) {
        $(`${currentActiveTab}Section`).classList.remove('hidden');
        renderLeaderTable(currentActiveTab, q, camp);
    } else if (currentActiveTab === 'summary') {
        $('campaignSummarySection').classList.remove('hidden');
        renderCampaignSummary();
    } else if (currentActiveTab === 'entries') {
        $('entriesSection').classList.remove('hidden');
        renderEntries(q, camp);
    }
}

function renderCards(filtered) {
    const t = sumStats(filtered);
    $('cardCollectibles').innerText = formatPHP(t.collectibles);
    $('cardCollection').innerText = formatPHP(t.collection);
    $('cardLiqRate').innerText = `${t.effRate.toFixed(1)}% Efficiency Rate`;
    $('cardPenalty').innerText = formatPHP(t.penalty);
    $('cardPenRate').innerText = `${t.penRate.toFixed(1)}% Penalty Rate`;
    $('cardProvision').innerText = fmtNum(t.fixedProv);
    $('cardProvRate').innerText = t.achRate === null ? 'ACH % shows once TO RETAIN is in the data' : `${t.achRate.toFixed(1)}% ACH (of ${fmtNum(t.toRetain)} To Retain)`;
    $('cardRepo').innerText = fmtInt(t.repo);
    $('cardRepoRate').innerText = `${pct(t.repo, t.accs1).toFixed(1)}% of ${fmtInt(t.accs1)} accounts`;
}

// Upper-right card: SAME PERIOD collection (last month at the same point of the month) for the current filter,
// compared with this month so far.
function renderLastMonthCard(filtered) {
    const s = sumStats(filtered);
    $('lmCardPeriod').innerText = periodLabel(shiftPeriod(currentPeriod(), -1));
    if (s.lmSpCollection === null) {
        $('lmCardValue').innerHTML = DASH;
        $('lmCardSub').innerText = 'Not in the data yet (SAME PERIOD (COLLECTION) column of the Excel file).';
        return;
    }
    $('lmCardValue').innerText = formatPHP(s.lmSpCollection);
    const v = s.collectionForSp - s.lmSpCollection, ch = samePeriodChange(s.collectionForSp, s.lmSpCollection);
    $('lmCardSub').innerHTML = `This month so far: <b>${formatPHP(s.collectionForSp)}</b><br>SAME PERIOD VARIANCE: <b class="${v >= 0 ? 'text-emerald-700' : 'text-rose-600'}">` +
        `<i class="fa-solid ${v >= 0 ? 'fa-caret-up' : 'fa-caret-down'}"></i> ${formatPHP(v)}${ch === null ? '' : ` (${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%)`}</b>`;
}

// 4 name/count columns + the 12 metric columns + KPI RATE, plus ACTION when the role can use it.
const tableCols = withAction => 4 + METRIC_COLS.length + 1 + (withAction ? 1 : 0);

function renderTeleTable(team, filtered, color) {
    const ranked = rankedTeles(team, filtered), edit = canEdit();
    $(`${team}Count`).innerText = `${ranked.length} Specialists`;
    $(`${team}TableBody`).innerHTML = ranked.map(i => {
        const k = esc(i.key);
        const actions = !edit ? '' : `<td class="${TD} text-center whitespace-nowrap">
            <button onclick="openEntryModal('${k}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-lg text-xs font-semibold"><i class="fa-solid fa-plus"></i> Entry</button>
            <button onclick="openTeleModal('${k}')" class="bg-amber-50 hover:bg-amber-100 text-amber-600 px-2.5 py-1 rounded-lg text-xs font-semibold"><i class="fa-solid fa-pen"></i> Edit</button></td>`;
        return `<tr class="${ROW}">
            <td class="${TD} text-center font-bold text-${color}-600 whitespace-nowrap">${rankBadge(i.assignedRank)}</td>
            <td class="${TD} font-bold text-indigo-600">${esc(i.campaign)}</td>
            <td class="${TD} font-bold text-slate-800">${esc(i.name)}</td>
            <td class="${TD} text-center text-slate-600 font-semibold">${i.accs1}</td>
            ${metricCells(i, `text-${color}-600`)}
            <td class="${TD} text-center font-extrabold text-${color}-600 bg-${color}-50/40 border-l border-r border-${color}-100 text-sm">${i.kpiRate.toFixed(1)}%</td>
            ${actions}
        </tr>`;
    }).join('') || `<tr><td colspan="${tableCols(edit)}" class="py-6 text-center text-xs text-slate-400">No telecollectors match.</td></tr>`;
}

function renderLeaderTable(type, q, camp) {
    const ranked = rankedLeaders(type, camp).filter(i => i.name.toLowerCase().includes(q) || i.campaigns.some(c => c.toLowerCase().includes(q)));
    const admin = isAdmin(), withData = new Set(state.collectors.map(c => c.campaign));
    // Campaigns without telecollectors (e.g. a different spelling in the Excel file) are greyed out so the Admin can spot them.
    const camps = list => list.map(c => withData.has(c) ? esc(c) : `<span class="text-slate-400 font-normal" title="No telecollectors in this campaign yet">${esc(c)}</span>`).join(', ');
    $(`${type}Count`).innerText = `${ranked.length} Leaders`;
    $(`${type}TableBody`).innerHTML = ranked.map(i => `<tr class="${ROW}">
        <td class="${TD} text-center font-bold text-amber-600 whitespace-nowrap">${rankBadge(i.assignedRank)}</td>
        <td class="${TD} font-bold text-slate-800">${esc(i.name)}</td>
        <td class="${TD} font-semibold text-indigo-600">${camps(i.campaigns)}</td>
        <td class="${TD} text-center text-slate-600 font-semibold">${i.accs1}</td>
        ${metricCells(i)}
        <td class="${TD} text-center font-extrabold text-amber-600 bg-amber-50/40 border-l border-r border-amber-100 text-sm">${i.kpiRate.toFixed(1)}%</td>
        ${admin ? `<td class="${TD} text-center"><button onclick="openLeaderModal('${type}', ${i.idx})" class="bg-amber-50 hover:bg-amber-100 text-amber-600 px-2.5 py-1 rounded-lg text-xs font-semibold"><i class="fa-solid fa-pen"></i> Edit</button></td>` : ''}
    </tr>`).join('') || `<tr><td colspan="${tableCols(admin)}" class="py-6 text-center text-xs text-slate-400">No leaders match.</td></tr>`;
}

/* Campaign Summary & Race: one ranking chart per division (all campaigns), then the summary table. */
function renderCampaignSummary() {
    const stats = campaignStatsList();
    const rank = field => getAssignedRanks(stats, field);
    const label = c => `${c.assignedRank}. ${c.name}`;
    const pctFmt = v => v.toFixed(1) + '%';

    $('chartCollectionSub').innerText = 'Ranked by EFF % = Collection ÷ Collectibles';
    renderRankingChart('chartCollection', rank('effRate').map(c => ({ label: label(c), value: round2(c.effRate),
        tip: [`Collection ${formatPHP(c.collection)}`, `Collectibles ${formatPHP(c.collectibles)}`] })), { series: 'EFF %', format: pctFmt });

    $('chartPenaltySub').innerText = 'Ranked by % vs Collection = Penalty ÷ Collection';
    renderRankingChart('chartPenalty', rank('penRate').map(c => ({ label: label(c), value: round2(c.penRate),
        tip: [`Penalty ${formatPHP(c.penalty)}`, `Collection ${formatPHP(c.collection)}`] })), { series: '% vs Collection', format: pctFmt });

    if (stats.some(c => c.achRate !== null)) {
        $('chartProvisionSub').innerText = 'Ranked by ACH % = Fixed Provision ÷ To Retain (— = no To Retain yet)';
        renderRankingChart('chartProvision', rank('achRate').map(c => ({ label: label(c), value: c.achRate === null ? null : round2(c.achRate),
            tip: [`Fixed Provision ${fmtNum(c.fixedProv)}`, `To Retain ${c.toRetain === null ? '—' : fmtNum(c.toRetain)}`] })), { series: 'ACH %', format: pctFmt });
    } else {
        $('chartProvisionSub').innerText = 'Ranked by Fixed Provision until TO RETAIN is in the data (then by ACH %)';
        renderRankingChart('chartProvision', rank('fixedProv').map(c => ({ label: label(c), value: c.fixedProv,
            tip: [`Beginning ${fmtNum(c.beginning)}`] })), { series: 'Fixed Provision', format: compactPHP });
    }

    $('chartRepoSub').innerText = 'Ranked by repo units';
    renderRankingChart('chartRepo', rank('repo').map(c => ({ label: label(c), value: c.repo,
        tip: [`${pct(c.repo, c.accs1).toFixed(1)}% of ${fmtInt(c.accs1)} accounts`] })), { series: 'Repo units', format: v => fmtInt(v), axis: v => (Number.isInteger(v) ? fmtInt(v) : '') });

    $('campaignSummaryTableBody').innerHTML = [...stats].sort((a, b) => b.effRate - a.effRate).map(c => `<tr class="${ROW}">
        <td class="${TD} font-bold text-indigo-600">${esc(c.name)}</td><td class="${TD} text-center text-slate-600 font-semibold">${c.accs1}</td>${metricCells(c)}</tr>`).join('')
        || `<tr><td colspan="14" class="py-6 text-center text-xs text-slate-400">No data yet.</td></tr>`;
}

function renderEntries(q, camp) {
    const list = state.entries.filter(e => ((e.name || '').toLowerCase().includes(q) || (e.byName || '').toLowerCase().includes(q) || (e.campaign || '').toLowerCase().includes(q)) && (camp === 'ALL' || e.campaign === camp));
    $('entriesCount').innerText = `${list.length} Entries`;
    $('entriesTableBody').innerHTML = list.map(e => `<tr class="${ROW}">
        <td class="${TD} font-semibold whitespace-nowrap">${esc(e.date)}</td>
        <td class="${TD} text-slate-500 whitespace-nowrap">${esc(fmtDateTime(e.ts))}</td>
        <td class="${TD} font-semibold text-slate-700">${esc(e.byName)}</td>
        <td class="${TD} font-bold text-indigo-600">${esc(e.campaign)}</td>
        <td class="${TD} capitalize">${esc(e.team)}</td>
        <td class="${TD} font-bold text-slate-800">${esc(e.name)}</td>
        <td class="${TD} font-semibold text-amber-600">${formatPHP(e.collection)}</td>
        <td class="${TD} font-semibold text-rose-600">${formatPHP(e.penalty)}</td>
        <td class="${TD} font-semibold text-emerald-700">${fmtNum(e.fixedProv)}</td>
        <td class="${TD} text-center font-bold text-indigo-600">${num(e.repo)}</td>
        <td class="${TD} text-center">${entryUndoable(e)
            ? `<button onclick="handleDeleteEntry('${esc(e.id)}')" class="bg-rose-50 hover:bg-rose-100 text-rose-600 px-2.5 py-1 rounded-lg text-xs font-semibold"><i class="fa-solid fa-rotate-left"></i> Undo</button>`
            : '<span class="text-[10px] text-slate-400">Before last import</span>'}</td>
    </tr>`).join('') || `<tr><td colspan="11" class="py-6 text-center text-xs text-slate-400">No daily entries yet.</td></tr>`;
}

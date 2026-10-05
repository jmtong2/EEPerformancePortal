/* Company totals: the Collection / Provision / Repo tabs (the row above the telecollector tabs).
   View "Company total" = Curing, Recovery and the company total; "By campaign" = one row per campaign (optionally one bucket).
   Follows the campaign filter and search. TARGET = On-Track Figure = monthly figure ÷ business days in the month ×
   business days elapsed up to the "as of" date (js/core/period.js). % of a target = actual ÷ target. */

let companyView = 'total';   // 'total' | 'campaign'
let companyBucket = 'all';   // by-campaign view: 'all' | 'curing' | 'recovery'

const CO_TABS = [['co-collection', 'fa-sack-dollar', 'text-amber-600', 'Collection'], ['co-provision', 'fa-vault', 'text-emerald-600', 'Provision'], ['co-repo', 'fa-circle-check', 'text-indigo-600', 'Repo']];
const CO_TITLES = { 'co-collection': 'COMPANY COLLECTION', 'co-provision': 'COMPANY PROVISION', 'co-repo': 'COMPANY REPO' };

// [header, value(s = totals, t = targets), type, unit of the last-month figure (sp only)]
// type: int | money | pct | units | sp (SAME PERIOD: value is { cur, lm } -> % change + last month's same-period figure)
const CO_COLS = {
    'co-collection': [
        ['# ACCS', s => s.accs1, 'int'],
        ['COLLECTIBLES', s => s.collectibles, 'money'],
        ['COLLECTION', s => s.collection, 'money'],
        ['EFF %', s => (s.collectibles > 0 ? s.effRate : null), 'pct'],
        ['VARIANCE COLLECTION', s => s.collectibles - s.collection, 'money'],
        ['PENALTY', s => s.penalty, 'money'],
        ['% (VS COLLECTION)', s => (s.collection > 0 ? s.penRate : null), 'pct'],
        ['COMPARISON LAST MONTH', s => s.lmCollection, 'money'],
        ['VARIANCE COMPARISON', s => (s.lmCollection === null ? null : s.collectionForLm - s.lmCollection), 'money'],
        ['TARGET COLLECTION', (s, t) => t.collection, 'money'],
        ['% (VS TARGET)', (s, t) => (t.collection > 0 ? (s.collection / t.collection) * 100 : null), 'pct'],
        ['VARIANCE', (s, t) => s.collection - t.collection, 'money'],
        ['SAME PERIOD', s => ({ cur: s.collectionForSp, lm: s.lmSpCollection }), 'sp', 'money']
    ],
    'co-provision': [
        ['# ACCS', s => s.accs1, 'int'],
        ['BEGINNING', s => s.beginning, 'money'],
        ['PRINCIPAL BAL', s => s.principalBal, 'money'],
        ['TO RETAIN', s => s.toRetain, 'money'],
        ['FIXED PROVISION', s => s.fixedProv, 'money'],
        ['VARIANCE', s => (s.toRetain === null ? null : s.toRetain - s.fixedForRetain), 'money'],
        ['% (VS TO RETAIN)', s => s.achRate, 'pct'],
        ['TARGET PROVISION', (s, t) => t.provision, 'money'],
        ['% (VS TARGET)', (s, t) => (t.provision > 0 ? (s.fixedForRetain / t.provision) * 100 : null), 'pct'],
        ['SAME PERIOD', s => ({ cur: s.fixedForSp, lm: s.lmSpFixedProv }), 'sp', 'money']
    ],
    'co-repo': [
        ['# ACCS', s => s.accs1, 'int'],
        ['TARGET REPO', (s, t) => t.repo, 'units'],
        ['REPO', s => s.repo, 'int'],
        ['PRINCIPAL BALANCE PROVISION', s => s.repoProv, 'money'],
        ['VARIANCE REPO', (s, t) => (t.repo === null ? null : t.repo - s.repoForTarget), 'units'],
        ['% (VS TARGET)', (s, t) => (t.repo > 0 ? (s.repoForTarget / t.repo) * 100 : null), 'pct'],
        ['SAME PERIOD', s => ({ cur: s.repoForSp, lm: s.lmSpRepo }), 'sp', 'units']
    ]
};
// Optional source figures per tab: a note under the table says when they are missing or only partly filled.
const CO_OPTIONAL = {
    'co-collection': [['lmCollection', 'COMPARISON LAST MONTH'], ['lmSpCollection', 'SAME PERIOD']],
    'co-provision': [['toRetain', 'TO RETAIN'], ['lmSpFixedProv', 'SAME PERIOD']],
    'co-repo': [['targetRepo', 'TARGET REPO'], ['lmSpRepo', 'SAME PERIOD']]
};

/* Rows for a view: [{ label, list, total?, s: totals, t: targets }] plus the business-day progress used for the targets. */
function companyRows(list, view = companyView, bucket = companyBucket) {
    let groups;
    if (view === 'campaign') {
        const l = bucket === 'all' ? list : list.filter(c => c.team === bucket);
        groups = uniq(l.map(c => c.campaign)).sort().map(name => ({ label: name, list: l.filter(c => c.campaign === name) }));
        groups.push({ label: bucket === 'all' ? 'TOTAL' : `TOTAL ${bucket.toUpperCase()}`, list: l, total: true });
    } else {
        groups = [['curing', 'CURING'], ['recovery', 'RECOVERY']].map(([team, label]) => ({ label, list: list.filter(c => c.team === team) })).filter(g => g.list.length);
        groups.push({ label: 'COMPANY TOTAL', list, total: true });
    }
    const prog = bdProgress(effectiveAsOf());
    return { prog, rows: groups.map(g => { const s = sumStats(g.list); return { ...g, s, t: targetsFor(s, prog) }; }) };
}

function coFmt(v, type) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return DASH;
    if (type === 'money') return formatPHP(v);
    if (type === 'pct') return v.toFixed(1) + '%';
    if (type === 'int') return fmtInt(v);
    return fmtUnits(v);
}
function spCell(sp, unit) {
    if (sp.lm === null || sp.lm === undefined) return DASH;
    const ch = samePeriodChange(sp.cur, sp.lm), lm = unit === 'money' ? formatPHP(sp.lm) : fmtUnits(sp.lm);
    const head = ch === null ? '<span class="text-slate-400">n/a</span>'
        : `<span class="font-bold ${ch >= 0 ? 'text-emerald-700' : 'text-rose-600'}"><i class="fa-solid ${ch >= 0 ? 'fa-caret-up' : 'fa-caret-down'}"></i> ${Math.abs(ch).toFixed(1)}%</span>`;
    return `${head}<span class="block text-[10px] text-slate-400 whitespace-nowrap">LM ${lm}</span>`;
}
function coCell(col, r) { const v = col[1](r.s, r.t); return col[2] === 'sp' ? spCell(v, col[3]) : coFmt(v, col[2]); }

function coverageNotes(tab, list) {
    return CO_OPTIONAL[tab].map(([f, label]) => {
        const have = list.filter(c => c[f] !== null && c[f] !== undefined).length;
        if (!list.length || have === list.length) return '';
        return have === 0 ? `${label}: not in the data yet, so it shows —.` : `${label}: only ${have} of ${list.length} telecollectors have this figure; comparisons use those ${have} only.`;
    }).filter(Boolean);
}

function setCompanyView(v) { companyView = v === 'campaign' ? 'campaign' : 'total'; renderDashboard(); }
function setCompanyBucket(b) { companyBucket = ['curing', 'recovery'].includes(b) ? b : 'all'; renderDashboard(); }

function renderCompany(tab, list, scopeText) {
    const { prog, rows } = companyRows(list);
    const cols = CO_COLS[tab];
    $('coTitle').innerText = `${CO_TITLES[tab]} — ${scopeText}`;
    $('coAsOf').innerText = `As of ${dateLabel(prog.asOf)} · business day ${prog.elapsed} of ${prog.total} in ${periodLabel(prog.period)} · TARGET = monthly figure ÷ ${prog.total} × ${prog.elapsed}`;
    [['coViewTotal', 'total'], ['coViewCampaign', 'campaign']].forEach(([id, v]) => {
        const on = companyView === v;
        $(id).classList.toggle('bg-white', on); $(id).classList.toggle('shadow-sm', on); $(id).classList.toggle('text-slate-900', on); $(id).classList.toggle('text-slate-500', !on);
    });
    $('coBucket').classList.toggle('hidden', companyView !== 'campaign');
    $('coBucket').value = companyBucket;

    // Compact cells and wrapping headers so the wide tables fit on a laptop screen (they scroll sideways on smaller ones).
    const CTD = 'py-2.5 px-2', centered = c => (['int', 'units'].includes(c[2]) ? 'text-center' : '');
    $('coHead').innerHTML = `<tr class="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
        <th class="${CTD} align-bottom">${companyView === 'campaign' ? 'CAMPAIGN' : 'BUCKET'}</th>
        ${cols.map(c => `<th class="${CTD} align-bottom leading-tight ${centered(c)}">${c[0]}</th>`).join('')}</tr>`;
    $('coBody').innerHTML = !list.length ? `<tr><td colspan="${cols.length + 1}" class="py-6 text-center text-xs text-slate-400">No telecollector data.</td></tr>`
        : rows.map(r => `<tr class="${r.total ? 'bg-slate-50 border-t-2 border-slate-200 text-xs font-bold' : ROW}">
            <td class="${CTD} font-bold ${r.total ? 'text-slate-900' : 'text-indigo-600'} whitespace-nowrap">${esc(r.label)}</td>
            ${cols.map(c => `<td class="${CTD} whitespace-nowrap ${centered(c)} ${r.total ? '' : 'font-medium text-slate-700'}">${coCell(c, r)}</td>`).join('')}
        </tr>`).join('');

    const notes = coverageNotes(tab, list);
    if (tab === 'co-repo') notes.push('VARIANCE REPO = TARGET REPO − REPO. PRINCIPAL BALANCE PROVISION = Provision of Repo, month-to-date (from the imported file plus Daily Log-in Entries).');
    $('coNotes').innerHTML = notes.map(n => `<p><i class="fa-solid fa-circle-info"></i> ${esc(n)}</p>`).join('');
    $('coNotes').classList.toggle('hidden', !notes.length);

    $('coChartWrap').classList.toggle('hidden', tab !== 'co-repo' || !list.length);
    if (tab === 'co-repo' && list.length) {
        const parts = rows.filter(r => !r.total);
        renderGroupedChart('coRepoChart', parts.map(r => r.label), [
            { label: 'Repo (actual)', data: parts.map(r => r.s.repo), color: CHART.blue },
            { label: 'Target repo (on-track)', data: parts.map(r => r.t.repo), color: CHART.orange },
            { label: 'Same period last month', data: parts.map(r => r.s.lmSpRepo), color: CHART.aqua }
        ], { title: 'Repo vs target', format: v => fmtUnits(v) });
    }
}

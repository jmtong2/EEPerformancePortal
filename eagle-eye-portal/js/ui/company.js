/* Company totals: the Collection / Provision / Repo tabs (the row above the telecollector tabs).
   View "Company total" = Curing, Recovery and the company total; "By campaign" = one row per campaign (optionally one bucket).
   Follows the campaign filter and search.
   ON TRACK = monthly figure ÷ business days in the month × business days up to today (js/core/kpi.js targetsFor):
     Collection uses Collectibles, Provision uses To Retain, Repo uses the monthly TARGET.
   ON TRACK % = On Track ÷ actual. SAME PERIOD = last month at the same point of the month; SAME PERIOD VARIANCE = this month − that. */

let companyView = 'total';   // 'total' | 'campaign'
let companyBucket = 'all';   // by-campaign view: 'all' | 'curing' | 'recovery'

const CO_TABS = [['co-collection', 'fa-sack-dollar', 'text-amber-600', 'Collection'], ['co-provision', 'fa-vault', 'text-emerald-600', 'Provision'], ['co-repo', 'fa-circle-check', 'text-indigo-600', 'Repo']];
const CO_TITLES = { 'co-collection': 'COMPANY COLLECTION', 'co-provision': 'COMPANY PROVISION', 'co-repo': 'COMPANY REPO' };

const ratioPct = (a, b) => (a === null || a === undefined || b === null || b === undefined || !(b > 0) ? null : (a / b) * 100);
const diffOrNull = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : a - b);

// [header, value(s = totals, t = ON TRACK figures), type, group]   type: int | money | pct | units
const CO_COLS = {
    'co-collection': [
        ['# OF ACCOUNTS', s => s.accs1, 'int'],
        ['COLLECTIBLES', s => s.collectibles, 'money'],
        ['COLLECTION', s => s.collection, 'money'],
        ['EFF %', s => ratioPct(s.collection, s.collectibles), 'pct'],
        ['VARIANCE COLLECTION', s => s.collectibles - s.collection, 'money'],
        ['PENALTY', s => s.penalty, 'money'],
        ['% (VS COLLECTION)', s => ratioPct(s.penalty, s.collection), 'pct'],
        ['SAME PERIOD', s => s.lmSpCollection, 'money'],
        ['SAME PERIOD VARIANCE', s => diffOrNull(s.lmSpCollection === null ? null : s.collectionForSp, s.lmSpCollection), 'money'],
        ['ON TRACK COLLECTION', (s, t) => t.collection, 'money'],
        ['ON TRACK %', (s, t) => ratioPct(t.collection, s.collection), 'pct'],
        ['VARIANCE (ON TRACK)', (s, t) => s.collection - t.collection, 'money']
    ],
    'co-provision': [
        ['# OF ACCOUNTS', s => s.endingAccs, 'int'],
        ['ENDING', s => s.ending, 'money'],
        ['# OF ACCOUNTS', s => s.beginningAccs, 'int'],
        ['BEGINNING', s => s.beginning, 'money'],
        ['# OF ACCOUNTS', s => s.toRetainAccs, 'int'],
        ['TO RETAIN', s => s.toRetain, 'money'],
        ['# OF ACCOUNTS', s => s.fixedAccs, 'int'],
        ['FIXED PROVISION', s => s.fixedProv, 'money'],
        ['%', (s, t) => ratioPct(t.provision, s.fixedForRetain), 'pct'],
        ['ON TRACK PROVISION', (s, t) => t.provision, 'money'],
        ['# OF ACCOUNTS VARIANCE', s => s.toRetainAccs - s.fixedAccs, 'int'],
        ['PROVISION VARIANCE', s => diffOrNull(s.toRetain, s.fixedForRetain), 'money'],
        ['SAME PERIOD', s => s.lmSpFixedProv, 'money'],
        ['SAME PERIOD VARIANCE', s => diffOrNull(s.lmSpFixedProv === null ? null : s.fixedForSp, s.lmSpFixedProv), 'money']
    ],
    'co-repo': [
        ['2ND MONTH', s => s.repoAge2, 'units', 'AGE'],
        ['3RD MONTH', s => s.repoAge3, 'units', 'AGE'],
        ['4TH MONTH AND UP', s => s.repoAge4, 'units', 'AGE'],
        ['TARGET', s => s.targetRepoMonth, 'units'],
        ['ACTUAL', s => s.repo, 'int'],
        ['%', (s, t) => ratioPct(t.repo, s.repoForTarget), 'pct'],
        ['ON TRACK', (s, t) => t.repo, 'units'],
        ['VARIANCE (ON TRACK)', (s, t) => diffOrNull(t.repo, t.repo === null ? null : s.repoForTarget), 'units'],
        ['SAME PERIOD', s => s.lmSpRepo, 'units'],
        ['SAME PERIOD VARIANCE', s => diffOrNull(s.lmSpRepo === null ? null : s.repoForSp, s.lmSpRepo), 'units']
    ]
};
// Optional source figures per tab: a note under the table says when they are missing or only partly filled.
const CO_OPTIONAL = {
    'co-collection': [['lmSpCollection', 'SAME PERIOD']],
    'co-provision': [['toRetain', 'TO RETAIN'], ['lmSpFixedProv', 'SAME PERIOD']],
    'co-repo': [['targetRepo', 'TARGET'], ['lmSpRepo', 'SAME PERIOD']]
};
const CO_FORMULAS = {
    'co-collection': 'ON TRACK % = ON TRACK COLLECTION ÷ COLLECTION · VARIANCE (ON TRACK) = COLLECTION − ON TRACK COLLECTION · SAME PERIOD VARIANCE = COLLECTION − SAME PERIOD.',
    'co-provision': '% = ON TRACK PROVISION ÷ FIXED PROVISION · # OF ACCOUNTS VARIANCE = # of accounts (TO RETAIN) − # of accounts (FIXED PROVISION) · PROVISION VARIANCE = TO RETAIN − FIXED PROVISION · SAME PERIOD VARIANCE = FIXED PROVISION − SAME PERIOD.',
    'co-repo': '% = ON TRACK ÷ ACTUAL · VARIANCE (ON TRACK) = ON TRACK − ACTUAL · SAME PERIOD VARIANCE = ACTUAL − SAME PERIOD.'
};

/* Rows for a view: [{ label, list, total?, s: totals, t: ON TRACK figures }] plus the business-day progress used for ON TRACK. */
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
function coCell(col, r) { return coFmt(col[1](r.s, r.t), col[2]); }

// Header rows: columns that share a group (e.g. AGE) get a group cell above them; the others span both rows.
function coHeadHtml(firstLabel, cols, cls, centered) {
    const grouped = cols.some(c => c[3]);
    if (!grouped) return `<tr class="${cls}"><th class="py-2.5 px-2 align-bottom">${firstLabel}</th>${cols.map(c => `<th class="py-2.5 px-2 align-bottom leading-tight ${centered(c)}">${c[0]}</th>`).join('')}</tr>`;
    let top = `<th rowspan="2" class="py-2.5 px-2 align-bottom">${firstLabel}</th>`, bottom = '';
    cols.forEach((c, i) => {
        if (!c[3]) { top += `<th rowspan="2" class="py-2.5 px-2 align-bottom leading-tight ${centered(c)}">${c[0]}</th>`; return; }
        if (i === 0 || cols[i - 1][3] !== c[3]) {
            let span = 0; while (i + span < cols.length && cols[i + span][3] === c[3]) span++;
            top += `<th colspan="${span}" class="pt-2.5 pb-1 px-2 text-center border-b border-slate-200">${c[3]}</th>`;
        }
        bottom += `<th class="pb-2.5 pt-1 px-2 align-bottom leading-tight ${centered(c)}">${c[0]}</th>`;
    });
    return `<tr class="${cls.replace('border-b border-slate-200', '')}">${top}</tr><tr class="${cls}">${bottom}</tr>`;
}

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
    const day = prog.asOf === todayStr() ? `today, ${dateLabel(prog.asOf)}` : dateLabel(prog.asOf);
    $('coAsOf').innerText = `ON TRACK as of ${day} · business day ${prog.elapsed} of ${prog.total} in ${periodLabel(prog.period)} · ON TRACK = monthly figure ÷ ${prog.total} × ${prog.elapsed}`;
    [['coViewTotal', 'total'], ['coViewCampaign', 'campaign']].forEach(([id, v]) => {
        const on = companyView === v;
        $(id).classList.toggle('bg-white', on); $(id).classList.toggle('shadow-sm', on); $(id).classList.toggle('text-slate-900', on); $(id).classList.toggle('text-slate-500', !on);
    });
    $('coBucket').classList.toggle('hidden', companyView !== 'campaign');
    $('coBucket').value = companyBucket;

    // Compact cells and wrapping headers so the wide tables fit on a laptop screen (they scroll sideways on smaller ones).
    const CTD = 'py-2.5 px-2', centered = c => (['int', 'units'].includes(c[2]) ? 'text-center' : '');
    $('coHead').innerHTML = coHeadHtml(companyView === 'campaign' ? 'CAMPAIGN' : 'BUCKET', cols,
        'bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200', centered);
    $('coBody').innerHTML = !list.length ? `<tr><td colspan="${cols.length + 1}" class="py-6 text-center text-xs text-slate-400">No telecollector data.</td></tr>`
        : rows.map(r => `<tr class="${r.total ? 'bg-slate-50 border-t-2 border-slate-200 text-xs font-bold' : ROW}">
            <td class="${CTD} font-bold ${r.total ? 'text-slate-900' : 'text-indigo-600'} whitespace-nowrap">${esc(r.label)}</td>
            ${cols.map(c => `<td class="${CTD} whitespace-nowrap ${centered(c)} ${r.total ? '' : 'font-medium text-slate-700'}">${coCell(c, r)}</td>`).join('')}
        </tr>`).join('');

    const notes = [CO_FORMULAS[tab], ...coverageNotes(tab, list)];
    $('coNotes').innerHTML = notes.map(n => `<p><i class="fa-solid fa-circle-info"></i> ${esc(n)}</p>`).join('');
    $('coNotes').classList.toggle('hidden', !notes.length);

    $('coChartWrap').classList.toggle('hidden', tab !== 'co-repo' || !list.length);
    if (tab === 'co-repo' && list.length) {
        const parts = rows.filter(r => !r.total);
        renderGroupedChart('coRepoChart', parts.map(r => r.label), [
            { label: 'Actual', data: parts.map(r => r.s.repo), color: CHART.blue },
            { label: 'On track', data: parts.map(r => r.t.repo), color: CHART.orange },
            { label: 'Same period', data: parts.map(r => r.s.lmSpRepo), color: CHART.aqua }
        ], { title: 'Repo: actual vs on track', format: v => fmtUnits(v) });
    }
}

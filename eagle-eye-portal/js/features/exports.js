/* Excel and PDF export — Admin only.
   · Excel: always ALL data — INFO, Company Collection / Provision / Repo, Curing, Recovery, TL, OM & AOM, GM,
     Campaign Summary, Entries Log, LEADERS, HOLIDAYS. The file can be imported back (Data → Import Excel):
     INFO, Curing, Recovery, LEADERS and HOLIDAYS are read; the other sheets are reports.
   · PDF: printable report; follows the campaign filter currently selected on the dashboard. */

const frac = (a, b) => (b > 0 ? a / b : 0);
const optRet = i => (i.toRetain === null || i.toRetain === undefined ? null : i.toRetain);
const fixedForRet = i => (i.fixedForRetain !== undefined ? i.fixedForRetain : i.fixedProv);
// [header, value(row), type]  type: money | pct (fraction) | int | units | (text)
const METRIC_EXPORT = [
    ['COLLECTIBLES', i => i.collectibles, 'money'], ['COLLECTION', i => i.collection, 'money'], ['EFF %', i => frac(i.collection, i.collectibles), 'pct'],
    ['VARIANCE COLLECTION', i => i.collectibles - i.collection, 'money'], ['PENALTY', i => i.penalty, 'money'], ['% (vs Collection)', i => frac(i.penalty, i.collection), 'pct'],
    ['BEGINNING', i => i.beginning, 'money'], ['TO RETAIN', i => optRet(i), 'money'], ['FIXED PROVISION', i => i.fixedProv, 'money'],
    ['ACH %', i => (optRet(i) === null ? null : frac(fixedForRet(i), optRet(i))), 'pct'], ['VARIANCE PROVISION', i => (optRet(i) === null ? null : optRet(i) - fixedForRet(i)), 'money'],
    ['REPO', i => i.repo, 'int']
];
const METRIC_BY_NAME = Object.fromEntries(METRIC_EXPORT.map(c => [c[0], c]));
const KPI_EXPORT = ['KPI RATE', i => i.kpiRate / 100, 'pct'];
const BUCKET_EXPORT = ['BUCKET', i => (i.team === 'recovery' ? 'Recovery' : 'Curing')];
// Curing / Recovery sheets: every source column, so the file can be imported back.
const TELE_EXPORT = [['RANK', i => i.assignedRank, 'int'], ['CAMPAIGN', i => i.campaign], BUCKET_EXPORT, ['FULL NAME', i => i.name], ['# ACCS', i => i.accs1, 'int'],
    METRIC_BY_NAME['COLLECTIBLES'], METRIC_BY_NAME['COLLECTION'], METRIC_BY_NAME['EFF %'], METRIC_BY_NAME['VARIANCE COLLECTION'], METRIC_BY_NAME['PENALTY'], METRIC_BY_NAME['% (vs Collection)'],
    METRIC_BY_NAME['BEGINNING'], ['PRINCIPAL BAL', i => i.principalBal, 'money'], METRIC_BY_NAME['TO RETAIN'], METRIC_BY_NAME['FIXED PROVISION'], METRIC_BY_NAME['ACH %'], METRIC_BY_NAME['VARIANCE PROVISION'],
    ['TARGET REPO', i => i.targetRepo, 'units'], METRIC_BY_NAME['REPO'], ['PROVISION OF REPO', i => i.repoProv, 'money'],
    ['LM COLLECTION', i => i.lmCollection, 'money'], ['LM SAME PERIOD COLLECTION', i => i.lmSpCollection, 'money'],
    ['LM FIXED PROVISION', i => i.lmFixedProv, 'money'], ['LM SAME PERIOD FIXED PROVISION', i => i.lmSpFixedProv, 'money'],
    ['LM REPO', i => i.lmRepo, 'int'], ['LM SAME PERIOD REPO', i => i.lmSpRepo, 'int'], KPI_EXPORT];
const TELE_PDF = [['RANK', i => i.assignedRank, 'int'], ['CAMPAIGN', i => i.campaign], ['FULL NAME', i => i.name], ['# ACCS', i => i.accs1, 'int'], ...METRIC_EXPORT, KPI_EXPORT];
const LEADER_EXPORT = [['RANK', i => i.assignedRank, 'int'], ['FULL NAME', i => i.name], ['HANDLED CAMPAIGNS', i => i.campaigns.join(', ')], ['# ACCS', i => i.accs1, 'int'], ...METRIC_EXPORT, KPI_EXPORT];
const CAMPAIGN_EXPORT = [['CAMPAIGN', i => i.name], ['# ACCS', i => i.accs1, 'int'], ...METRIC_EXPORT];
const ENTRY_EXPORT = [['DATE', e => e.date], ['ENCODED', e => fmtDateTime(e.ts)], ['ENCODED BY', e => e.byName], ['CAMPAIGN', e => e.campaign], BUCKET_EXPORT,
    ['TELECOLLECTOR', e => e.name], ['COLLECTION', e => num(e.collection), 'money'], ['PENALTY', e => num(e.penalty), 'money'],
    ['FIXED PROVISION', e => num(e.fixedProv), 'money'], ['REPO', e => num(e.repo), 'int'], ['PROVISION OF REPO', e => num(e.repoProv), 'money']];
const EXCEL_FMT = { money: '#,##0.00', pct: '0.0%', int: '#,##0', units: '#,##0.0' };

// Company tab columns (js/ui/company.js) for export: % as fractions; SAME PERIOD split into last month's figure and % change.
function coExportCols(tab) {
    return [['', r => r.label], ...CO_COLS[tab].flatMap(([h, fn, type, unit]) => {
        if (type === 'sp') return [[`${h} (LAST MONTH)`, r => fn(r.s, r.t).lm, unit === 'money' ? 'money' : 'units'],
            [`${h} (CHANGE %)`, r => { const v = fn(r.s, r.t), ch = samePeriodChange(v.cur, v.lm); return ch === null ? null : ch / 100; }, 'pct']];
        if (type === 'pct') return [[h, r => { const v = fn(r.s, r.t); return v === null || v === undefined ? null : v / 100; }, 'pct']];
        return [[h, r => fn(r.s, r.t), type]];
    })];
}
const progText = prog => `As of ${dateLabel(prog.asOf)} · business day ${prog.elapsed} of ${prog.total} in ${periodLabel(prog.period)} · TARGET = monthly figure ÷ ${prog.total} × ${prog.elapsed}`;

/* ===================== EXCEL ===================== */
// blocks: [{ title, sub?, cols, rows }] stacked on one sheet (title row, sub/blank row, header row, data rows).
function excelBlocks(blocks) {
    const aoa = [], fmts = [], widths = [];
    blocks.forEach((b, bi) => {
        if (bi) aoa.push([]);
        aoa.push([b.title]);
        aoa.push(b.sub ? [b.sub] : []);
        aoa.push(b.cols.map(c => c[0]));
        b.rows.forEach(r => {
            const rowIdx = aoa.length;
            aoa.push(b.cols.map((c, ci) => {
                const v = c[1](r);
                if (typeof v === 'number' && !isFinite(v)) return null;
                if (typeof v === 'number' && c[2]) fmts.push([rowIdx, ci, c[2]]);
                return v === undefined ? null : v;
            }));
        });
        b.cols.forEach((c, ci) => { widths[ci] = Math.max(widths[ci] || 0, c[2] === 'money' ? 16 : c[2] === 'pct' ? 11 : ['int', 'units'].includes(c[2]) ? 9 : 28); });
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    fmts.forEach(([r, c, t]) => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = EXCEL_FMT[t]; });
    ws['!cols'] = widths.map(wch => ({ wch }));
    return ws;
}
const excelSheet = (title, cols, rows) => excelBlocks([{ title, cols, rows }]);

function excelCompanySheet(tab) {
    const total = companyRows(state.collectors, 'total');
    const byCampaign = companyRows(state.collectors, 'campaign', 'all');
    const cols = coExportCols(tab);
    return excelBlocks([
        { title: `${CO_TITLES[tab]} — COMPANY TOTAL`, sub: progText(total.prog), cols: [['BUCKET', r => r.label], ...cols.slice(1)], rows: total.rows },
        { title: `${CO_TITLES[tab]} — BY CAMPAIGN`, cols: [['CAMPAIGN', r => r.label], ...cols.slice(1)], rows: byCampaign.rows }
    ]);
}

async function exportExcel() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can export data.');
    try {
        await withProgress('Building Excel file…', async () => {
            await loadScript(LIB.xlsx);
            const all = await Backend.exportAll();
            const stamp = `exported ${new Date().toLocaleString('en-PH')} by ${currentUser.username}`;
            const prog = bdProgress(effectiveAsOf());
            const wb = XLSX.utils.book_new();
            const add = (ws, name) => XLSX.utils.book_append_sheet(wb, ws, name);
            add(XLSX.utils.aoa_to_sheet([['EAGLE EYE PERFORMANCE PORTAL — DATA EXPORT'], [], ['MONTH', currentPeriod()], ['AS OF DATE', prog.asOf],
                ['BUSINESS DAYS', `${prog.elapsed} of ${prog.total}`], ['EXPORTED', stamp]]), 'INFO');
            add(excelCompanySheet('co-collection'), 'Company Collection');
            add(excelCompanySheet('co-provision'), 'Company Provision');
            add(excelCompanySheet('co-repo'), 'Company Repo');
            add(excelSheet(`CURING TELECOLLECTORS — ${stamp}`, TELE_EXPORT, rankedTeles('curing')), 'Curing');
            add(excelSheet(`RECOVERY TELECOLLECTORS — ${stamp}`, TELE_EXPORT, rankedTeles('recovery')), 'Recovery');
            add(excelSheet('TEAM LEADERS (TL)', LEADER_EXPORT, rankedLeaders('tl')), 'TL');
            add(excelSheet('OPERATION MANAGERS & AOM', LEADER_EXPORT, rankedLeaders('om')), 'OM & AOM');
            add(excelSheet('GENERAL MANAGERS (GM)', LEADER_EXPORT, rankedLeaders('gm')), 'GM');
            add(excelSheet('CAMPAIGN SUMMARY', CAMPAIGN_EXPORT, campaignStatsList().sort((a, b) => b.effRate - a.effRate)), 'Campaign Summary');
            const entries = (all.entries || []).map(sanitizeEntry).sort((a, b) => b.ts - a.ts);
            add(excelSheet('DAILY ENTRIES LOG', ENTRY_EXPORT, entries), 'Entries Log');
            add(XLSX.utils.aoa_to_sheet([['TYPE', 'FULL NAME', 'HANDLED CAMPAIGNS'],
                ...['tl', 'om', 'gm'].flatMap(t => (state.leaders[t] || []).map(l => [t.toUpperCase(), l.name, l.campaigns.join(', ')]))]), 'LEADERS');
            add(XLSX.utils.aoa_to_sheet([['DATE', 'DESCRIPTION'], ...(state.holidays || []).map(h => [h.date, h.name])]), 'HOLIDAYS');
            XLSX.writeFile(wb, `eagle-eye-performance-${todayStr()}.xlsx`, { compression: true });
        });
        toast('Excel file exported.', 'ok');
    } catch (e) { toast('Export failed: ' + friendlyError(e), 'err'); }
}

/* ===================== PDF ===================== */
// The PDF uses the built-in Helvetica font, which has no peso sign, so amounts are plain numbers ("Amounts in PHP").
const pdfVal = (v, type) => (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) ? '-'
    : type === 'money' ? fmtNum(v) : type === 'pct' ? (v * 100).toFixed(1) + '%' : type === 'int' ? fmtInt(v) : type === 'units' ? fmtUnits(v) : String(v);

async function exportPDF() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can export data.');
    try {
        await withProgress('Building PDF report…', async () => {
            await loadScript(LIB.jspdf);
            await loadScript(LIB.autotable);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), Mg = 24;
            const camp = $('campaignFilterSelect').value || 'ALL';
            const teles = state.collectors.filter(c => camp === 'ALL' || c.campaign === camp);
            const totals = sumStats(teles);
            const prog = bdProgress(effectiveAsOf());

            doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
            doc.text('EAGLE EYE BUSINESS & COLLECTION SERVICES INC.', Mg, 34);
            doc.setFontSize(11); doc.text('Telecollector Performance Report', Mg, 50);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            doc.text(`Campaign: ${camp === 'ALL' ? 'All campaigns' : camp}   ·   ${progText(prog).replace(/÷/g, '/').replace(/×/g, 'x')}   ·   Amounts in PHP`, Mg, 63);
            doc.text(`Generated ${new Date().toLocaleString('en-PH')} by ${currentUser.displayName || currentUser.username}`, Mg, 74);

            doc.autoTable({
                startY: 82, margin: { left: Mg, right: Mg }, theme: 'grid',
                styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59], textColor: 255 },
                head: [['Collectibles', 'Collection', 'Eff %', 'Penalty', '% vs Collection', 'Beginning', 'To Retain', 'Fixed Provision', 'ACH %', 'Repo', 'Last month collection']],
                body: [[fmtNum(totals.collectibles), fmtNum(totals.collection), totals.effRate.toFixed(1) + '%', fmtNum(totals.penalty), totals.penRate.toFixed(1) + '%',
                    fmtNum(totals.beginning), pdfVal(totals.toRetain, 'money'), fmtNum(totals.fixedProv), totals.achRate === null ? '-' : totals.achRate.toFixed(1) + '%',
                    fmtInt(totals.repo), pdfVal(totals.lmCollection, 'money')]]
            });

            const section = (title, cols, rows, color, rowStyle) => {
                let y = doc.lastAutoTable.finalY + 18;
                if (y > H - 80) { doc.addPage(); y = 36; }
                doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(title, Mg, y);
                doc.autoTable({
                    startY: y + 6, margin: { left: Mg, right: Mg, bottom: 30 }, theme: 'striped',
                    styles: { fontSize: 6.3, cellPadding: 2, overflow: 'linebreak' },
                    headStyles: { fillColor: color, textColor: 20, fontStyle: 'bold' },
                    columnStyles: Object.fromEntries(cols.map((c, i) => [i, c[2] ? { halign: 'right' } : {}])),
                    head: [cols.map(c => c[0])],
                    body: rows.length ? rows.map(r => r.divider ? [{ content: r.divider, colSpan: cols.length, styles: { fontStyle: 'bold', fillColor: [226, 232, 240] } }]
                        : cols.map((c, ci) => ({ content: pdfVal(c[1](r), c[2]), styles: rowStyle && rowStyle(r, ci) }))) : [[{ content: 'No data', colSpan: cols.length }]]
                });
            };
            const totalBold = r => (r.total ? { fontStyle: 'bold' } : undefined);
            [['co-collection', [253, 230, 138]], ['co-provision', [167, 243, 208]], ['co-repo', [199, 210, 254]]].forEach(([tab, color]) => {
                const rows = [...companyRows(teles, 'total').rows, { divider: 'BY CAMPAIGN' }, ...companyRows(teles, 'campaign', 'all').rows];
                section(CO_TITLES[tab], coExportCols(tab).map((c, i) => (i ? c : ['', c[1]])), rows, color, totalBold);
            });
            section('CURING TELECOLLECTORS (ranked by KPI Rate)', TELE_PDF, rankedTeles('curing', teles), [251, 191, 36]);
            section('RECOVERY TELECOLLECTORS (ranked by KPI Rate)', TELE_PDF, rankedTeles('recovery', teles), [147, 197, 253]);
            section('TEAM LEADERS (TL)', LEADER_EXPORT, rankedLeaders('tl', camp), [191, 219, 254]);
            section('OPERATION MANAGERS & AOM', LEADER_EXPORT, rankedLeaders('om', camp), [199, 210, 254]);
            section('GENERAL MANAGERS (GM)', LEADER_EXPORT, rankedLeaders('gm', camp), [253, 230, 138]);
            section('CAMPAIGN SUMMARY', CAMPAIGN_EXPORT, campaignStatsList().filter(c => camp === 'ALL' || c.name === camp).sort((a, b) => b.effRate - a.effRate), [226, 232, 240]);

            const pages = doc.getNumberOfPages();
            for (let p = 1; p <= pages; p++) {
                doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120);
                doc.text('Eagle Eye Performance Portal · Confidential', Mg, H - 14);
                doc.text(`Page ${p} of ${pages}`, W - Mg, H - 14, { align: 'right' });
                doc.setTextColor(0);
            }
            doc.save(`eagle-eye-report-${todayStr()}.pdf`);
        });
        toast('PDF report exported.', 'ok');
    } catch (e) { toast('Export failed: ' + friendlyError(e), 'err'); }
}

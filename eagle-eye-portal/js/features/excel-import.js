/* Excel import — Admin only — with security validation.

   File checks   : .xlsx/.xls only · max size · real Excel file signature (not a renamed file) ·
                   no macros (VBA) · readable / not password-protected · sheet & row limits.
   Content checks: recognised header row · Curing/Recovery detected · valid names & campaigns ·
                   numbers only (no text, no Excel errors like #DIV/0!) · no negatives · whole numbers for
                   accounts/repo · Repo ≤ # Accounts · To Retain ≤ Beginning · no duplicate telecollectors ·
                   valid month / "as of" date / holidays / leaders · cross-check of totals between sheets.
   Apply         : errors block the import; warnings must be ticked; the Admin re-enters their password;
                   an undo copy of the current data is saved first (Data → Undo).

   Understood layouts:
     · Summary_Campaign_Revised.xlsx (current): one sheet per campaign (campaign title in A1, e.g. sheet "AFC" titled
       "Asialink") with a CURING block and a RECOVERY block — COLLECTION / PROVISION (each figure with its own
       # OF ACCOUNTS) / REPO (2nd Month, 3rd Month, 4th Month and Up, TARGET, ACTUAL) / SAME PERIOD columns —
       plus "Curing" / "Recovery" summary sheets with a CAMPAIGN column. Filled summary sheets are used and the
       campaign sheets cross-check them; empty summary sheets are ignored and the campaign sheets are used.
       VARIANCE columns in the file are not read: the portal computes them.
     · Older files: SUMMARY Campaign.xlsx, the v7 template (INFO / HOLIDAYS / LEADERS sheets are still read), and
       files exported by this portal (Data → Export Excel). */

const ACCS_RE = /^((#|NO\.?|NUMBER) ?(OF )?)?(ACCNTS|ACCOUNTS|ACCTS|ACCS)$/;
const IMPORT_HEADERS = {
    campaign: /^CAMPAIGNS?$/,
    bucket: /^(BUCKET|TEAM|BUCKET \/ TEAM)$/,
    name: /^(FULL ?NAME|NAME|TELECOLLECTOR|TELE ?COLLECTOR|AGENT)$/,
    collectibles: /^COLLECTIBLES?$/,
    collection: /^COLLECTIONS?$/,
    penalty: /^PENALT(Y|IES)$/,
    lmSpCollection: /^(SAME PERIOD \(COLLECTION\)|SAME PERIOD COLLECTION|(LM|LAST MONTH) SAME PERIOD COLLECTION)$/,
    ending: /^(ENDING|ENDING PROVISION)$/,
    beginning: /^(BEGINNING|BEGINNING PROVISION|BEG\.? PROVISION|PROVISION)$/,
    toRetain: /^(TO RETAIN|TO ATTAIN|PROVISION TO RETAIN|RETAIN)$/,
    fixedProv: /^(FIXED PROVISION|PROVISION TO FIXED|PROVISION FIXED|FIXED)$/,
    lmSpFixedProv: /^(SAME PERIOD \(PROVISION\)|SAME PERIOD PROVISION|SAME PERIOD FIXED PROVISION|(LM|LAST MONTH) SAME PERIOD FIXED PROVISION)$/,
    repoAge2: /^2ND MONTH$/,
    repoAge3: /^3RD MONTH$/,
    repoAge4: /^4TH MONTH( AND UP| AND ABOVE|\+)?$/,
    targetRepo: /^(TARGET|TARGET REPO|REPO TARGET|MONTHLY TARGET REPO)$/,
    repo: /^(REPOS?|ACTUAL|ACTUAL REPO)$/,
    lmSpRepo: /^(SAME PERIOD \(REPO\)|SAME PERIOD REPO|(LM|LAST MONTH) SAME PERIOD REPO)$/,
    // older source files
    principalBal: /^PRINCIPAL( BAL\.?| BALANCE)?$/,
    repoProv: /^(PROVISION OF REPO|REPO PROVISION|PRINCIPAL BAL(\.|ANCE)? PROVISION)$/,
    lmCollection: /^((LM|LAST MONTH) COLLECTION|COMPARISON LAST MONTH)$/,
    lmFixedProv: /^(LM|LAST MONTH) FIXED PROVISION$/,
    lmRepo: /^(LM|LAST MONTH) REPO$/
};
// "# OF ACCOUNTS" appears several times: which figure it counts is decided by the column right after it.
const ACCS_FOR_NEXT = [['ending', 'endingAccs'], ['beginning', 'beginningAccs'], ['toRetain', 'toRetainAccs'], ['fixedProv', 'fixedAccs']];
// [field, label, whole number?, optional (blank = not provided)?]
const IMPORT_NUM_FIELDS = [
    ['accs1', '# of accounts', true], ['collectibles', 'Collectibles'], ['collection', 'Collection'], ['penalty', 'Penalty'],
    ['lmSpCollection', 'Same Period (Collection)', false, true],
    ['endingAccs', '# of accounts (Ending)', true], ['ending', 'Ending'], ['beginningAccs', '# of accounts (Beginning)', true], ['beginning', 'Beginning'],
    ['toRetainAccs', '# of accounts (To Retain)', true], ['toRetain', 'To Retain', false, true],
    ['fixedAccs', '# of accounts (Fixed Provision)', true], ['fixedProv', 'Fixed Provision'], ['lmSpFixedProv', 'Same Period (Provision)', false, true],
    ['repoAge2', '2nd Month'], ['repoAge3', '3rd Month'], ['repoAge4', '4th Month and Up'],
    ['targetRepo', 'Target (repo)', false, true], ['repo', 'Actual (repo)', true], ['lmSpRepo', 'Same Period (Repo)', false, true],
    ['principalBal', 'Principal Bal'], ['repoProv', 'Provision of Repo'],
    ['lmCollection', 'LM Collection', false, true], ['lmFixedProv', 'LM Fixed Provision', false, true], ['lmRepo', 'LM Repo', true, true]
];
const IMPORT_FIELDS = IMPORT_NUM_FIELDS.map(f => f[0]);
const CROSS_FIELDS = ['accs1', 'collectibles', 'collection', 'penalty', 'ending', 'beginning', 'fixedProv', 'repo'];
const CROSS_LABELS = { accs1: '# of accounts', fixedProv: 'fixed provision', repo: 'repo (actual)' };
const SHEET_KIND = [[/^(README|READ ME|INSTRUCTIONS?|HOW TO USE)$/i, 'readme'], [/^INFO$/i, 'info'], [/^HOLIDAYS?$/i, 'holidays'], [/^(LEADERS?|TL ?OM ?GM)$/i, 'leaders']];
let importState = null;

function openImportModal() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can import Excel files.');
    importState = null;
    $('importFile').value = '';
    $('importReport').innerHTML = '';
    $('importReport').classList.add('hidden');
    $('importApplyWrap').classList.add('hidden');
    $('importChecks').dataset.sig = '';
    renderChecks('importChecks', { errors: [], warnings: [] });
    showModal('importModal');
}

async function handleImportFile(input) {
    if (!isAdmin()) return deny('Only the Admin can import Excel files.');
    const file = input.files[0];
    importState = null;
    $('importApplyWrap').classList.add('hidden');
    renderChecks('importChecks', { errors: [], warnings: [] });
    if (!file) return;
    $('importReport').classList.remove('hidden');
    $('importReport').innerHTML = '<p class="text-slate-500"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking file…</p>';
    const result = await analyzeImportFile(file);
    importState = result;
    renderImportReport(result);
}

/* ===================== 1. FILE-LEVEL SECURITY CHECKS ===================== */
async function analyzeImportFile(file) {
    const r = { fileName: sanitizeText(file.name, 120), checks: [], errors: [], warnings: [], notes: [], records: [], sheetsUsed: [], sheetsCross: [], sheetsSkipped: [],
        present: new Set(), info: null, holidays: null, leaders: null, fatal: false };
    const pass = (label, detail) => r.checks.push({ ok: true, label, detail });
    const fail = (label, detail) => { r.checks.push({ ok: false, label, detail }); r.errors.push(`${label}: ${detail}`); r.fatal = true; return r; };

    const ext = ((file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) return fail('File type', `".${ext || '?'}" files are not allowed. Only .xlsx or .xls Excel files can be imported (macro files like .xlsm are blocked).`);
    pass('File type', `.${ext}`);

    if (file.size === 0) return fail('File size', 'The file is empty.');
    if (file.size > IMPORT_MAX_BYTES) return fail('File size', `${(file.size / 1048576).toFixed(1)} MB is over the ${(IMPORT_MAX_BYTES / 1048576).toFixed(0)} MB limit.`);
    pass('File size', `${(file.size / 1024).toFixed(0)} KB`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
    const isOle = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].every((b, i) => bytes[i] === b);
    if ((ext === 'xlsx' && !isZip) || (ext === 'xls' && !isOle)) {
        if (ext === 'xlsx' && isOle) return fail('File signature', 'This .xlsx is encrypted / password-protected. Remove the password in Excel and save again.');
        return fail('File signature', 'The contents are not a real Excel file (it may be renamed or damaged).');
    }
    pass('File signature', isZip ? 'Excel workbook (.xlsx)' : 'Excel 97-2003 workbook (.xls)');

    try { await loadScript(LIB.xlsx); } catch (e) { return fail('Excel reader', e.message); }
    let wb;
    try { wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: true, dense: false }); }
    catch (e) { return fail('Readable', /password|encrypt/i.test(e.message) ? 'The file is password-protected. Remove the password in Excel and save again.' : 'Excel could not read this file (' + sanitizeText(e.message, 120) + ').'); }
    pass('Readable', `${wb.SheetNames.length} sheet(s)`);

    if (wb.vbaraw) return fail('Macros', 'This file contains macros (VBA). Files with macros are blocked for security. Save it as a normal .xlsx workbook.');
    pass('Macros', 'none found');

    if (wb.SheetNames.length > IMPORT_MAX_SHEETS) return fail('Sheets', `${wb.SheetNames.length} sheets is over the limit of ${IMPORT_MAX_SHEETS}.`);

    parseImportWorkbook(wb, r);
    if (!r.fatal) { validateImportRecords(r); validateImportMeta(r); }
    return r;
}

/* ===================== 2. READING THE WORKBOOK ===================== */
function importCell(ws, row, col) {
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell || cell.t === 'z') return null;
    if (cell.t === 'e') return { error: cell.w || '#ERROR' };
    if (cell.t === 'n') return cell.v;
    if (cell.t === 'd') return { error: 'a date' };
    if (cell.t === 'b') return { error: 'TRUE/FALSE' };
    return sanitizeText(cell.v, 200);
}
const importHead = v => typeof v === 'string' ? v.toUpperCase().replace(/\s+/g, ' ').trim() : '';
function importBucket(text) { const s = importHead(text); return /RECOV/.test(s) ? 'recovery' : /CUR/.test(s) ? 'curing' : null; }
const headText = v => importHead(v).replace(/\s*\((₱|PHP|PESOS?|ACCOUNTS?|ACCTS|#|COUNT|MONTHLY)\)$/, '').replace(/\s*\*$/, '');
function importHeaderMap(cells) {
    const heads = cells.map(headText), map = {};
    heads.forEach((h, c) => {
        if (!h) return;
        if (ACCS_RE.test(h)) {   // "# OF ACCOUNTS": counts the figure in the next column (ENDING, BEGINNING, TO RETAIN, FIXED PROVISION), else accounts
            const next = heads.slice(c + 1).find(Boolean) || '';
            const pair = ACCS_FOR_NEXT.find(([f]) => IMPORT_HEADERS[f].test(next));
            const field = pair ? pair[1] : 'accs1';
            if (map[field] === undefined) map[field] = c;
            return;
        }
        for (const [field, re] of Object.entries(IMPORT_HEADERS)) if (map[field] === undefined && re.test(h)) { map[field] = c; break; }
    });
    return map;
}
// Campaign of a per-campaign sheet: the sheet title (A1, e.g. "Asialink") or the sheet name (e.g. "AFC").
// A name that matches an existing campaign wins, so "CEPAT" keeps matching campaign CEPAT even if the title says "Cepat Kredit".
function resolveCampaign(title, sheetName) {
    const strip = s => cleanName(String(s || '').replace(/RECOVERY|CURRING|CURING/ig, ' '));
    const cands = [strip(title), strip(sheetName)].filter(c => c && NAME_RE.test(c));
    const known = uniq([...allCampaigns(), ...leaderCampaigns()]);
    for (const c of cands) { const k = known.find(x => slug(x) === slug(c)); if (k) return k; }
    return cands[0] || '';
}function sheetKind(name) { const k = SHEET_KIND.find(([re]) => re.test(String(name).trim())); return k ? k[1] : null; }
function sheetGrid(ws, maxRows, maxCols, reader) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    const lastRow = Math.min(range.e.r, range.s.r + maxRows), lastCol = Math.min(range.e.c, maxCols);
    const rows = [];
    for (let row = range.s.r; row <= lastRow; row++) {
        const cells = [];
        for (let col = 0; col <= lastCol; col++) cells.push(reader(ws, row, col));
        rows.push({ rowNo: row + 1, cells });
    }
    return rows;
}

function parseImportWorkbook(wb, r) {
    const sections = [];
    let totalRows = 0;
    for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const kind = sheetKind(sheetName);
        if (!ws || !ws['!ref']) { r.sheetsSkipped.push(`${sheetName} (empty)`); continue; }
        if (kind === 'readme') { r.sheetsSkipped.push(`${sheetName} (instructions)`); continue; }
        if (kind === 'info') { parseInfoSheet(ws, sheetName, r); continue; }
        if (kind === 'holidays') { parseHolidaySheet(ws, sheetName, r); continue; }
        if (kind === 'leaders') { parseLeaderSheet(ws, sheetName, r); continue; }

        const rows = sheetGrid(ws, 20000, 80, importCell).map(x => x.cells);
        const firstRow = XLSX.utils.decode_range(ws['!ref']).s.r;
        const sheetGeneric = /^sheet\s*\d*$/i.test(sheetName.trim());
        const sheetTitle = (rows[0] || []).find(v => typeof v === 'string' && v.trim()) || '';
        let section = null, foundAny = false;
        rows.forEach((cells, i) => {
            const rowNo = firstRow + i + 1;
            const map = importHeaderMap(cells);
            if (map.name !== undefined && map.collectibles !== undefined && map.collection !== undefined) {
                if (cells.some(v => importHead(v) === 'HANDLED CAMPAIGNS')) { section = null; if (!r.sheetsSkipped.includes(`${sheetName} (leader table)`)) r.sheetsSkipped.push(`${sheetName} (leader table)`); return; }
                // Bucket: a title in the 3 rows above (e.g. "CURING", "SOUTH ASIALINK RECOVERY"), else the sheet name.
                let bucket = null, title = '';
                for (let k = 1; k <= 3 && i - k >= 0 && !bucket; k++) {
                    const t = rows[i - k].find(v => typeof v === 'string' && v.trim());
                    const b = t ? importBucket(t) : null;
                    if (b) { bucket = b; title = t; }
                }
                if (!bucket) bucket = importBucket(sheetName);
                let campaign = null;
                if (map.campaign === undefined) {
                    if (!sheetGeneric) campaign = resolveCampaign(sheetTitle, sheetName);
                    else if (title) campaign = cleanName(title.replace(/RECOVERY|CURRING|CURING/ig, '')) || null;
                }
                section = { sheet: sheetName, title: sheetTitle, headerRow: rowNo, map, bucket, campaign, consolidated: map.campaign !== undefined, records: [] };
                sections.push(section); foundAny = true;
                return;
            }
            if (!section) return;
            const rawName = cells[section.map.name];
            const nameText = typeof rawName === 'string' ? rawName : '';
            const numericCols = IMPORT_NUM_FIELDS.map(([f]) => section.map[f]).filter(c => c !== undefined);
            const hasNumbers = numericCols.some(c => typeof cells[c] === 'number' && cells[c] !== 0);
            if (!nameText) {
                if (rawName !== null && typeof rawName !== 'string') r.warnings.push(`${sheetName} row ${rowNo}: the name cell is not text — row skipped.`);
                else if (hasNumbers) r.warnings.push(`${sheetName} row ${rowNo}: has numbers but no name — row skipped.`);
                return;
            }
            if (/^(GRAND )?(SUB ?)?TOTALS?$/.test(importHead(nameText))) return;
            const nonEmpty = cells.filter(v => v !== null && v !== '').length;
            const textOnly = cells.every(v => v === null || v === '' || typeof v === 'string');
            // block titles: "RECOVERY" alone, or "RECOVERY | COLLECTION | PROVISION | REPO" group rows
            if (!hasNumbers && textOnly && ((nonEmpty === 1 && importBucket(nameText)) || /^(CURR?ING|RECOVERY)$/.test(importHead(nameText)))) return;
            totalRows++;
            if (totalRows > IMPORT_MAX_ROWS) return;
            section.records.push(importRowToRecord(section, cells, rowNo));
        });
        if (!foundAny && !r.sheetsSkipped.some(s => s.startsWith(sheetName + ' ('))) r.sheetsSkipped.push(`${sheetName} (no telecollector table found)`);
    }
    if (totalRows > IMPORT_MAX_ROWS) { r.errors.push(`The file has more than ${IMPORT_MAX_ROWS} telecollector rows.`); r.fatal = true; return; }

    // Summary sheets (with a CAMPAIGN column) are used when they have rows; otherwise the per-campaign sheets.
    const consolidated = sections.filter(s => s.consolidated && s.records.length);
    sections.filter(s => s.consolidated && !s.records.length).forEach(s => { if (!r.sheetsSkipped.includes(`${s.sheet} (no rows)`)) r.sheetsSkipped.push(`${s.sheet} (no rows)`); });
    const perCampaign = sections.filter(s => !s.consolidated);
    const used = consolidated.length ? consolidated : perCampaign;
    const cross = consolidated.length ? perCampaign : [];
    // Campaign codes typed in the summary sheets (e.g. "AFC") follow the per-campaign sheet they name.
    const alias = new Map();
    perCampaign.forEach(s => { if (s.campaign) [s.sheet, s.title].forEach(a => { if (a) alias.set(slug(cleanName(a)), s.campaign); }); });
    consolidated.forEach(s => s.records.forEach(rec => { const to = alias.get(slug(rec.campaign)); if (to) rec.campaign = to; }));
    r.records = used.flatMap(s => s.records);
    r.sheetsUsed = uniq(used.map(s => s.sheet));
    r.sheetsCross = uniq(cross.map(s => s.sheet));
    r.campaignNames = uniq(perCampaign.filter(s => used.includes(s) && s.title && slug(s.campaign) !== slug(s.sheet)).map(s => `${s.sheet} → ${s.campaign}`));
    used.forEach(s => IMPORT_FIELDS.forEach(f => { if (s.map[f] !== undefined) r.present.add(f); }));
    if (!r.records.length) {
        r.errors.push('No telecollector rows were found. Fill in at least one FULL NAME row under the CURING or RECOVERY header (per-campaign sheets), or in the Curing / Recovery summary sheets.');
        r.fatal = true; return;
    }
    if (cross.length) importCrossCheck(used, cross, r);
}
function importNumber(v, label, integer, rec, optional) {
    if (v === null || v === '') return optional ? null : 0;
    if (typeof v === 'object' && v.error) { rec.errors.push(`${label} contains ${v.error === 'a date' || v.error === 'TRUE/FALSE' ? v.error : 'an Excel error (' + v.error + ')'}`); return optional ? null : 0; }
    let n = v;
    if (typeof v === 'string') {
        const t = v.replace(/[₱,\s]|PHP/gi, '');
        if (t === '' || t === '-') return optional ? null : 0;
        n = /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
        if (!isFinite(n)) { rec.errors.push(`${label} "${v.slice(0, 30)}" is not a number`); return optional ? null : 0; }
    }
    if (!isFinite(n)) { rec.errors.push(`${label} is not a number`); return optional ? null : 0; }
    if (n < 0) { rec.errors.push(`${label} is negative (${n})`); return optional ? null : 0; }
    if (n > 9999999999) { rec.errors.push(`${label} is unrealistically large`); return optional ? null : 0; }
    if (integer) {
        if (Math.abs(n - Math.round(n)) > 1e-9) { rec.errors.push(`${label} must be a whole number (${n})`); return optional ? null : 0; }
        return Math.round(n);
    }
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-4) rec.warnings.push(`${label} ${n} rounded to 2 decimals`);
    return round2(n);
}

function importRowToRecord(section, cells, rowNo) {
    const m = section.map;
    const rec = { sheet: section.sheet, row: rowNo, errors: [], warnings: [], has: [] };
    rec.where = `${section.sheet} row ${rowNo}`;
    rec.name = cleanName(cells[m.name]);
    const campRaw = m.campaign !== undefined ? cells[m.campaign] : section.campaign;
    rec.campaign = typeof campRaw === 'string' ? cleanName(campRaw) : '';
    rec.team = (m.bucket !== undefined ? importBucket(cells[m.bucket]) : null) || section.bucket;
    IMPORT_NUM_FIELDS.forEach(([f, label, integer, optional]) => {
        if (m[f] === undefined) { rec[f] = optional ? null : 0; return; }
        rec.has.push(f);
        rec[f] = importNumber(cells[m[f]], label, integer, rec, optional);
    });
    return rec;
}

function importCrossCheck(used, cross, r) {
    const sum = (sections) => {
        const g = {};
        sections.forEach(s => s.records.forEach(rec => {
            if (!rec.campaign || !rec.team) return;
            const k = `${rec.campaign}|${rec.team}`;
            g[k] = g[k] || { sheets: new Set(), fields: new Set(CROSS_FIELDS.filter(f => s.map[f] !== undefined)) };
            g[k].sheets.add(s.sheet);
            CROSS_FIELDS.forEach(f => g[k][f] = (g[k][f] || 0) + num(rec[f]));
        }));
        return g;
    };
    const a = sum(used), b = sum(cross);
    let matched = 0;
    Object.entries(b).forEach(([k, gb]) => {
        const [campaign, team] = k.split('|');
        const ga = a[k];
        if (!ga) { r.warnings.push(`Sheet "${[...gb.sheets].join(', ')}" has ${campaign} ${team} rows that are not in the summary sheet(s) "${r.sheetsUsed.join(', ')}".`); return; }
        const diffs = CROSS_FIELDS.filter(f => gb.fields.has(f) && ga.fields.has(f) && Math.abs(num(ga[f]) - num(gb[f])) > 0.01)
            .map(f => `${CROSS_LABELS[f] || f} ${fmtNum(ga[f])} vs ${fmtNum(gb[f])}`);
        if (diffs.length) r.warnings.push(`Totals for ${campaign} ${team} differ between "${[...ga.sheets].join(', ')}" and "${[...gb.sheets].join(', ')}": ${diffs.join('; ')}.`);
        else matched++;
    });
    if (matched) r.notes.push(`${matched} campaign/bucket total(s) cross-checked against the per-campaign sheets and match.`);
}

/* ---------- INFO / HOLIDAYS / LEADERS sheets ---------- */
const rawCell = (ws, row, col) => ws[XLSX.utils.encode_cell({ r: row, c: col })] || null;
const cellText = c => (!c || c.t === 'z' ? '' : sanitizeText(c.w !== undefined && c.t !== 'n' ? c.w : c.v, 200));
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const toPeriod = (y, m) => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : null);
function toYmd(y, m, d) {
    const p = toPeriod(y, m); if (!p || !(d >= 1 && d <= 31)) return null;
    const s = `${p}-${String(d).padStart(2, '0')}`;
    return ymdLocal(parseYmd(s)) === s ? s : null;
}
function excelSerialParts(v) { if (!(v >= 1 && v < 2958466)) return null; const d = XLSX.SSF.parse_date_code(v); return d ? d : null; }
// A date cell (Excel date, or text like 2026-10-05 / 10/5/2026 / Oct 5, 2026) -> "YYYY-MM-DD" or null.
function cellToYmd(c) {
    if (!c || c.t === 'z') return null;
    if (c.t === 'n') { const d = excelSerialParts(c.v); return d ? toYmd(d.y, d.m, d.d) : null; }
    if (c.t === 'd' && c.v instanceof Date) return ymdLocal(c.v);
    const t = cellText(c).toUpperCase();
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return toYmd(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return toYmd(+m[3], +m[1], +m[2]);           // M/D/YYYY
    m = t.match(/^([A-Z]{3,9})\.? (\d{1,2}),? (\d{4})$/); if (m) { const i = MONTH_NAMES.indexOf(m[1].slice(0, 3)); return i < 0 ? null : toYmd(+m[3], i + 1, +m[2]); }
    return null;
}
// A month cell (Excel date, or text like 2026-10 / Oct 2026 / October 2026) -> "YYYY-MM" or null.
function cellToPeriod(c) {
    if (!c || c.t === 'z') return null;
    if (c.t === 'n') { const d = excelSerialParts(c.v); return d ? toPeriod(d.y, d.m) : null; }
    if (c.t === 'd' && c.v instanceof Date) return ymdLocal(c.v).slice(0, 7);
    const t = cellText(c).toUpperCase();
    let m = t.match(/^(\d{4})[-/.](\d{1,2})$/); if (m) return toPeriod(+m[1], +m[2]);
    m = t.match(/^(\d{1,2})[-/.](\d{4})$/); if (m) return toPeriod(+m[2], +m[1]);
    m = t.match(/^([A-Z]{3,9})\.?[ ,-]+(\d{4})$/); if (m) { const i = MONTH_NAMES.indexOf(m[1].slice(0, 3)); return i < 0 ? null : toPeriod(+m[2], i + 1); }
    const ymd = cellToYmd(c);
    return ymd ? ymd.slice(0, 7) : null;
}

// INFO: a label cell (MONTH / AS OF DATE) with the value in the next filled cell to its right.
function parseInfoSheet(ws, sheetName, r) {
    r.info = { sheet: sheetName, month: null, asOf: null, monthText: '', asOfText: '' };
    sheetGrid(ws, 60, 12, rawCell).forEach(({ rowNo, cells }) => {
        cells.forEach((c, i) => {
            const label = importHead(cellText(c)).replace(/[:*]+$/, '').trim();
            const isMonth = /^(MONTH|PERIOD|REPORT MONTH)$/.test(label), isAsOf = /^(AS OF|AS OF DATE|AS-OF DATE|DATA AS OF)$/.test(label);
            if (!isMonth && !isAsOf) return;
            const valueCell = cells.slice(i + 1).find(x => x && x.t !== 'z' && cellText(x) !== '');
            if (!valueCell) return;
            if (isMonth && !r.info.monthText) { r.info.monthText = cellText(valueCell) || String(valueCell.v); r.info.month = cellToPeriod(valueCell); r.info.monthRow = rowNo; }
            if (isAsOf && !r.info.asOfText) { r.info.asOfText = cellText(valueCell) || String(valueCell.v); r.info.asOf = cellToYmd(valueCell); r.info.asOfRow = rowNo; }
        });
    });
}

// HOLIDAYS: header row with DATE (+ DESCRIPTION / NAME / HOLIDAY), one holiday per row.
function parseHolidaySheet(ws, sheetName, r) {
    const rows = sheetGrid(ws, 500, 10, rawCell);
    const hi = rows.findIndex(x => x.cells.some(c => importHead(cellText(c)) === 'DATE'));
    if (hi < 0) { r.warnings.push(`${sheetName}: no DATE header found — sheet ignored.`); return; }
    const head = rows[hi].cells.map(c => importHead(cellText(c)));
    const dCol = head.indexOf('DATE'), nCol = head.findIndex(h => /^(DESCRIPTION|NAME|HOLIDAY|HOLIDAY NAME|REMARKS?)$/.test(h));
    const list = [];
    rows.slice(hi + 1).forEach(({ rowNo, cells }) => {
        const c = cells[dCol];
        if (!c || cellText(c) === '') return;
        const date = cellToYmd(c);
        if (!date) { r.warnings.push(`${sheetName} row ${rowNo}: "${cellText(c).slice(0, 30)}" is not a date — skipped.`); return; }
        list.push({ date, name: nCol >= 0 ? cellText(cells[nCol]).slice(0, 60) : '' });
    });
    r.holidays = sanitizeHolidays(list);
    r.holidaySheet = sheetName;
}

// LEADERS: TYPE (TL / OM / AOM / GM), FULL NAME, HANDLED CAMPAIGNS (separated by commas).
function parseLeaderSheet(ws, sheetName, r) {
    const rows = sheetGrid(ws, 500, 10, rawCell);
    const hi = rows.findIndex(x => { const h = x.cells.map(c => importHead(cellText(c))); return h.some(v => /^(TYPE|POSITION|ROLE)$/.test(v)) && h.some(v => /^(FULL ?NAME|NAME)$/.test(v)); });
    if (hi < 0) { r.warnings.push(`${sheetName}: no TYPE / FULL NAME header found — sheet ignored.`); return; }
    const head = rows[hi].cells.map(c => importHead(cellText(c)));
    const tCol = head.findIndex(v => /^(TYPE|POSITION|ROLE)$/.test(v)), nCol = head.findIndex(v => /^(FULL ?NAME|NAME)$/.test(v));
    const cCol = head.findIndex(v => /^(HANDLED CAMPAIGNS?|CAMPAIGNS?)$/.test(v));
    if (cCol < 0) { r.warnings.push(`${sheetName}: no HANDLED CAMPAIGNS column — sheet ignored.`); return; }
    const out = { tl: [], om: [], gm: [] };
    rows.slice(hi + 1).forEach(({ rowNo, cells }) => {
        const typeText = importHead(cellText(cells[tCol])), name = cleanName(cellText(cells[nCol]));
        if (!typeText && !name) return;
        const where = `${sheetName} row ${rowNo}`;
        const type = /^(TL|TEAM LEADER)/.test(typeText) ? 'tl' : /^(OM|AOM|OPERATIONS? MANAGER|ASSISTANT)/.test(typeText) ? 'om' : /^(GM|GENERAL MANAGER)/.test(typeText) ? 'gm' : null;
        if (!type) { r.warnings.push(`${where}: TYPE "${typeText.slice(0, 20)}" is not TL, OM, AOM or GM — row skipped.`); return; }
        if (!name || !PERSON_RE.test(name) || name.replace(/[^A-ZÑ]/g, '').length < 3) { r.warnings.push(`${where}: "${name.slice(0, 40)}" is not a valid name — row skipped.`); return; }
        const campaigns = uniq(cellText(cells[cCol]).split(/[,;/\n]+/).map(x => cleanName(x)).filter(Boolean));
        const bad = campaigns.filter(c => !NAME_RE.test(c) || c.length > 60);
        if (bad.length) r.warnings.push(`${where}: campaign "${bad[0].slice(0, 30)}" has invalid characters — left out.`);
        const ok = campaigns.filter(c => !bad.includes(c));
        if (!ok.length) { r.warnings.push(`${where}: ${name} has no handled campaigns — row skipped.`); return; }
        const ex = out[type].find(l => slug(l.name) === slug(name));
        if (ex) ex.campaigns = uniq([...ex.campaigns, ...ok]); else out[type].push({ name, campaigns: ok, where });
    });
    r.leaderSheet = sheetName;
    if (out.tl.length + out.om.length + out.gm.length) r.leaders = out;
    else r.warnings.push(`${sheetName}: no valid leaders found — the current TL/OM/GM list is kept.`);
}

/* ===================== 3. CONTENT VALIDATION ===================== */
function validateImportRecords(r) {
    const seen = new Map();
    r.records.forEach(rec => {
        if (!rec.name) rec.errors.push('name is empty');
        else if (!PERSON_RE.test(rec.name)) rec.errors.push(`name "${rec.name}" has invalid characters (letters, spaces, . , ' - only)`);
        else if (rec.name.length > 80 || rec.name.replace(/[^A-ZÑ]/g, '').length < 3) rec.errors.push(`name "${rec.name}" is too short or too long`);
        if (!rec.campaign) rec.errors.push('campaign is missing (add a CAMPAIGN column or name the sheet after the campaign)');
        else if (!NAME_RE.test(rec.campaign) || rec.campaign.length > 60) rec.errors.push(`campaign "${rec.campaign}" has invalid characters`);
        if (!rec.team) rec.errors.push('cannot tell if this row is Curing or Recovery (add a BUCKET column or a title row "CURING"/"RECOVERY" above the header)');
        if (rec.accs1 > 0 && rec.repo > rec.accs1) rec.errors.push(`Repo (${rec.repo}) is more than # Accounts (${rec.accs1})`);
        if (rec.toRetain !== null && rec.beginning > 0 && rec.toRetain > rec.beginning) rec.errors.push('To Retain is more than Beginning');
        if (rec.collectibles > 0 && rec.collection > rec.collectibles) rec.warnings.push('Collection is higher than Collectibles');
        if (rec.toRetain !== null && rec.toRetain > 0 && rec.fixedProv > rec.toRetain) rec.warnings.push('Fixed Provision is higher than To Retain');
        if (rec.penalty > 0 && rec.penalty > rec.collection) rec.warnings.push('Penalty is higher than Collection');
        if (rec.targetRepo !== null && rec.accs1 > 0 && rec.targetRepo > rec.accs1) rec.warnings.push(`Repo TARGET (${rec.targetRepo}) is more than # of accounts (${rec.accs1})`);
        if (rec.toRetainAccs > 0 && rec.fixedAccs > rec.toRetainAccs) rec.warnings.push('# of accounts for Fixed Provision is higher than for To Retain');
        if (!rec.accs1) rec.warnings.push('# Accounts is 0');
        if (!rec.beginning) rec.warnings.push('Beginning is 0');
        if (rec.name && rec.campaign && rec.team) {
            rec.key = collectorKey(rec.campaign, rec.team, rec.name);
            if (seen.has(rec.key)) rec.errors.push(`duplicate — the same telecollector is also on ${seen.get(rec.key).where}`);
            else seen.set(rec.key, rec);
        }
    });
    // Similar names in the same campaign + bucket (possible typos)
    const byGroup = {};
    r.records.filter(x => x.key).forEach(x => { (byGroup[`${x.campaign}|${x.team}`] = byGroup[`${x.campaign}|${x.team}`] || []).push(x); });
    Object.values(byGroup).forEach(list => list.forEach((x, i) => list.slice(i + 1).forEach(y => {
        if (x.key !== y.key && levenshtein(slug(x.name), slug(y.name)) <= 2) r.warnings.push(`Similar names in ${x.campaign} ${x.team}: "${x.name}" (${x.where}) and "${y.name}" (${y.where}) — same person?`);
    })));
    // Similar to an existing telecollector under a different spelling
    r.records.filter(x => x.key && !findCollector(x.key)).forEach(x => {
        const twin = state.collectors.find(c => c.campaign === x.campaign && c.team === x.team && levenshtein(slug(c.name), slug(x.name)) <= 2);
        if (twin) r.warnings.push(`"${x.name}" (${x.where}) looks like existing "${twin.name}" in ${x.campaign} ${x.team} — a spelling change will create a new telecollector.`);
    });
    r.records.forEach(x => {
        x.errors.forEach(e => r.errors.push(`${x.where}${x.name ? ' (' + x.name + ')' : ''}: ${e}`));
        x.warnings.forEach(w => r.warnings.push(`${x.where}${x.name ? ' (' + x.name + ')' : ''}: ${w}`));
    });
    if ((r.campaignNames || []).length) r.notes.push(`Campaign names taken from the sheets: ${r.campaignNames.join(', ')}.`);
    const missing = (fields, text) => { if (!fields.some(f => r.present.has(f))) r.notes.push(text); };
    missing(['toRetain'], 'No TO RETAIN column — To Retain stays blank (%, ON TRACK PROVISION and PROVISION VARIANCE show "—").');
    missing(['targetRepo'], 'No repo TARGET column — the repo TARGET and ON TRACK stay blank.');
    missing(['ending', 'endingAccs', 'beginningAccs', 'toRetainAccs', 'fixedAccs'], 'No ENDING / # OF ACCOUNTS provision columns — they are set to 0 (use the Summary_Campaign_Revised layout).');
    missing(['lmSpCollection', 'lmSpFixedProv', 'lmSpRepo'], 'No SAME PERIOD columns — SAME PERIOD and SAME PERIOD VARIANCE stay blank.');
}

// Month / "as of" date / holidays / leaders from the INFO, HOLIDAYS and LEADERS sheets.
function validateImportMeta(r) {
    const today = todayStr();
    if (r.info) {
        const i = r.info, where = i.sheet;
        if (i.monthText && !i.month) r.errors.push(`${where}: MONTH "${i.monthText.slice(0, 30)}" is not a valid month (use e.g. 2026-10 or Oct 2026).`);
        if (i.asOfText && !i.asOf) r.errors.push(`${where}: AS OF DATE "${i.asOfText.slice(0, 30)}" is not a valid date (use e.g. 2026-10-05).`);
        if (i.asOf && i.asOf > today) r.errors.push(`${where}: AS OF DATE ${i.asOf} is in the future.`);
        if (i.month && i.asOf && periodOf(i.asOf) !== i.month) r.errors.push(`${where}: AS OF DATE ${i.asOf} is not inside MONTH ${periodLabel(i.month)}.`);
        if (!i.month && i.asOf) i.month = periodOf(i.asOf);
        if (!i.monthText && !i.asOfText) r.warnings.push(`${where}: MONTH and AS OF DATE are empty — the portal keeps ${periodLabel(currentPeriod())}.`);
        if (i.month && i.month !== currentPeriod()) r.warnings.push(`This file is for ${periodLabel(i.month)}; the portal is on ${periodLabel(currentPeriod())}. Importing switches the portal to ${periodLabel(i.month)}.`);
    } else r.notes.push(`The month stays ${periodLabel(currentPeriod())} (change it in Data → Month & holidays).`);
    if (r.holidaySheet && !(r.holidays || []).length) r.warnings.push(`${r.holidaySheet}: no holidays listed — the current holiday list is kept.`);
    if (r.leaders) {
        const camps = new Set(r.records.map(x => x.campaign));
        ['tl', 'om', 'gm'].forEach(t => r.leaders[t].forEach(l => l.campaigns.filter(c => !camps.has(c)).forEach(c =>
            r.warnings.push(`${l.where}: ${l.name} handles ${c}, which has no telecollectors in this file.`))));
        ['tl', 'om', 'gm'].forEach(t => r.leaders[t].forEach(l => delete l.where));
    }
}

/* ===================== 4. REPORT ===================== */
const sameVal = (a, b) => (a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : Math.abs(num(a) - num(b)) <= 0.004);
function importDiff(r) {
    const incoming = new Map(r.records.filter(x => x.key).map(x => [x.key, x]));
    let added = 0, changed = 0, same = 0;
    incoming.forEach((x, k) => {
        const c = findCollector(k);
        if (!c) { added++; return; }
        x.has.some(f => !sameVal(c[f], x[f])) ? changed++ : same++;
    });
    const missing = state.collectors.filter(c => !incoming.has(c.key)).length;
    return { added, changed, same, missing };
}

function renderImportReport(r) {
    const box = $('importReport');
    const checks = r.checks.map(c => `<li class="${c.ok ? 'text-emerald-700' : 'text-rose-600 font-semibold'}"><i class="fa-solid ${c.ok ? 'fa-circle-check' : 'fa-circle-xmark'} w-4"></i> ${esc(c.label)}: ${esc(c.detail)}</li>`).join('');
    let html = `<div class="font-bold text-slate-800 mb-1"><i class="fa-solid fa-file-excel text-emerald-600"></i> ${esc(r.fileName)}</div>
        <ul class="space-y-0.5 mb-3">${checks}</ul>`;
    if (!r.fatal) {
        const groups = {};
        r.records.forEach(x => {
            const g = groups[x.campaign || '(no campaign)'] = groups[x.campaign || '(no campaign)'] || { curing: 0, recovery: 0, other: 0, collectibles: 0, collection: 0, beginning: 0, fixedProv: 0 };
            g[x.team || 'other']++;
            ['collectibles', 'collection', 'beginning', 'fixedProv'].forEach(f => g[f] += num(x[f]));
        });
        const d = importDiff(r);
        const month = r.info && r.info.month ? r.info.month : currentPeriod();
        const asOf = r.info && r.info.asOf ? r.info.asOf : null;
        let progText = '';
        if (asOf && !r.errors.some(e => e.startsWith(r.info.sheet + ':'))) {
            const saved = state.holidays;
            if ((r.holidays || []).length) state.holidays = r.holidays;
            const p = bdProgress(asOf);
            state.holidays = saved;
            progText = ` · business day ${p.elapsed} of ${p.total}`;
        }
        const L = r.leaders;
        html += `<div class="grid md:grid-cols-3 gap-2 mb-3">
                <div class="bg-indigo-50 rounded-xl p-2"><b>Month:</b> ${esc(periodLabel(month))}<br><b>As of:</b> ${asOf ? esc(dateLabel(asOf)) + progText : 'not in the file'}</div>
                <div class="bg-indigo-50 rounded-xl p-2"><b>Holidays:</b> ${(r.holidays || []).length ? `${r.holidays.length} from the file (replaces the list)` : 'kept as they are'}<br>
                    <b>Leaders:</b> ${L ? `${L.tl.length} TL · ${L.om.length} OM/AOM · ${L.gm.length} GM (replaces the list)` : 'kept as they are'}</div>
                <div class="bg-indigo-50 rounded-xl p-2"><b>Optional columns found (blank = not provided):</b><br>${esc(['toRetain', 'targetRepo', 'lmSpCollection', 'lmSpFixedProv', 'lmSpRepo'].filter(f => r.present.has(f)).map(f => IMPORT_NUM_FIELDS.find(x => x[0] === f)[1]).join(', ') || 'none')}</div>
            </div>
            <div class="grid md:grid-cols-3 gap-2 mb-3">
                <div class="bg-slate-50 rounded-xl p-2"><b>Data taken from:</b><br>${esc(r.sheetsUsed.join(', '))}</div>
                <div class="bg-slate-50 rounded-xl p-2"><b>Cross-checked with:</b><br>${esc(r.sheetsCross.join(', ') || '—')}</div>
                <div class="bg-slate-50 rounded-xl p-2"><b>Ignored:</b><br>${esc(r.sheetsSkipped.join(', ') || '—')}</div>
            </div>
            <div class="overflow-x-auto mb-3"><table class="w-full text-left">
                <thead><tr class="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200"><th class="py-1 pr-2">Campaign</th><th class="py-1 pr-2 text-center">Curing</th><th class="py-1 pr-2 text-center">Recovery</th><th class="py-1 pr-2">Collectibles</th><th class="py-1 pr-2">Collection</th><th class="py-1 pr-2">Beginning</th><th class="py-1 pr-2">Fixed Provision</th></tr></thead>
                <tbody>${Object.entries(groups).map(([k, g]) => `<tr class="border-b border-slate-100"><td class="py-1 pr-2 font-bold text-indigo-600">${esc(k)}</td><td class="py-1 pr-2 text-center">${g.curing}</td><td class="py-1 pr-2 text-center">${g.recovery}</td><td class="py-1 pr-2">${formatPHP(g.collectibles)}</td><td class="py-1 pr-2">${formatPHP(g.collection)}</td><td class="py-1 pr-2">${fmtNum(g.beginning)}</td><td class="py-1 pr-2">${fmtNum(g.fixedProv)}</td></tr>`).join('')}</tbody>
            </table></div>
            <p class="mb-1"><b>${r.records.length}</b> telecollector rows · compared with current data: <b class="text-emerald-700">${d.added} new</b>, <b class="text-amber-700">${d.changed} changed</b>, ${d.same} unchanged, <b>${d.missing}</b> current telecollector(s) not in the file.</p>
            ${r.notes.map(n => `<p class="text-slate-500"><i class="fa-solid fa-circle-info"></i> ${esc(n)}</p>`).join('')}`;
        $('importModeReplaceInfo').innerText = `Deletes all ${state.collectors.length} current telecollectors and the daily entries log, then loads the ${r.records.length} from the file.`;
        $('importModeMergeInfo').innerText = `Updates the ${d.changed + d.same} that match, adds the ${d.added} new ones, and keeps the ${d.missing} that are not in the file. Columns missing from the file keep their current values.`;
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
    const shown = { errors: r.errors.slice(0, 40).concat(r.errors.length > 40 ? [`…and ${r.errors.length - 40} more errors`] : []), warnings: r.warnings.slice(0, 40).concat(r.warnings.length > 40 ? [`…and ${r.warnings.length - 40} more warnings`] : []) };
    $('importChecks').dataset.sig = '';
    renderChecks('importChecks', shown);
    $('importApplyWrap').classList.toggle('hidden', r.fatal);
    $('importApplyBtn').disabled = r.errors.length > 0;
    $('importApplyBtn').title = r.errors.length ? 'Fix the errors in the Excel file, then choose it again.' : '';
    r.shown = shown;
}

/* ===================== 5. APPLY ===================== */
async function applyImport() {
    if (!isAdmin()) return deny('Only the Admin can import Excel files.');
    const r = importState;
    if (!r || r.fatal || r.errors.length) return toast('Fix the errors first.', 'err');
    if (!checksPass('importChecks', r.shown)) return;
    const mode = document.querySelector('input[name="importMode"]:checked').value;
    const ok = await askAdminPassword('Confirm Excel import',
        `${mode === 'replace' ? 'REPLACE all current data with' : 'Update & add'} ${r.records.length} telecollectors from "${r.fileName}". An undo copy of the current data is saved first. Enter your Admin password to continue.`);
    if (!ok || !isAdmin()) return;
    // "Update & add": a column that is not in the file keeps the telecollector's current value.
    const records = r.records.map(x => {
        const ex = mode === 'merge' ? findCollector(x.key) : null, out = { campaign: x.campaign, team: x.team, name: x.name };
        IMPORT_FIELDS.forEach(f => { out[f] = ex && !x.has.includes(f) ? ex[f] : x[f]; });
        return out;
    });
    const meta = {};
    if (r.info && r.info.month) meta.period = r.info.month;
    if (r.info && r.info.asOf) meta.as_of = r.info.asOf;
    if ((r.holidays || []).length) meta.holidays = r.holidays;
    if (r.leaders) meta.leaders = r.leaders;
    try {
        await withProgress('Importing…', () => Backend.importCollectors({ records, mode, label: r.fileName, meta }));
        hideModal('importModal');
        importState = null;
        toast(`Imported ${records.length} telecollectors from ${r.fileName}. Use Data → Undo to go back.`, 'ok');
    } catch (e) { toast('Import failed: ' + friendlyError(e), 'err'); }
}

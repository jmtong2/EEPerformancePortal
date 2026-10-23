/* Month, "as of" date and business days (Monday–Friday minus holidays) used for Targets / On-Track Figures:
   Target = monthly figure ÷ business days in the month × business days elapsed up to the as-of date. */

function ymdLocal(d) { return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d || 1); }
function periodOf(ymd) { return String(ymd || '').slice(0, 7); }
function shiftPeriod(p, delta) { const d = parseYmd(p + '-01'); d.setMonth(d.getMonth() + delta); return ymdLocal(d).slice(0, 7); }
function periodLabel(p) { return /^\d{4}-\d{2}$/.test(p || '') ? parseYmd(p + '-01').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : '—'; }
function dateLabel(ymd) { return /^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? parseYmd(ymd).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
function lastDayOf(p) { const d = parseYmd(p + '-01'); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymdLocal(d); }

function holidaySet() { return new Set((state.holidays || []).map(h => (typeof h === 'string' ? h : h.date))); }

// All business days of a month as YYYY-MM-DD strings.
function businessDays(period) {
    const hs = holidaySet(), out = [];
    const d = parseYmd(period + '-01'), month = d.getMonth();
    for (; d.getMonth() === month; d.setDate(d.getDate() + 1)) {
        const wd = d.getDay(), s = ymdLocal(d);
        if (wd !== 0 && wd !== 6 && !hs.has(s)) out.push(s);
    }
    return out;
}

// { period, total, elapsed, ratio } for the month of `asOf` (elapsed counts business days up to and including asOf).
function bdProgress(asOf) {
    const period = periodOf(asOf), days = businessDays(period);
    const elapsed = days.filter(d => d <= asOf).length;
    return { period, asOf, total: days.length, elapsed, ratio: days.length ? elapsed / days.length : 0 };
}

function currentPeriod() { return /^\d{4}-\d{2}$/.test(state.currentPeriod || '') ? state.currentPeriod : todayStr().slice(0, 7); }

// The day the ON TRACK figures are counted up to: TODAY (today counts as a business day if it is one).
// For a past month the whole month counts; for a future month nothing has elapsed yet.
function effectiveAsOf() {
    const p = currentPeriod(), today = todayStr();
    if (periodOf(today) === p) return today;
    return today > p ? lastDayOf(p) : p + '-01';
}

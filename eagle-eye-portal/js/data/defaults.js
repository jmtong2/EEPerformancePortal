/* KPI defaults, default holidays and the column glossary.
   No telecollector or leader data lives in the website files any more: everything is stored in Supabase
   and loaded after login (the data is personal information and the site files are public once hosted). */

/* ===================== KPI DEFAULTS =====================
   Score per metric = actual ÷ target (capped at `cap`%), then weighted.
   The Provision part is skipped (and the other weights re-scaled) for telecollectors without a TO RETAIN figure. */
const DEFAULT_KPI = {
    cap: 120,
    curing:   { weights: { collection: 35, penalty: 30, provision: 25, repo: 10 }, targets: { collection: 40, penalty: 10, provision: 55, repo: 2 } },
    recovery: { weights: { collection: 30, penalty: 25, provision: 35, repo: 10 }, targets: { collection: 40, penalty: 6,  provision: 70, repo: 2 } }
};

/* Philippine regular & special non-working days for 2026 (fixed-date ones + Holy Week).
   Verify against the official proclamation and add company-specific non-working days in Data → Month, as-of date & holidays. */
const DEFAULT_HOLIDAYS = [
    { date: '2026-01-01', name: "New Year's Day" }, { date: '2026-02-17', name: 'Chinese New Year' },
    { date: '2026-04-02', name: 'Maundy Thursday' }, { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-09', name: 'Araw ng Kagitingan' }, { date: '2026-05-01', name: 'Labor Day' },
    { date: '2026-06-12', name: 'Independence Day' }, { date: '2026-08-21', name: 'Ninoy Aquino Day' },
    { date: '2026-08-31', name: 'National Heroes Day' }, { date: '2026-11-30', name: 'Bonifacio Day' },
    { date: '2026-12-08', name: 'Feast of the Immaculate Conception' }, { date: '2026-12-24', name: 'Christmas Eve' },
    { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-30', name: 'Rizal Day' },
    { date: '2026-12-31', name: 'Last Day of the Year' }
];

/* ===================== COLUMN GLOSSARY (Column Guide) ===================== */
const GLOSSARY = [
    ['RANK', "Position by KPI Rate within the table. Ties share the same rank."],
    ['CAMPAIGN', "Name of the campaign (client)."],
    ['FULL NAME', "Name of the telecollector."],
    ['# ACCS', "Number of accounts assigned."],
    ['COLLECTIBLES', "Amount to be collected (amount due) for the month."],
    ['COLLECTION', "Actual amount collected, month-to-date."],
    ['EFF %', "Collection efficiency = Collection ÷ Collectibles."],
    ['VARIANCE COLLECTION', "Amount still uncollected = Collectibles − Collection."],
    ['PENALTY', "Fees collected for late payments, month-to-date."],
    ['% (vs Collection)', "Share of the collection that is penalty = Penalty ÷ Collection."],
    ['BEGINNING', "Beginning provision for the month."],
    ['PRINCIPAL BAL', "Principal balance of the accounts."],
    ['TO RETAIN', "Provision amount to be retained for the month (from the source file). Blank until the source provides it."],
    ['FIXED PROVISION', "Provision actually retained (fixed), month-to-date."],
    ['ACH %', "Provision achievement = Fixed Provision ÷ To Retain (blank while To Retain is blank)."],
    ['VARIANCE PROVISION', "Provision still to be fixed = To Retain − Fixed Provision."],
    ['REPO', "Number of accounts fully paid (principal, interest and all charges), month-to-date."],
    ['PROVISION OF REPO', "Principal balance / provision of the repo (fully paid) accounts, month-to-date."],
    ['TARGET (ON-TRACK FIGURE)', "Where the month should be by now = monthly figure ÷ business days in the month × business days elapsed up to the \"as of\" date. Business days = Monday–Friday minus holidays. Target Collection uses Collectibles, Target Provision uses To Retain, Target Repo uses the monthly Target Repo."],
    ['% (vs TARGET)', "Actual ÷ Target."],
    ['COMPARISON LAST MONTH', "Last month's total collection."],
    ['VARIANCE COMPARISON', "This month's collection − last month's total collection."],
    ['SAME PERIOD', "This month vs last month at the same point of the month (same business day): the % change and last month's same-period figure."],
    ['KPI RATE', "Overall score of Collection, Penalty, Provision and Repo against the KPI targets (see the KPI Rate section)."],
    ['ACTION', "Admin / Management only: add a daily entry for, or edit, the record."]
];

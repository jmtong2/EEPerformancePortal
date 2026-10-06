/* KPI defaults, default holidays, the standard TL / OM & AOM lists and the column glossary.
   No telecollector data lives in the website files: it is stored in Supabase (or this browser) and loaded after login
   (it is personal information and the site files are public once hosted). */

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

/* ===================== STANDARD TL AND OM & AOM LISTS =====================
   Loaded once by the v9 upgrade (Local mode: js/backends/local-backend.js; Supabase: the same list in
   database/supabase-setup.sql). After that the Admin changes them in the TL and OM & AOM tabs. The GM list is kept as it is. */
const DEFAULT_LEADERS = {
    tl: [
        { name: 'RICHMOND OLIVEROS', campaigns: ['ASIALINK'] },
        { name: 'JOSE ANGELO MANARPIIS', campaigns: ['SURECYCLE', 'SOUTH ASIALINK', 'WISEFUND'] },
        { name: 'JOHN LESTER MAMARIL', campaigns: ['GLOBAL DOMINION', 'GLOBAL CEBUANA'] },
        { name: 'JOHN CERLO CALIPES', campaigns: ['CEPAT'] }
    ],
    om: [
        { name: 'JAYME ANN PIL', campaigns: ['ASIALINK'] },
        { name: 'ROXELL VISTAL', campaigns: ['ASIALINK'] },
        { name: 'NICHOLE DELA CRUZ', campaigns: ['SOUTH ASIALINK', 'WISEFUND', 'SURECYCLE'] },
        { name: 'MARHENIEL GADO', campaigns: ['SOUTH ASIALINK', 'WISEFUND', 'SURECYCLE'] },
        { name: 'CECILE MARIE SOLANOY', campaigns: ['GLOBAL DOMINION', 'GLOBAL CEBUANA'] },
        { name: 'ELOISA JANE BALLESTEROS', campaigns: ['CEPAT'] }
    ]
};

/* ===================== COLUMN GLOSSARY (Column Guide) ===================== */
const GLOSSARY = [
    ['RANK', "Position by KPI Rate within the table. Ties share the same rank. — means there are no figures to score yet."],
    ['CAMPAIGN', "Name of the campaign (client)."],
    ['FULL NAME', "Name of the telecollector."],
    ['# OF ACCOUNTS', "Number of accounts. In the Collection tab: accounts assigned. In the Provision tab each figure has its own count: the # OF ACCOUNTS right before ENDING, BEGINNING, TO RETAIN or FIXED PROVISION counts the accounts in that figure."],
    ['COLLECTIBLES', "Amount to be collected (amount due) for the month."],
    ['COLLECTION', "Actual amount collected, month-to-date."],
    ['EFF %', "Collection efficiency = Collection ÷ Collectibles."],
    ['VARIANCE COLLECTION', "Amount still uncollected = Collectibles − Collection."],
    ['PENALTY', "Fees collected for late payments, month-to-date."],
    ['% (vs Collection)', "Share of the collection that is penalty = Penalty ÷ Collection."],
    ['ENDING', "Ending provision."],
    ['BEGINNING', "Beginning provision for the month."],
    ['TO RETAIN', "Provision to be retained for the month (from the Excel file). Blank = not provided yet."],
    ['FIXED PROVISION', "Provision actually retained (fixed), month-to-date."],
    ['ACH %', "Provision achievement = Fixed Provision ÷ To Retain (blank while To Retain is blank)."],
    ['VARIANCE PROVISION / PROVISION VARIANCE', "Provision still to be fixed = To Retain − Fixed Provision."],
    ['# OF ACCOUNTS VARIANCE', "# of accounts (To Retain) − # of accounts (Fixed Provision)."],
    ['REPO / ACTUAL (REPO UNITS)', "Number of repo units, month-to-date."],
    ['AGE: 2ND MONTH / 3RD MONTH / 4TH MONTH AND UP', "Repo units by account age, as given in the Excel file. The Repo tab charts them by age, next to TARGET, ACTUAL and %."],
    ['TARGET (repo)', "The month's repo target from the Excel file. Different from ON TRACK."],
    ['ON TRACK', "Where the month should be by today = monthly figure ÷ business days in the month × business days up to today (today included). Business days = Monday–Friday minus holidays. ON TRACK COLLECTION uses Collectibles, ON TRACK PROVISION uses To Retain, repo ON TRACK uses the repo TARGET."],
    ['ON TRACK % / %', "On Track ÷ actual: ON TRACK COLLECTION ÷ Collection, ON TRACK PROVISION ÷ Fixed Provision, repo ON TRACK ÷ Actual."],
    ['VARIANCE (ON TRACK)', "Collection: Collection − On Track Collection. Repo: On Track − Actual."],
    ['SAME PERIOD', "Last month's figure at the same point of the month (from the Excel file)."],
    ['SAME PERIOD VARIANCE', "This month − Same Period (current month − previous month)."],
    ['KPI RATE', "Overall score of Collection, Penalty, Provision and Repo against the KPI targets (see the KPI Rate section)."],
    ['ACTION', "Telecollector tables: Admin and Management add a daily entry or edit the record. TL / OM & AOM / GM tables: Admin only. Not shown to Analysts (view only)."]
];
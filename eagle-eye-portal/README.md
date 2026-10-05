# Eagle Eye Performance Portal v7

A dashboard for company, campaign, telecollector, TL, OM/AOM and GM performance at Eagle Eye Business & Collection Services.

- **Storage:** Supabase only. See `docs/SUPABASE-SETUP.md` for setup, upgrading and the monthly routine.
- **Data source:** *SUMMARY Campaign TEMPLATE.xlsx*, imported by the Admin. The website files contain **no** telecollector data.

## What's on the dashboard
- **Company totals tabs:** Collection · Provision · Repo.
  - View the totals by company (Curing, Recovery, Total) or by campaign.
  - TARGET columns are On Track Figures: monthly figure ÷ business days × business days elapsed.
  - The **SAME PERIOD** column compares against last month at the same business day.
  - The Repo tab includes a chart.
- **Last month's collection**, upper right.
- **Telecollector / TL / OM & AOM / GM rankings** by KPI Rate.
- **Campaign Summary & Race:** ranking charts for Collection, Penalty, Provision and Repo, plus the summary table.
- **Entries Log:** Admin and Management only.

## Folder structure
```
eagle-eye-portal/
├── index.html                  Page layout (HTML only)
├── css/styles.css              Custom styles (most styling is Tailwind classes in index.html)
├── js/
│   ├── config.js               ⚙ SETTINGS: Supabase URL + key, limits, library versions. The only file you normally edit.
│   ├── app.js                  Startup
│   ├── data/defaults.js        KPI defaults, default holidays, column definitions (no personal data)
│   ├── core/
│   │   ├── utils.js            General helpers (formatting, messages, script loading)
│   │   ├── model.js            Roles, app state, telecollector records (duplicate-proof keys), data clean-up
│   │   ├── validation.js       Shared form checks (red errors / amber warnings)
│   │   ├── period.js           Month, "as of" date, business days
│   │   └── kpi.js              KPI Rate, totals, targets, rankings
│   ├── backends/supabase-backend.js   Supabase Auth + database + live updates
│   ├── ui/
│   │   ├── dashboard.js        Tabs, cards, ranking tables
│   │   ├── company.js          Company Collection / Provision / Repo tabs
│   │   └── charts.js           Charts (Chart.js, loaded on demand)
│   └── features/
│       ├── auth.js             Login, first-time Admin setup, role visibility, auto-logout, change password
│       ├── users.js            User accounts (Admin)
│       ├── daily-entry.js      Daily Log-in Entry with On Track Figures, and undo (Admin, Management)
│       ├── telecollectors.js   Add / edit / delete telecollectors (Admin, Management)
│       ├── leaders.js          TL / OM / GM (Admin, Management)
│       ├── kpi-settings.js     KPI targets and weights (Admin)
│       ├── column-guide.js     Printable column guide
│       ├── data-tools.js       Data menu: month & holidays, new month, delete / undo / reset (Admin)
│       ├── excel-import.js     Excel import with security validation (Admin)
│       └── exports.js          Excel and PDF export (Admin)
├── database/supabase-setup.sql Tables, security and functions (run in the Supabase SQL Editor; safe to re-run)
└── docs/SUPABASE-SETUP.md      Setup, upgrade, template and monthly routine
```

## Roles
| | Admin | Management | Analyst |
|---|:-:|:-:|:-:|
| View dashboards, rankings, charts, Column Guide | ✅ | ✅ | ✅ |
| Daily Log-in Entry, Entries Log | ✅ | ✅ | ❌ |
| Add / edit / delete telecollectors, TL/OM/GM | ✅ | ✅ | ❌ |
| Change own password | ✅ | ✅ | ❌ |
| Add / manage users | ✅ | ❌ | ❌ |
| **Data** menu (see below) | ✅ | ❌ | ❌ |
| See the portal version (Performance Portal v7) | ✅ | ❌ | ❌ |

The **Data** menu covers: Import Excel · Export Excel / PDF · Month & holidays · KPI settings · Start new month · Undo / Reset / Delete all.

The database functions in `database/supabase-setup.sql` enforce these rules on the server.

## Blank figures
**To Retain**, **Target Repo** and the **last-month (LM)** figures stay blank until the source file provides them.

While they're blank:
- the related columns show "—";
- the KPI Rate leaves Provision out and re-scales the other weights;
- partly filled data is compared only over the telecollectors that have the figure.

## Notes for developers
- Scripts are plain `<script>` tags loaded in a fixed order (bottom of `index.html`), not ES modules.
- Tables are read-only through the API (row-level security). All writes are role-checked `security definer` functions, and each runs as one transaction.
- The Excel import never runs formulas; it reads cell values only.
- **Libraries:** pinned in `js/config.js`, and each loads only when needed:
  - supabase-js;
  - Chart.js (charts);
  - SheetJS (Excel);
  - jsPDF + AutoTable (PDF).

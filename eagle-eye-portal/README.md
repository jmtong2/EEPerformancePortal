# Eagle Eye Performance Portal v9

A dashboard for company, campaign, telecollector, TL, OM/AOM and GM performance at Eagle Eye Business & Collection Services.

## Two ways to run it (`js/config.js` → `STORAGE_MODE`)
| Mode | When | Data |
|---|---|---|
| **Local** | Supabase keys empty (or `STORAGE_MODE = 'local'`) | Saved in **this browser on this PC only**. |
| **Supabase** | `SUPABASE_URL` + `SUPABASE_ANON_KEY` filled in | Online and shared by every PC. Setup: `docs/SUPABASE-SETUP.md`. |

### Running locally
1. Unzip the folder.
2. Double-click `index.html` in Chrome or Edge (internet is needed for the page styles and charts).
3. Log in with a starter account. These are created the first time the portal opens in a browser:

   | Username | Password | Role |
   |---|---|---|
   | `admin` | `ad1100` | Admin |
   | `management` | `mt1100` | Management |
   | `analyst` | `ac1100` | Analyst |

4. Go to **Data → Import Excel file** and load the Summary Campaign file.

Before going further:
- **Change the starter passwords** with **Password** (Admin and Management) or **Users → Reset PW**. The starter list is in `js/config.js`.
- **Back up regularly** with **Data → Export to Excel**. Clearing the browser's data deletes the Local data.
- **To move to Supabase**, import the exported file there.

## Forgotten passwords
- **On the login screen:** **Forgot password?** sends a request to the Admin. The Admin sees it under **Users** (with a red count on the button), clicks **Reset PW** and gives the person the new password.
- **No Admin can log in, Local mode:**
  1. Open the portal on that PC and press **F12** to open the console.
  2. Run `eeLocalSetPassword('admin', 'NewPassword')`.
  3. Log in with the new password.
- **No Admin can log in, Supabase:** see "Forgotten passwords" in `docs/SUPABASE-SETUP.md`.

## Excel source: Summary_Campaign_Revised.xlsx
- **One sheet per campaign.** The campaign name comes from cell A1, for example "Asialink". If the sheet name (e.g. "CEPAT") matches a campaign already in the portal, that name is kept.
- **Each sheet has a CURING block and a RECOVERY block** with these columns:
  - **COLLECTION:** # OF ACCOUNTS, COLLECTIBLES, COLLECTION, PENALTY, SAME PERIOD (COLLECTION).
  - **PROVISION:** ENDING, BEGINNING, TO RETAIN and FIXED PROVISION, each with its own # OF ACCOUNTS before it, plus SAME PERIOD (PROVISION).
  - **REPO:** 2nd Month, 3rd Month, 4th Month and Up, TARGET, ACTUAL, SAME PERIOD (REPO).
- **The "Curing" / "Recovery" summary sheets** (with a CAMPAIGN column) are used instead when they have rows.
- **VARIANCE columns in the file are ignored.** The portal computes every %, VARIANCE and ON TRACK figure itself.
- **Blank cells:** a blank TO RETAIN, TARGET or SAME PERIOD means "not provided" and shows as "—". Other blank cells count as 0.

## What's on the dashboard
- **Cards:** Total Collectibles · Collection Total (Efficiency Rate) · Penalty Recovered (Penalty Rate = Penalty ÷ Collection) · Fixed Provision Total (ACH %) · Repo Units (% of accounts).
- **Company tabs: Collection · Provision · Repo.** View by company total or by campaign.
  - **ON TRACK** = monthly figure ÷ business days in the month × business days up to today (today included). Business days are Monday–Friday minus holidays.
  - **ON TRACK %** = On Track ÷ actual.
  - **SAME PERIOD** = last month at the same point of the month. **SAME PERIOD VARIANCE** = this month − Same Period.
  - **Repo chart:** repo units by age (2nd month, 3rd month, 4th month and up) on the x-axis, next to a **Target, actual and %** panel: grey track = TARGET for the month, coloured bar = ACTUAL, black tick = ON TRACK today, % = ON TRACK ÷ ACTUAL. *Company total* shows the company as a whole; *By campaign* shows each campaign in its own colour. It is not split by Curing / Recovery.
- **Same Period (Collection) card**, upper right.
- **Telecollector / TL / OM & AOM / GM rankings** by KPI Rate.
  - Standard KPI targets and weights: Collection 40% with weights 35 (Curing) / 30 (Recovery); Penalty 10% / 6%, weights 30 / 25; Provision 55% / 70%, weights 25 / 35; Repo 2%, weight 10.
  - Ties share a rank and the next rank follows without a gap (1, 1, 2, 3), for example an OM and an AOM who handle the same campaigns.
  - Telecollectors with no figures yet show "—" instead of a rank.
- **Campaign Summary & Race charts** and the summary table.
- **Entries Log** (Admin and Management).

## TL, OM & AOM and GM lists
v9 loads the standard lists once (in `js/data/defaults.js` and `database/supabase-setup.sql`):

| Campaigns | TL | OM & AOM | GM |
|---|---|---|---|
| Asialink | Richmond Oliveros | Jayme Ann Pil, Roxell Vistal | Arnel Salloman |
| SureCycle, South Asialink, WiseFund | Jose Angelo Manarpiis | Nichole Dela Cruz, Marheniel Gado | Pop Anthon Pradilla |
| Global Dominion, Global Cebuana | John Lester Mamaril | Cecile Marie Solanoy | Jay-Ar Figueroa |
| Cepat | (no TL) | Eloisa Jane Ballesteros | Rommel Saraosos |

After that, only the **Admin** changes them: **Add TL / Add OM / AOM / Add GM** adds a person, and **Edit** changes which campaigns they handle or removes them. A handled campaign shown in grey has no telecollectors in the data yet (for example, a different spelling in the Excel file).

## Roles
| | Admin | Management | Analyst |
|---|:-:|:-:|:-:|
| View dashboards, rankings, charts, Column Guide | ✅ | ✅ | ✅ |
| ACTION columns in the tables | ✅ | ✅ telecollectors only | ❌ (view only) |
| Daily Log-in Entry, Entries Log | ✅ | ✅ | ❌ |
| Add / edit / delete telecollectors | ✅ | ✅ | ❌ |
| Add / edit / delete TL, OM & AOM, GM (and the campaigns they handle) | ✅ | ❌ | ❌ |
| Change own password | ✅ | ✅ | ❌ |
| Add / manage users, answer password requests | ✅ | ❌ | ❌ |
| **Data** menu: Import · Export Excel / PDF · Month & holidays · KPI settings · New month · Undo / Reset / Delete all | ✅ | ❌ | ❌ |
| See the portal version | ✅ | ❌ | ❌ |

## Folder structure
```
eagle-eye-portal/
├── index.html                 Page layout
├── img/                       Logo and browser icon
├── css/styles.css             Custom styles
├── js/config.js               ⚙ SETTINGS: storage mode, Supabase keys, starter accounts, limits
├── js/app.js                  Startup (picks Local or Supabase)
├── js/data/defaults.js        KPI defaults, default holidays, standard TL / OM & AOM / GM lists, column definitions
├── js/core/                   Helpers, data model, validation, business days, KPI and totals
├── js/backends/               supabase-backend.js (online) · local-backend.js (this browser)
├── js/ui/                     dashboard.js · company.js (company tabs) · charts.js
├── js/features/               Login, users, daily entry, telecollectors, leaders, KPI settings, guide, Data menu, Excel import, exports
├── database/supabase-setup.sql Supabase tables, security and functions (re-run after every upgrade; never deletes data)
└── docs/SUPABASE-SETUP.md     Supabase setup and upgrade
```

## Notes for developers
- Scripts are plain `<script>` tags in a fixed order (bottom of `index.html`), so the page also works when opened as a file.
- **Local mode** is an in-browser stand-in for the Supabase client. It runs the same database functions and checks, and stores passwords as salted PBKDF2 hashes in `localStorage`.
- **Supabase:** tables are read-only through the API (row-level security). All writes are role-checked functions that each run as one transaction.

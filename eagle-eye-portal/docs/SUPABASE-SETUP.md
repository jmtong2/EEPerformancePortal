# Eagle Eye Performance Portal v9: Supabase Setup and Monthly Routine

In Supabase mode the portal stores everything in **Supabase**: logins, telecollectors, settings and the entries log. No telecollector data is kept in the website files. (To run on one PC without Supabase, see "Running locally" in `README.md`.)

---

## Already running an earlier version on Supabase? Upgrade to v9
1. Supabase Dashboard → **SQL Editor → New query**. Paste **all** of the new `database/supabase-setup.sql` and click **Run**. Your existing data is kept. The upgrade:
   - **v9:** loads the standard TL, OM & AOM and GM lists (see `README.md`) and makes changing them Admin-only;
   - **v8 (if you skipped it):** adds the columns of the Summary_Campaign_Revised layout (ENDING, # OF ACCOUNTS per provision figure, repo by age) and the "Forgot password?" requests, and resets the KPI Rate to the standard targets and weights.
2. Replace the website files with the new `eagle-eye-portal` folder. Before you do, copy your three lines from the old `js/config.js` into the new one: `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_EMAIL_DOMAIN`.
3. Coming from v7 or earlier: log in as Admin and import the filled **Summary_Campaign_Revised.xlsx** with **Data → Import Excel file…** (**Replace all data**).

If you skip step 1, the Admin sees a red "Finish the v9 upgrade" notice (or, from v7 and earlier, *"The Supabase database is not set up for this version yet"*).

---
## New project: step by step (about 20 minutes, free plan)

### Step 1: Create the Supabase project
1. Go to **https://supabase.com**, sign in, and click **New project**.
2. Enter a name such as `eagle-eye-portal` and a **database password**. Save the password somewhere safe.
3. For **Region**, choose **Southeast Asia (Singapore)**, then click **Create new project**.

### Step 2: Login settings
1. Open **Authentication → Sign In / Providers**.
2. Set **Allow new users to sign up** to **ON**.
   - The Admin creates everyone's logins from the portal, which needs this setting.
   - Anyone who signs up on their own gets no access.
3. Under **Email**, turn **Confirm email OFF** and click **Save**. No e-mails are ever sent.

### Step 3: Create the database
1. Open **SQL Editor → New query**.
2. Paste **all** of `database/supabase-setup.sql` and click **Run**. You should see "Success. No rows returned".

### Step 4: Connect the portal
1. Copy the **Project URL** from **Project Settings → Data API**.
2. Copy the **anon / publishable** key from **Project Settings → API Keys**.
3. Fill both into `js/config.js`:

```js
const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // or sb_publishable_...
```

> **Never** paste the `service_role` / **secret** key into the portal.

### Step 5: Put the portal online
1. Go to **https://app.netlify.com/drop** and drag the whole `eagle-eye-portal` folder onto the page.
2. To update the site later, open it in Netlify, go to **Deploys**, and drag the folder in again.

### Step 6: Create the Admin and load the data
1. Open the portal link. The **First-time Setup** form appears.
2. Enter your username, display name and a password of 6 or more characters. You become the **Admin**. (To keep the usual logins, use username `admin` here, then add `management` and `analyst` in Step 7.)
3. Go to **Data → Import Excel file…** and upload the filled **Summary_Campaign_Revised.xlsx**.

> Do this **right after** the site goes online. Until an Admin exists, whoever opens the link first could claim the Admin account.

### Step 7: Add the other accounts
Go to **Users** and add each person's username, display name, role (**Admin / Management / Analyst**) and password. (Management can add and edit telecollectors and daily entries; only the Admin changes TL / OM & AOM / GM.)
- **Reset PW** sets a new password immediately.
- **Delete** removes the login completely, so the username can be reused.
- Role changes and un-ticking **Active** take effect immediately, even if the person is logged in.

---

## The source file: Summary_Campaign_Revised.xlsx
See "Excel source" in `README.md`.
- **Layout:** one sheet per campaign, each with CURING and RECOVERY blocks (or the Curing / Recovery summary sheets).
- **Blank cells:** a blank TO RETAIN, TARGET or SAME PERIOD means "not provided".
- **Computed by the portal:** the VARIANCE, % and ON TRACK columns.
- **Optional extra sheets** are still read: HOLIDAYS (DATE, DESCRIPTION) and LEADERS (TYPE, FULL NAME, HANDLED CAMPAIGNS).

Files exported from the portal (**Data → Export to Excel**) can be imported back the same way.

## Monthly routine (Admin)
1. **During the month:** keep the totals current in one of two ways:
   - re-import the updated Excel file (**Replace all data**);
   - have Admin / Management add **Daily Log-in Entries**.
2. **ON TRACK figures:** the portal computes them as monthly figure ÷ business days in the month × business days up to today (today included).
   - Business days are Monday–Friday minus the holidays.
   - To check or adjust the month and holidays, use **Data → Month & holidays…**.
3. **At month end:**
   - **Data → Start new month…** sets this month's actuals back to zero (collection, penalty, fixed provision and its # of accounts, repo), clears SAME PERIOD and moves to the next month.
   - Then import the new month's file.
4. **Mistakes:**
   - **Data → Undo** reverses the last import, reset, new month or delete-all.
   - **Data → Reset to last imported file…** returns everything to how it was right after the last import.
## Coming from the Firebase version
In the old portal, go to **Data → Export to Excel**, then import that file here with **Replace all data**. Re-create the user accounts; logins can't be copied between systems. The entries-log history doesn't transfer, but every telecollector's totals do.

## Forgotten passwords
- **Anyone:** **Forgot password?** on the login screen sends a request; the Admin sees it under **Users** (red count on the button) and uses **Reset PW**.
- **A normal user:** the Admin uses **Users → Reset PW**.
- **The only Admin:** in **SQL Editor**, run the following (change the username and the password), then log in and change the password again under **Password**:
  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('NewPassword#2026', extensions.gen_salt('bf'))
   where email = 'yourusername@eagleeye-portal.example.com';
  ```

> Tip: keep **two Admin accounts** so one can always reset the other.

## Free-plan notes
- Supabase pauses free projects after 7 days without activity. To wake it, open the dashboard and click **Restore project**; no data is lost.
- The free database holds 500 MB. This portal uses well under 50 MB.

## Troubleshooting
| Message | Fix |
|---|---|
| "Supabase is not connected yet" | Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Step 4). |
| "SUPABASE_URL … is wrong" / "Invalid path specified in request URL" | Use exactly `https://xxxx.supabase.co`, with nothing after `.co`. |
| "SUPABASE_ANON_KEY … is wrong" | Copy the **anon / publishable** key again. |
| "The Supabase database is not set up for this version yet" | Run `database/supabase-setup.sql` again (Step 3). |
| "This login is not confirmed…" | Turn **Confirm email** OFF (Step 2), then delete and re-add the user. |
| "Supabase rejected the login e-mail domain" | Set `SUPABASE_EMAIL_DOMAIN` in `js/config.js` to your company e-mail domain **before** creating users. |
| "This login has no portal access" | Delete the user and add them again under **Users**. |
| "No Excel file has been imported yet, so there is nothing to reset to" | Reset needs at least one import. Use **Undo** instead. |
| Stuck on "Connecting to cloud…" | Check the internet connection, the URL and the key, and whether the project is **paused**. |

## Security notes
- Tables are **read-only** through the API. Every change goes through a database function that checks the user's role on the server, and each function runs as one all-or-nothing transaction.
- Analysts can't read the entries log.
- The undo copy and the last-import copy are never sent to any browser.
- The server also checks the data:
  - no negative amounts;
  - To Retain can't be more than Beginning;
  - names may contain letters only;
  - Repo can't exceed # accounts;
  - valid months and dates;
  - no duplicate telecollectors.

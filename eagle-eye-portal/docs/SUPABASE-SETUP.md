# Eagle Eye Performance Portal v7: Supabase Setup and Monthly Routine

The portal stores everything in **Supabase**: logins, telecollectors, settings and the entries log. No data is kept in the website files.

---

## Already running an earlier version on Supabase? Upgrade to v7
1. Supabase Dashboard → **SQL Editor → New query**. Paste **all** of the new `database/supabase-setup.sql` and click **Run**. Your existing data is kept.
   - The upgrade clears **To Retain**, which will come from the new source file.
   - It also loads the 2026 Philippine holidays.
2. Replace the website files with the new `eagle-eye-portal` folder. Before you do, copy your three lines from the old `js/config.js` into the new one: `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_EMAIL_DOMAIN`.
3. Log in as Admin. Fill in **SUMMARY Campaign TEMPLATE.xlsx**, then upload it with **Data → Import Excel file…** and choose **Replace all data**.

If you skip step 1, the portal says *"The Supabase database is not set up for v7 yet"*.

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
2. Enter your username, display name and a password of 8 or more characters. You become the **Admin**.
3. Go to **Data → Import Excel file…** and upload the filled **SUMMARY Campaign TEMPLATE.xlsx**.

> Do this **right after** the site goes online. Until an Admin exists, whoever opens the link first could claim the Admin account.

### Step 7: Add the other accounts
Go to **Users** and add each person's username, display name, role (**Admin / Management / Analyst**) and password.
- **Reset PW** sets a new password immediately.
- **Delete** removes the login completely, so the username can be reused.
- Role changes and un-ticking **Active** take effect immediately, even if the person is logged in.

---

## The source file: SUMMARY Campaign TEMPLATE.xlsx
| Sheet | What to fill in |
|---|---|
| **INFO** | **MONTH** and **AS OF DATE**, the date the month-to-date figures run up to. |
| **Curing / Recovery** | One row per telecollector. **Yellow** columns must be filled; a blank counts as 0. **Green** columns are optional: a blank means "not provided yet" and the portal shows "—". |
| **HOLIDAYS** | Non-working days. These reduce the business days used for the targets. |
| **LEADERS** | TL / OM / AOM / GM and the campaigns they handle, separated by commas. |
| **README** | Instructions, column dictionary, an example row and the assumptions. This sheet is never imported. |

Files exported from the portal (**Data → Export to Excel**) can be imported back the same way.

## Monthly routine (Admin)
1. **During the month:** keep the totals current in one of two ways:
   - re-import the updated template (**Replace all data**);
   - have Admin / Management add **Daily Log-in Entries**.

   Each import or entry moves the "as of" date forward.
2. **Targets (On Track Figures):** the portal computes them as monthly figure ÷ business days in the month × business days elapsed up to the "as of" date.
   - Business days are Monday–Friday minus the holidays.
   - To check or adjust these, use **Data → Month, "as of" date & holidays…**.
3. **At month end:**
   - **Data → Start new month…** copies this month's Collection, Fixed Provision and Repo into the "last month" columns, sets the actuals back to zero, and moves to the next month.
   - Then import the new month's file.
   - If the file already has the **LM** columns, you can skip **Start new month** and just import.
4. **Mistakes:**
   - **Data → Undo** reverses the last import, reset, new month or delete-all.
   - **Data → Reset to last imported file…** returns everything to how it was right after the last import.

## Coming from the Firebase version
In the old portal, go to **Data → Export to Excel**, then import that file here with **Replace all data**. Re-create the user accounts; logins can't be copied between systems. The entries-log history doesn't transfer, but every telecollector's totals do.

## Forgotten passwords
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
| "The Supabase database is not set up for v7 yet" | Run `database/supabase-setup.sql` again (Step 3). |
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

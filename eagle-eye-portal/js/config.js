/* =====================================================================
   CONFIGURATION — the only file you normally need to edit.
   ---------------------------------------------------------------------
   Where the data is stored:
     · LOCAL    - this browser on this PC only. No internet database needed.
     · SUPABASE - online, shared by every PC (step-by-step: docs/SUPABASE-SETUP.md).
   ===================================================================== */
const STORAGE_MODE = 'auto';       // 'auto' = Supabase when the two values below are filled in, otherwise Local
                                   // 'local' = always Local (Supabase values are ignored) · 'supabase' = always Supabase
const SUPABASE_URL = '';           // e.g. 'https://abcdefghijkl.supabase.co'   (Project Settings -> Data API -> Project URL)
const SUPABASE_ANON_KEY = '';      // the "anon" / "publishable" key (safe to share; never the service_role / secret key)
const SUPABASE_EMAIL_DOMAIN = '';  // normally leave empty. Only if Supabase says "Email address is invalid": just your company domain, e.g. 'yourcompany.com' (no @). Set it before creating users.

/* Local mode only: logins created automatically the first time the portal opens in a browser.
   They are never re-created once deleted. Change the passwords later with "Password" or Users → Reset PW. */
const LOCAL_STARTER_ACCOUNTS = [
    { username: 'admin', password: 'ad1100', role: 'Admin', displayName: 'ADMIN' },
    { username: 'management', password: 'mt1100', role: 'Management', displayName: 'MANAGEMENT' },
    { username: 'analyst', password: 'ac1100', role: 'Analyst', displayName: 'ANALYST' }
];

/* ---------- General ---------- */
const APP_VERSION = 'v9';                                    // "Performance Portal v9", shown to Admin only
const MIN_PASSWORD_LENGTH = 6;                               // minimum length for new passwords (8+ is safer)
const USERNAME_EMAIL_DOMAIN = 'eagleeye-portal.example.com';  // usernames are stored as username@this-domain (no e-mails are sent)
const INACTIVITY_LIMIT = 10 * 60 * 1000;                     // auto-logout after 10 minutes idle
const CLOUD_ENTRY_LIMIT = 500;                               // the Entries Log shows the latest N entries

/* Excel import security limits */
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
const IMPORT_MAX_SHEETS = 50;
const IMPORT_MAX_ROWS = 5000;

/* Third-party libraries (exact versions pinned; each loads only when needed) */
const LIB = {
    supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
    chartjs: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
};

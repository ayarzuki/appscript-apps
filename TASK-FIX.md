# TASK-FIX — Webapp login: email tidak terbaca (kosong) + layar kegagalan yang jelas

Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`
Read first: this file, then `src/Auth.gs`, `src/Scripts.html` (initApp / showNotRegisteredScreen / api() switch),
`src/Views.html` (tpl-not-registered, tpl-db-not-ready), `src/appsscript.json`.
**Do NOT touch:** `TASK.md`, `README.md`, `verify.js`, `.clasp.json`, the design doc. The operator pushes with clasp — do NOT run clasp/git.

## Verified evidence (root cause)

The deployed web app shows "Akses Ditolak — Akun Google Anda **(akun Anda)** belum terdaftar …"
for a VALID, seeded owner email. `showNotRegisteredScreen(email)` renders `email || 'akun Anda'` —
so the server returned an **empty email**: `Session.getActiveUser().getEmail()` returned `''` in the
deployed web app. Root cause: `appsscript.json` declares **explicit** oauthScopes without
`https://www.googleapis.com/auth/userinfo.email`; Google requires that scope for
`Session.getActiveUser().getEmail()` — with explicit scopes and this missing it returns an empty string.

Secondary problem: every failure mode (DB not set up, empty email, inactive user, thrown error) collapses
into the same misleading "belum terdaftar" screen.

## Fix 1 — `src/appsscript.json` (manifest)

oauthScopes becomes EXACTLY (order as shown):
```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email"
]
```
Everything else in the manifest stays as-is.

## Fix 2 — `src/Auth.gs`: stateful bootstrap + diagnostics

`getAppBootstrap()` must NEVER throw and now returns a `state` field, evaluated in this order:

1. `dbId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID)`; `dbReady = Boolean(dbId)`.
   If NOT dbReady → `state: 'db-not-ready'` (include detected email, which may be `''`).
2. `email = String(Session.getActiveUser().getEmail() || '').trim()`.
   If `email === ''` → `state: 'email-unavailable'`.
3. Users lookup with normalized comparison (add helper `normalizeEmail_(v)` → `String(v == null ? '' : v).trim().toLowerCase()`):
   `normalizeEmail_(u.email) === email.toLowerCase()`, active when `is_active === true || 'TRUE' || 'true' || 1`.
   - found + active → `state: 'ok'` (user/nav exactly as now).
   - found + inactive → `state: 'inactive'`.
   - not found → `state: 'not-registered'`.
4. any exception → `state: 'error'`, include `errorMessage: err.message`.

Every return includes: `state`, `email` (detected, may be `''`), `notRegistered` (= `state !== 'ok'`, legacy compat),
`dbReady`, `title`, `version`. `user`/`nav` only on `'ok'`. `errorMessage` only on `'error'`.

Also add client-callable `diagnoseLogin()` (no role required; must never throw; every part in try/catch):
```js
{ activeUser, effectiveUser, dbReady, dbIdTail, usersCount, matchedEmail, matchedActive, verdict, errorMessage }
```
- `dbIdTail` = last 6 chars of the DB spreadsheet id (or null).
- `usersCount` = number of rows in `users` (0 when no DB / on failure).
- `matchedEmail` / `matchedActive` = whether the session email exists / is active in `users`.
- `verdict` = short Indonesian sentence, e.g. `'Siap digunakan.'` / `'Database belum disiapkan (jalankan setupDatabase).'` /
  `'Email tidak terbaca dari sesi Google.'` / `'Email <x> belum terdaftar.'` / `'Akun <x> non-aktif.'`

Keep `getCurrentUser_`, `requireRole_`, `canAccess_` behavior (may use `normalizeEmail_`).

## Fix 3 — `src/Scripts.html`: screen routing + diagnostics UI

- `api()` switch: ADD `case 'diagnoseLogin': google.script.run.withSuccessHandler(s).withFailureHandler(f).diagnoseLogin(); break;`
  (the verifier cross-checks every `api('...')` call site against the switch + server definitions).
- `initApp()`: replace the `if (!b || b.notRegistered) …` early-return with state routing:
  - `!b` → showAccessIssue fallback ('Terjadi Kesalahan').
  - `'ok'` → existing flow unchanged.
  - `'db-not-ready'` → `showDbNotReadyScreen(b)`.
  - `'email-unavailable' | 'inactive' | 'not-registered' | 'error'` → `showAccessIssue(b)`.
  - legacy object with `notRegistered` but no `state` → treat as `'not-registered'`.
- Keep `showNotRegisteredScreen(email)` as a thin wrapper calling the new flow; email display: `email || 'tidak terdeteksi'`.
- New helper `renderIssue(tplId, {title, message, hint, email})` — clones template, fills
  `#issue-title`, `#issue-message`, `#issue-hint`, `#issue-email`, and wires `#btn-issue-diag`:
  on click calls `api('diagnoseLogin')` and writes `JSON.stringify(res, null, 2)` into `#issue-diag` (textContent).
- `showDbNotReadyScreen(b)` — clones `tpl-db-not-ready`, fills `#dbnr-email` (`b.email || 'tidak terdeteksi'`),
  wires `#btn-dbnr-diag` → `#dbnr-diag` same as above.
- Copy (Bahasa Indonesia, exact):
  - not-registered → title `'Akses Ditolak'`, message `'Akun Google Anda (' + email + ') belum terdaftar di Sistem Administrasi Akademik Sparks Math.'`, hint `'Silakan hubungi tim HQ untuk mendaftarkan email Anda.'`
  - email-unavailable → title `'Email Tidak Terbaca'`, message `'Sistem tidak dapat membaca email akun Google Anda (kosong).'`, hint `'Pastikan Anda login dengan akun @seven-retail.com — gunakan hanya satu akun Google di browser ini — lalu muat ulang halaman. Bila masih gagal, jalankan Diagnostik dan kirimkan hasilnya ke tim IT.'`
  - inactive → title `'Akun Non-Aktif'`, message `'Akun ' + email + ' terdaftar tetapi berstatus non-aktif.'`, hint `'Hubungi tim HQ untuk mengaktifkan kembali.'`
  - error → title `'Terjadi Kesalahan'`, message `'Sistem gagal memuat profil: ' + errorMessage`, hint `'Jalankan Diagnostik dan kirimkan hasilnya ke tim IT.'`

## Fix 4 — `src/Views.html`

- Replace `tpl-not-registered` with a generic `tpl-access-issue` (remove the old template; ensure no leftover
  references): ids `#issue-icon`, `#issue-title`, `#issue-message`, `#issue-hint`, `#issue-email`,
  `#btn-issue-diag` (button text `'Tampilkan Diagnostik'`), `#issue-diag` (`<pre>` styled, hidden/empty initially).
- Extend `tpl-db-not-ready`: keep existing look; add email line `#dbnr-email` (`'Email terdeteksi: …'`),
  numbered steps: `1) Buka editor Apps Script 2) Jalankan fungsi setupDatabase() 3) Jalankan seedMasterData()`,
  plus `#btn-dbnr-diag` + `#dbnr-diag` (same diagnostic pattern).

## Fix 5 — NEW `login-sim.js` at project root (the retest harness)

Node (>=18, no dependencies). Load `src/Config.gs` + `src/Db.gs` + `src/Auth.gs` (concatenate in that order)
into a `vm` context with mocked Apps Script globals:

- `PropertiesService.getScriptProperties()` → in-memory `{ getProperty, setProperty }`
- `SpreadsheetApp.openById(id)` → if `!id` throw `Error('Cannot open spreadsheet with id: null')`; else return
  `{ getSheetByName(name) | null, insertSheet(name) }`; sheet = `{ getLastRow(), getLastColumn(),
  getRange(r,c,nr,nc).getValues(), appendRow(arr), setFrozenRows(n) }` backed by a 2-D array (header row + data rows)
- `CacheService.getScriptCache()` → `{ get, put, remove }` no-ops
- `LockService.getScriptLock()` → `{ waitLock, releaseLock }` no-ops
- `Session.getActiveUser()` / `getEffectiveUser()` → `{ getEmail() }` settable per scenario

Scenario table (each: set DB property state, sheet rows, session email → call `ctx.getAppBootstrap()` → assert):

| # | Setup | Expect |
|---|---|---|
| S1 | DB ready; users row: aulya.kustyawan@seven-retail.com, role `SA`, center_codes `BTR`, is_active `true`; session email same | `state==='ok'`, `notRegistered===false`, `user.role==='SA'`, nav only SA screens (`beranda,murid,kelas,penilaian,event,waiting,media`) |
| S2 | same but users sheet empty | `state==='not-registered'`, `email` echoed |
| S3 | user row `is_active: false` | `state==='inactive'` |
| S4 | session email `''` | `state==='email-unavailable'` (never throws) |
| S5 | DB property unset (openById must throw if called) | `state==='db-not-ready'`, no exception thrown by getAppBootstrap |
| S6 | stored email `'AULYA.Kustyawan@Seven-Retail.com '` (case + trailing space), session lowercase | `state==='ok'` |
| S7 | `is_active` stored as string `'TRUE'` | `state==='ok'` |

Also in S1 assert `diagnoseLogin()` returns an object with `matchedEmail===true`, `verdict` a non-empty string.
Print `PASS S1 …` / `FAIL S1 … (<reason>)` per scenario and a final `RESULT: PASS|FAIL (n scenarios)` line.
Exit code 0 only when all pass. No `package.json`, no deps, single file.

## Acceptance (run in the FOREGROUND, paste raw output)

```bash
cd C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math
node login-sim.js     # EXPECTED: RESULT: PASS (7 scenarios), exit 0
node verify.js        # EXPECTED: RESULT: PASS — 0 failure(s), exit 0
```

`verify.js` is READ-ONLY for you — never edit it. If it reports something you believe is wrong, report it instead.

## Report format (end your run with exactly this)

```
STATUS: done | partial
FILES:   <path — what changed, one line each>
HARNESS: <raw tail of node login-sim.js, last 15 lines>
VERIFY:  <raw tail of node verify.js, last 10 lines>
NOTES:   <anything not done + why>
```

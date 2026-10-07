# TASK-FEAT1 — Email-code login (OTP) for external/personal-Gmail accounts + callApi bridge

Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`

**Why:** Apps Script only reveals the visitor's email (`Session.getActiveUser().getEmail()`) for accounts in
the same Workspace domain. Personal Gmail users get an empty email → currently dead-end. Solution: visitors
prove ownership of their email via a 6-digit code sent to their inbox (MailApp), and receive a **session
token** the client stores in `localStorage` and sends with every API call. DB stays private; runs as owner.

Read first: `TASK*.md` files for context of prior work; `src/Auth.gs` (getCurrentUser_ ~line 20, getAppBootstrap
~line 90+, diagnoseLogin), `src/Db.gs` (insert/insertUnlocked_/updateWhere/readCached_/invalidate_/withLock_),
`src/Setup.gs` (TABLE_SCHEMAS format ~line 9), `src/Scripts.html` (api() ~line 59-115, initApp tail, renderIssue,
confirmDialog, nav build ~1515), `src/Views.html` (tpl-access-issue / tpl-db-not-ready for login screen styling
patterns), `login-sim.js` (mock harness, loader lines 16-19), `ui-sim.js` (mock + scenarios).

**`src/Config.gs` already contains (do NOT edit Config.gs):** `AUTH_CFG` = { TOKEN_TTL_DAYS: 30,
CODE_TTL_MINUTES: 10, CODE_MAX_ATTEMPTS: 5, CODE_RESEND_SECONDS: 60, CODE_MAX_PER_HOUR: 3 } — use these.

**Allowed to edit:** NEW `src/Api.gs`, `src/Auth.gs`, `src/Setup.gs`, `src/Scripts.html`, `src/Views.html`,
`src/Styles.html`, `src/appsscript.json`, `login-sim.js`, `ui-sim.js`.
**Do NOT touch:** `src/Config.gs`, `src/Db.gs` (helpers exist), `src/Index.html`, other `.gs`, `verify.js`,
`admin-sim.js` (must stay green UNTOUCHED — see guard in step 2), `README.md`, `.clasp.json`. No clasp/git.

## 1. `src/Api.gs` (NEW) — dispatcher + token identity + OTP flow

- Identity override globals:
  `let __identityEmail_ = '';`
  `function getIdentityOverride_() { return __identityEmail_; }`
  `function setIdentityOverride_(v) { __identityEmail_ = normalizeEmail_(v || ''); }`
- `const PUBLIC_ROUTES = ['getAppBootstrap', 'requestLoginCode', 'verifyLoginCode', 'logout', 'diagnoseLogin', 'getAppVersionInfo'];`
- `const API_ROUTES = { <all 47 existing client target names>: <same-named function>, requestLoginCode: requestLoginCode, verifyLoginCode: verifyLoginCode, logout: logout };`
  → Keys MUST equal the server function names exactly (verify.js cross-checks; >=45 routes required).
  Existing names (from the old client switch): getAppBootstrap, diagnoseLogin, getAppVersionInfo, getSetupStatus,
  listStudents, getStudent, createStudent, updateStudent, listClasses, getClassDetail, createClass, updateClass,
  listTeachers, placeStudent, closeEnrollment, getMySessions, getSessionRoster, saveSessionEntries,
  listSessionsForClass, getClassAttendanceSummary, saveAssessments, listAssessmentBoard, generateReportPdf,
  listEvents, updateEventStatus, listWaitingList, saveWaitingEntry, setWaitingStatus, getLevelingBoard,
  saveLevelingDecisions, getMediaChecklist, uploadClassMedia, getMediaGuidelines, getDashboardHome,
  getDashboardStats, listUsers, saveUser, toggleUser, listCenters, saveCenter, listProgramsLevels,
  saveProgramLevel, listHolidays, saveHoliday, deleteHoliday, getAuditLog, dryRunMigration — plus the 3 new.
- `function callApi(name, args, token)`:
  - `const route = API_ROUTES[name]; if (!route) throw new Error('Fungsi tidak dikenal: ' + name);`
  - `const list = Array.isArray(args) ? args : [];`
  - sessionEmail = try/catch `normalizeEmail_(Session.getActiveUser().getEmail())`
  - tokenEmail = `resolveToken_(token)`; identity = tokenEmail || sessionEmail;
  - if route NOT in PUBLIC_ROUTES and !identity → `throw new Error('Sesi tidak ditemukan. Silakan masuk terlebih dahulu.');`
  - `setIdentityOverride_(tokenEmail || ''); try { return route.apply(null, list); } finally { setIdentityOverride_(''); }`
- Token helpers:
  - `issueToken_(email)`: token = `Utilities.getUuid().replace(/-/g,'')` twice concatenated (64 hex); expiry = now + AUTH_CFG.TOKEN_TTL_DAYS days; `Db.insert('auth_sessions', { token, email, created_at: toIsoDateTime_(now), expires_at: toIsoDateTime_(expiry), last_seen_at: toIsoDateTime_(now) }, email)`; `Db.invalidate_('auth_sessions')`; return token.
  - `resolveToken_(token)`: blank → ''; read `Db.readCached_('auth_sessions')`; match row.token === token, not deleted (check `is_deleted === true || String(r.is_deleted).toLowerCase() === 'true'`), `new Date(row.expires_at).getTime() >= Date.now()`; return normalizeEmail_(row.email) or ''.
- `function requestLoginCode(email)` — PUBLIC; wrapped in `withLock_`:
  - normalize; validate format (simple regex); invalid → `{ ok:false, message:'Alamat email tidak valid.' }`.
  - user must exist & active in `users` → else `{ ok:false, message:'Email ini belum terdaftar di sistem. Hubungi tim HQ untuk didaftarkan.' }` (NO email sent).
  - Rate limits vs `auth_codes` rows for this email (only non-deleted): last row younger than AUTH_CFG.CODE_RESEND_SECONDS → `{ ok:false, message:'Mohon tunggu N detik sebelum minta kode lagi.' }`; count in last 60 min >= AUTH_CFG.CODE_MAX_PER_HOUR → `{ ok:false, message:'Terlalu banyak permintaan kode. Coba lagi nanti.' }`.
  - code = 6 random digits string; insert row `{ email, code, expires_at: now + AUTH_CFG.CODE_TTL_MINUTES, attempts: 0, created_at: now }` (unlocked insert while holding lock, `'system'` as user); invalidate cache.
  - Send via `MailApp.sendEmail({ to: em, subject: '[SIS Sparks Math] Kode masuk Anda', name: APP_TITLE, body: <Indonesian text with the code, validity minutes, "abaikan jika bukan Anda"> })`.
  - return `{ ok:true, message:'Kode telah dikirim ke ' + em + '. Berlaku N menit.' }`.
- `function verifyLoginCode(email, code)` — PUBLIC; in `withLock_`:
  - find latest matching code row (same email, not deleted). None/expired → `{ ok:false, message:'Kode tidak ditemukan atau kedaluwarsa. Minta kode baru.' }`.
  - attempts >= AUTH_CFG.CODE_MAX_ATTEMPTS → mark deleted → `{ ok:false, message:'Kode diblokir karena salah terlalu banyak. Minta kode baru.' }`.
  - mismatch → attempts+1 (updateWhere) → `{ ok:false, message:'Kode salah. Sisa percobaan: N.' }`.
  - match → mark row deleted; re-check user active; issue `issueToken_(email)`; return `{ ok:true, token, email, message:'Berhasil masuk.' }`.
- `function logout(token)` — PUBLIC, silent (never throws): if token → softDelete matching auth_sessions row (updateWhere) + invalidate; return `{ ok:true }`.
- All reads/writes use Db with literal table names `'auth_sessions'` / `'auth_codes'` (Db.sheet_ self-heals from TABLE_SCHEMAS).

## 2. `src/Auth.gs` changes

- `getCurrentUser_()`: resolve email as override-first WITH GUARD (admin-sim loads Auth.gs without Api.gs):
  ```js
  const override = (typeof getIdentityOverride_ === 'function') ? getIdentityOverride_() : '';
  email = normalizeEmail_(override || Session.getActiveUser().getEmail());
  ```
  (keep try/catch and existing error messages).
- `getAppBootstrap(token)`: new optional param.
  - tokenEmail = `(typeof resolveToken_ === 'function') ? resolveToken_(token) : ''` (same guard, wrapped try/catch).
  - email = tokenEmail || sessionEmail. **If email === '' → return `{ state:'login-required', title, version }`** (replaces the old 'email-unavailable' return; keep `db-not-ready` logic BEFORE this unchanged).
  - not-registered / inactive branches: unchanged behavior.
  - SUCCESS branch: include `token` in the payload — reuse the provided token if it resolved successfully, else `issueToken_(email)` fresh. Keep payload fields (nav, user, centers, roles, version...) intact. NEVER throws.
- `diagnoseLogin()`: optionally append `authMode: 'token' | 'session' | 'none'` — small, keep contract.

## 3. `src/Setup.gs` — TABLE_SCHEMAS additions (follow existing format):
- `auth_sessions`: `['token','email','created_at','expires_at','last_seen_at','is_deleted','updated_at','updated_by']`
- `auth_codes`: `['email','code','expires_at','attempts','created_at','is_deleted','updated_at','updated_by']`

## 4. `src/appsscript.json`
- `webapp.access`: `"DOMAIN"` → `"ANYONE"` (login via kode; live deployment access diubah manual oleh owner di UI).
- oauthScopes: add `"https://www.googleapis.com/auth/script.send_mail"`.

## 5. `src/Scripts.html` — client

- Token helpers (top-level, before api()): key constant `sis_sparks_token`;
  `getAuthToken_()`, `setAuthToken_(t)`, `clearAuthToken_()` wrapping localStorage in try/catch.
- **Rewrite `api(name, ...args)` to a SINGLE bridge** (delete the entire 47-case switch):
  ```js
  function api(name, ...args) {
    setLoading(true);
    return new Promise((resolve, reject) => {
      const s = (res) => { setLoading(false); resolve(res); };
      const f = (err) => { setLoading(false); const m = err && err.message ? err.message : String(err); showToast(m, 'error'); reject(new Error(m)); };
      try { google.script.run.withSuccessHandler(s).withFailureHandler(f).callApi(name, args, getAuthToken_()); }
      catch (e) { f(e); }
    });
  }
  ```
  (verify.js demands exactly ONE `google.script.run.withSuccessHandler` occurrence in the file — update the old comment above api() so it doesn't need to say "switch".)
- `reloadApp_()` helper: `function reloadApp_() { window.location.reload(); }` — use it for post-login & logout reloads (harness overrides it).
- initApp bootstrap handling:
  - `b.state === 'login-required'` (and legacy `'email-unavailable'`) → `clearAuthToken_(); renderLoginScreen(b); return;`
  - `b.state === 'ok'` → `if (b.token) setAuthToken_(b.token);` then existing flow; also remove any leftover `.login-screen` element.
- `renderLoginScreen()` — mirror renderIssue() mechanics (hide #app-layout, hide splash, setLoading(false), append clone of `tpl-login-otp`). Wire:
  - `#btn-send-code` (disable during call): email = trim+lowercase; basic validation; `api('requestLoginCode', email)` → ok: reveal `#login-code-wrap`, message, start 60s resend countdown (`#btn-resend-code` disabled, label `Kirim ulang (Ns)`), keep email in a local var; !ok: show `res.message` in `#login-message`.
  - `#btn-verify-code`: `api('verifyLoginCode', email, code)` → ok: `setAuthToken_(res.token); reloadApp_();` !ok: show `res.message`.
  - `#btn-resend-code`: same as send (server enforces 60s guard).
  - Enter key in inputs triggers the respective action.
- Logout button (JS-injected, no Index.html edits): after nav build in initApp, append `<button id="btn-logout" class="logout-link">Keluar</button>` to `.sidebar-footer` (guard against duplicates); click → `confirmDialog('Keluar dari sistem?', 'Anda perlu login kembali untuk mengakses sistem.', () => { api('logout', getAuthToken_()).catch(() => {}).then(() => { clearAuthToken_(); reloadApp_(); }); });`
- Login screen text (Indonesian) incl. hint: "Akun @seven-retail.com bisa langsung masuk tanpa kode."

## 6. `src/Views.html` — `tpl-login-otp` template (follow tpl-access-issue card styling)
Card with: title "Masuk", subtitle, `#login-email` (type=email), `#btn-send-code` "Kirim Kode",
`#login-code-wrap` (class hidden) containing `#login-code` (inputmode numeric, maxlength 6), `#btn-verify-code` "Masuk",
`#btn-resend-code` "Kirim ulang" (disabled), `#login-message`, small note. `src/Styles.html`: minimal
`.login-screen` / `.login-card` / `.login-message` / `.logout-link` styles using existing CSS vars.

## 7. Harness updates (must all pass)

### login-sim.js
- Loader: add Api.gs (`[configCode, dbCode, authCode, apiCode].join('\n;\n')`).
- Extend mocks: MailApp.sendEmail capture (store `{to, subject, body}`; expose last email per scenario);
  generic sheet writes must support the new tables (seed auth_sessions/auth_codes rows as needed).
- Update S1-S7 for the new bootstrap contract: the old `email-unavailable` expectation becomes
  `login-required`; domain-user scenarios now also get a `token` field (assert present).
- NEW scenarios:
  - S8 valid token: empty Session email (external user), seed `auth_sessions` row with token 'tokA' for an
    active HQ user → `callApi('listUsers', [], 'tokA')` returns the user list (identity from token, not Session).
  - S9 invalid token: `callApi('listUsers', [], 'nope')` with empty Session → throws (catch + assert it failed).
  - S10 OTP flow: seed active TEACHER user `guru@gmail.com`; `requestLoginCode('guru@gmail.com')` → ok:true + email captured
    (extract the 6-digit code from the captured body); `verifyLoginCode('guru@gmail.com','000000')` → ok:false (wrong);
    `verifyLoginCode('guru@gmail.com', <real code>)` → ok:true + token; then `callApi('getMySessions', ['today'], token)` works.
    Also: `requestLoginCode('asing@x.com')` (unregistered) → ok:false AND no email sent.
  - S11 rate limit: immediate second `requestLoginCode('guru@gmail.com')` → ok:false ("tunggu").
  - Summary: `RESULT: PASS (11 scenarios)`.
- TEETH (must show raw output): in a scratch copy (`$TMPDIR/feat1neg`), break `resolveToken_` to skip the
  row lookup (accept any token) → `node login-sim.js` MUST fail S9. Restore, then run in the repo.

### ui-sim.js
- Mock now exposes `callApi(name, args, token)` routing to fixtures by name; maintain an in-memory sessions map:
  `{}` initially. `getAppBootstrap`: if token param resolvable in sessions → ok payload; else → `{state:'login-required', ...}`.
  `requestLoginCode` → `{ok:true,...}`; `verifyLoginCode` → `{ok:true, token:'tokNew', email}` and register 'tokNew'.
- EXISTING scenarios: preseed `window.localStorage.setItem('sis_sparks_token','t1')` + sessions map {'t1': user} so
  the app loads directly (keeps 11 HQ clicks + 8 admin steps + 4 TEACHER clicks + sidebar toggle green).
- NEW scenario "OTP login (external)": fresh window, NO token → login screen visible; fill `#login-email`, click
  `#btn-send-code` → `#login-code-wrap` visible; fill `#login-code` '123456', click `#btn-verify-code` →
  assert `localStorage['sis_sparks_token'] === 'tokNew'`; BEFORE the click override
  `window.reloadApp_ = () => { window.__reloads = (window.__reloads||0)+1; window.dispatchEvent(new window.Event('DOMContentLoaded')); };`
  → assert `__reloads === 1` and after the re-init the nav is rendered (app loaded) & login screen removed.
- Update summary line (add "+ OTP login flow").

### Acceptance (run in foreground; paste tails)
```bash
node login-sim.js   # RESULT: PASS (11 scenarios)  (+ teeth output)
node ui-sim.js      # RESULT: PASS (… + OTP login flow)
node admin-sim.js   # RESULT: PASS (5 scenarios)   [untouched]
node verify.js      # RESULT: PASS — 0 failure(s)  [read-only for you]
```

## Report format (end exactly like this)

```
STATUS: done | partial
FILES:  <path — what changed, one line each>
TEETH:  <raw 2-4 lines: scratch without token validation fails login-sim S9>
LOGIN:  <tail, last 4 lines>
UI-SIM: <tail, last 4 lines>
ADMIN:  <tail, last 2 lines>
VERIFY: <tail, last 5 lines>
NOTES:  <anything skipped + why>
```

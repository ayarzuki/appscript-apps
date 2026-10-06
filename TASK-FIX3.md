# TASK-FIX3 — Admin CRUD UI (register Teacher/user, centers, programs, holidays) + 2 data-correctness bugs

Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`

Read first: this file; then `src/Scripts.html` (routing ~142-160, loadAdminTab ~903-925, renderAdmin ~889,
existing modal patterns openStudentModal/openClassModal + submit handlers ~226-300, api() switch ~62-108),
`src/Views.html` (tpl-admin ~711, tpl-modal-student-form ~735 onward as the pattern), `src/Auth.gs`
(getAppBootstrap ~90-190), `src/Admin.gs` (whole), `src/Db.gs` (update ~231-274, softDelete ~284+),
`src/Classes.gs` (listTeachers ~414-430), `ui-sim.js`, `login-sim.js` (mock pattern reference).

**Allowed to edit:** `src/Scripts.html`, `src/Views.html`, `src/Auth.gs`, `src/Db.gs`, `src/Admin.gs`,
`src/Styles.html` (minor checkbox-group styling only), `ui-sim.js`, NEW `admin-sim.js`.
**Do NOT touch:** `src/Config.gs`, `src/appsscript.json`, `verify.js`, `login-sim.js`, `TASK*.md`, `README.md`,
`.clasp.json`. Do NOT run clasp/git.

## Problem (user-reported + verified evidence)

User: role pilihan "Teacher" ada tapi TIDAK ADA cara membuat/registrasi Teacher.
Verified: ALL Admin tabs are read-only — no UI anywhere calls `api('saveUser')`, `api('toggleUser')`,
`api('saveCenter')`, `api('saveHoliday')`, `api('saveProgramLevel')`, `api('deleteHoliday')`, although every
server function AND dispatcher case already exists (Scripts.html lines 97-107). `listTeachers()` (Classes.gs)
is already used by the class-form teacher dropdown — it's empty solely because no TEACHER users can be created.
Two data bugs found while auditing: (1) `saveProgramLevel` update path calls `Db.update('programs_levels','program',…`
— `Db.update` matches the FIRST row only, so editing level 2 of program "Math" corrupts level 1. (2) `deleteHoliday`
soft-deletes by date only → when two centers share the same holiday date, the wrong row can be deleted.

## Part A — Admin CRUD UI (the main fix)

Follow the EXACT markup/idiom of existing student/class modals (openModal → tpl content clone → fill →
`#btn-submit-*` click handler reads form values → `api(...)` → toast → closeModal → refresh). All new text in
Indonesian, consistent with existing copy style.

### A1. Users tab (register Teacher HERE — the reported gap)
- In `loadAdminTab('users')`: render a toolbar above the table:
  `<button id="btn-add-user" class="btn btn-primary btn-sm">+ Tambah Pengguna</button>` (mirror the
  "+ Tambah Murid" button classes used in tpl-murid).
- Table: keep existing columns, ADD a final `<th>Aksi</th>` column. Per row:
  `<button class="btn btn-secondary btn-sm btn-edit-user" data-email="…">Edit</button>` +
  `<button class="btn btn-secondary btn-sm btn-toggle-user" data-email="…" data-active="true|false">Nonaktifkan|Aktifkan</button>`.
  Toggle label: active → "Nonaktifkan", inactive → "Aktifkan".
- NEW template `tpl-modal-user-form` in Views.html (structure mirrors tpl-modal-student-form):
  - `#user-modal-title` ("Tambah Pengguna Baru" / "Edit Pengguna")
  - `<input type="email" name="email" required>` — DISABLED in edit mode (email is the key)
  - `<input type="text" name="full_name" required>`
  - `<select name="role" required>` — options built at open time from `state.roles` (roles: HQ, CM, SA, TEACHER, LEAD_TEACHER). Default on add: TEACHER.
  - Center checkboxes: `<div id="user-centers" class="checkbox-group"></div>` — one checkbox per `state.centers`
    entry (`value=center_code`, label `center_name (center_code)`), plus hint text
    "Kosongkan = akses semua cabang".
  - `<input type="checkbox" name="is_active" checked>` "Aktif".
  - `#btn-submit-user` button.
- Submit: build payload `{ email, full_name, role, center_codes: <checked codes joined ','>, is_active }`
  → `await api('saveUser', payload)` → toast sukses → closeModal → `loadAdminTab('users')`.
- Edit: prefill all fields from the row (checkboxes checked per `center_codes` split(',')); email input disabled.",
  Still send email in the payload.
- Toggle: `confirmDialog('Ubah status pengguna?', email, () => api('toggleUser', email, !active) → reload)`. Note
  confirmDialog's callback is sync — chain with .then inside.
- Copy the existing toast helper usage and error handling idiom (try/catch → toast error).

### A2. Centers tab
- Toolbar: `#btn-add-center` "+ Tambah Cabang". Table: add Aksi column with Edit (`btn-edit-center`,
  data-code=center_code).
- NEW `tpl-modal-center-form`: `center_code` (required; in edit mode disabled; JS uppercases), `center_no`
  (default '01'), `center_name` (required), `is_active` checkbox. Submit → `api('saveCenter', payload)`
  → after success also update client cache: replace/add the entry in `state.centers` (so dependent dropdowns
  see it immediately) → reload tab.

### A3. Programs & Levels tab
- Toolbar: `#btn-add-program` "+ Tambah Program/Level". Table: add Aksi column with Edit (`btn-edit-program`
  data-program + data-level).
- NEW `tpl-modal-program-form`: `program` (required), `level` (required), `level_order` (number, required),
  `next_small_level`, `next_big_level` (text). **In edit mode: program + level DISABLED** (they are the key);
  level_order + nudges editable. Submit → `api('saveProgramLevel', payload)` → reload.

### A4. Holidays tab
- Toolbar: `#btn-add-holiday` "+ Tambah Hari Libur". Table: add Aksi column with Hapus (`btn-del-holiday`,
  data-date + data-center).
- NEW `tpl-modal-holiday-form`: `date` (input type=date, required), `center_code` select
  ("Semua Cabang" value='' + state.centers), `description` (required). Submit → `api('saveHoliday', payload)` → reload.
- Hapus: `confirmDialog(...)` → `api('deleteHoliday', date, center_code)` → reload.

### A5. Bootstrap roles
- `src/Auth.gs` `getAppBootstrap()`: add `roles: ROLES.slice()` to the SUCCESS payload (the state:'ok' return
  that carries nav/user/centers — read it and extend; do NOT add to the issue payloads).
- `src/Scripts.html` initApp: store `state.roles = (b.roles && b.roles.length) ? b.roles : ['HQ','CM','SA','TEACHER','LEAD_TEACHER']`.

## Part B — Data-correctness fixes (server)

### B1. Composite-row update/delete helpers in `src/Db.gs`
Add `updateWhere(table, predicate, patch, userEmail)` and `softDeleteWhere(table, predicate, userEmail)` that
mirror `update()` / `softDelete()` mechanics EXACTLY (same sheet read/write, `updated_at/updated_by`,
`auditUnlocked_` before/after logging, same lock usage) but match the row by `predicate(rowObject) === true`
(first match). Do not change existing `update()` / `softDelete()` behavior (other callers depend on them).

### B2. `saveProgramLevel` (Admin.gs)
Update path must use `Db.updateWhere('programs_levels', pl => pl.program === form.program && pl.level === form.level, {...})`
so ONLY the exact (program AND level) row updates. findOne/existing check stays.

### B3. `deleteHoliday` (Admin.gs)
Replace the two-step findOne + `softDelete('holidays','date',...)` with
`Db.softDeleteWhere('holidays', h => toIsoDate_(h.date) === dateIso && (h.center_code || '') === targetCenter, user.email)`
so the EXACT (date + center) row is deleted. Keep the not-found error behavior.

## Part C — Tests (all must run in FOREGROUND; paste raw tails in the report)

### C1. Extend `ui-sim.js` (client, jsdom — keep existing HQ nav clicks working)
Add to the HQ scenario (bootstrap fixture: add `roles` + sample centers `[{center_code:'BTR',center_name:'Bintaro'},{center_code:'KLM',center_name:'Kalimalang'}]`;
make the mock `listUsers`/`listCenters`/`listHolidays`/`listProgramsLevels` STATEFUL so saved rows appear on reload):
1. click 'admin' nav → users table rendered.
2. click `#btn-add-user` → modal visible (`#modal-root` not hidden, contains `input[name=email]`).
3. fill: email `teacher1@seven-retail.com`, full_name `Teacher One`, role select `TEACHER`, check center `BTR`;
   click `#btn-submit-user`.
4. assert recorded `saveUser` payload: `role === 'TEACHER'`, `center_codes === 'BTR'`, email lowercased;
   assert table now shows `teacher1@seven-retail.com` (auto-reload with stateful mock).
5. click that row's `btn-toggle-user` → confirmDialog → click `#btn-confirm-ok` → assert `toggleUser` called
   with `(email, false)`.
6. centers tab: add center flow → assert `saveCenter` payload captured.
7. holidays tab: add → assert `saveHoliday` captured; delete a seeded row → assert `deleteHoliday` with (date, center).
8. programs tab: add → assert `saveProgramLevel` captured.
Add a NEW scenario: bootstrap role TEACHER (nav `['beranda','sesi','penilaian','media']`) → nav renders exactly
those 4 links; click each → `#content` non-empty; assert no `#/admin` link exists.
Keep the final summary line format `RESULT: PASS (...)` / `RESULT: FAIL (...)` and exit codes 0/1.

### C2. NEW `admin-sim.js` (server data harness; replicate login-sim.js mock approach — read its mock of
SpreadsheetApp/Properties/LockService/CacheService and rebuild locally, plus `setValues`, `audit_log` sheet)
Load Config.gs + Db.gs + Admin.gs + Classes.gs into a `vm` context. Scenarios:
- S1 `saveUser` create (role TEACHER, center_codes 'BTR') → users row appended with correct fields + is_active true.
- S2 `saveUser` update (same email, change role→LEAD_TEACHER + full_name) → SAME row updated in place, no new row.
- S3 `saveProgramLevel` composite fix: seed Math levels 1/2/3 (level_order 1/2/3); edit level 2 → assert level 2
  changed AND levels 1 & 3 rows byte-identical (this test MUST fail against the old code path — verify by temporarily
  reverting in a scratch copy if you want, then restore).
- S4 `deleteHoliday` composite fix: seed 2026-12-25 BTR + 2026-12-25 KLM; delete (2026-12-25, KLM) → KLM
  is_deleted=true, BTR row untouched.
- S5 `listTeachers('BTR')` with users: tA center_codes='' (all), tB 'BTR', tC 'KLM' inactive, lT 'BTR' LEAD_TEACHER
  → returns tA, tB, lT; excludes tC (inactive) and excludes KLM-only teacher.
Summary line `RESULT: PASS (5 scenarios)` / FAIL + exit codes.

### C3. Keep green
```bash
node admin-sim.js    # RESULT: PASS (5 scenarios)
node ui-sim.js       # RESULT: PASS
node login-sim.js    # RESULT: PASS (7 scenarios)  [unchanged]
node verify.js       # RESULT: PASS — 0 failure(s)  [read-only for you]
```

## Report format (end your run with exactly this)

```
STATUS: done | partial
FILES:   <path — what changed, one line each>
ADMIN-SIM: <tail, last 4 lines>
UI-SIM:  <tail, last 4 lines>
LOGIN:   <tail, last 2 lines>
VERIFY:  <tail, last 4 lines>
NOTES:   <anything skipped + why>
```

# TASK — Build the complete Google Apps Script project "SIS Sparks Math" (new academic admin system)

Greenfield build. The design document `sistem-administrasi-akademik-sparks-math.md` in this same
directory is the **authoritative specification** — READ IT FULLY FIRST (601 lines). This TASK.md
adds the precise implementation contract you must follow. Read both before writing code.

- Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`
- The remote Apps Script project already exists; the operator pushes `src/` later with clasp.
  **You must NOT run clasp, git, npm, or any deploy command.**
- Every file you create goes **under `src/` only**. Do not modify the `.md` doc, `.clasp.json`,
  or anything else outside `src/`. Create **no other files anywhere** in the repo.
- Runtime: V8 (ES2020 fine), Timezone `Asia/Jakarta`. **No external libraries, no CDNs, no npm.**
- All user-facing strings in **Bahasa Indonesia**. Code comments in English or Indonesian.
- Write each file **complete** — no placeholders, no "rest of implementation here".

## Deliverable: exactly these 21 files under `src/`

### 1. `appsscript.json` — EXACT content (do not deviate):
```json
{
  "timeZone": "Asia/Jakarta",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "DOMAIN"
  }
}
```

### 2. `Code.gs`
- `doGet()` → `HtmlService.createTemplateFromFile('Index').evaluate().setTitle('Sistem Administrasi Akademik Sparks Math').addMetaTag('viewport','width=device-width, initial-scale=1')`.
- `include(name)` → `HtmlService.createHtmlOutputFromFile(name).getContent()`.
- `getAppVersionInfo()` client-callable → `{title, version}` (used by the UI footer).

### 3. `Config.gs` — single source of configuration (const objects at top)
- `APP_TITLE = 'Sistem Administrasi Akademik Sparks Math'`, `APP_VERSION = '0.1.0'`.
- Script-property keys: `DB_SPREADSHEET_ID`, `TX_DB_SPREADSHEET_ID_<AY>`, `MEDIA_ROOT_FOLDER_ID`,
  `REPORTS_FOLDER_ID`, `TEMPLATE_DOC_ID`, `TX_DB_AY` (current academic-year label, e.g. `2026-2027`).
  Helper `getProp_(key)` → PropertiesService script property.
- Table-name constants + `TX_TABLES = ['attendance','daily_notes']` (transaction tables live in the
  per-academic-year spreadsheet; fallback to main DB when the year property is unset, with a warning).
- `ROLES = ['HQ','CM','SA','TEACHER','LEAD_TEACHER']`.
- `NAV_BY_ROLE` (screen id → label), use exactly these ids/labels:
  `beranda:'Beranda'`, `murid:'Murid'`, `kelas:'Kelas'`, `sesi:'Sesi & Absensi'`,
  `penilaian:'Assessment & Laporan'`, `event:'Event Tracker'`, `waiting:'Waiting List'`,
  `leveling:'Leveling'`, `media:'Media'`, `dashboard:'Dashboard'`, `admin:'Admin'`.
  - HQ: beranda, murid, kelas, penilaian, event, waiting, leveling, media, dashboard, admin
  - CM: beranda, murid, kelas, penilaian, event, leveling, dashboard
  - SA: beranda, murid, kelas, penilaian, event, waiting, media
  - TEACHER: beranda, sesi, penilaian, media
  - LEAD_TEACHER: beranda, sesi, penilaian, leveling, media, dashboard
- Status enums (from doc §2): student `['Postponed','Active','Non-Active','Cancel (DP Only)']`;
  class `['Draft','Active','Completed']`; attendance `['Present','Absent','Excused']`.
- `ASSESSMENT_TYPES = ['MIDTERM_1','FINAL_TERM_1','MIDTERM_2','FINAL_TERM_2']`;
  `GRADES = ['A+','A','B','C','D']`; `GRADE_RANK = {'D':1,'C':2,'B':3,'A':4,'A+':5}`.
- `EVENT_TYPES = ['PROGRESS_REPORT','PTM','CLASS_MEDIA','TERMLY_REPORT']`; event status `['Open','Done']`.
- `LEAVE_REASONS = ['Level Up','Looping','Pindah Kelas','Berhenti','Postponed']`.
- `DECISION_TYPES = ['LOOPING','SMALL','BIG']`;
  `WAITING_STATUS = ['Waiting','Contacted','Offered','Enrolled','Cancelled']`.
- `MILESTONE_BY_SESSION = {10:'UPLOAD_MEDIA',13:'MIDTERM_1',20:'UPLOAD_MEDIA',24:'FINAL_TERM_1',30:'UPLOAD_MEDIA',37:'MIDTERM_2',40:'UPLOAD_MEDIA',48:'FINAL_TERM_2'}`.
- `EVENT_RULES` — events auto-created with the class (due = planned date of that session):
  - CLASS_MEDIA at sessions [10,20,30,40,48]
  - PTM at sessions [13,24,37]
  - TERMLY_REPORT at sessions [24,48]
  - PROGRESS_REPORT for months [1,2,4,5] → due = class `start_date` + N months (label `Progress Report Bulan N`). (Assumption — should be configurable; add comment.)
- Leveling: `LEVELING = { minAttendanceSmall:70, minAttendanceBig:75, joinSessionLooping:45 }`.
- `ACADEMIC_YEAR_START_MONTH = 7` + `academicYearLabel_(dateOrIso)` helper (Jul 2026–Jun 2027 → '2026-2027').
- `CACHE_TTL_SECONDS = 300`, `REF_TABLES = ['users','centers','programs_levels','holidays']`.
- `REPORT_PLACEHOLDERS = ['{{student_name}}','{{nickname}}','{{class_name}}','{{program}}','{{level}}','{{teacher_name}}','{{term}}','{{attendance_rate}}','{{sessions_present}}','{{sessions_total}}','{{grades_summary}}','{{achievement_notes}}','{{improvement_notes}}','{{center_name}}','{{report_date}}','{{sa_name}}']`.
- `MEDIA_GUIDELINES` — string with 5 do / 5 don't bullets (generic, marked `TODO: replace with SIS lama content`).
- ID formats: student = center_code + 4-digit seq (BTR0001); class = `C{center_no 2-digit}-{yy}{seq 3-digit}` e.g. `C01-25089` (**assumption from doc §12 Q1 — keep generation isolated in one helper with a comment**); enrollment `ENR-000123` (6 digits); session = `<class_id>-S<session_no padded 2>` e.g. `C01-25089-S13`.
- Client API surface rule: **client-callable functions have NO trailing underscore; internal helpers END with `_`**.

### 4. `Setup.gs`
- `TABLE_SCHEMAS` — object mapping **every** table name to its header row (exact columns from doc §4;
  EVERY table also gets the standard columns `created_at, created_by, updated_at, updated_by, is_deleted`):
  `students, classes, enrollments, sessions, attendance, daily_notes, assessments, events, waiting_list, leveling, media, users, centers, programs_levels, holidays, audit_log, snapshot_dashboard`.
  - students: student_id, center_code, full_name, nickname, dob, parent_name, parent_phone, language, school, status, intake, actual_join_date, package, credit_class, payment_status, retention_status, last_membership_date (+standard).
  - classes: class_id, center_code, program, level, schedule_day, schedule_time, room, main_teacher_email, sa_email, intake, start_date, end_date, previous_class_id, total_sessions, status (+standard).
  - enrollments: enrollment_id, student_id, class_id, join_date, leave_date, leave_reason (+standard).
  - sessions: session_id, class_id, session_no, planned_date, actual_date, teacher_email, lesson_plan_url, milestone (+standard).
  - attendance: session_id, student_id, status, recorded_by (+standard).
  - daily_notes: session_id, student_id, score, achievement, area_of_improvement, recorded_by (+standard).
  - assessments: class_id, student_id, assessment_type, grade, report_due_date, report_generated_at, report_pdf_url (+standard).
  - events: class_id, event_type, due_date, done_date, status (+standard). (label column allowed: add `description`)
  - waiting_list: input_date, source, student_id, full_name, program, level, day, time, request_no, status, notes (+standard).
  - leveling: class_id, student_id, intake, recommended_level, final_level, decision_type, notes, decided_by, decided_at (+standard).
  - media: class_id, milestone, drive_file_id, file_name, uploaded_by, uploaded_at (+standard).
  - users: email, full_name, role, center_codes, is_active (+standard).
  - centers: center_code, center_no, center_name, is_active (+standard).
  - programs_levels: program, level, level_order, next_small_level, next_big_level (+standard).
  - holidays: date, center_code, description (+standard).
  - audit_log: timestamp, user_email, action, table_name, record_id, before_json, after_json (no soft-delete needed but keep standard cols for uniformity).
  - snapshot_dashboard: snapshot_date, center_code, program, active_students, classes_active, attendance_rate_avg, compliance_missing (+standard).
- Global functions (all idempotent, all writes inside `withLock_`):
  - `setupDatabase()` — creates (a) main DB spreadsheet `SIS Sparks Math — Database` with all non-TX tabs, (b) current-academic-year TX spreadsheet `SIS Sparks Math — Transaksi AY<label>` with `attendance` + `daily_notes` tabs, (c) Drive root folder `SIS Sparks Math (New System)` with subfolders `Media`, `Reports`, `Templates`. Stores ids in script properties. Re-running reuses existing ids, creates only what is missing. Returns a summary object.
  - `seedMasterData()` — idempotent: centers `[{center_code:'BTR',center_no:'01',center_name:'Bintaro',is_active:true}]` (comment: replace with the real 20-center list), programs_levels minimal chain for LE (1A→1B→2A→ … at least 1A,1B,2A,2B,3A,3B with next_small/next_big mapping; CT,BS minimal placeholder rows), users: `aulya.kustyawan@seven-retail.com` role `HQ`, center_codes `''`, is_active true. No duplicates on re-run.
  - `authorizeSmokeTest()` — reads DB property; writes+reads one audit_log heartbeat row; returns `{ok, dbSpreadsheetId, txSpreadsheetId, folderId, versions}`. This is the first function the operator runs (OAuth consent).
  - `installNightlyTriggers()` — removes existing duplicate triggers then creates a daily 01:00 time-driven trigger for `buildSnapshots`.
  - `getSetupStatus()` — small status readout for the Admin screen (db ready? folders? template?).

### 5. `Auth.gs`
- `getCurrentUser_()` — `Session.getActiveUser().getEmail()` → match `users` row (is_active true); split `center_codes` into `centerList` (null/[] = all centers); throw `new Error('Akun Anda belum terdaftar di sistem.')` if unknown.
- `requireRole_(roles, centerCode)` — per doc §8 sample; role in roles required; if `centerCode` given and `user.centerList` non-empty, must contain it; else throw `'Tidak punya akses ke cabang '+centerCode`.
- `getAppBootstrap()` (client-callable) — NEVER throws: returns `{notRegistered:true, email}` for unknown users; otherwise `{user:{email,full_name,role,centers:[]}, nav:[{id,label}...], dbReady:bool, title, version}`.
- `canAccess_(user, roles, centerCode)` helper.

### 6. `Db.gs` — generic table layer (server-only; never called from client)
Public surface (keep these exact method names):
- `sheet_(table)` → resolves target spreadsheet (`TX_TABLES` → year TX sheet by property, fallback main DB + `console.warn`), returns sheet by name; **self-heals**: creates tab with headers from `TABLE_SCHEMAS` if missing.
- `readAll(table)`, `readWhere(table, pred)`, `findOne(table, pred)` — parse via header row; skip `is_deleted` unless `{includeDeleted:true}` passed.
- `insert(table, record, userEmail)` → adds standard cols, appends (single row may use appendRow; multi-row MUST batch), writes audit, returns the record.
- `insertMany(table, records, userEmail)` → one `setValues` write; audit rows batched too.
- `update(table, idKey, idValue, patch, userEmail)` → find row, patch fields + updated_at/by; audit with before/after.
- `softDelete(table, idKey, idValue, userEmail)`.
- `withLock_(fn)` — `LockService.getScriptLock()`, `waitLock(30000)`, release in `finally`. **Every write path runs inside the lock.** ID-generation flows (read-max → write) execute inside ONE lock — callers use `withLock_` directly (see Students/Classes).
- `audit_(userEmail, action, table, recordId, before, after)` → append to `audit_log` (JSON.stringify before/after, truncate each at 4000 chars).
- `readCached_(table)` for REF_TABLES via CacheService (key `ref_<table>`, JSON, TTL from Config); `invalidate_(table)` clears it — Admin mutations call it.
- Date helpers: `toIsoDate_(v)`, `toIsoDateTime_(v)`, `parseIsoDate_(s)`; all values crossing `google.script.run` must be ISO strings or primitives — never pass Date objects or undefined (use null).

### 7. `Students.gs` — client-callable (roles HQ/CM/SA, center-scoped via requireRole_)
- `listStudents(filters)` → light rows `{student_id, full_name, nickname, center_code, status, package, credit_class}` filtered by q (name/id), center, status.
- `getStudent(studentId)` → full record + `enrollmentHistory` (enrollments joined with class info).
- `createStudent(form)` → validate (nama wajib; dob valid if present; status default `Postponed`); id gen `center+4digit max+1` inside ONE lock; returns saved record.
- `updateStudent(form)` → patch + audit.
- Internal `nextStudentId_(centerCode)`.

### 8. `Classes.gs` — client-callable (roles HQ/CM/SA)
- `listClasses(filters)` (center, status, program, day).
- `getClassDetail(classId)` → `{klass, students:[{student,enrollment}...], sessions:[...48], events:[...]}`.
- `createClass(form)` → validate + `requireRole_(['HQ','CM','SA'], form.center_code)`; inside ONE lock:
  `nextClassId_(center, year)` → `C{center_no}-{yy}{seq}`; generate **48 sessions** (`parseDayCodes_` +
  skip holidays where `center_code` empty or matches); compute `end_date` = last planned date (unless provided); generate events from `EVENT_RULES`; insert class + sessions + events (batched). Returns summary `{class_id, sessions_created, events_created}`.
- `updateClass(form)`, `listTeachers(centerCode)` (users role TEACHER/LEAD_TEACHER for the dropdown).
- Placement: `placeStudent(studentId, classId, joinDate, leaveReason)` — closes any open enrollment (`leave_date = joinDate`, reason defaults `'Pindah Kelas'`), opens new enrollment (`ENR-` + 6-digit seq under same lock); sets student status per class status (Active class → `Active`, else `Postponed`); audit. `closeEnrollment(enrollmentId, leaveDate, leaveReason, newStatus)`.
- `parseDayCodes_(str)` → array of JS weekday numbers; tokens case-insensitive, greedy 2-char first: `Th`=4, `Sa`=6, `Su`=0, then `M`=1,`T`=2,`W`=3,`F`=5. Handles `'TTh'`, `'MWF'`, `'Sa'`, comma/space-separated lists.
- `nextClassId_(centerCode, year)`.
- Internal `generateSessions_(klass, holidays, startDate)` + `generateEvents_(klass, sessions)` helpers.

### 9. `Attendance.gs` — client-callable
- `getMySessions(scope)` → sessions for TEACHER (their classes) / LEAD (center), scope `'today'|'upcoming'|'unrecorded'`.
- `getSessionRoster(sessionId)` → `{session, klass, students:[{student, attendance, note}]}`.
- `saveSessionEntries(sessionId, payload)` → payload `{actual_date, teacher_email, entries:[{student_id,status,score,achievement,area_of_improvement}]}`; roles TEACHER/LEAD (own class check); batch upsert attendance + daily_notes (one `setValues` per table via Db), set session `actual_date`/`teacher_email`; audit; returns count saved. Also allow corrections: only TEACHER/LEAD; keep `recorded_by`.
- `listSessionsForClass(classId)`, `getClassAttendanceSummary(classId)` → per student `{present, absent, excused, conducted, rate}` where `conducted` = class sessions with `session_no >= joinSessionNo` and `planned_date <= today`; `rate` null when conducted=0.
- Internal `attendanceRate_(classId, studentId)` + `joinSessionNo_(classId, studentId)` (used by Leveling too).

### 10. `Reports.gs` — client-callable
- `saveAssessments(classId, items)` (roles TEACHER/LEAD) — items `[{student_id, assessment_type, grade}]`; upsert per (class,student,type); set `report_due_date` from the milestone session's planned date (13→MIDTERM_1, 24→FINAL_TERM_1, 37→MIDTERM_2, 48→FINAL_TERM_2).
- `listAssessmentBoard(centerCode|classId)` → rows with computed status `Belum | Tepat waktu | Terlambat` vs `report_due_date` (+ `report_pdf_url`).
- `generateReportPdf(classId, studentId, assessmentType)` (roles HQ/CM/SA) — template id from property `TEMPLATE_DOC_ID`; if unset throw `'Template laporan belum dikonfigurasi. Set TEMPLATE_DOC_ID di Pengaturan.'`; copy template into REPORTS folder via DocumentApp → `replaceText` all `REPORT_PLACEHOLDERS` → export PDF (`getAs('application/pdf')`) → save to folder → record `report_generated_at`/`report_pdf_url` → return `{url, file_name}`.
- Internal `buildReportData_(classId, studentId, assessmentType)` (student, class, teacher, attendance, grades summary, latest notes).
- `listReportTemplates()`? not needed. Keep placeholders documented in a comment block.

### 11. `Events.gs` — client-callable (roles SA/CM/HQ; LEAD read)
- `listEvents(filters)` (center, type, status, dueBefore) → rows decorated `{...event, class_label, overdue:bool}`.
- `updateEventStatus(eventId, status, doneDate)`.

### 12. `WaitingList.gs` — client-callable (roles SA/HQ)
- `listWaitingList(centerCode)`, `saveWaitingEntry(form)` (create/update outside DB), `setWaitingStatus(id, status)`.

### 13. `Leveling.gs` — client-callable
- `getLevelingBoard(classId)` (view: LEAD/CM/SA/HQ) → per enrolled student: `{student, finalGrades, attendanceRate, joinSessionNo, recommended_level, recommendation_type, reason, decision}`.
  Recommendation rules (doc §6.6, order matters): final term grade `D` → `LOOPING`; joined at session >= 45 → `LOOPING`; attendance < 70% → `LOOPING`; grade rank >= A (4) and attendance >= 75% → `BIG`; grade rank >= C (2) and attendance >= 70% → `SMALL`; no final grade → `NEED_ASSESSMENT`. `recommended_level` = `program + ' ' + next level` (SMALL→`next_small_level`, BIG→`next_big_level`, LOOPING→same level) resolved from `programs_levels`. Always include a human-readable Indonesian `reason` string.
- `saveLevelingDecisions(classId, decisions)` (**LEAD only**) — per student `{student_id, final_level, decision_type, notes}`; write/upsert `leveling` rows with `decided_by/decided_at`; audit.
- Internal `computeRecommendation_(...)`.

### 14. `Media.gs` — client-callable (roles SA/TEACHER/LEAD)
- `getMediaChecklist(classId)` → milestones `[{milestone, sessionNo, count, required:'2–4', files:[{name,url}]}]` from `media` + session milestones.
- `uploadClassMedia(classId, milestone, fileName, mimeType, base64Data)` — one file per call (client loops); Drive folder `Media/<classId>/` created lazily under `MEDIA_ROOT_FOLDER_ID`; insert `media` row; return `{url, file_name}`.
- `getMediaGuidelines()` → `{text}` (from Config).

### 15. `Dashboard.gs`
- `buildSnapshots()` — called by trigger; computes per center+program: active students, classes active, avg attendance rate, compliance gaps; writes `snapshot_dashboard` rows (batched; date-stamped; re-run same day replaces that day's rows for idempotency).
- `getDashboardHome()` (client-callable, all roles) — role-appropriate: today's classes accessible to the user, events due within 7 days, sessions passed >3 days without attendance (compliance), student counts by status.
- `getDashboardStats(filters)` (client-callable, CM/HQ/LEAD) — attendance rate per program/center/teacher + compliance list + report status counts.
- `installNightlyTriggers()` lives in Setup.gs (see §4).

### 16. `Admin.gs` — client-callable, **HQ only** (`requireRole_(['HQ'])`)
- `listUsers/saveUser/toggleUser`, `listCenters/saveCenter`, `listProgramsLevels/saveProgramLevel`, `listHolidays/saveHoliday/deleteHoliday`, `getAuditLog(filters)` (latest 500). Every mutation calls `invalidate_('users'|'centers'|'programs_levels'|'holidays')` as needed.

### 17. `Migration.gs` — read-only scaffold, config-gated (Phase 4 of doc §10)
- Reads script property `OLD_SIS_SOURCES` (JSON string; empty/not set by default). 
- `dryRunMigration(centerCode)` (client-callable, HQ only): if not configured → return `{configured:false, message:'Migrasi belum dikonfigurasi. Atur OLD_SIS_SOURCES di Pengaturan.'}`; otherwise read old sheets with **read-only calls only** (`getDataRange().getValues()`) and return `{configured:true, counts, sample, diffs}` WITHOUT writing anything.
- `writeMigration(centerCode, confirmToken)` — refuses unless `CONFIG.MIGRATION_WRITE_ENABLED === true` AND `confirmToken === 'SAYA-SETUJU'`; hard assert every source id != target ids; then writes students/classes/enrollments basics via Db. Default disabled.
- Header comment: fase 4, read-only terhadap SIS lama, salin bukan pindah.

### 18. `Index.html` — shell served by `doGet`
`<!DOCTYPE html>`, `<html lang="id">`, meta charset + viewport, `<base target="_top">`,
head includes `<?!= include('Styles') ?>`; body: `#app-loading` splash, `#app-banner` (hidden; for
not-registered / db-not-ready states), header bar (`#app-header` with title + `#user-chip`),
`aside#nav`, `main#content`, `#modal-root`, `#toast-root`; before `</body>`:
`<?!= include('Views') ?>` then `<?!= include('Scripts') ?>`.

### 19. `Styles.html` — `<style>` block
Modern clean admin UI using CSS custom properties: sidebar layout (~240px, collapses under 900px),
cards, tables (sticky header, zebra), badges with status colors (Active=green, Postponed=amber,
Non-Active=gray, Cancel=red; Draft=gray, Active=blue, Completed=green; Present=green, Absent=red,
Excused=amber), buttons (primary/secondary/danger), forms/grid, modals, toasts, spinner, empty
states, login/consent screens, simple CSS bar charts for dashboard, `@media print` basic rules.
System font stack only (no external fonts).

### 20. `Views.html` — `<template id="tpl-*">` blocks for every screen
Skeletons for: loading, not-registered, every nav screen (beranda, murid, murid-detail, kelas,
kelas-detail, sesi, sesi-input, penilaian, event, waiting, leveling, media, dashboard, admin), and
modals (student-form, class-form, placement-form, assessment-editor, event-edit, waiting-form,
leveling-form, user-form, center-form, program-form, holiday-form, media-upload, confirm-dialog).
Pure HTML with class/id hooks; no logic; no inline event handlers.

### 21. `Scripts.html` — `<script>` block, the client app
- `api(name, ...args)` → Promise wrapper over `google.script.run.withSuccessHandler/withFailureHandler`; global spinner; errors → toast (Indonesian).
- Boot: `getAppBootstrap()` → notRegistered screen / banner for dbReady=false; build sidebar from
  `nav`; hash router (`#/murid` …) with `#/beranda` default; `state` in memory only
  (**do not use localStorage/sessionStorage**).
- `esc()` for every interpolated value (XSS safety). Date display `id-ID` (`dd MMM yyyy`).
- Each screen: `load()` fetches via server, `render()` clones its `<template>`, binds events.
- Behaviors: student search/filter + form modals; class create form (show returned counts) +
  detail (students, sessions, events, placement); sesi screen (today/unrecorded lists → input
  screen: attendance radio Present/Absent/Excused + score + 2 comment fields per student, ONE
  batch save call); penilaian (grade input per student/term, status column, Generate PDF button
  showing returned URL); event tracker (filters + mark done); waiting list CRUD; leveling board
  (recommendation badge + reason, decision form for LEAD); media checklist + upload (client reads
  file via FileReader → base64 → loop `uploadClassMedia` per file, max 4); dashboard (home
  summary + stats tables + CSS bars); admin (CRUD tabs + audit log; HQ only).
- Confirm dialogs before every destructive/status action. Success toasts after every save.
- **Only call server functions that exist** — the verifier cross-checks every `google.script.run` target against definitions.

## Cross-cutting rules (hard)
1. No external resources: no `<script src=...>`, no `<link href="http...">`, no libraries/CDN anywhere.
2. Never write outside `src/`. Never touch the doc / `.clasp.json`. Never run clasp/git/npm. No new files beyond the 21.
3. Server modules use the `Db` layer for all sheet data ops (only Setup/Db/Migration may call `SpreadsheetApp.openById/create`).
4. All sheet reads: one `getDataRange().getValues()` per table per call, work in memory. All multi-row writes: single `setValues`. All writes inside `withLock_`.
5. Client boundary: plain JSON-safe values only; dates as ISO strings; `null` not `undefined`.
6. Client-callable server functions: global scope, no trailing `_`, start by calling `getCurrentUser_()` or `requireRole_(...)`. Role enforcement is server-side; the nav is also role-filtered.
7. Errors to client: friendly Indonesian `Error` messages; never raw stack traces.
8. After writing ALL files, run the verification and fix your files until it passes:
   ```
   cd C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math
   node verify.js
   ```
   `verify.js` is READ-ONLY for you — **never edit it**. Exit code 0 and zero FAIL lines = done.
   If verify.js appears wrong, report it — do not modify it.

## Report format (end your run with exactly this block)
```
STATUS: done | partial
FILES:
  src/<name> — <lines> lines
VERIFY: <the raw output of node verify.js, last 30 lines>
ASSUMPTIONS: <every invented/defaulted config value>
NOTES: <anything not done, and why>
```

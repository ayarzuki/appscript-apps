#!/usr/bin/env node
/* verify.js — acceptance checker for the SIS Sparks Math Apps Script build.
 *
 * Run from the project root:   node verify.js
 * Exit code 0 and no FAIL lines = pass. READ-ONLY: agents must not edit this file.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const REQUIRED_FILES = [
  'appsscript.json', 'Code.gs', 'Config.gs', 'Setup.gs', 'Auth.gs', 'Api.gs', 'Db.gs',
  'Students.gs', 'Classes.gs', 'Attendance.gs', 'Reports.gs', 'Events.gs',
  'WaitingList.gs', 'Leveling.gs', 'Media.gs', 'Dashboard.gs', 'Admin.gs',
  'Migration.gs', 'Index.html', 'Styles.html', 'Views.html', 'Scripts.html',
];

const REQUIRED_TABLES = [
  'students', 'classes', 'enrollments', 'sessions', 'attendance', 'daily_notes',
  'assessments', 'events', 'waiting_list', 'leveling', 'media', 'users',
  'centers', 'programs_levels', 'holidays', 'audit_log', 'snapshot_dashboard',
  'auth_sessions', 'auth_codes',
];

const failures = [];
const warnings = [];
const ok = (m) => console.log('  PASS ' + m);
const fail = (m) => { failures.push(m); console.log('  FAIL ' + m); };
const warn = (m) => { warnings.push(m); console.log('  WARN ' + m); };

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// ---------- 1. required files ----------
console.log('== 1. required files ==');
const texts = {};
for (const f of REQUIRED_FILES) {
  const t = read(path.join(SRC, f));
  if (t === null) fail(`missing src/${f}`);
  else { texts[f] = t; ok(`src/${f} (${t.split('\n').length} lines)`); }
}

// ---------- 2. manifest ----------
console.log('== 2. appsscript.json ==');
if (texts['appsscript.json']) {
  try {
    const m = JSON.parse(texts['appsscript.json']);
    if (m.timeZone === 'Asia/Jakarta') ok('timeZone Asia/Jakarta'); else fail(`timeZone is ${m.timeZone}`);
    if (m.runtimeVersion === 'V8') ok('runtimeVersion V8'); else fail(`runtimeVersion is ${m.runtimeVersion}`);
    const w = m.webapp || {};
    if (w.executeAs === 'USER_DEPLOYING') ok('webapp.executeAs USER_DEPLOYING'); else fail(`webapp.executeAs is ${w.executeAs}`);
    if (w.access === 'ANYONE') ok('webapp.access ANYONE (login Gmail pribadi via kode email)'); else fail(`webapp.access is ${w.access} (expected ANYONE untuk login kode email)`);
    const sc = (m.oauthScopes || []).join(' ');
    if (sc.includes('auth/spreadsheets')) ok('scope spreadsheets'); else fail('scope spreadsheets missing');
    if (sc.includes('auth/drive')) ok('scope drive'); else fail('scope drive missing');
    if (sc.includes('auth/userinfo.email')) ok('scope userinfo.email'); else fail('scope userinfo.email missing (Session.getActiveUser().getEmail() returns empty without it)');
    if (sc.includes('script.send_mail')) ok('scope script.send_mail'); else fail('scope script.send_mail missing (login code email via MailApp)');
  } catch (e) { fail('appsscript.json is not valid JSON: ' + e.message); }
}

// ---------- 3. syntax parse of .gs ----------
console.log('== 3. syntax parse (.gs) ==');
for (const f of REQUIRED_FILES.filter((x) => x.endsWith('.gs'))) {
  const t = texts[f];
  if (t == null) continue;
  try { new Function(t); ok(`${f} parses`); }
  catch (e) { fail(`syntax error in ${f}: ${e.message}`); }
}

// ---------- 4. table-schema coherence ----------
console.log('== 4. table-schema coherence ==');
if (texts['Setup.gs']) {
  const schemaKeys = new Set();
  const reSchema = /(['"])([a-z0-9_]+)\1\s*:\s*\[/g;
  let m;
  while ((m = reSchema.exec(texts['Setup.gs'])) !== null) schemaKeys.add(m[2]);
  const missing = REQUIRED_TABLES.filter((t) => !schemaKeys.has(t));
  if (missing.length) fail('TABLE_SCHEMAS missing tables: ' + missing.join(', '));
  else ok(`TABLE_SCHEMAS has all ${REQUIRED_TABLES.length} tables`);

  // every Db.* call with a literal table name must reference a schema'd table
  const known = new Set([...schemaKeys, ...REQUIRED_TABLES]);
  const reUse = /\bDb\.[A-Za-z_]+\s*\(\s*'([a-z0-9_]+)'/g;
  const used = new Set();
  const bad = [];
  for (const f of REQUIRED_FILES.filter((x) => x.endsWith('.gs'))) {
    if (f === 'Setup.gs') continue;
    const t = texts[f]; if (t == null) continue;
    let mm;
    reUse.lastIndex = 0;
    while ((mm = reUse.exec(t)) !== null) {
      used.add(mm[1]);
      if (!known.has(mm[1])) bad.push(`${f}: Db literal '${mm[1]}' not in TABLE_SCHEMAS`);
    }
  }
  if (bad.length) bad.forEach(fail); else ok(`all Db table literals resolve (${used.size} tables used)`);
}

// ---------- 5. client -> server function cross-check ----------
console.log('== 5. google.script.run target cross-check ==');
function extractChainTargets(text) {
  // For each `google.script.run` occurrence, walk the `.method(` chain; skip
  // withSuccessHandler/withFailureHandler/withUserObject; first other method = target.
  const targets = [];
  const HANDLERS = new Set(['withSuccessHandler', 'withFailureHandler', 'withUserObject']);
  let idx = -1;
  const NEEDLE = 'google.script.run';
  const skipBalanced = (s, i) => {
    // i points at '('; return index AFTER the matching ')', quote/backtick aware.
    let depth = 0, j = i;
    while (j < s.length) {
      const ch = s[j];
      if (ch === "'" || ch === '"') { const q = ch; j++; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; } }
      else if (ch === '`') { j++; while (j < s.length && s[j] !== '`') { if (s[j] === '\\') j++; j++; } }
      else if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) return j + 1; }
      j++;
    }
    return -1;
  };
  while ((idx = text.indexOf(NEEDLE, idx + 1)) !== -1) {
    let i = idx + NEEDLE.length;
    for (let guard = 0; guard < 40; guard++) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== '.') break;
      i++;
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const name = text.slice(i, j);
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '(') break;              // not a call — stop chain
      if (HANDLERS.has(name)) { i = skipBalanced(text, j); if (i < 0) break; continue; }
      targets.push(name);
      break;
    }
  }
  return targets;
}
{
  const htmlFiles = ['Scripts.html', 'Views.html', 'Index.html'].filter((f) => texts[f]);
  const targets = new Set();
  for (const f of htmlFiles) for (const t of extractChainTargets(texts[f])) targets.add(t);

  // Pattern B: promise-wrapper switch — `case 'name': runner.name(` inside the api() helper.
  const switchTargets = new Set();
  if (texts['Scripts.html']) {
    const reSwitch = /case\s+'([A-Za-z_]\w*)'\s*:\s*runner\.\1\s*\(/g;
    let m;
    while ((m = reSwitch.exec(texts['Scripts.html'])) !== null) { switchTargets.add(m[1]); targets.add(m[1]); }
  }
  // Pattern C: `api('name', ...)` call sites anywhere in the client HTML.
  const apiTargets = new Set();
  for (const f of htmlFiles) {
    const reApi = /\bapi\(\s*'([A-Za-z_]\w*)'/g;
    let m;
    while ((m = reApi.exec(texts[f])) !== null) apiTargets.add(m[1]);
  }

  const serverSrc = REQUIRED_FILES.filter((x) => x.endsWith('.gs')).map((f) => texts[f] || '').join('\n');
  const defRe = (n) => new RegExp(`(?:function\\s+${n}\\s*\\(|\\b(?:const|let|var)\\s+${n}\\s*=|\\b${n}\\s*=\\s*function\\b)`);
  const missing = [];
  for (const t of targets) {
    if (!t) continue;
    if (t.endsWith('_')) missing.push(`${t} (client must not call trailing-underscore helpers)`);
    else if (!defRe(t).test(serverSrc)) missing.push(t);
  }
  const wrapperOk = texts['Scripts.html'] ? texts['Scripts.html'].includes('google.script.run') : false;
  if (!wrapperOk) fail('Scripts.html never references google.script.run');
  else if (targets.size === 0) fail('no google.script.run targets found in Scripts.html — client never calls the server?');
  else if (missing.length) missing.forEach((x) => fail(`client target not defined server-side: ${x}`));
  else ok(`all ${targets.size} server-call targets defined server-side (${switchTargets.size} switch cases, ${apiTargets.size} api() call sites)`);

  // Caller-side completeness: every api('X') call site must be routed by the wrapper.
  if (switchTargets.size > 0) {
    const unrouted = [...apiTargets].filter((t) => !switchTargets.has(t));
    if (unrouted.length) unrouted.forEach((t) => fail(`api('${t}') has no case in the wrapper switch`));
    else ok('every api(...) call site is routed in the wrapper switch');
  } else if (apiTargets.size > 0) {
    const unmapped = [...apiTargets].filter((t) => !targets.has(t) && !defRe(t).test(serverSrc));
    if (unmapped.length) unmapped.forEach((t) => fail(`api('${t}') not defined server-side`));
    else ok(`all ${apiTargets.size} api() call sites resolve server-side`);
  }
}

// ---------- 5b. API routes allowlist (callApi dispatcher) ----------
console.log('== 5b. API routes allowlist ==');
{
  const apiSrc = texts['Api.gs'] || '';
  const routeKeys = new Set();
  const block = /const\s+API_ROUTES\s*=\s*\{([\s\S]*?)\};/.exec(apiSrc);
  if (!block) fail('Api.gs: API_ROUTES allowlist block not found');
  else {
    const reKey = /^\s*([A-Za-z_]\w*)\s*:/gm;
    let m;
    while ((m = reKey.exec(block[1])) !== null) routeKeys.add(m[1]);
  }
  if (block) {
    if (routeKeys.size >= 45) ok(`API_ROUTES allowlist has ${routeKeys.size} routes`);
    else fail(`API_ROUTES has only ${routeKeys.size} routes (expected >= 45)`);
  }

  const htmlFiles = ['Scripts.html', 'Views.html', 'Index.html'].filter((f) => texts[f]);
  const apiTargets = new Set();
  for (const f of htmlFiles) {
    const reApi = /\bapi\(\s*'([A-Za-z_]\w*)'/g;
    let m;
    while ((m = reApi.exec(texts[f])) !== null) apiTargets.add(m[1]);
  }
  if (block) {
    const unrouted = [...apiTargets].filter((t) => !routeKeys.has(t));
    if (unrouted.length) unrouted.forEach((t) => fail(`api('${t}') is not in the API_ROUTES allowlist`));
    else ok(`all ${apiTargets.size} api(...) call sites are in the allowlist`);
  }

  const serverSrc = REQUIRED_FILES.filter((x) => x.endsWith('.gs')).map((f) => texts[f] || '').join('\n');
  const defRe = (n) => new RegExp(`(?:function\\s+${n}\\s*\\(|\\b(?:const|let|var)\\s+${n}\\s*=|\\b${n}\\s*=\\s*function\\b)`);
  const bad = [];
  for (const k of routeKeys) {
    if (k.endsWith('_')) bad.push(`${k} (routes must not expose trailing-underscore helpers)`);
    else if (!defRe(k).test(serverSrc)) bad.push(k);
  }
  if (bad.length) bad.forEach((x) => fail(`API_ROUTES entry not defined server-side: ${x}`));
  else if (block) ok('every allowlisted route is defined server-side');

  const s = texts['Scripts.html'] || '';
  const bridges = (s.match(/google\.script\.run\.\s*withSuccessHandler/g) || []).length;
  if (!s.includes('.callApi(')) fail('Scripts.html does not call callApi(...)');
  else if (bridges !== 1) fail(`Scripts.html must have exactly one google.script.run bridge (found ${bridges})`);
  else ok('single google.script.run bridge via callApi');

  if (apiSrc.includes('PUBLIC_ROUTES')) ok('Api.gs declares PUBLIC_ROUTES'); else fail('Api.gs missing PUBLIC_ROUTES');
}

// ---------- 6. bans ----------
console.log('== 6. bans ==');
{
  let bad = 0;
  for (const f of REQUIRED_FILES) {
    const t = texts[f]; if (t == null) continue;
    if (/IMPORTRANGE/i.test(t)) { fail(`${f} contains IMPORTRANGE`); bad++; }
  }
  for (const f of ['Index.html', 'Views.html', 'Styles.html', 'Scripts.html']) {
    const t = texts[f]; if (t == null) continue;
    if (/<script[^>]+src\s*=/i.test(t)) { fail(`${f} has external <script src=>`); bad++; }
    if (/<link[^>]+href\s*=\s*["']https?:/i.test(t)) { fail(`${f} has external <link href="http...">`); bad++; }
  }
  const openByIdAllowed = new Set(['Setup.gs', 'Db.gs', 'Migration.gs']);
  for (const f of REQUIRED_FILES.filter((x) => x.endsWith('.gs'))) {
    const t = texts[f]; if (t == null) continue;
    if (/SpreadsheetApp\.openById\(/.test(t) && !openByIdAllowed.has(f)) { fail(`${f} calls SpreadsheetApp.openById outside the Db/Setup/Migration layer`); bad++; }
  }
  if (!bad) ok('no banned patterns');
}

// ---------- 7. key API surface ----------
console.log('== 7. key API surface ==');
const has = (f, re, label) => { const t = texts[f]; if (t && re.test(t)) ok(label); else fail(label); };
has('Code.gs', /function\s+doGet\s*\(/, 'Code.gs defines doGet()');
has('Code.gs', /function\s+include\s*\(/, 'Code.gs defines include()');
has('Db.gs', /getScriptLock\s*\(/, 'Db.gs uses LockService.getScriptLock');
has('Db.gs', /CacheService/, 'Db.gs uses CacheService');
has('Auth.gs', /Session\.getActiveUser\s*\(/, 'Auth.gs uses Session.getActiveUser');
has('Auth.gs', /requireRole_/, 'Auth.gs defines requireRole_');
has('Students.gs', /nextStudentId_/, 'Students.gs has nextStudentId_');
has('Classes.gs', /parseDayCodes_/, 'Classes.gs has parseDayCodes_');
has('Leveling.gs', /computeRecommendation_/, 'Leveling.gs has computeRecommendation_');
has('Migration.gs', /OLD_SIS_SOURCES/, 'Migration.gs reads OLD_SIS_SOURCES');
if (texts['Index.html']) {
  for (const inc of ['Styles', 'Views', 'Scripts']) {
    if (new RegExp(`include\\('${inc}'\\)`).test(texts['Index.html'])) ok(`Index.html includes ${inc}`);
    else fail(`Index.html missing <?!= include('${inc}') ?>`);
  }
}
has('Auth.gs', /function\s+diagnoseLogin\s*\(/, 'Auth.gs defines diagnoseLogin()');
has('Auth.gs', /db-not-ready/, 'Auth.gs distinguishes db-not-ready state');
has('Auth.gs', /login-required/, 'Auth.gs distinguishes login-required state');
{
  const simTxt = read(path.join(ROOT, 'login-sim.js'));
  if (simTxt === null) fail('login-sim.js (test harness) missing at project root');
  else ok('login-sim.js present');
}

console.log('== 7c. routing sandbox-safety ==');
{
  const s = texts['Scripts.html'];
  if (s) {
    if (s.includes('google.script.history')) ok('Scripts.html uses google.script.history'); else fail('Scripts.html missing google.script.history (sandbox-safe routing required)');
    if (s.includes('preventDefault(') && s.includes('closest(')) ok('delegated click interception present'); else fail('delegated click interception for in-app hash links missing');
    if (/location\.hash\s*=(?!=)/.test(s)) fail('Scripts.html still assigns location.hash directly (sandbox-unsafe: causes blank page)'); else ok('no direct location.hash assignment');
  }
  const uiSim = read(path.join(ROOT, 'ui-sim.js')) !== null;
  if (uiSim) ok('ui-sim.js present'); else warn('ui-sim.js (UI click-through harness) not present');
}

console.log('== 7d. admin CRUD UI wiring ==');
{
  const s = texts['Scripts.html'];
  if (s) {
    for (const m of ['saveUser', 'toggleUser', 'saveCenter', 'saveHoliday', 'saveProgramLevel', 'deleteHoliday']) {
      const re = new RegExp('api\\([\'"]' + m + '[\'"]');
      if (re.test(s)) ok('Scripts.html wires api(\'' + m + '\')'); else fail('Scripts.html missing api(\'' + m + '\') — admin CRUD UI not wired');
    }
  }
  const v = texts['Views.html'];
  if (v) {
    for (const tpl of ['tpl-modal-user-form', 'tpl-modal-center-form', 'tpl-modal-program-form', 'tpl-modal-holiday-form']) {
      if (v.includes('template id="' + tpl + '"')) ok('Views.html has ' + tpl); else fail('Views.html missing template ' + tpl);
    }
  }
  const adminSim = read(path.join(ROOT, 'admin-sim.js')) !== null;
  if (adminSim) ok('admin-sim.js present'); else warn('admin-sim.js (server data harness) not present');
}

console.log('== 7e. sidebar toggle ==');
{
  const s = texts['Scripts.html'];
  const st = texts['Styles.html'];
  if (s) {
    if (s.includes('sidebar-collapsed')) ok('Scripts.html toggles sidebar-collapsed (desktop collapse)'); else fail('Scripts.html missing sidebar-collapsed toggle');
    if (s.includes('matchMedia')) ok('Scripts.html uses matchMedia for width-aware toggle'); else fail('Scripts.html missing matchMedia width check');
  }
  if (st) {
    if (st.includes('sidebar-collapsed')) ok('Styles.html has .sidebar-collapsed rule'); else fail('Styles.html missing .sidebar-collapsed rule');
  }
  const uiSimTxt = read(path.join(ROOT, 'ui-sim.js'));
  if (uiSimTxt && uiSimTxt.includes('matchMedia')) ok('ui-sim.js drives matchMedia scenarios'); else warn('ui-sim.js has no matchMedia coverage');
}

console.log('== 7f. email-code auth wiring ==');
{
  const a = texts['Api.gs'];
  if (a) {
    if (a.includes('MailApp')) ok('Api.gs sends codes via MailApp'); else fail('Api.gs missing MailApp');
    for (const fn of ['callApi', 'requestLoginCode', 'verifyLoginCode', 'logout']) {
      if (new RegExp('function\\s+' + fn + '\\s*\\(').test(a)) ok('Api.gs defines ' + fn + '()'); else fail('Api.gs missing ' + fn + '()');
    }
  }
  const s = texts['Scripts.html'];
  if (s) {
    if (s.includes('sis_sparks_token')) ok('Scripts.html stores session token (sis_sparks_token)'); else fail('Scripts.html missing token storage sis_sparks_token');
    if (s.includes('requestLoginCode')) ok('Scripts.html wires requestLoginCode'); else fail('Scripts.html missing requestLoginCode wiring');
    if (s.includes('verifyLoginCode')) ok('Scripts.html wires verifyLoginCode'); else fail('Scripts.html missing verifyLoginCode wiring');
    if (s.includes('localStorage')) ok('Scripts.html uses localStorage for the token'); else fail('Scripts.html missing localStorage token use');
  }
  const v = texts['Views.html'];
  if (v) {
    if (v.includes('tpl-login-otp')) ok('Views.html has tpl-login-otp'); else fail('Views.html missing tpl-login-otp template');
  }
}
{
  const gsAll = REQUIRED_FILES.filter((x) => x.endsWith('.gs')).map((f) => texts[f] || '');
  const withRole = gsAll.filter((t) => t.includes('requireRole_')).length;
  if (withRole >= 5) ok(`requireRole_ used across ${withRole} server files`); else fail(`requireRole_ only used in ${withRole} server files (>=5 expected)`);
  const combined = (texts['Views.html'] || '') + (texts['Scripts.html'] || '');
  const labels = ['Beranda', 'Murid', 'Kelas', 'Absensi', 'Penilaian', 'Event', 'Waiting', 'Leveling', 'Media', 'Dashboard', 'Admin'];
  const found = labels.filter((l) => combined.includes(l));
  if (found.length >= 8) ok(`UI labels present: ${found.length}/${labels.length}`); else fail(`only ${found.length}/${labels.length} UI labels found in Views/Scripts`);
}

// ---------- 8. warnings ----------
console.log('== 8. warnings (non-fatal) ==');
{
  let todo = 0, big = [];
  for (const f of REQUIRED_FILES) {
    const t = texts[f]; if (t == null) continue;
    todo += (t.match(/TODO|FIXME/g) || []).length;
    const lines = t.split('\n').length;
    if (lines > 1400) big.push(`${f} (${lines})`);
  }
  if (todo) warn(`${todo} TODO/FIXME marker(s) across files`);
  if (big.length) warn('very large files: ' + big.join(', '));
  ok('warnings evaluated');
}

// ---------- summary ----------
console.log('\n=========================================');
console.log(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failure(s), ${warnings.length} warning(s)`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(failures.length === 0 ? 0 : 1);

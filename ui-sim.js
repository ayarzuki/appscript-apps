#!/usr/bin/env node
/* ui-sim.js — Click-through regression harness for SIS Sparks Math navigation and Admin CRUD.
 *
 * Simulates in-browser clicking of all sidebar navigation links and Admin CRUD flows in JSDOM.
 * Prevents regressions for sandbox base target="_top" blank page bug.
 *
 * Install jsdom outside repository:
 *   npm install jsdom --prefix "$TMPDIR/uidom"   (Linux / macOS)
 *   npm install jsdom --prefix "$TEMP/uidom"     (Windows PowerShell)
 */
'use strict';

const fs = require('fs');
const path = require('path');

let jsdomModule;
try {
  jsdomModule = require('jsdom');
} catch (e1) {
  try {
    const tempDir = process.env.TMPDIR || process.env.TEMP || '';
    const fallbackPath = path.join(tempDir, 'uidom', 'node_modules', 'jsdom');
    jsdomModule = require(fallbackPath);
  } catch (e2) {
    console.log(`SKIPPED: jsdom not installed (${e2.message})`);
    process.exit(0);
  }
}

const { JSDOM, VirtualConsole } = jsdomModule;

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const indexHtml = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
const stylesHtml = fs.readFileSync(path.join(SRC, 'Styles.html'), 'utf8');
const viewsHtml = fs.readFileSync(path.join(SRC, 'Views.html'), 'utf8');
const scriptsHtml = fs.readFileSync(path.join(SRC, 'Scripts.html'), 'utf8');

const fullHtml = indexHtml
  .replace(/<\?!=\s*include\(['"]Styles['"]\)\s*\?>/, stylesHtml)
  .replace(/<\?!=\s*include\(['"]Views['"]\)\s*\?>/, viewsHtml)
  .replace(/<\?!=\s*include\(['"]Scripts['"]\)\s*\?>/, scriptsHtml);

function createStatefulDb() {
  return {
    users: [
      {
        email: 'aulya.kustyawan@seven-retail.com',
        full_name: 'Test',
        role: 'HQ',
        center_codes: 'Semua',
        is_active: true
      }
    ],
    centers: [
      { center_code: 'BTR', center_name: 'Bintaro', center_no: '01', is_active: true },
      { center_code: 'KLM', center_name: 'Kalimalang', center_no: '02', is_active: true }
    ],
    holidays: [
      { date: '2026-12-25', center_code: 'BTR', description: 'Natal Bintaro' },
      { date: '2026-12-25', center_code: 'KLM', description: 'Natal Kalimalang' }
    ],
    programs: [
      { program: 'Math', level: '1', level_order: 1, next_small_level: '2', next_big_level: '' }
    ],
    captured: {
      saveUser: [],
      toggleUser: [],
      saveCenter: [],
      saveHoliday: [],
      deleteHoliday: [],
      saveProgramLevel: []
    }
  };
}

function makeFixtureHandler(db, roleOverride = 'HQ', sessionsMap = {}) {
  return function fixtureFor(methodName, args, token) {
    if (methodName === 'callApi') {
      const targetName = args[0];
      const targetArgs = args[1] || [];
      const callToken = args[2] || token;
      return fixtureFor(targetName, targetArgs, callToken);
    }
    switch (methodName) {
      case 'getAppBootstrap': {
        const resolved = (token && sessionsMap[token]) ? sessionsMap[token] : null;
        if (!resolved) {
          return {
            state: 'login-required',
            notRegistered: true,
            dbReady: true,
            version: '0.1.2',
            title: 'Sistem Administrasi Akademik Sparks Math'
          };
        }
        const effectiveRole = resolved.role || roleOverride;
        if (effectiveRole === 'TEACHER') {
          return {
            state: 'ok',
            token: token,
            notRegistered: false,
            dbReady: true,
            version: '0.1.2',
            title: 'Sistem Administrasi Akademik Sparks Math',
            user: {
              email: resolved.email || 'teacher@seven-retail.com',
              full_name: 'Guru Sparks',
              role: 'TEACHER',
              centers: ['BTR']
            },
            roles: ['HQ', 'CM', 'SA', 'TEACHER', 'LEAD_TEACHER'],
            nav: [
              { id: 'beranda', label: 'Beranda' },
              { id: 'sesi', label: 'Sesi & Absensi' },
              { id: 'penilaian', label: 'Assessment & Laporan' },
              { id: 'media', label: 'Media' }
            ]
          };
        }
        return {
          state: 'ok',
          token: token,
          notRegistered: false,
          dbReady: true,
          version: '0.1.2',
          title: 'Sistem Administrasi Akademik Sparks Math',
          user: {
            email: resolved.email || 'aulya.kustyawan@seven-retail.com',
            full_name: 'Test',
            role: 'HQ',
            centers: []
          },
          roles: ['HQ', 'CM', 'SA', 'TEACHER', 'LEAD_TEACHER'],
          nav: [
            { id: 'beranda', label: 'Beranda' },
            { id: 'murid', label: 'Murid' },
            { id: 'kelas', label: 'Kelas' },
            { id: 'sesi', label: 'Sesi & Absensi' },
            { id: 'penilaian', label: 'Assessment & Laporan' },
            { id: 'event', label: 'Event Tracker' },
            { id: 'waiting', label: 'Waiting List' },
            { id: 'leveling', label: 'Leveling' },
            { id: 'media', label: 'Media' },
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'admin', label: 'Admin' }
          ]
        };
      }
      case 'requestLoginCode':
        return {
          ok: true,
          message: 'Kode telah dikirim ke ' + (args[0] || '') + '. Berlaku 10 menit.'
        };
      case 'verifyLoginCode': {
        const em = args[0];
        sessionsMap['tokNew'] = { email: em, role: 'HQ' };
        return {
          ok: true,
          token: 'tokNew',
          email: em,
          message: 'Berhasil masuk.'
        };
      }
      case 'logout': {
        const tok = args[0] || token;
        if (tok && sessionsMap[tok]) delete sessionsMap[tok];
        return { ok: true };
      }
      case 'listCenters':
        return db.centers.map(c => Object.assign({}, c));
      case 'saveCenter': {
        const c = args[0];
        db.captured.saveCenter.push(c);
        const idx = db.centers.findIndex(x => x.center_code === c.center_code);
        if (idx >= 0) db.centers[idx] = Object.assign({}, db.centers[idx], c);
        else db.centers.push(Object.assign({}, c));
        return c;
      }
      case 'listUsers':
        return db.users.map(u => Object.assign({}, u));
      case 'saveUser': {
        const u = args[0];
        db.captured.saveUser.push(u);
        const idx = db.users.findIndex(x => x.email === u.email);
        if (idx >= 0) db.users[idx] = Object.assign({}, db.users[idx], u);
        else db.users.push(Object.assign({ is_active: true }, u));
        return u;
      }
      case 'toggleUser': {
        const email = args[0];
        const isActive = args[1];
        db.captured.toggleUser.push({ email, isActive });
        const idx = db.users.findIndex(x => x.email === email);
        if (idx >= 0) db.users[idx].is_active = Boolean(isActive);
        return db.users[idx] || null;
      }
      case 'listHolidays':
        return db.holidays.map(h => Object.assign({}, h));
      case 'saveHoliday': {
        const h = args[0];
        db.captured.saveHoliday.push(h);
        db.holidays.push(Object.assign({}, h));
        return h;
      }
      case 'deleteHoliday': {
        const date = args[0];
        const centerCode = args[1] || '';
        db.captured.deleteHoliday.push({ date, centerCode });
        const idx = db.holidays.findIndex(x => x.date === date && (x.center_code || '') === centerCode);
        if (idx >= 0) db.holidays.splice(idx, 1);
        return true;
      }
      case 'listProgramsLevels':
        return db.programs.map(p => Object.assign({}, p));
      case 'saveProgramLevel': {
        const p = args[0];
        db.captured.saveProgramLevel.push(p);
        const idx = db.programs.findIndex(x => x.program === p.program && x.level === p.level);
        if (idx >= 0) db.programs[idx] = Object.assign({}, db.programs[idx], p);
        else db.programs.push(Object.assign({}, p));
        return p;
      }
      case 'listClasses':
        return [
          {
            class_id: 'CLS1',
            class_name: 'Class 1',
            center_code: 'BTR',
            schedule_day: 'SENIN',
            schedule_time: '14:00',
            status: 'Active',
            program: 'MATH',
            level: '1',
            intake: '2026-01'
          }
        ];
      case 'getDashboardHome':
        return {
          studentCounts: { Active: 10, Postponed: 2, 'Non-Active': 1, total: 13 },
          todaySessions: [],
          upcomingEvents: [],
          missingAttendance: []
        };
      case 'listStudents':
        return [];
      case 'getStudent':
        return { student_id: 'STU1', full_name: 'Murid 1', center_code: 'BTR', status: 'Active' };
      case 'getClassDetail':
        return {
          klass: { class_id: 'CLS1', class_name: 'Class 1', center_code: 'BTR' },
          students: [],
          sessions: [],
          events: []
        };
      case 'getMySessions':
        return [];
      case 'getSessionRoster':
        return {
          session: { session_id: 'SES1', session_no: 1, planned_date: '2026-10-06' },
          klass: { class_id: 'CLS1', class_name: 'Class 1' },
          students: []
        };
      case 'listAssessmentBoard':
        return [];
      case 'listEvents':
        return [];
      case 'listWaitingList':
        return [];
      case 'getLevelingBoard':
        return { rows: [] };
      case 'getMediaChecklist':
        return { checklists: [] };
      case 'getMediaGuidelines':
        return { text: 'Panduan media Sparks Math' };
      case 'getDashboardStats':
        return {
          programRates: [],
          reportCounts: { Belum: 0, 'Tepat waktu': 0, Terlambat: 0, Selesai: 0 },
          complianceGaps: []
        };
      case 'listTeachers':
        return [];
      case 'getAuditLog':
        return [];
      case 'getSetupStatus':
        return { ready: true };
      case 'getAppVersionInfo':
        return { version: '0.1.2' };
      default:
        return [];
    }
  };
}

function createRunMock(win, fixtureHandler) {
  function makeRunner(handlers) {
    const h = handlers || { success: null, failure: null, userObject: null };
    return new Proxy({}, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'withSuccessHandler') {
          return function (fn) {
            return makeRunner({ ...h, success: fn });
          };
        }
        if (prop === 'withFailureHandler') {
          return function (fn) {
            return makeRunner({ ...h, failure: fn });
          };
        }
        if (prop === 'withUserObject') {
          return function (obj) {
            return makeRunner({ ...h, userObject: obj });
          };
        }
        return function (...args) {
          const timer = win.setTimeout ? win.setTimeout.bind(win) : setTimeout;
          timer(() => {
            try {
              const res = fixtureHandler(prop, args);
              if (typeof h.success === 'function') {
                h.success(res, h.userObject);
              }
            } catch (err) {
              if (typeof h.failure === 'function') {
                h.failure(err, h.userObject);
              }
            }
          }, 0);
          return undefined;
        };
      }
    });
  }
  return makeRunner();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, timeoutMs, intervalMs = 25) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

async function run() {
  const hqSessions = { 't1': { email: 'aulya.kustyawan@seven-retail.com', role: 'HQ' } };
  const db = createStatefulDb();
  const fixtureHandler = makeFixtureHandler(db, 'HQ', hqSessions);
  const virtualConsole = new VirtualConsole();
  const uncaughtErrors = [];

  virtualConsole.on('jsdomError', (err) => {
    uncaughtErrors.push(err);
  });

  const dom = new JSDOM(fullHtml, {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole,
    url: 'https://script.google.com/macros/s/test/exec',
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
      if (!window.matchMedia) {
        window.matchMedia = function (q) {
          const m = /max-width:\s*(\d+)px/.exec(q);
          return {
            matches: m ? window.innerWidth <= Number(m[1]) : false,
            addEventListener: function () {},
            removeEventListener: function () {},
            addListener: function () {},
            removeListener: function () {}
          };
        };
      }
      window.onerror = function (msg, source, lineno, colno, err) {
        uncaughtErrors.push(err || new Error(String(msg)));
      };

      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      window.localStorage.setItem('sis_sparks_token', 't1');

      window.google = {
        script: {
          run: createRunMock(window, fixtureHandler),
          history: {
            pushState: () => {},
            replaceState: () => {},
            setChangeHandler: () => {}
          },
          url: {
            getLocation: (cb) => {
              if (typeof cb === 'function') {
                window.setTimeout(() => cb({ hash: '', parameter: {}, parameters: {} }), 0);
              }
            }
          }
        }
      };
    }
  });

  // Wait for bootstrap to complete and nav links to populate
  const inited = await waitUntil(() => {
    const navEl = dom.window.document.getElementById('nav-links');
    return navEl && navEl.children.length === 11;
  }, 3000);

  if (!inited) {
    console.error('RESULT: FAIL (initApp timed out waiting for #nav-links with 11 items)');
    if (uncaughtErrors.length > 0) {
      console.error('Errors:', uncaughtErrors);
    }
    process.exit(1);
  }

  // Verify footer version runtime fill
  const footerEl = dom.window.document.getElementById('footer-version');
  if (!footerEl || footerEl.textContent !== 'v0.1.2') {
    console.error(`RESULT: FAIL (footer text was "${footerEl ? footerEl.textContent : 'missing'}", expected "v0.1.2")`);
    process.exit(1);
  }

  // Verify desktop sidebar toggle collapse/expand
  console.log('== Desktop Sidebar Toggle Verification ==');
  const btnToggleDesktop = dom.window.document.getElementById('btn-toggle-sidebar');
  const layoutDesktop = dom.window.document.getElementById('app-layout');
  if (!btnToggleDesktop || !layoutDesktop) {
    console.error('FAIL: #btn-toggle-sidebar or #app-layout not found');
    process.exit(1);
  }

  btnToggleDesktop.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: dom.window
  }));

  if (!layoutDesktop.classList.contains('sidebar-collapsed')) {
    console.error('FAIL desktop toggle: #app-layout missing sidebar-collapsed class after first click');
    process.exit(1);
  }
  console.log('PASS desktop sidebar toggle -> sidebar-collapsed class added');

  btnToggleDesktop.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: dom.window
  }));

  if (layoutDesktop.classList.contains('sidebar-collapsed')) {
    console.error('FAIL desktop toggle: #app-layout still has sidebar-collapsed class after second click');
    process.exit(1);
  }
  console.log('PASS desktop sidebar toggle -> sidebar-collapsed class removed');

  const navEl = dom.window.document.getElementById('nav-links');
  const links = Array.from(navEl.querySelectorAll('a.nav-item'));

  let passedClicks = 0;
  let failedClicks = 0;

  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const screenId = href.replace(/^#\/?/, '');
    const errCountBefore = uncaughtErrors.length;

    const clickEvt = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: dom.window
    });

    link.dispatchEvent(clickEvt);

    if (!clickEvt.defaultPrevented) {
      console.error(`FAIL click ${screenId}: defaultPrevented was false`);
      failedClicks++;
      continue;
    }

    const contentEl = dom.window.document.getElementById('content');
    const rendered = await waitUntil(() => {
      return contentEl && contentEl.innerHTML.trim().length > 0;
    }, 1500);

    // Let any trailing microtasks/render callbacks settle
    await sleep(30);

    const newErrors = uncaughtErrors.slice(errCountBefore);
    if (!rendered) {
      console.error(`FAIL click ${screenId}: #content was empty`);
      failedClicks++;
    } else if (newErrors.length > 0) {
      console.error(`FAIL click ${screenId}: uncaught error: ${newErrors[0].message || newErrors[0]}`);
      failedClicks++;
    } else {
      console.log(`PASS click ${screenId}`);
      passedClicks++;
    }
  }

  if (failedClicks > 0 || passedClicks !== 11) {
    console.error(`RESULT: FAIL (${failedClicks} failed)`);
    process.exit(1);
  }

  // --- Admin CRUD UI Scenarios (HQ) ---
  console.log('== Admin CRUD UI Verification ==');

  // 1. users table rendered
  const usersTableOk = await waitUntil(() => {
    return Boolean(dom.window.document.getElementById('btn-add-user'));
  }, 2000);
  if (!usersTableOk) {
    console.error('FAIL admin: #btn-add-user not found in users table');
    process.exit(1);
  }
  console.log('PASS admin users table rendered');

  // 2. click #btn-add-user -> modal visible (#modal-root not hidden, contains input[name=email])
  const btnAddUser = dom.window.document.getElementById('btn-add-user');
  btnAddUser.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  const modalVisible = await waitUntil(() => {
    const modal = dom.window.document.getElementById('modal-root');
    return modal && !modal.classList.contains('hidden') && Boolean(modal.querySelector('input[name="email"]'));
  }, 2000);
  if (!modalVisible) {
    console.error('FAIL admin: #modal-root not visible or missing input[name=email]');
    process.exit(1);
  }
  console.log('PASS click #btn-add-user -> modal visible');

  // 3. fill: email teacher1@seven-retail.com, full_name Teacher One, role select TEACHER, check center BTR; click #btn-submit-user
  const modalRoot = dom.window.document.getElementById('modal-root');
  const emailIn = modalRoot.querySelector('input[name="email"]');
  const nameIn = modalRoot.querySelector('input[name="full_name"]');
  const roleSel = modalRoot.querySelector('select[name="role"]');
  const btrCb = modalRoot.querySelector('input[name="user_center_code"][value="BTR"]');

  emailIn.value = 'teacher1@seven-retail.com';
  nameIn.value = 'Teacher One';
  roleSel.value = 'TEACHER';
  if (btrCb) btrCb.checked = true;

  const btnSubmitUser = modalRoot.querySelector('#btn-submit-user');
  btnSubmitUser.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  // 4. assert recorded saveUser payload: role === 'TEACHER', center_codes === 'BTR', email lowercased;
  // assert table now shows teacher1@seven-retail.com (auto-reload with stateful mock)
  await waitUntil(() => db.captured.saveUser.length > 0, 2000);
  const saveUserPayload = db.captured.saveUser[db.captured.saveUser.length - 1];
  if (!saveUserPayload || saveUserPayload.role !== 'TEACHER' || saveUserPayload.center_codes !== 'BTR' || saveUserPayload.email !== 'teacher1@seven-retail.com') {
    console.error('FAIL admin saveUser payload mismatch:', saveUserPayload);
    process.exit(1);
  }

  const userShown = await waitUntil(() => {
    const content = dom.window.document.getElementById('content');
    return content && content.innerHTML.includes('teacher1@seven-retail.com');
  }, 2000);
  if (!userShown) {
    console.error('FAIL admin: table did not reload with teacher1@seven-retail.com');
    process.exit(1);
  }
  console.log('PASS saveUser captured & row rendered in table');

  // 5. click that row's btn-toggle-user -> confirmDialog -> click #btn-confirm-ok -> assert toggleUser called with (email, false)
  const toggleBtn = dom.window.document.querySelector('.btn-toggle-user[data-email="teacher1@seven-retail.com"]');
  if (!toggleBtn) {
    console.error('FAIL admin: .btn-toggle-user for teacher1@seven-retail.com not found');
    process.exit(1);
  }
  toggleBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  const confirmVisible = await waitUntil(() => {
    const modal = dom.window.document.getElementById('modal-root');
    return modal && !modal.classList.contains('hidden') && Boolean(modal.querySelector('#btn-confirm-ok'));
  }, 2000);
  if (!confirmVisible) {
    console.error('FAIL admin: confirmDialog not visible');
    process.exit(1);
  }

  const btnConfirmOk = dom.window.document.getElementById('btn-confirm-ok');
  btnConfirmOk.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => db.captured.toggleUser.length > 0, 2000);
  const lastToggle = db.captured.toggleUser[db.captured.toggleUser.length - 1];
  if (!lastToggle || lastToggle.email !== 'teacher1@seven-retail.com' || lastToggle.isActive !== false) {
    console.error('FAIL admin: toggleUser mismatch:', lastToggle);
    process.exit(1);
  }
  console.log('PASS toggleUser called with (teacher1@seven-retail.com, false)');

  // 6. centers tab: add center flow -> assert saveCenter payload captured
  const centersTabBtn = dom.window.document.querySelector('.btn-admin-tab[data-tab="centers"]');
  centersTabBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => Boolean(dom.window.document.getElementById('btn-add-center')), 2000);
  const btnAddCenter = dom.window.document.getElementById('btn-add-center');
  btnAddCenter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => {
    const modal = dom.window.document.getElementById('modal-root');
    return modal && !modal.classList.contains('hidden') && Boolean(modal.querySelector('input[name="center_code"]'));
  }, 2000);

  const cModal = dom.window.document.getElementById('modal-root');
  cModal.querySelector('input[name="center_code"]').value = 'BDG';
  cModal.querySelector('input[name="center_name"]').value = 'Bandung';
  cModal.querySelector('input[name="center_no"]').value = '03';

  const btnSubmitCenter = cModal.querySelector('#btn-submit-center');
  btnSubmitCenter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => db.captured.saveCenter.length > 0, 2000);
  const saveCenterPayload = db.captured.saveCenter[db.captured.saveCenter.length - 1];
  if (!saveCenterPayload || saveCenterPayload.center_code !== 'BDG') {
    console.error('FAIL admin: saveCenter payload mismatch:', saveCenterPayload);
    process.exit(1);
  }
  console.log('PASS saveCenter flow captured');

  // 7. holidays tab: add -> assert saveHoliday captured; delete a seeded row -> assert deleteHoliday with (date, center)
  const holidaysTabBtn = dom.window.document.querySelector('.btn-admin-tab[data-tab="holidays"]');
  holidaysTabBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => Boolean(dom.window.document.getElementById('btn-add-holiday')), 2000);
  const btnAddHoliday = dom.window.document.getElementById('btn-add-holiday');
  btnAddHoliday.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => {
    const modal = dom.window.document.getElementById('modal-root');
    return modal && !modal.classList.contains('hidden') && Boolean(modal.querySelector('input[name="date"]'));
  }, 2000);

  const hModal = dom.window.document.getElementById('modal-root');
  hModal.querySelector('input[name="date"]').value = '2026-08-17';
  hModal.querySelector('input[name="description"]').value = 'Hari Kemerdekaan';

  const btnSubmitHoliday = hModal.querySelector('#btn-submit-holiday');
  btnSubmitHoliday.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => db.captured.saveHoliday.length > 0, 2000);
  const saveHolidayPayload = db.captured.saveHoliday[db.captured.saveHoliday.length - 1];
  if (!saveHolidayPayload || saveHolidayPayload.date !== '2026-08-17') {
    console.error('FAIL admin: saveHoliday payload mismatch:', saveHolidayPayload);
    process.exit(1);
  }
  console.log('PASS saveHoliday captured');

  // Delete seeded holiday (2026-12-25, BTR)
  await waitUntil(() => Boolean(dom.window.document.querySelector('.btn-del-holiday')), 2000);
  const delBtn = dom.window.document.querySelector('.btn-del-holiday[data-date="2026-12-25"][data-center="BTR"]');
  if (!delBtn) {
    console.error('FAIL admin: btn-del-holiday for 2026-12-25 BTR not found');
    process.exit(1);
  }
  delBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => {
    const modal = dom.window.document.getElementById('modal-root');
    return modal && !modal.classList.contains('hidden') && Boolean(modal.querySelector('#btn-confirm-ok'));
  }, 2000);

  const btnConfirmDel = dom.window.document.getElementById('btn-confirm-ok');
  btnConfirmDel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => db.captured.deleteHoliday.length > 0, 2000);
  const lastDel = db.captured.deleteHoliday[db.captured.deleteHoliday.length - 1];
  if (!lastDel || lastDel.date !== '2026-12-25' || lastDel.centerCode !== 'BTR') {
    console.error('FAIL admin: deleteHoliday mismatch:', lastDel);
    process.exit(1);
  }
  console.log('PASS deleteHoliday captured with (2026-12-25, BTR)');

  // 8. programs tab: add -> assert saveProgramLevel captured
  const programsTabBtn = dom.window.document.querySelector('.btn-admin-tab[data-tab="programs"]');
  programsTabBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => Boolean(dom.window.document.getElementById('btn-add-program')), 2000);
  const btnAddProg = dom.window.document.getElementById('btn-add-program');
  btnAddProg.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => {
    const modal = dom.window.document.getElementById('modal-root');
    return modal && !modal.classList.contains('hidden') && Boolean(modal.querySelector('input[name="program"]'));
  }, 2000);

  const pModal = dom.window.document.getElementById('modal-root');
  pModal.querySelector('input[name="program"]').value = 'Math';
  pModal.querySelector('input[name="level"]').value = '1A';
  pModal.querySelector('input[name="level_order"]').value = '1';
  pModal.querySelector('input[name="next_small_level"]').value = '1B';
  pModal.querySelector('input[name="next_big_level"]').value = '2A';

  const btnSubmitProg = pModal.querySelector('#btn-submit-program');
  btnSubmitProg.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));

  await waitUntil(() => db.captured.saveProgramLevel.length > 0, 2000);
  const saveProgPayload = db.captured.saveProgramLevel[db.captured.saveProgramLevel.length - 1];
  if (!saveProgPayload || saveProgPayload.program !== 'Math' || saveProgPayload.level !== '1A') {
    console.error('FAIL admin: saveProgramLevel mismatch:', saveProgPayload);
    process.exit(1);
  }
  console.log('PASS saveProgramLevel captured');

  // --- Scenario 2: TEACHER Role ---
  console.log('== Teacher Role Verification ==');
  const teacherSessions = { 't1': { email: 'teacher@seven-retail.com', role: 'TEACHER' } };
  const teacherDb = createStatefulDb();
  const teacherFixture = makeFixtureHandler(teacherDb, 'TEACHER', teacherSessions);
  const teacherErrors = [];
  const teacherConsole = new VirtualConsole();
  teacherConsole.on('jsdomError', (err) => { teacherErrors.push(err); });

  const teacherDom = new JSDOM(fullHtml, {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: teacherConsole,
    url: 'https://script.google.com/macros/s/test/exec',
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
      if (!window.matchMedia) {
        window.matchMedia = function (q) {
          const m = /max-width:\s*(\d+)px/.exec(q);
          return {
            matches: m ? window.innerWidth <= Number(m[1]) : false,
            addEventListener: function () {},
            removeEventListener: function () {},
            addListener: function () {},
            removeListener: function () {}
          };
        };
      }
      window.onerror = function (msg, source, lineno, colno, err) {
        teacherErrors.push(err || new Error(String(msg)));
      };
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      window.localStorage.setItem('sis_sparks_token', 't1');
      window.google = {
        script: {
          run: createRunMock(window, teacherFixture),
          history: { pushState: () => {}, replaceState: () => {}, setChangeHandler: () => {} },
          url: { getLocation: (cb) => { if (typeof cb === 'function') window.setTimeout(() => cb({ hash: '', parameter: {}, parameters: {} }), 0); } }
        }
      };
    }
  });

  const teacherInited = await waitUntil(() => {
    const navEl2 = teacherDom.window.document.getElementById('nav-links');
    return navEl2 && navEl2.children.length === 4;
  }, 3000);

  if (!teacherInited) {
    console.error('FAIL: teacher role nav links did not populate with 4 items');
    process.exit(1);
  }

  const teacherAdminLink = teacherDom.window.document.querySelector('a[href="#/admin"]');
  if (teacherAdminLink) {
    console.error('FAIL: #/admin link exists in TEACHER nav');
    process.exit(1);
  }
  console.log('PASS TEACHER: exactly 4 nav links rendered, no #/admin link');

  const teacherNavLinks = Array.from(teacherDom.window.document.querySelectorAll('#nav-links a.nav-item'));
  let teacherPassedClicks = 0;

  for (const link of teacherNavLinks) {
    const href = link.getAttribute('href') || '';
    const screenId = href.replace(/^#\/?/, '');
    const errCountBefore = teacherErrors.length;

    const clickEvt = new teacherDom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: teacherDom.window
    });

    link.dispatchEvent(clickEvt);
    if (!clickEvt.defaultPrevented) {
      console.error(`FAIL click TEACHER ${screenId}: defaultPrevented was false`);
      process.exit(1);
    }

    const contentEl = teacherDom.window.document.getElementById('content');
    const rendered = await waitUntil(() => {
      return contentEl && contentEl.innerHTML.trim().length > 0;
    }, 1500);

    await sleep(30);

    const newErrors = teacherErrors.slice(errCountBefore);
    if (!rendered) {
      console.error(`FAIL click TEACHER ${screenId}: #content was empty`);
      process.exit(1);
    } else if (newErrors.length > 0) {
      console.error(`FAIL click TEACHER ${screenId}: uncaught error: ${newErrors[0].message || newErrors[0]}`);
      process.exit(1);
    } else {
      console.log(`PASS click TEACHER ${screenId}`);
      teacherPassedClicks++;
    }
  }

  if (teacherPassedClicks !== 4) {
    console.error(`FAIL: teacher passed clicks was ${teacherPassedClicks}, expected 4`);
    process.exit(1);
  }

  // --- Scenario 3: Mobile Sidebar Verification (width 600) ---
  console.log('== Mobile Sidebar Verification ==');
  const mobileSessions = { 't1': { email: 'aulya.kustyawan@seven-retail.com', role: 'HQ' } };
  const mobileDb = createStatefulDb();
  const mobileFixture = makeFixtureHandler(mobileDb, 'HQ', mobileSessions);
  const mobileErrors = [];
  const mobileConsole = new VirtualConsole();
  mobileConsole.on('jsdomError', (err) => { mobileErrors.push(err); });

  const mobileDom = new JSDOM(fullHtml, {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: mobileConsole,
    url: 'https://script.google.com/macros/s/test/exec',
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true, writable: true });
      if (!window.matchMedia) {
        window.matchMedia = function (q) {
          const m = /max-width:\s*(\d+)px/.exec(q);
          return {
            matches: m ? window.innerWidth <= Number(m[1]) : false,
            addEventListener: function () {},
            removeEventListener: function () {},
            addListener: function () {},
            removeListener: function () {}
          };
        };
      }
      window.onerror = function (msg, source, lineno, colno, err) {
        mobileErrors.push(err || new Error(String(msg)));
      };
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      window.localStorage.setItem('sis_sparks_token', 't1');
      window.google = {
        script: {
          run: createRunMock(window, mobileFixture),
          history: { pushState: () => {}, replaceState: () => {}, setChangeHandler: () => {} },
          url: { getLocation: (cb) => { if (typeof cb === 'function') window.setTimeout(() => cb({ hash: '', parameter: {}, parameters: {} }), 0); } }
        }
      };
    }
  });

  const mobileInited = await waitUntil(() => {
    const navEl3 = mobileDom.window.document.getElementById('nav-links');
    return navEl3 && navEl3.children.length === 11;
  }, 3000);

  if (!mobileInited) {
    console.error('FAIL: mobile sim initApp timed out waiting for #nav-links with 11 items');
    process.exit(1);
  }

  const mobileBtnToggle = mobileDom.window.document.getElementById('btn-toggle-sidebar');
  const mobileNav = mobileDom.window.document.getElementById('nav');
  if (!mobileBtnToggle || !mobileNav) {
    console.error('FAIL mobile: #btn-toggle-sidebar or #nav missing');
    process.exit(1);
  }

  // 1. click #btn-toggle-sidebar -> #nav gets class open
  mobileBtnToggle.dispatchEvent(new mobileDom.window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: mobileDom.window
  }));

  if (!mobileNav.classList.contains('open')) {
    console.error('FAIL mobile toggle: #nav does not have open class after toggle click');
    process.exit(1);
  }
  console.log('PASS mobile sidebar toggle -> #nav open');

  // 2. click a nav link (e.g. #/murid) -> #nav class open is REMOVED (auto-close) and content renders
  const mobileMuridLink = mobileDom.window.document.querySelector('#nav-links a[href="#/murid"]');
  if (!mobileMuridLink) {
    console.error('FAIL mobile: #/murid link not found in #nav-links');
    process.exit(1);
  }

  const mobileClickEvt = new mobileDom.window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: mobileDom.window
  });
  mobileMuridLink.dispatchEvent(mobileClickEvt);

  if (!mobileClickEvt.defaultPrevented) {
    console.error('FAIL mobile click #/murid: defaultPrevented was false');
    process.exit(1);
  }

  if (mobileNav.classList.contains('open')) {
    console.error('FAIL mobile auto-close: #nav still has open class after navigation');
    process.exit(1);
  }

  const mobileContentEl = mobileDom.window.document.getElementById('content');
  const mobileRendered = await waitUntil(() => {
    return mobileContentEl && mobileContentEl.innerHTML.trim().length > 0;
  }, 1500);

  if (!mobileRendered) {
    console.error('FAIL mobile click #/murid: #content was empty');
    process.exit(1);
  }

  if (mobileErrors.length > 0) {
    console.error(`FAIL mobile click #/murid: uncaught error: ${mobileErrors[0].message || mobileErrors[0]}`);
    process.exit(1);
  }

  console.log('PASS mobile nav click -> #nav open class removed & content rendered');

  // --- Scenario 4: OTP Login (External Gmail) ---
  console.log('== OTP Login (External) Verification ==');
  const otpSessions = {};
  const otpDb = createStatefulDb();
  const otpFixture = makeFixtureHandler(otpDb, 'HQ', otpSessions);
  const otpErrors = [];
  const otpConsole = new VirtualConsole();
  otpConsole.on('jsdomError', (err) => { otpErrors.push(err); });

  const otpDom = new JSDOM(fullHtml, {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: otpConsole,
    url: 'https://script.google.com/macros/s/test/exec',
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
      if (!window.matchMedia) {
        window.matchMedia = function (q) {
          const m = /max-width:\s*(\d+)px/.exec(q);
          return {
            matches: m ? window.innerWidth <= Number(m[1]) : false,
            addEventListener: function () {},
            removeEventListener: function () {},
            addListener: function () {},
            removeListener: function () {}
          };
        };
      }
      window.onerror = function (msg, source, lineno, colno, err) {
        otpErrors.push(err || new Error(String(msg)));
      };
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      // Ensure NO token initially
      window.localStorage.clear();
      window.google = {
        script: {
          run: createRunMock(window, otpFixture),
          history: { pushState: () => {}, replaceState: () => {}, setChangeHandler: () => {} },
          url: { getLocation: (cb) => { if (typeof cb === 'function') window.setTimeout(() => cb({ hash: '', parameter: {}, parameters: {} }), 0); } }
        }
      };
    }
  });

  // 1. Fresh window, NO token -> login screen rendered
  const loginScreenVisible = await waitUntil(() => {
    return Boolean(otpDom.window.document.getElementById('login-email')) &&
           Boolean(otpDom.window.document.getElementById('btn-send-code'));
  }, 3000);

  if (!loginScreenVisible) {
    console.error('FAIL OTP: login screen (#login-email / #btn-send-code) not rendered');
    process.exit(1);
  }
  console.log('PASS OTP: login screen visible on start');

  // 2. Fill #login-email and click #btn-send-code
  const otpEmailIn = otpDom.window.document.getElementById('login-email');
  otpEmailIn.value = 'external.guru@gmail.com';

  const btnSendCode = otpDom.window.document.getElementById('btn-send-code');
  btnSendCode.dispatchEvent(new otpDom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: otpDom.window }));

  // 3. #login-code-wrap visible
  const codeWrapVisible = await waitUntil(() => {
    const wrap = otpDom.window.document.getElementById('login-code-wrap');
    return wrap && !wrap.classList.contains('hidden');
  }, 2000);

  if (!codeWrapVisible) {
    console.error('FAIL OTP: #login-code-wrap not visible after clicking #btn-send-code');
    process.exit(1);
  }
  console.log('PASS OTP: #login-code-wrap visible after send code');

  // 4. Fill #login-code with '123456'
  const otpCodeIn = otpDom.window.document.getElementById('login-code');
  otpCodeIn.value = '123456';

  // 5. BEFORE clicking #btn-verify-code, override reloadApp_ to simulate reload via DOMContentLoaded
  otpDom.window.reloadApp_ = () => {
    otpDom.window.__reloads = (otpDom.window.__reloads || 0) + 1;
    otpDom.window.dispatchEvent(new otpDom.window.Event('DOMContentLoaded'));
  };

  // 6. Click #btn-verify-code
  const btnVerifyCode = otpDom.window.document.getElementById('btn-verify-code');
  btnVerifyCode.dispatchEvent(new otpDom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: otpDom.window }));

  // 7. Assert localStorage has token 'tokNew'
  const tokenSaved = await waitUntil(() => {
    return otpDom.window.localStorage.getItem('sis_sparks_token') === 'tokNew';
  }, 2000);

  if (!tokenSaved) {
    console.error('FAIL OTP: localStorage["sis_sparks_token"] !== "tokNew"');
    process.exit(1);
  }
  console.log('PASS OTP: session token saved in localStorage');

  // 8. Assert __reloads === 1
  const reloaded = await waitUntil(() => otpDom.window.__reloads === 1, 2000);
  if (!reloaded) {
    console.error('FAIL OTP: window.__reloads was not 1');
    process.exit(1);
  }
  console.log('PASS OTP: reloadApp_ triggered reload (DOMContentLoaded)');

  // 9. After re-init, assert nav links populated with 11 items & login screen removed
  const appLoaded = await waitUntil(() => {
    const nav = otpDom.window.document.getElementById('nav-links');
    return nav && nav.children.length === 11;
  }, 3000);

  if (!appLoaded) {
    console.error('FAIL OTP: app did not load with 11 nav items after login');
    process.exit(1);
  }

  const leftoverLogin = otpDom.window.document.querySelector('.login-screen');
  if (leftoverLogin) {
    console.error('FAIL OTP: .login-screen element still present after login');
    process.exit(1);
  }
  console.log('PASS OTP: nav rendered & login screen removed');

  console.log('');
  console.log(`RESULT: PASS (${passedClicks} HQ clicks + 8 admin CRUD steps + ${teacherPassedClicks} TEACHER clicks + desktop & mobile sidebar toggle + OTP login flow)`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Unexpected error in ui-sim:', err);
  process.exit(1);
});

#!/usr/bin/env node
/* ui-sim.js — Click-through regression harness for SIS Sparks Math navigation.
 *
 * Simulates in-browser clicking of all sidebar navigation links in JSDOM.
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

function fixtureFor(methodName, args) {
  switch (methodName) {
    case 'getAppBootstrap':
      return {
        state: 'ok',
        notRegistered: false,
        dbReady: true,
        version: '0.1.2',
        title: 'Sistem Administrasi Akademik Sparks Math',
        user: {
          email: 'aulya.kustyawan@seven-retail.com',
          full_name: 'Test',
          role: 'HQ',
          centers: []
        },
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
    case 'listCenters':
      return [
        { center_code: 'CTR1', center_name: 'Center 1', center_no: '01', is_active: true }
      ];
    case 'listClasses':
      return [
        {
          class_id: 'CLS1',
          class_name: 'Class 1',
          center_code: 'CTR1',
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
      return { student_id: 'STU1', full_name: 'Murid 1', center_code: 'CTR1', status: 'Active' };
    case 'getClassDetail':
      return {
        klass: { class_id: 'CLS1', class_name: 'Class 1', center_code: 'CTR1' },
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
    case 'listUsers':
      return [
        {
          email: 'aulya.kustyawan@seven-retail.com',
          full_name: 'Test',
          role: 'HQ',
          center_codes: 'Semua',
          is_active: true
        }
      ];
    case 'listTeachers':
      return [];
    case 'listProgramsLevels':
      return [];
    case 'listHolidays':
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
}

function createRunMock(win) {
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
              const res = fixtureFor(prop, args);
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
      window.onerror = function (msg, source, lineno, colno, err) {
        uncaughtErrors.push(err || new Error(String(msg)));
      };

      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';

      window.google = {
        script: {
          run: createRunMock(window),
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

  if (failedClicks === 0 && passedClicks === 11) {
    console.log(`RESULT: PASS (${passedClicks} clicks)`);
    process.exit(0);
  } else {
    console.error(`RESULT: FAIL (${failedClicks} failed)`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error in ui-sim:', err);
  process.exit(1);
});

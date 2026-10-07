#!/usr/bin/env node
/* login-sim.js — Retest harness for authentication, API dispatcher, and OTP routing.
 *
 * Simulates Apps Script environment and runs scenarios S1-S11.
 * Exit code 0 and RESULT: PASS (11 scenarios) on success.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const configCode = fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8');
const setupCode = fs.readFileSync(path.join(SRC, 'Setup.gs'), 'utf8');
const dbCode = fs.readFileSync(path.join(SRC, 'Db.gs'), 'utf8');
const authCode = fs.readFileSync(path.join(SRC, 'Auth.gs'), 'utf8');
const apiCode = fs.readFileSync(path.join(SRC, 'Api.gs'), 'utf8');
const adminCode = fs.readFileSync(path.join(SRC, 'Admin.gs'), 'utf8');
const attendanceCode = fs.readFileSync(path.join(SRC, 'Attendance.gs'), 'utf8');
const combinedSource = [configCode, setupCode, dbCode, authCode, apiCode, adminCode, attendanceCode].join('\n;\n');

const USERS_HEADER = [
  'email', 'full_name', 'role', 'center_codes', 'is_active',
  'created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted'
];

const AUTH_SESSIONS_HEADER = [
  'token', 'email', 'created_at', 'expires_at', 'last_seen_at',
  'is_deleted', 'updated_at', 'updated_by'
];

const AUTH_CODES_HEADER = [
  'email', 'code', 'expires_at', 'attempts', 'created_at',
  'is_deleted', 'updated_at', 'updated_by'
];

function createContext({ dbId, usersRows, sheetsData, activeEmail, effectiveEmail }) {
  const properties = {};
  if (dbId !== undefined && dbId !== null) {
    properties['DB_SPREADSHEET_ID'] = String(dbId);
  }

  const sheets = {};
  if (usersRows) {
    sheets['users'] = usersRows.map(row => Array.isArray(row) ? row.slice() : row);
  }
  if (sheetsData) {
    for (const [name, rows] of Object.entries(sheetsData)) {
      sheets[name] = rows.map(row => Array.isArray(row) ? row.slice() : row);
    }
  }

  const sentEmails = [];
  let lastEmail = null;

  function createSheetMock(rows) {
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => {
        if (rows.length === 0) return 0;
        return Math.max(...rows.map(r => r.length));
      },
      getRange: (r, c, nr, nc) => ({
        getValues: () => {
          const result = [];
          for (let i = 0; i < nr; i++) {
            const rowIdx = (r - 1) + i;
            const rowData = rows[rowIdx] || [];
            const rowSlice = [];
            for (let j = 0; j < nc; j++) {
              const colIdx = (c - 1) + j;
              rowSlice.push(rowData[colIdx] !== undefined ? rowData[colIdx] : '');
            }
            result.push(rowSlice);
          }
          return result;
        },
        setValues: (newVals) => {
          for (let i = 0; i < newVals.length; i++) {
            const rowIdx = (r - 1) + i;
            if (!rows[rowIdx]) rows[rowIdx] = [];
            for (let j = 0; j < newVals[i].length; j++) {
              const colIdx = (c - 1) + j;
              rows[rowIdx][colIdx] = newVals[i][j];
            }
          }
        }
      }),
      appendRow: (arr) => {
        rows.push(arr.slice());
      },
      setFrozenRows: (_n) => {}
    };
  }

  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] !== undefined ? properties[key] : null,
        setProperty: (key, val) => { properties[key] = String(val); }
      })
    },
    SpreadsheetApp: {
      openById: (id) => {
        if (!id) {
          throw new Error('Cannot open spreadsheet with id: null');
        }
        return {
          getSheetByName: (name) => {
            if (!sheets[name]) return null;
            return createSheetMock(sheets[name]);
          },
          insertSheet: (name) => {
            if (!sheets[name]) sheets[name] = [];
            return createSheetMock(sheets[name]);
          }
        };
      }
    },
    MailApp: {
      sendEmail: (opts) => {
        sentEmails.push(opts);
        lastEmail = opts;
      }
    },
    Utilities: {
      getUuid: () => {
        let d = Date.now();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (d + Math.random() * 16) % 16 | 0;
          d = Math.floor(d / 16);
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => {},
        remove: () => {}
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => true,
        releaseLock: () => {}
      })
    },
    Session: {
      getActiveUser: () => ({
        getEmail: () => activeEmail !== undefined ? activeEmail : ''
      }),
      getEffectiveUser: () => ({
        getEmail: () => effectiveEmail !== undefined ? effectiveEmail : (activeEmail !== undefined ? activeEmail : '')
      })
    },
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(combinedSource, context);
  context.__getLastEmail = () => lastEmail;
  context.__getSentEmails = () => sentEmails.slice();
  context.__getSheets = () => sheets;
  return context;
}

const scenarios = [
  {
    id: 'S1',
    description: 'DB ready, active SA user, session same',
    run: () => {
      const email = 'aulya.kustyawan@seven-retail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [email, 'Aulya Kustyawan', 'SA', 'BTR', true, '', '', '', '', false]
        ],
        activeEmail: email
      });

      const res = ctx.getAppBootstrap();
      if (res.state !== 'ok') throw new Error(`state expected 'ok', got '${res.state}'`);
      if (res.notRegistered !== false) throw new Error(`notRegistered expected false, got ${res.notRegistered}`);
      if (!res.token || typeof res.token !== 'string' || res.token.length === 0) {
        throw new Error(`token expected non-empty string, got '${res.token}'`);
      }
      if (!res.user || res.user.role !== 'SA') throw new Error(`user.role expected 'SA', got '${res.user ? res.user.role : 'undefined'}'`);

      const navIds = (res.nav || []).map(n => n.id).join(',');
      const expectedNav = 'beranda,murid,kelas,penilaian,event,waiting,media';
      if (navIds !== expectedNav) throw new Error(`nav expected '${expectedNav}', got '${navIds}'`);

      const diag = ctx.diagnoseLogin();
      if (!diag || diag.matchedEmail !== true) throw new Error(`diagnoseLogin.matchedEmail expected true, got ${diag ? diag.matchedEmail : 'null'}`);
      if (!diag || typeof diag.verdict !== 'string' || diag.verdict.trim().length === 0) {
        throw new Error(`diagnoseLogin.verdict expected non-empty string, got '${diag ? diag.verdict : ''}'`);
      }
    }
  },
  {
    id: 'S2',
    description: 'DB ready, users sheet empty',
    run: () => {
      const email = 'aulya.kustyawan@seven-retail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [USERS_HEADER],
        activeEmail: email
      });

      const res = ctx.getAppBootstrap();
      if (res.state !== 'not-registered') throw new Error(`state expected 'not-registered', got '${res.state}'`);
      if (res.email !== email) throw new Error(`email expected '${email}', got '${res.email}'`);
    }
  },
  {
    id: 'S3',
    description: 'user row is_active: false',
    run: () => {
      const email = 'aulya.kustyawan@seven-retail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [email, 'Aulya Kustyawan', 'SA', 'BTR', false, '', '', '', '', false]
        ],
        activeEmail: email
      });

      const res = ctx.getAppBootstrap();
      if (res.state !== 'inactive') throw new Error(`state expected 'inactive', got '${res.state}'`);
    }
  },
  {
    id: 'S4',
    description: 'session email empty',
    run: () => {
      const email = 'aulya.kustyawan@seven-retail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [email, 'Aulya Kustyawan', 'SA', 'BTR', true, '', '', '', '', false]
        ],
        activeEmail: ''
      });

      let res;
      try {
        res = ctx.getAppBootstrap();
      } catch (e) {
        throw new Error(`getAppBootstrap threw: ${e.message}`);
      }
      if (res.state !== 'login-required') throw new Error(`state expected 'login-required', got '${res.state}'`);
    }
  },
  {
    id: 'S5',
    description: 'DB property unset (openById must throw if called)',
    run: () => {
      const ctx = createContext({
        dbId: null,
        usersRows: null,
        activeEmail: 'aulya.kustyawan@seven-retail.com'
      });

      let res;
      try {
        res = ctx.getAppBootstrap();
      } catch (e) {
        throw new Error(`getAppBootstrap threw: ${e.message}`);
      }
      if (res.state !== 'db-not-ready') throw new Error(`state expected 'db-not-ready', got '${res.state}'`);
    }
  },
  {
    id: 'S6',
    description: 'stored email case and space variation, session lowercase',
    run: () => {
      const storedEmail = 'AULYA.Kustyawan@Seven-Retail.com ';
      const sessionEmail = 'aulya.kustyawan@seven-retail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [storedEmail, 'Aulya Kustyawan', 'SA', 'BTR', true, '', '', '', '', false]
        ],
        activeEmail: sessionEmail
      });

      const res = ctx.getAppBootstrap();
      if (res.state !== 'ok') throw new Error(`state expected 'ok', got '${res.state}'`);
      if (!res.token || typeof res.token !== 'string' || res.token.length === 0) {
        throw new Error(`token expected non-empty string, got '${res.token}'`);
      }
    }
  },
  {
    id: 'S7',
    description: "is_active stored as string 'TRUE'",
    run: () => {
      const email = 'aulya.kustyawan@seven-retail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [email, 'Aulya Kustyawan', 'SA', 'BTR', 'TRUE', '', '', '', '', false]
        ],
        activeEmail: email
      });

      const res = ctx.getAppBootstrap();
      if (res.state !== 'ok') throw new Error(`state expected 'ok', got '${res.state}'`);
      if (!res.token || typeof res.token !== 'string' || res.token.length === 0) {
        throw new Error(`token expected non-empty string, got '${res.token}'`);
      }
    }
  },
  {
    id: 'S8',
    description: 'valid token resolves identity and allows calling protected API',
    run: () => {
      const hqEmail = 'hq.admin@external.com';
      const now = new Date();
      const future = new Date(Date.now() + 30 * 86400000);
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [hqEmail, 'HQ Admin', 'HQ', '', true, '', '', '', '', false]
        ],
        sheetsData: {
          auth_sessions: [
            AUTH_SESSIONS_HEADER,
            ['tokA', hqEmail, now.toISOString(), future.toISOString(), now.toISOString(), false, '', '']
          ]
        },
        activeEmail: '' // empty Session email (external user)
      });

      const users = ctx.callApi('listUsers', [], 'tokA');
      if (!Array.isArray(users)) throw new Error(`expected array from listUsers, got ${typeof users}`);
      const found = users.find(u => u.email === hqEmail);
      if (!found) throw new Error(`expected listUsers to return seeded HQ user ${hqEmail}`);
    }
  },
  {
    id: 'S9',
    description: 'invalid token with empty session throws error',
    run: () => {
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          ['hq.admin@external.com', 'HQ Admin', 'HQ', '', true, '', '', '', '', false]
        ],
        activeEmail: '' // empty Session email
      });

      let threw = false;
      try {
        ctx.callApi('listUsers', [], 'nope');
      } catch (err) {
        threw = true;
        if (!/Sesi tidak ditemukan|masuk terlebih dahulu/i.test(err.message)) {
          throw new Error(`expected session error message, got: ${err.message}`);
        }
      }
      if (!threw) throw new Error('callApi with invalid token should have thrown');
    }
  },
  {
    id: 'S10',
    description: 'OTP flow: request code, capture email, wrong code fails, valid code returns token, callApi works, unregistered fails with no email',
    run: () => {
      const guruEmail = 'guru@gmail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [guruEmail, 'Guru Sparks', 'TEACHER', 'BTR', true, '', '', '', '', false]
        ],
        activeEmail: ''
      });

      // 1. Request code for registered guru
      const reqRes = ctx.requestLoginCode(guruEmail);
      if (!reqRes || !reqRes.ok) throw new Error(`requestLoginCode failed: ${reqRes ? reqRes.message : 'no response'}`);

      // 2. Email captured & extract code
      const emailObj = ctx.__getLastEmail();
      if (!emailObj) throw new Error('No email captured by MailApp');
      if (emailObj.to !== guruEmail) throw new Error(`Expected email to ${guruEmail}, got ${emailObj.to}`);

      const codeMatch = emailObj.body.match(/\b\d{6}\b/);
      if (!codeMatch) throw new Error(`Could not extract 6-digit code from email body: ${emailObj.body}`);
      const realCode = codeMatch[0];

      // 3. Verify with wrong code -> ok: false
      const wrongRes = ctx.verifyLoginCode(guruEmail, '000000');
      if (!wrongRes || wrongRes.ok !== false) throw new Error(`verifyLoginCode with 000000 should fail, got ${JSON.stringify(wrongRes)}`);

      // 4. Verify with real code -> ok: true + token
      const okRes = ctx.verifyLoginCode(guruEmail, realCode);
      if (!okRes || !okRes.ok) throw new Error(`verifyLoginCode with real code failed: ${okRes ? okRes.message : 'no response'}`);
      if (!okRes.token || typeof okRes.token !== 'string') throw new Error(`Expected token, got ${okRes.token}`);

      // 5. callApi('getMySessions', ['today'], token) works
      const sessions = ctx.callApi('getMySessions', ['today'], okRes.token);
      if (!Array.isArray(sessions)) throw new Error(`Expected array from getMySessions, got ${typeof sessions}`);

      // 6. Request code for unregistered user -> ok: false and NO email sent
      const emailCountBefore = ctx.__getSentEmails().length;
      const unregRes = ctx.requestLoginCode('asing@x.com');
      if (!unregRes || unregRes.ok !== false) throw new Error('requestLoginCode for unregistered user should return ok:false');
      const emailCountAfter = ctx.__getSentEmails().length;
      if (emailCountAfter !== emailCountBefore) throw new Error('No email should be sent for unregistered user');
    }
  },
  {
    id: 'S11',
    description: 'rate limit: immediate second requestLoginCode returns ok:false with wait message',
    run: () => {
      const guruEmail = 'guru@gmail.com';
      const ctx = createContext({
        dbId: 'db-spread-id-123456',
        usersRows: [
          USERS_HEADER,
          [guruEmail, 'Guru Sparks', 'TEACHER', 'BTR', true, '', '', '', '', false]
        ],
        activeEmail: ''
      });

      const firstRes = ctx.requestLoginCode(guruEmail);
      if (!firstRes || !firstRes.ok) throw new Error(`First request failed: ${firstRes ? firstRes.message : 'none'}`);

      const secondRes = ctx.requestLoginCode(guruEmail);
      if (!secondRes || secondRes.ok !== false) throw new Error(`Second request should fail rate limit, got ${JSON.stringify(secondRes)}`);
      if (!/tunggu/i.test(secondRes.message)) throw new Error(`Expected message to contain 'tunggu', got: ${secondRes.message}`);
    }
  }
];

let failedCount = 0;

for (const scenario of scenarios) {
  try {
    scenario.run();
    console.log(`PASS ${scenario.id} — ${scenario.description}`);
  } catch (err) {
    failedCount++;
    console.log(`FAIL ${scenario.id} — ${scenario.description} (${err.message})`);
  }
}

console.log('');
if (failedCount === 0) {
  console.log(`RESULT: PASS (${scenarios.length} scenarios)`);
  process.exit(0);
} else {
  console.log(`RESULT: FAIL (${failedCount}/${scenarios.length} failed)`);
  process.exit(1);
}

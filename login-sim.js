#!/usr/bin/env node
/* login-sim.js — Retest harness for authentication and bootstrap routing.
 *
 * Simulates Apps Script environment and runs scenarios S1-S7.
 * Exit code 0 and RESULT: PASS (7 scenarios) on success.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const configCode = fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8');
const dbCode = fs.readFileSync(path.join(SRC, 'Db.gs'), 'utf8');
const authCode = fs.readFileSync(path.join(SRC, 'Auth.gs'), 'utf8');
const combinedSource = [configCode, dbCode, authCode].join('\n;\n');

const USERS_HEADER = [
  'email', 'full_name', 'role', 'center_codes', 'is_active',
  'created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted'
];

function createContext({ dbId, usersRows, activeEmail, effectiveEmail }) {
  const properties = {};
  if (dbId !== undefined && dbId !== null) {
    properties['DB_SPREADSHEET_ID'] = String(dbId);
  }

  const sheets = {};
  if (usersRows) {
    sheets['users'] = usersRows.map(row => Array.isArray(row) ? row.slice() : row);
  }

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
            sheets[name] = [];
            return createSheetMock(sheets[name]);
          }
        };
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
      if (res.state !== 'email-unavailable') throw new Error(`state expected 'email-unavailable', got '${res.state}'`);
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

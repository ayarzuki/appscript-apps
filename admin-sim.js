#!/usr/bin/env node
/* admin-sim.js — Server data harness for Admin CRUD and composite data operations.
 *
 * Simulates Apps Script environment and runs scenarios S1-S5.
 * Exit code 0 and RESULT: PASS (5 scenarios) on success.
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
const adminCode = fs.readFileSync(path.join(SRC, 'Admin.gs'), 'utf8');
const classesCode = fs.readFileSync(path.join(SRC, 'Classes.gs'), 'utf8');
const combinedSource = [configCode, dbCode, authCode, adminCode, classesCode].join('\n;\n');

const STANDARD_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted'];

const USERS_HEADER = [
  'email', 'full_name', 'role', 'center_codes', 'is_active',
  ...STANDARD_COLUMNS
];

const PROGRAMS_LEVELS_HEADER = [
  'program', 'level', 'level_order', 'next_small_level', 'next_big_level',
  ...STANDARD_COLUMNS
];

const HOLIDAYS_HEADER = [
  'date', 'center_code', 'description',
  ...STANDARD_COLUMNS
];

const AUDIT_LOG_HEADER = [
  'timestamp', 'user_email', 'action', 'table_name', 'record_id',
  'before_json', 'after_json',
  ...STANDARD_COLUMNS
];

function createContext({ dbId, sheetsData, activeEmail }) {
  const properties = {
    DB_SPREADSHEET_ID: dbId || 'mock-db-id'
  };

  const sheets = {};
  if (sheetsData) {
    for (const [name, rows] of Object.entries(sheetsData)) {
      sheets[name] = rows.map(row => Array.isArray(row) ? row.slice() : row);
    }
  }

  if (!sheets['audit_log']) {
    sheets['audit_log'] = [AUDIT_LOG_HEADER.slice()];
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
        },
        setValues: (values) => {
          for (let i = 0; i < values.length; i++) {
            const rowIdx = (r - 1) + i;
            while (rows.length <= rowIdx) {
              rows.push([]);
            }
            for (let j = 0; j < values[i].length; j++) {
              const colIdx = (c - 1) + j;
              rows[rowIdx][colIdx] = values[i][j];
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

  let mockLockHeld = false;
  const cacheStore = {};

  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] !== undefined ? properties[key] : null,
        setProperty: (key, val) => { properties[key] = String(val); }
      })
    },
    SpreadsheetApp: {
      openById: (id) => {
        if (!id) throw new Error('Cannot open spreadsheet with id: null');
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
        get: (k) => cacheStore[k] || null,
        put: (k, v) => { cacheStore[k] = String(v); },
        remove: (k) => { delete cacheStore[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (mockLockHeld) throw new Error('LockService: nested/contended acquire in same execution');
          mockLockHeld = true;
          return true;
        },
        releaseLock: () => { mockLockHeld = false; }
      })
    },
    Session: {
      getActiveUser: () => ({
        getEmail: () => activeEmail !== undefined ? activeEmail : 'admin@seven-retail.com'
      }),
      getEffectiveUser: () => ({
        getEmail: () => activeEmail !== undefined ? activeEmail : 'admin@seven-retail.com'
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
  return { context, sheets };
}

const scenarios = [
  {
    id: 'S1',
    description: "saveUser create (role TEACHER, center_codes 'BTR') -> row appended, is_active true",
    run: () => {
      const adminEmail = 'admin@seven-retail.com';
      const { context, sheets } = createContext({
        activeEmail: adminEmail,
        sheetsData: {
          users: [
            USERS_HEADER,
            [adminEmail, 'HQ Admin', 'HQ', '', true, '2026-01-01', 'system', '2026-01-01', 'system', false]
          ]
        }
      });

      const res = context.saveUser({
        email: 'teacher1@seven-retail.com',
        full_name: 'Teacher One',
        role: 'TEACHER',
        center_codes: 'BTR'
      });

      if (!res) throw new Error('saveUser returned null or undefined');
      if (res.email !== 'teacher1@seven-retail.com') throw new Error(`expected email teacher1@seven-retail.com, got ${res.email}`);
      if (res.role !== 'TEACHER') throw new Error(`expected role TEACHER, got ${res.role}`);
      if (res.center_codes !== 'BTR') throw new Error(`expected center_codes BTR, got ${res.center_codes}`);
      if (res.is_active !== true) throw new Error(`expected is_active true, got ${res.is_active}`);

      const userRows = sheets.users;
      if (userRows.length !== 3) throw new Error(`expected 3 rows in users sheet, got ${userRows.length}`);
      const newRow = userRows[2];
      if (newRow[0] !== 'teacher1@seven-retail.com') throw new Error(`row email mismatch: ${newRow[0]}`);
      if (newRow[1] !== 'Teacher One') throw new Error(`row full_name mismatch: ${newRow[1]}`);
      if (newRow[2] !== 'TEACHER') throw new Error(`row role mismatch: ${newRow[2]}`);
      if (newRow[3] !== 'BTR') throw new Error(`row center_codes mismatch: ${newRow[3]}`);
      if (newRow[4] !== true) throw new Error(`row is_active mismatch: ${newRow[4]}`);
      if (newRow[9] !== false) throw new Error(`row is_deleted mismatch: ${newRow[9]}`);
    }
  },
  {
    id: 'S2',
    description: 'saveUser update (same email, change role->LEAD_TEACHER + full_name) -> SAME row updated in place, no new row',
    run: () => {
      const adminEmail = 'admin@seven-retail.com';
      const teacherEmail = 'teacher1@seven-retail.com';
      const { context, sheets } = createContext({
        activeEmail: adminEmail,
        sheetsData: {
          users: [
            USERS_HEADER,
            [adminEmail, 'HQ Admin', 'HQ', '', true, '2026-01-01', 'system', '2026-01-01', 'system', false],
            [teacherEmail, 'Teacher One', 'TEACHER', 'BTR', true, '2026-01-01', 'system', '2026-01-01', 'system', false]
          ]
        }
      });

      const res = context.saveUser({
        email: teacherEmail,
        full_name: 'Teacher One Senior',
        role: 'LEAD_TEACHER',
        center_codes: 'BTR'
      });

      if (!res) throw new Error('saveUser returned null or undefined');
      if (res.email !== teacherEmail) throw new Error(`expected email ${teacherEmail}, got ${res.email}`);
      if (res.full_name !== 'Teacher One Senior') throw new Error(`expected full_name 'Teacher One Senior', got ${res.full_name}`);
      if (res.role !== 'LEAD_TEACHER') throw new Error(`expected role LEAD_TEACHER, got ${res.role}`);

      const userRows = sheets.users;
      if (userRows.length !== 3) throw new Error(`expected users length to remain 3, got ${userRows.length}`);
      const updatedRow = userRows[2];
      if (updatedRow[0] !== teacherEmail) throw new Error(`row email mismatch: ${updatedRow[0]}`);
      if (updatedRow[1] !== 'Teacher One Senior') throw new Error(`row full_name mismatch: ${updatedRow[1]}`);
      if (updatedRow[2] !== 'LEAD_TEACHER') throw new Error(`row role mismatch: ${updatedRow[2]}`);
    }
  },
  {
    id: 'S3',
    description: 'saveProgramLevel composite fix: seed Math levels 1/2/3; edit level 2 -> level 2 changed AND levels 1 & 3 untouched',
    run: () => {
      const adminEmail = 'admin@seven-retail.com';
      const initialRows = [
        PROGRAMS_LEVELS_HEADER,
        ['Math', '1', 1, '2', '', '2026-01-01', 'system', '2026-01-01', 'system', false],
        ['Math', '2', 2, '3', '', '2026-01-01', 'system', '2026-01-01', 'system', false],
        ['Math', '3', 3, '', '', '2026-01-01', 'system', '2026-01-01', 'system', false]
      ];

      const { context, sheets } = createContext({
        activeEmail: adminEmail,
        sheetsData: {
          users: [
            USERS_HEADER,
            [adminEmail, 'HQ Admin', 'HQ', '', true, '2026-01-01', 'system', '2026-01-01', 'system', false]
          ],
          programs_levels: initialRows
        }
      });

      const beforeRow1 = JSON.stringify(sheets.programs_levels[1]);
      const beforeRow3 = JSON.stringify(sheets.programs_levels[3]);

      context.saveProgramLevel({
        program: 'Math',
        level: '2',
        level_order: 20,
        next_small_level: '2B',
        next_big_level: '4'
      });

      const row2 = sheets.programs_levels[2];
      if (row2[0] !== 'Math' || row2[1] !== '2') throw new Error(`row 2 keys mismatch: ${row2[0]} ${row2[1]}`);
      if (row2[2] !== 20) throw new Error(`expected level_order 20, got ${row2[2]}`);
      if (row2[3] !== '2B') throw new Error(`expected next_small_level 2B, got ${row2[3]}`);
      if (row2[4] !== '4') throw new Error(`expected next_big_level 4, got ${row2[4]}`);

      const afterRow1 = JSON.stringify(sheets.programs_levels[1]);
      const afterRow3 = JSON.stringify(sheets.programs_levels[3]);

      if (afterRow1 !== beforeRow1) {
        throw new Error(`level 1 row was modified! before: ${beforeRow1}, after: ${afterRow1}`);
      }
      if (afterRow3 !== beforeRow3) {
        throw new Error(`level 3 row was modified! before: ${beforeRow3}, after: ${afterRow3}`);
      }
    }
  },
  {
    id: 'S4',
    description: 'deleteHoliday composite fix: seed 2026-12-25 BTR + 2026-12-25 KLM; delete (2026-12-25, KLM) -> KLM deleted, BTR untouched',
    run: () => {
      const adminEmail = 'admin@seven-retail.com';
      const initialHolidays = [
        HOLIDAYS_HEADER,
        ['2026-12-25', 'BTR', 'Natal Bintaro', '2026-01-01', 'system', '2026-01-01', 'system', false],
        ['2026-12-25', 'KLM', 'Natal Kalimalang', '2026-01-01', 'system', '2026-01-01', 'system', false]
      ];

      const { context, sheets } = createContext({
        activeEmail: adminEmail,
        sheetsData: {
          users: [
            USERS_HEADER,
            [adminEmail, 'HQ Admin', 'HQ', '', true, '2026-01-01', 'system', '2026-01-01', 'system', false]
          ],
          holidays: initialHolidays
        }
      });

      const beforeBtr = JSON.stringify(sheets.holidays[1]);

      const res = context.deleteHoliday('2026-12-25', 'KLM');
      if (res !== true) throw new Error(`expected deleteHoliday to return true, got ${res}`);

      const isDelIdx = HOLIDAYS_HEADER.indexOf('is_deleted');
      const klmRow = sheets.holidays[2];
      if (klmRow[1] !== 'KLM') throw new Error(`row 2 center_code mismatch: ${klmRow[1]}`);
      if (klmRow[isDelIdx] !== true) throw new Error(`expected KLM row is_deleted to be true, got ${klmRow[isDelIdx]}`);

      const afterBtr = JSON.stringify(sheets.holidays[1]);
      if (afterBtr !== beforeBtr) {
        throw new Error(`BTR holiday row was modified! before: ${beforeBtr}, after: ${afterBtr}`);
      }
      if (sheets.holidays[1][isDelIdx] !== false) throw new Error('BTR holiday row is_deleted should be false');
    }
  },
  {
    id: 'S5',
    description: "listTeachers('BTR') with tA (all), tB (BTR), tC (KLM inactive), lT (BTR LEAD_TEACHER) -> returns tA, tB, lT",
    run: () => {
      const adminEmail = 'admin@seven-retail.com';
      const { context } = createContext({
        activeEmail: adminEmail,
        sheetsData: {
          users: [
            USERS_HEADER,
            [adminEmail, 'HQ Admin', 'HQ', '', true, '2026-01-01', 'system', '2026-01-01', 'system', false],
            ['ta@seven-retail.com', 'Teacher A', 'TEACHER', '', true, '2026-01-01', 'system', '2026-01-01', 'system', false],
            ['tb@seven-retail.com', 'Teacher B', 'TEACHER', 'BTR', true, '2026-01-01', 'system', '2026-01-01', 'system', false],
            ['tc@seven-retail.com', 'Teacher C', 'TEACHER', 'KLM', false, '2026-01-01', 'system', '2026-01-01', 'system', false],
            ['lt@seven-retail.com', 'Lead Teacher', 'LEAD_TEACHER', 'BTR', true, '2026-01-01', 'system', '2026-01-01', 'system', false],
            ['td@seven-retail.com', 'Teacher D', 'TEACHER', 'KLM', true, '2026-01-01', 'system', '2026-01-01', 'system', false]
          ]
        }
      });

      const teachers = context.listTeachers('BTR');
      if (!Array.isArray(teachers)) throw new Error(`expected array, got ${typeof teachers}`);

      const emails = teachers.map(t => t.email);
      if (!emails.includes('ta@seven-retail.com')) throw new Error('missing teacher A (center_codes empty)');
      if (!emails.includes('tb@seven-retail.com')) throw new Error('missing teacher B (center_codes BTR)');
      if (!emails.includes('lt@seven-retail.com')) throw new Error('missing lead teacher (center_codes BTR)');

      if (emails.includes('tc@seven-retail.com')) throw new Error('inactive teacher C was included');
      if (emails.includes('td@seven-retail.com')) throw new Error('KLM-only teacher D was included in BTR query');

      if (teachers.length !== 3) throw new Error(`expected exactly 3 teachers, got ${teachers.length}: ${emails.join(', ')}`);
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

/**
 * Db.gs — Generic spreadsheet data access layer, caching, locking and auditing.
 * All sheet modifications occur inside LockService script locks.
 */

const Db = {
  /**
   * Resolves the target spreadsheet for the table and returns the Sheet.
   * Auto-heals by creating the tab with headers from TABLE_SCHEMAS if missing.
   * @param {string} table
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  sheet_(table) {
    let ssId;
    const isTx = TX_TABLES.includes(table);

    if (isTx) {
      const ay = getProp_(PROP_KEYS.TX_DB_AY) || academicYearLabel_(new Date());
      ssId = getProp_(PROP_KEYS.TX_DB_SPREADSHEET_ID_PREFIX + ay);
      if (!ssId) {
        console.warn(`TX sheet for academic year ${ay} not set, falling back to main DB for table '${table}'.`);
        ssId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
      }
    } else {
      ssId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
    }

    if (!ssId) {
      throw new Error('Database spreadsheet ID belum dikonfigurasi. Jalankan Setup terlebih dahulu.');
    }

    const ss = SpreadsheetApp.openById(ssId);
    let sheet = ss.getSheetByName(table);

    // Self-healing: create sheet if missing
    if (!sheet) {
      const headers = (typeof TABLE_SCHEMAS !== 'undefined' && TABLE_SCHEMAS[table]) ? TABLE_SCHEMAS[table] : [];
      sheet = ss.insertSheet(table);
      if (headers.length > 0) {
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
      }
    }
    return sheet;
  },

  /**
   * Reads all records from a table.
   * @param {string} table
   * @param {{includeDeleted?: boolean}=} options
   * @return {Object[]}
   */
  readAll(table, options) {
    const sheet = this.sheet_(table);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];

    const rawValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = rawValues[0];
    const rows = rawValues.slice(1);
    const includeDeleted = options && options.includeDeleted;

    const results = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        let val = row[c];
        if (val instanceof Date) {
          val = toIsoDateOrTime_(val);
        } else if (val === undefined) {
          val = null;
        }
        obj[headers[c]] = val;
      }
      const isDeleted = obj.is_deleted === true || String(obj.is_deleted).toLowerCase() === 'true';
      if (includeDeleted || !isDeleted) {
        results.push(obj);
      }
    }
    return results;
  },

  /**
   * Reads records matching a predicate.
   * @param {string} table
   * @param {Function} predicate
   * @param {{includeDeleted?: boolean}=} options
   * @return {Object[]}
   */
  readWhere(table, predicate, options) {
    return this.readAll(table, options).filter(predicate);
  },

  /**
   * Finds the first record matching a predicate.
   * @param {string} table
   * @param {Function} predicate
   * @param {{includeDeleted?: boolean}=} options
   * @return {Object|null}
   */
  findOne(table, predicate, options) {
    return this.readAll(table, options).find(predicate) || null;
  },

  /**
   * Appends a record without acquiring lock (caller MUST hold lock).
   * @param {string} table
   * @param {Object} record
   * @param {string} userEmail
   * @return {Object}
   */
  insertUnlocked_(table, record, userEmail) {
    const sheet = this.sheet_(table);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const nowIso = toIsoDateTime_(new Date());

    const full = Object.assign({}, record, {
      created_at: nowIso,
      created_by: userEmail || 'system',
      updated_at: nowIso,
      updated_by: userEmail || 'system',
      is_deleted: false
    });

    const rowData = headers.map(h => (h in full && full[h] !== undefined && full[h] !== null ? full[h] : ''));
    sheet.appendRow(rowData);

    // Audit log
    if (table !== 'audit_log') {
      const idKey = headers[0];
      this.auditUnlocked_(userEmail || 'system', 'INSERT', table, String(full[idKey] || ''), null, full);
    }
    return full;
  },

  /**
   * Inserts a single record with lock.
   * @param {string} table
   * @param {Object} record
   * @param {string} userEmail
   * @return {Object}
   */
  insert(table, record, userEmail) {
    return withLock_(() => this.insertUnlocked_(table, record, userEmail));
  },

  /**
   * Inserts multiple records in a single setValues call (caller MUST hold lock).
   * @param {string} table
   * @param {Object[]} records
   * @param {string} userEmail
   * @return {Object[]}
   */
  insertManyUnlocked_(table, records, userEmail) {
    if (!records || records.length === 0) return [];
    const sheet = this.sheet_(table);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const nowIso = toIsoDateTime_(new Date());
    const idKey = headers[0];

    const fullRecords = records.map(rec => Object.assign({}, rec, {
      created_at: nowIso,
      created_by: userEmail || 'system',
      updated_at: nowIso,
      updated_by: userEmail || 'system',
      is_deleted: false
    }));

    const rowsData = fullRecords.map(rec =>
      headers.map(h => (h in rec && rec[h] !== undefined && rec[h] !== null ? rec[h] : ''))
    );

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsData.length, headers.length).setValues(rowsData);

    // Batched audit logs
    if (table !== 'audit_log') {
      const auditRows = fullRecords.map(rec => ({
        timestamp: nowIso,
        user_email: userEmail || 'system',
        action: 'INSERT_MANY',
        table_name: table,
        record_id: String(rec[idKey] || ''),
        before_json: '',
        after_json: JSON.stringify(rec).slice(0, 4000)
      }));
      this.insertManyRaw_('audit_log', auditRows);
    }

    return fullRecords;
  },

  /**
   * Inserts multiple records with lock.
   * @param {string} table
   * @param {Object[]} records
   * @param {string} userEmail
   * @return {Object[]}
   */
  insertMany(table, records, userEmail) {
    return withLock_(() => this.insertManyUnlocked_(table, records, userEmail));
  },

  /**
   * Raw insertion into a table without creating nested audit records.
   * @param {string} table
   * @param {Object[]} records
   */
  insertManyRaw_(table, records) {
    if (!records || records.length === 0) return;
    const sheet = this.sheet_(table);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowsData = records.map(rec =>
      headers.map(h => (h in rec && rec[h] !== undefined && rec[h] !== null ? rec[h] : ''))
    );
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsData.length, headers.length).setValues(rowsData);
  },

  /**
   * Updates a record by primary key inside a lock.
   * @param {string} table
   * @param {string} idKey Column name of the ID
   * @param {*} idValue Value of the ID to match
   * @param {Object} patch Fields to update
   * @param {string} userEmail
   * @return {Object|null} Updated record
   */
  update(table, idKey, idValue, patch, userEmail) {
    return withLock_(() => {
      const sheet = this.sheet_(table);
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow <= 1) return null;

      const rawValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      const headers = rawValues[0];
      const idColIdx = headers.indexOf(idKey);
      if (idColIdx === -1) throw new Error(`Column '${idKey}' not found in table '${table}'.`);

      let targetRowIdx = -1;
      let beforeObj = null;

      for (let r = 1; r < rawValues.length; r++) {
        if (String(rawValues[r][idColIdx]) === String(idValue)) {
          targetRowIdx = r + 1; // 1-based row index in sheet
          beforeObj = {};
          for (let c = 0; c < headers.length; c++) {
            beforeObj[headers[c]] = rawValues[r][c];
          }
          break;
        }
      }

      if (targetRowIdx === -1) return null;

      const nowIso = toIsoDateTime_(new Date());
      const afterObj = Object.assign({}, beforeObj, patch, {
        updated_at: nowIso,
        updated_by: userEmail || 'system'
      });

      const updatedRowValues = [headers.map(h => (h in afterObj && afterObj[h] !== undefined && afterObj[h] !== null ? afterObj[h] : ''))];
      sheet.getRange(targetRowIdx, 1, 1, headers.length).setValues(updatedRowValues);

      if (table !== 'audit_log') {
        this.auditUnlocked_(userEmail || 'system', 'UPDATE', table, String(idValue), beforeObj, afterObj);
      }

      return afterObj;
    });
  },

  /**
   * Performs soft deletion by marking is_deleted = true.
   * @param {string} table
   * @param {string} idKey
   * @param {*} idValue
   * @param {string} userEmail
   * @return {boolean}
   */
  softDelete(table, idKey, idValue, userEmail) {
    const updated = this.update(table, idKey, idValue, { is_deleted: true }, userEmail);
    return Boolean(updated);
  },

  /**
   * Internal unlocked audit helper.
   */
  auditUnlocked_(userEmail, action, tableName, recordId, before, after) {
    const sheet = this.sheet_('audit_log');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const nowIso = toIsoDateTime_(new Date());

    const beforeStr = before ? JSON.stringify(before).slice(0, 4000) : '';
    const afterStr = after ? JSON.stringify(after).slice(0, 4000) : '';

    const auditRec = {
      timestamp: nowIso,
      user_email: userEmail || 'system',
      action: action,
      table_name: tableName,
      record_id: recordId || '',
      before_json: beforeStr,
      after_json: afterStr,
      created_at: nowIso,
      created_by: userEmail || 'system',
      updated_at: nowIso,
      updated_by: userEmail || 'system',
      is_deleted: false
    };

    const rowData = headers.map(h => (h in auditRec ? auditRec[h] : ''));
    sheet.appendRow(rowData);
    return auditRec;
  },

  /**
   * Public audit logging function.
   */
  audit_(userEmail, action, tableName, recordId, before, after) {
    return withLock_(() => this.auditUnlocked_(userEmail, action, tableName, recordId, before, after));
  },

  /**
   * Reads cached reference tables or falls back to sheet read.
   * @param {string} table
   * @return {Object[]}
   */
  readCached_(table) {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'ref_' + table;
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // Fall back to sheet
      }
    }
    const data = this.readAll(table);
    try {
      const jsonStr = JSON.stringify(data);
      if (jsonStr.length < 100000) {
        cache.put(cacheKey, jsonStr, CACHE_TTL_SECONDS);
      }
    } catch (e) {
      console.warn(`Could not cache table ${table}: ${e.message}`);
    }
    return data;
  },

  /**
   * Invalidates cached table.
   * @param {string} table
   */
  invalidate_(table) {
    const cache = CacheService.getScriptCache();
    cache.remove('ref_' + table);
  }
};

/**
 * Global LockService execution helper.
 * Waits up to 30 seconds for the lock.
 * @param {Function} fn
 * @return {*}
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Format Date to YYYY-MM-DD.
 * @param {Date|string|number} v
 * @return {string}
 */
function toIsoDate_(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format Date to ISO string YYYY-MM-DDTHH:mm:ss.
 * @param {Date|string|number} v
 * @return {string}
 */
function toIsoDateTime_(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString();
}

/**
 * Dispatches date formatting based on time component.
 * @param {Date} d
 * @return {string}
 */
function toIsoDateOrTime_(d) {
  if (!d || isNaN(d.getTime())) return '';
  // If time is 00:00:00, return YYYY-MM-DD
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    return toIsoDate_(d);
  }
  return d.toISOString();
}

/**
 * Parse ISO date string to Date object safely.
 * @param {string} s
 * @return {Date|null}
 */
function parseIsoDate_(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

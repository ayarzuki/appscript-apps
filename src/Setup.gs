/**
 * Setup.gs — System initialization, schema definition, and master data seeding.
 */

const STANDARD_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted'];

// TABLE_SCHEMAS defines headers for all system tables.
// Each table includes its domain columns followed by standard audit/soft-delete columns.
const TABLE_SCHEMAS = {
  'students': [
    'student_id', 'center_code', 'full_name', 'nickname', 'dob',
    'parent_name', 'parent_phone', 'language', 'school', 'status',
    'intake', 'actual_join_date', 'package', 'credit_class',
    'payment_status', 'retention_status', 'last_membership_date',
    ...STANDARD_COLUMNS
  ],
  'classes': [
    'class_id', 'center_code', 'program', 'level', 'schedule_day',
    'schedule_time', 'room', 'main_teacher_email', 'sa_email', 'intake',
    'start_date', 'end_date', 'previous_class_id', 'total_sessions', 'status',
    ...STANDARD_COLUMNS
  ],
  'enrollments': [
    'enrollment_id', 'student_id', 'class_id', 'join_date', 'leave_date',
    'leave_reason',
    ...STANDARD_COLUMNS
  ],
  'sessions': [
    'session_id', 'class_id', 'session_no', 'planned_date', 'actual_date',
    'teacher_email', 'lesson_plan_url', 'milestone',
    ...STANDARD_COLUMNS
  ],
  'attendance': [
    'session_id', 'student_id', 'status', 'recorded_by',
    ...STANDARD_COLUMNS
  ],
  'daily_notes': [
    'session_id', 'student_id', 'score', 'achievement', 'area_of_improvement',
    'recorded_by',
    ...STANDARD_COLUMNS
  ],
  'assessments': [
    'class_id', 'student_id', 'assessment_type', 'grade',
    'report_due_date', 'report_generated_at', 'report_pdf_url',
    ...STANDARD_COLUMNS
  ],
  'events': [
    'class_id', 'event_type', 'due_date', 'done_date', 'status', 'description',
    ...STANDARD_COLUMNS
  ],
  'waiting_list': [
    'input_date', 'source', 'student_id', 'full_name', 'program', 'level',
    'day', 'time', 'request_no', 'status', 'notes',
    ...STANDARD_COLUMNS
  ],
  'leveling': [
    'class_id', 'student_id', 'intake', 'recommended_level', 'final_level',
    'decision_type', 'notes', 'decided_by', 'decided_at',
    ...STANDARD_COLUMNS
  ],
  'media': [
    'class_id', 'milestone', 'drive_file_id', 'file_name',
    'uploaded_by', 'uploaded_at',
    ...STANDARD_COLUMNS
  ],
  'users': [
    'email', 'full_name', 'role', 'center_codes', 'is_active',
    ...STANDARD_COLUMNS
  ],
  'centers': [
    'center_code', 'center_no', 'center_name', 'is_active',
    ...STANDARD_COLUMNS
  ],
  'programs_levels': [
    'program', 'level', 'level_order', 'next_small_level', 'next_big_level',
    ...STANDARD_COLUMNS
  ],
  'holidays': [
    'date', 'center_code', 'description',
    ...STANDARD_COLUMNS
  ],
  'audit_log': [
    'timestamp', 'user_email', 'action', 'table_name', 'record_id',
    'before_json', 'after_json',
    ...STANDARD_COLUMNS
  ],
  'snapshot_dashboard': [
    'snapshot_date', 'center_code', 'program', 'active_students',
    'classes_active', 'attendance_rate_avg', 'compliance_missing',
    ...STANDARD_COLUMNS
  ],
  'auth_sessions': [
    'token', 'email', 'created_at', 'expires_at', 'last_seen_at',
    'is_deleted', 'updated_at', 'updated_by'
  ],
  'auth_codes': [
    'email', 'code', 'expires_at', 'attempts', 'created_at',
    'is_deleted', 'updated_at', 'updated_by'
  ]
};

/**
 * Setup or verify database spreadsheets and Drive folders.
 * Idempotent: re-running reuses existing IDs and creates only missing resources.
 * @return {Object} Summary of setup status
 */
function setupDatabase() {
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    let dbId = props.getProperty(PROP_KEYS.DB_SPREADSHEET_ID);
    const ay = academicYearLabel_(new Date());
    const txPropKey = PROP_KEYS.TX_DB_SPREADSHEET_ID_PREFIX + ay;
    let txId = props.getProperty(txPropKey);
    let rootFolderId = props.getProperty(PROP_KEYS.MEDIA_ROOT_FOLDER_ID);
    let reportsFolderId = props.getProperty(PROP_KEYS.REPORTS_FOLDER_ID);

    // 1. Root Drive Folder
    let rootFolder;
    if (rootFolderId) {
      try {
        rootFolder = DriveApp.getFolderById(rootFolderId);
      } catch (e) {
        rootFolder = null;
      }
    }
    if (!rootFolder) {
      rootFolder = DriveApp.createFolder('SIS Sparks Math (New System)');
      rootFolderId = rootFolder.getId();
      props.setProperty(PROP_KEYS.MEDIA_ROOT_FOLDER_ID, rootFolderId);
    }

    // Subfolders: Media, Reports, Templates
    let mediaFolder, reportsFolder, templatesFolder;
    const existingSubfolders = rootFolder.getFolders();
    while (existingSubfolders.hasNext()) {
      const f = existingSubfolders.next();
      if (f.getName() === 'Media') mediaFolder = f;
      if (f.getName() === 'Reports') reportsFolder = f;
      if (f.getName() === 'Templates') templatesFolder = f;
    }
    if (!mediaFolder) mediaFolder = rootFolder.createFolder('Media');
    if (!reportsFolder) {
      reportsFolder = rootFolder.createFolder('Reports');
      reportsFolderId = reportsFolder.getId();
      props.setProperty(PROP_KEYS.REPORTS_FOLDER_ID, reportsFolderId);
    }
    if (!templatesFolder) templatesFolder = rootFolder.createFolder('Templates');

    // 2. Main DB Spreadsheet
    let dbSpreadsheet;
    if (dbId) {
      try {
        dbSpreadsheet = SpreadsheetApp.openById(dbId);
      } catch (e) {
        dbSpreadsheet = null;
      }
    }
    if (!dbSpreadsheet) {
      dbSpreadsheet = SpreadsheetApp.create('SIS Sparks Math — Database');
      dbId = dbSpreadsheet.getId();
      props.setProperty(PROP_KEYS.DB_SPREADSHEET_ID, dbId);
      // Move to root folder
      try {
        const file = DriveApp.getFileById(dbId);
        rootFolder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (e) {
        console.warn('Could not move main DB to folder: ' + e.message);
      }
    }

    // Ensure non-TX tabs exist in main DB
    const nonTxTables = Object.keys(TABLE_SCHEMAS).filter(t => !TX_TABLES.includes(t));
    for (const table of nonTxTables) {
      ensureSheetSchema_(dbSpreadsheet, table, TABLE_SCHEMAS[table]);
    }
    // Remove default 'Sheet1' if present and other sheets exist
    const defaultSheet = dbSpreadsheet.getSheetByName('Sheet1') || dbSpreadsheet.getSheetByName('Sheet 1');
    if (defaultSheet && dbSpreadsheet.getSheets().length > 1) {
      try { dbSpreadsheet.deleteSheet(defaultSheet); } catch (e) {}
    }

    // 3. Current Academic Year Transaction Spreadsheet
    let txSpreadsheet;
    if (txId) {
      try {
        txSpreadsheet = SpreadsheetApp.openById(txId);
      } catch (e) {
        txSpreadsheet = null;
      }
    }
    if (!txSpreadsheet) {
      txSpreadsheet = SpreadsheetApp.create('SIS Sparks Math — Transaksi AY' + ay);
      txId = txSpreadsheet.getId();
      props.setProperty(txPropKey, txId);
      props.setProperty(PROP_KEYS.TX_DB_AY, ay);
      try {
        const file = DriveApp.getFileById(txId);
        rootFolder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (e) {
        console.warn('Could not move TX DB to folder: ' + e.message);
      }
    }

    // Ensure TX tabs in TX sheet
    for (const table of TX_TABLES) {
      ensureSheetSchema_(txSpreadsheet, table, TABLE_SCHEMAS[table]);
    }
    const defaultTxSheet = txSpreadsheet.getSheetByName('Sheet1') || txSpreadsheet.getSheetByName('Sheet 1');
    if (defaultTxSheet && txSpreadsheet.getSheets().length > 1) {
      try { txSpreadsheet.deleteSheet(defaultTxSheet); } catch (e) {}
    }

    return {
      ok: true,
      dbSpreadsheetId: dbId,
      txSpreadsheetId: txId,
      academicYear: ay,
      rootFolderId: rootFolderId,
      reportsFolderId: reportsFolderId
    };
  });
}

/**
 * Ensures a sheet exists with the exact header row.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @param {string[]} headers
 */
function ensureSheetSchema_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else {
    // If empty sheet, write header
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
  }
}

/**
 * Seeds minimal master data idempotently.
 * @return {Object} Seeding summary
 */
function seedMasterData() {
  return withLock_(() => {
    const userEmail = 'system@setup';
    let seededUsers = 0;
    let seededCenters = 0;
    let seededProgLevels = 0;

    // 1. Initial HQ User
    const hqEmail = 'aulya.kustyawan@seven-retail.com';
    const existingHq = Db.findOne('users', u => u.email === hqEmail);
    if (!existingHq) {
      Db.insertUnlocked_('users', {
        email: hqEmail,
        full_name: 'Aulya Kustyawan',
        role: 'HQ',
        center_codes: '',
        is_active: true
      }, userEmail);
      seededUsers++;
    }

    // 2. Initial Center (BTR - Bintaro)
    // Comment: Replace with the real 20-center list in production
    const existingCenter = Db.findOne('centers', c => c.center_code === 'BTR');
    if (!existingCenter) {
      Db.insertUnlocked_('centers', {
        center_code: 'BTR',
        center_no: '01',
        center_name: 'Bintaro',
        is_active: true
      }, userEmail);
      seededCenters++;
    }

    // 3. Programs & Levels (LE chain 1A..3B, minimal CT & BS placeholders)
    const existingLevels = Db.readAll('programs_levels');
    if (existingLevels.length === 0) {
      const leChain = [
        { program: 'LE', level: '1A', level_order: 1, next_small_level: '1B', next_big_level: '2A' },
        { program: 'LE', level: '1B', level_order: 2, next_small_level: '2A', next_big_level: '2A' },
        { program: 'LE', level: '2A', level_order: 3, next_small_level: '2B', next_big_level: '3A' },
        { program: 'LE', level: '2B', level_order: 4, next_small_level: '3A', next_big_level: '3A' },
        { program: 'LE', level: '3A', level_order: 5, next_small_level: '3B', next_big_level: 'CT 1A' },
        { program: 'LE', level: '3B', level_order: 6, next_small_level: 'CT 1A', next_big_level: 'CT 1A' },
        // Placeholder rows for CT & BS
        { program: 'CT', level: '1A', level_order: 7, next_small_level: '1B', next_big_level: '2A' },
        { program: 'BS', level: '1A', level_order: 8, next_small_level: '1B', next_big_level: '2A' }
      ];
      for (const row of leChain) {
        Db.insertUnlocked_('programs_levels', row, userEmail);
        seededProgLevels++;
      }
    }

    Db.invalidate_('users');
    Db.invalidate_('centers');
    Db.invalidate_('programs_levels');

    return {
      ok: true,
      seededUsers,
      seededCenters,
      seededProgLevels
    };
  });
}

/**
 * Authorize smoke test run by operator during initial OAuth consent.
 * Verifies script property, logs a heartbeat audit entry, and reads back.
 * @return {Object}
 */
function authorizeSmokeTest() {
  const dbId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
  const ay = academicYearLabel_(new Date());
  const txId = getProp_(PROP_KEYS.TX_DB_SPREADSHEET_ID_PREFIX + ay);
  const folderId = getProp_(PROP_KEYS.MEDIA_ROOT_FOLDER_ID);

  let auditRow = null;
  if (dbId) {
    try {
      auditRow = Db.audit_('smoke-test@operator', 'HEARTBEAT', 'audit_log', 'SMOKE_TEST', null, { status: 'OK' });
    } catch (e) {
      console.warn('Smoke test audit log warning: ' + e.message);
    }
  }

  return {
    ok: Boolean(dbId),
    dbSpreadsheetId: dbId || null,
    txSpreadsheetId: txId || null,
    folderId: folderId || null,
    versions: {
      app: APP_VERSION,
      academicYear: ay,
      heartbeatLogged: Boolean(auditRow)
    }
  };
}

/**
 * Sends a test email to the operator to verify the mail scope (run once from the editor).
 * @return {Object}
 */
function smokeTestEmail() {
  const to = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: '[SIS Sparks Math] Tes izin kirim email',
    name: APP_TITLE,
    body: 'Jika Anda membaca email ini, izin "Send email as you" sudah aktif dan kode login (OTP) siap dipakai.'
  });
  return { ok: true, sentTo: to };
}

/**
 * Removes duplicate time-driven triggers and installs a daily 01:00 trigger for buildSnapshots.
 */
function installNightlyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'buildSnapshots') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger('buildSnapshots')
    .timeBased()
    .atHour(1)
    .everyDays(1)
    .inTimezone('Asia/Jakarta')
    .create();
  return { ok: true, message: 'Nightly trigger for buildSnapshots installed at 01:00 WIB.' };
}

/**
 * Returns current setup status for Admin screen.
 * @return {Object}
 */
function getSetupStatus() {
  const dbId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
  const ay = academicYearLabel_(new Date());
  const txId = getProp_(PROP_KEYS.TX_DB_SPREADSHEET_ID_PREFIX + ay);
  const folderId = getProp_(PROP_KEYS.MEDIA_ROOT_FOLDER_ID);
  const reportsFolderId = getProp_(PROP_KEYS.REPORTS_FOLDER_ID);
  const templateDocId = getProp_(PROP_KEYS.TEMPLATE_DOC_ID);

  return {
    dbReady: Boolean(dbId),
    dbSpreadsheetId: dbId,
    txSpreadsheetId: txId,
    academicYear: ay,
    folderId: folderId,
    reportsFolderId: reportsFolderId,
    templateDocId: templateDocId,
    templateConfigured: Boolean(templateDocId)
  };
}

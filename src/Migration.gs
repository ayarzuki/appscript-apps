/**
 * Migration.gs — Phase 4: Migration scaffold from legacy SIS.
 * READ-ONLY terhadap SIS lama, salin bukan pindah.
 * Sumber spreadsheet dibaca tanpa pernah diubah atau ditulis.
 */

// Safety gate: migration write is strictly disabled by default
const MIGRATION_WRITE_ENABLED = false;

/**
 * Performs a dry-run migration reading legacy SIS data without modifying any records.
 * Client-callable, HQ only.
 * @param {string} centerCode
 * @return {Object}
 */
function dryRunMigration(centerCode) {
  requireRole_(['HQ']);

  const sourcesJson = getProp_('OLD_SIS_SOURCES');
  if (!sourcesJson) {
    return {
      configured: false,
      message: 'Migrasi belum dikonfigurasi. Atur OLD_SIS_SOURCES di Pengaturan.'
    };
  }

  let sources;
  try {
    sources = JSON.parse(sourcesJson);
  } catch (e) {
    return {
      configured: false,
      message: 'Format OLD_SIS_SOURCES tidak valid (harus JSON).'
    };
  }

  const centerConfig = sources[centerCode];
  if (!centerConfig || !centerConfig.spreadsheetId) {
    return {
      configured: false,
      message: `Sumber SIS lama untuk cabang ${centerCode} tidak ditemukan di OLD_SIS_SOURCES.`
    };
  }

  try {
    // READ-ONLY inspection: only openById and getValues()
    const ss = SpreadsheetApp.openById(centerConfig.spreadsheetId);
    const studentSheet = ss.getSheetByName('Student Database');
    const classSheet = ss.getSheetByName('Class Database');

    let studentRows = 0;
    const sampleStudents = [];
    if (studentSheet) {
      const vals = studentSheet.getDataRange().getValues();
      studentRows = Math.max(0, vals.length - 2); // header on row 2, data from row 3
      if (vals.length > 2) {
        sampleStudents.push({
          raw_col_0: vals[2][0] || '',
          raw_col_1: vals[2][1] || '',
          raw_col_2: vals[2][2] || ''
        });
      }
    }

    let classRows = 0;
    if (classSheet) {
      const vals = classSheet.getDataRange().getValues();
      classRows = Math.max(0, vals.length - 2);
    }

    return {
      configured: true,
      centerCode: centerCode,
      counts: {
        legacy_students: studentRows,
        legacy_classes: classRows
      },
      sample: sampleStudents,
      diffs: {
        status: 'READY_FOR_VERIFICATION',
        note: 'Data dibaca secara read-only dari SIS lama.'
      }
    };
  } catch (err) {
    return {
      configured: true,
      error: 'Gagal membaca spreadsheet SIS lama: ' + err.message
    };
  }
}

/**
 * Executes migration write if safely confirmed and enabled.
 * Refuses execution unless MIGRATION_WRITE_ENABLED is true and confirmToken is 'SAYA-SETUJU'.
 * @param {string} centerCode
 * @param {string} confirmToken
 * @return {Object}
 */
function writeMigration(centerCode, confirmToken) {
  requireRole_(['HQ']);

  if (!MIGRATION_WRITE_ENABLED) {
    throw new Error('Penulisan migrasi dinonaktifkan (MIGRATION_WRITE_ENABLED = false).');
  }

  if (confirmToken !== 'SAYA-SETUJU') {
    throw new Error('Token konfirmasi salah. Masukkan "SAYA-SETUJU" untuk melanjutkan.');
  }

  const targetDbId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
  const sourcesJson = getProp_('OLD_SIS_SOURCES');
  const sources = sourcesJson ? JSON.parse(sourcesJson) : {};
  const centerConfig = sources[centerCode];

  // Hard assertion: legacy spreadsheet ID must not equal target DB ID
  if (centerConfig && centerConfig.spreadsheetId === targetDbId) {
    throw new Error('Keamanan: ID spreadsheet sumber tidak boleh sama dengan ID database target.');
  }

  // Placeholder for write logic when approved in Phase 4
  return {
    ok: true,
    message: 'Migrasi fase 4 siap diimplementasikan saat cut-over disetujui.'
  };
}

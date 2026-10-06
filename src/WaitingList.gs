/**
 * WaitingList.gs — Waiting list queue management and status tracking.
 */

/**
 * Lists waiting list entries filtered by center code.
 * @param {string=} centerCode
 * @return {Object[]}
 */
function listWaitingList(centerCode) {
  const user = requireRole_(['HQ', 'CM', 'SA']);
  const allEntries = Db.readAll('waiting_list');
  const allStudents = Db.readAll('students');
  const studentCenterMap = new Map();
  for (const s of allStudents) {
    studentCenterMap.set(s.student_id, s.center_code);
  }

  return allEntries.filter(w => {
    // Determine entry center from student_id prefix or students table
    let entryCenter = '';
    if (w.student_id) {
      entryCenter = studentCenterMap.get(w.student_id) || w.student_id.replace(/[0-9]/g, '');
    }

    if (user.centerList && user.centerList.length > 0 && entryCenter) {
      if (!user.centerList.includes(entryCenter)) return false;
    }
    if (centerCode && entryCenter && entryCenter !== centerCode) {
      return false;
    }
    return true;
  }).map(w => ({
    request_no: w.request_no,
    input_date: w.input_date ? toIsoDate_(w.input_date) : '',
    source: w.source || '',
    student_id: w.student_id || '',
    full_name: w.full_name || '',
    program: w.program || '',
    level: w.level || '',
    day: w.day || '',
    time: w.time || '',
    status: w.status || 'Waiting',
    notes: w.notes || ''
  })).sort((a, b) => (b.input_date || '').localeCompare(a.input_date || ''));
}

/**
 * Generates next request number for waiting list (e.g. WL-000123).
 * @return {string}
 */
function nextWaitingRequestNo_() {
  const all = Db.readAll('waiting_list', { includeDeleted: true });
  let maxSeq = 0;
  for (const w of all) {
    const req = String(w.request_no || '');
    if (req.startsWith('WL-')) {
      const num = parseInt(req.slice(3), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return 'WL-' + String(maxSeq + 1).padStart(6, '0');
}

/**
 * Saves (creates or updates) a waiting list entry.
 * @param {Object} form
 * @return {Object}
 */
function saveWaitingEntry(form) {
  if (!form || !form.full_name) throw new Error('Nama calon murid wajib diisi.');
  const user = requireRole_(['HQ', 'CM', 'SA']);

  return withLock_(() => {
    const inputDate = form.input_date ? toIsoDate_(form.input_date) : toIsoDate_(new Date());

    if (form.request_no) {
      // Update
      const patch = {
        source: form.source || '',
        student_id: form.student_id || '',
        full_name: String(form.full_name).trim(),
        program: form.program || '',
        level: form.level || '',
        day: form.day || '',
        time: form.time || '',
        status: form.status || 'Waiting',
        notes: form.notes || ''
      };
      const updated = Db.update('waiting_list', 'request_no', form.request_no, patch, user.email);
      return updated;
    } else {
      // Create new
      const reqNo = nextWaitingRequestNo_();
      const newEntry = {
        input_date: inputDate,
        source: form.source || 'Walk-in',
        student_id: form.student_id || '',
        full_name: String(form.full_name).trim(),
        program: form.program || '',
        level: form.level || '',
        day: form.day || '',
        time: form.time || '',
        request_no: reqNo,
        status: form.status || 'Waiting',
        notes: form.notes || ''
      };
      Db.insertUnlocked_('waiting_list', newEntry, user.email);
      return newEntry;
    }
  });
}

/**
 * Updates status of a waiting list entry.
 * @param {string} id request_no
 * @param {string} status
 * @return {Object}
 */
function setWaitingStatus(id, status) {
  if (!id || !status) throw new Error('ID antrean dan status wajib diisi.');
  const user = requireRole_(['HQ', 'CM', 'SA']);

  const updated = Db.update('waiting_list', 'request_no', id, { status: status }, user.email);
  if (!updated) throw new Error('Data antrean tidak ditemukan.');
  return updated;
}

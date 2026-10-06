/**
 * Students.gs — Student management, search, profile, and enrollment history.
 */

/**
 * Lists students matching filters. Light rows for fast table rendering.
 * @param {Object=} filters {q: string, center: string, status: string}
 * @return {Object[]}
 */
function listStudents(filters) {
  const user = requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  const f = filters || {};
  const query = (f.q || '').trim().toLowerCase();
  const centerFilter = f.center || '';
  const statusFilter = f.status || '';

  const all = Db.readAll('students');
  return all.filter(s => {
    // Center restriction based on user permissions
    if (user.centerList && user.centerList.length > 0) {
      if (!user.centerList.includes(s.center_code)) return false;
    }
    if (centerFilter && s.center_code !== centerFilter) return false;
    if (statusFilter && s.status !== statusFilter) return false;
    if (query) {
      const matchId = String(s.student_id || '').toLowerCase().includes(query);
      const matchName = String(s.full_name || '').toLowerCase().includes(query);
      const matchNick = String(s.nickname || '').toLowerCase().includes(query);
      if (!matchId && !matchName && !matchNick) return false;
    }
    return true;
  }).map(s => ({
    student_id: s.student_id,
    full_name: s.full_name,
    nickname: s.nickname || '',
    center_code: s.center_code,
    status: s.status || 'Postponed',
    package: s.package || '',
    credit_class: s.credit_class !== null && s.credit_class !== undefined ? s.credit_class : '',
    parent_name: s.parent_name || '',
    parent_phone: s.parent_phone || ''
  }));
}

/**
 * Retrieves full student details along with joined enrollment history.
 * @param {string} studentId
 * @return {Object|null}
 */
function getStudent(studentId) {
  const user = requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  if (!studentId) throw new Error('ID murid wajib disertakan.');

  const student = Db.findOne('students', s => s.student_id === studentId);
  if (!student) throw new Error('Murid tidak ditemukan.');

  if (user.centerList && user.centerList.length > 0 && !user.centerList.includes(student.center_code)) {
    throw new Error('Tidak punya akses ke data murid di cabang ' + student.center_code);
  }

  // Load enrollment history
  const enrollments = Db.readWhere('enrollments', e => e.student_id === studentId);
  const classes = Db.readAll('classes');
  const classMap = new Map();
  for (const c of classes) {
    classMap.set(c.class_id, c);
  }

  const enrollmentHistory = enrollments.map(enr => {
    const k = classMap.get(enr.class_id) || {};
    return {
      enrollment_id: enr.enrollment_id,
      class_id: enr.class_id,
      join_date: enr.join_date ? toIsoDate_(enr.join_date) : '',
      leave_date: enr.leave_date ? toIsoDate_(enr.leave_date) : '',
      leave_reason: enr.leave_reason || '',
      class_name: `${k.program || ''}-${k.level || ''} ${k.schedule_day || ''} ${k.schedule_time || ''}`.trim(),
      program: k.program || '',
      level: k.level || '',
      status: k.status || '',
      intake: k.intake || ''
    };
  }).sort((a, b) => (b.join_date || '').localeCompare(a.join_date || ''));

  return Object.assign({}, student, {
    dob: student.dob ? toIsoDate_(student.dob) : '',
    actual_join_date: student.actual_join_date ? toIsoDate_(student.actual_join_date) : '',
    last_membership_date: student.last_membership_date ? toIsoDate_(student.last_membership_date) : '',
    enrollmentHistory: enrollmentHistory
  });
}

/**
 * Computes next student ID for a center (e.g. BTR0001).
 * Must be executed while caller holds lock or within withLock_.
 * @param {string} centerCode
 * @return {string}
 */
function nextStudentId_(centerCode) {
  const prefix = String(centerCode || '').toUpperCase().trim();
  if (!prefix) throw new Error('Kode cabang wajib diisi.');

  const all = Db.readAll('students', { includeDeleted: true });
  let maxSeq = 0;
  for (const s of all) {
    const sid = String(s.student_id || '');
    if (sid.startsWith(prefix)) {
      const numPart = parseInt(sid.slice(prefix.length), 10);
      if (!isNaN(numPart) && numPart > maxSeq) {
        maxSeq = numPart;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return prefix + String(nextSeq).padStart(4, '0');
}

/**
 * Creates a new student record.
 * @param {Object} form
 * @return {Object}
 */
function createStudent(form) {
  if (!form || !form.full_name || !String(form.full_name).trim()) {
    throw new Error('Nama lengkap murid wajib diisi.');
  }
  if (!form.center_code || !String(form.center_code).trim()) {
    throw new Error('Cabang murid wajib dipilih.');
  }

  const centerCode = String(form.center_code).trim().toUpperCase();
  const user = requireRole_(['HQ', 'CM', 'SA'], centerCode);

  return withLock_(() => {
    const studentId = nextStudentId_(centerCode);
    const newStudent = {
      student_id: studentId,
      center_code: centerCode,
      full_name: String(form.full_name).trim(),
      nickname: (form.nickname || '').trim(),
      dob: form.dob ? toIsoDate_(form.dob) : '',
      parent_name: (form.parent_name || '').trim(),
      parent_phone: (form.parent_phone || '').trim(),
      language: form.language || 'Indonesian',
      school: (form.school || '').trim(),
      status: form.status || 'Postponed',
      intake: form.intake || '',
      actual_join_date: form.actual_join_date ? toIsoDate_(form.actual_join_date) : '',
      package: form.package || '',
      credit_class: form.credit_class !== undefined && form.credit_class !== '' ? Number(form.credit_class) : 0,
      payment_status: form.payment_status || '',
      retention_status: form.retention_status || '',
      last_membership_date: form.last_membership_date ? toIsoDate_(form.last_membership_date) : ''
    };

    Db.insertUnlocked_('students', newStudent, user.email);
    return newStudent;
  });
}

/**
 * Updates an existing student record.
 * @param {Object} form
 * @return {Object}
 */
function updateStudent(form) {
  if (!form || !form.student_id) {
    throw new Error('ID murid wajib disertakan.');
  }
  if (!form.full_name || !String(form.full_name).trim()) {
    throw new Error('Nama lengkap murid wajib diisi.');
  }

  const existing = Db.findOne('students', s => s.student_id === form.student_id);
  if (!existing) throw new Error('Murid tidak ditemukan.');

  const centerCode = existing.center_code;
  const user = requireRole_(['HQ', 'CM', 'SA'], centerCode);

  const patch = {
    full_name: String(form.full_name).trim(),
    nickname: (form.nickname || '').trim(),
    dob: form.dob ? toIsoDate_(form.dob) : '',
    parent_name: (form.parent_name || '').trim(),
    parent_phone: (form.parent_phone || '').trim(),
    language: form.language || existing.language || 'Indonesian',
    school: (form.school || '').trim(),
    status: form.status || existing.status || 'Postponed',
    intake: form.intake !== undefined ? form.intake : existing.intake,
    actual_join_date: form.actual_join_date ? toIsoDate_(form.actual_join_date) : '',
    package: form.package !== undefined ? form.package : existing.package,
    credit_class: form.credit_class !== undefined && form.credit_class !== '' ? Number(form.credit_class) : existing.credit_class,
    payment_status: form.payment_status !== undefined ? form.payment_status : existing.payment_status,
    retention_status: form.retention_status !== undefined ? form.retention_status : existing.retention_status,
    last_membership_date: form.last_membership_date ? toIsoDate_(form.last_membership_date) : ''
  };

  const updated = Db.update('students', 'student_id', form.student_id, patch, user.email);
  return updated;
}

/**
 * Classes.gs — Class management, session schedule generator, events, and enrollments.
 */

/**
 * Parses schedule day codes (e.g., 'TTh', 'MWF', 'Sa', 'M, W, F') into JS weekday numbers (0=Sun, 1=Mon, ..., 6=Sat).
 * Greedy 2-character token matching first (Th, Sa, Su), then single-character (M, T, W, F).
 * @param {string} str
 * @return {number[]}
 */
function parseDayCodes_(str) {
  if (!str) return [1]; // Default to Monday
  const input = String(str).trim();
  const days = [];
  let i = 0;

  while (i < input.length) {
    // Check 2-character tokens
    const two = input.slice(i, i + 2).toLowerCase();
    if (two === 'th') {
      days.push(4); // Thursday
      i += 2;
      continue;
    } else if (two === 'sa') {
      days.push(6); // Saturday
      i += 2;
      continue;
    } else if (two === 'su') {
      days.push(0); // Sunday
      i += 2;
      continue;
    }

    // Check 1-character tokens
    const one = input[i].toLowerCase();
    if (one === 'm') {
      days.push(1); // Monday
      i += 1;
    } else if (one === 't') {
      days.push(2); // Tuesday
      i += 1;
    } else if (one === 'w') {
      days.push(3); // Wednesday
      i += 1;
    } else if (one === 'f') {
      days.push(5); // Friday
      i += 1;
    } else {
      // Skip delimiters, spaces, commas, numbers
      i += 1;
    }
  }

  const unique = Array.from(new Set(days));
  return unique.length > 0 ? unique : [1];
}

/**
 * Computes next Class ID formatted as C{center_no}-{yy}{seq 3-digit}, e.g. C01-25089.
 * Assumption from doc §12 Q1: center_no comes from centers table, yy is 2-digit year.
 * Must be executed while caller holds lock or within withLock_.
 * @param {string} centerCode
 * @param {number|string=} year
 * @return {string}
 */
function nextClassId_(centerCode, year) {
  const center = Db.findOne('centers', c => c.center_code === centerCode);
  const centerNo = (center && center.center_no) ? String(center.center_no).padStart(2, '0') : '01';
  const yr = year ? new Date(year, 0, 1) : new Date();
  const yy = String(yr.getFullYear()).slice(-2);
  const prefix = `C${centerNo}-${yy}`;

  const allClasses = Db.readAll('classes', { includeDeleted: true });
  let maxSeq = 0;
  for (const c of allClasses) {
    const cid = String(c.class_id || '');
    if (cid.startsWith(prefix)) {
      const seqStr = cid.slice(prefix.length);
      const seqNum = parseInt(seqStr, 10);
      if (!isNaN(seqNum) && seqNum > maxSeq) {
        maxSeq = seqNum;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

/**
 * Generates 48 sessions according to schedule days and skips center holidays.
 * @param {Object} klass
 * @param {Object[]} holidays
 * @param {string|Date} startDate
 * @return {Object[]}
 */
function generateSessions_(klass, holidays, startDate) {
  const dayNums = parseDayCodes_(klass.schedule_day);
  const holidayDates = new Set();

  for (const h of holidays) {
    if (!h.center_code || h.center_code === klass.center_code) {
      holidayDates.add(toIsoDate_(h.date));
    }
  }

  const sessions = [];
  const curr = new Date(startDate);
  // Zero out time
  curr.setHours(0, 0, 0, 0);

  let sessionNo = 1;
  let safetyDays = 0;

  while (sessionNo <= (klass.total_sessions || 48) && safetyDays < 1000) {
    safetyDays++;
    const dayOfWeek = curr.getDay();
    if (dayNums.includes(dayOfWeek)) {
      const dateIso = toIsoDate_(curr);
      if (!holidayDates.has(dateIso)) {
        const milestone = MILESTONE_BY_SESSION[sessionNo] || '';
        sessions.push({
          session_id: `${klass.class_id}-S${String(sessionNo).padStart(2, '0')}`,
          class_id: klass.class_id,
          session_no: sessionNo,
          planned_date: dateIso,
          actual_date: '',
          teacher_email: klass.main_teacher_email || '',
          lesson_plan_url: '',
          milestone: milestone
        });
        sessionNo++;
      }
    }
    curr.setDate(curr.getDate() + 1);
  }

  return sessions;
}

/**
 * Generates events from EVENT_RULES mapped to planned session dates.
 * @param {Object} klass
 * @param {Object[]} sessions
 * @return {Object[]}
 */
function generateEvents_(klass, sessions) {
  const events = [];
  const sessionMap = new Map();
  for (const s of sessions) {
    sessionMap.set(s.session_no, s.planned_date);
  }

  // CLASS_MEDIA
  for (const sNo of EVENT_RULES.CLASS_MEDIA) {
    const dueDate = sessionMap.get(sNo) || klass.start_date;
    events.push({
      class_id: klass.class_id,
      event_type: 'CLASS_MEDIA',
      due_date: dueDate,
      done_date: '',
      status: 'Open',
      description: `Class Media Sesi ${sNo}`
    });
  }

  // PTM
  for (const sNo of EVENT_RULES.PTM) {
    const dueDate = sessionMap.get(sNo) || klass.start_date;
    events.push({
      class_id: klass.class_id,
      event_type: 'PTM',
      due_date: dueDate,
      done_date: '',
      status: 'Open',
      description: `PTM Sesi ${sNo}`
    });
  }

  // TERMLY_REPORT
  for (const sNo of EVENT_RULES.TERMLY_REPORT) {
    const dueDate = sessionMap.get(sNo) || klass.start_date;
    events.push({
      class_id: klass.class_id,
      event_type: 'TERMLY_REPORT',
      due_date: dueDate,
      done_date: '',
      status: 'Open',
      description: `Termly Report Sesi ${sNo}`
    });
  }

  // PROGRESS_REPORT (Assumption: start_date + N months)
  const baseStart = parseIsoDate_(klass.start_date) || new Date();
  for (const monthNum of EVENT_RULES.PROGRESS_REPORT_MONTHS) {
    const reportDue = new Date(baseStart);
    reportDue.setMonth(reportDue.getMonth() + monthNum);
    events.push({
      class_id: klass.class_id,
      event_type: 'PROGRESS_REPORT',
      due_date: toIsoDate_(reportDue),
      done_date: '',
      status: 'Open',
      description: `Progress Report Bulan ${monthNum}`
    });
  }

  return events;
}

/**
 * Lists classes matching filters.
 * @param {Object=} filters {center: string, status: string, program: string, day: string}
 * @return {Object[]}
 */
function listClasses(filters) {
  const user = requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  const f = filters || {};
  const allClasses = Db.readAll('classes');

  return allClasses.filter(c => {
    if (user.centerList && user.centerList.length > 0) {
      if (!user.centerList.includes(c.center_code)) return false;
    }
    if (f.center && c.center_code !== f.center) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.program && c.program !== f.program) return false;
    if (f.day && c.schedule_day !== f.day) return false;
    return true;
  }).map(c => ({
    class_id: c.class_id,
    center_code: c.center_code,
    class_name: `${c.program || ''}-${c.level || ''} ${c.schedule_day || ''} ${c.schedule_time || ''}`.trim(),
    program: c.program,
    level: c.level,
    schedule_day: c.schedule_day,
    schedule_time: c.schedule_time,
    room: c.room || '',
    main_teacher_email: c.main_teacher_email || '',
    sa_email: c.sa_email || '',
    intake: c.intake || '',
    start_date: c.start_date ? toIsoDate_(c.start_date) : '',
    end_date: c.end_date ? toIsoDate_(c.end_date) : '',
    status: c.status || 'Draft',
    total_sessions: c.total_sessions || 48
  }));
}

/**
 * Retrieves full class details including students, sessions and events.
 * @param {string} classId
 * @return {Object}
 */
function getClassDetail(classId) {
  const user = requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  if (!classId) throw new Error('ID kelas wajib diisi.');

  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  if (user.centerList && user.centerList.length > 0 && !user.centerList.includes(klass.center_code)) {
    throw new Error('Tidak punya akses ke kelas cabang ' + klass.center_code);
  }

  // Active enrollments for this class
  const enrollments = Db.readWhere('enrollments', e => e.class_id === classId && (!e.leave_date || e.leave_date === ''));
  const allStudents = Db.readAll('students');
  const studentMap = new Map();
  for (const s of allStudents) {
    studentMap.set(s.student_id, s);
  }

  const enrolledStudents = enrollments.map(enr => {
    const s = studentMap.get(enr.student_id) || {};
    return {
      enrollment: {
        enrollment_id: enr.enrollment_id,
        student_id: enr.student_id,
        class_id: enr.class_id,
        join_date: enr.join_date ? toIsoDate_(enr.join_date) : '',
        leave_date: enr.leave_date ? toIsoDate_(enr.leave_date) : '',
        leave_reason: enr.leave_reason || ''
      },
      student: {
        student_id: s.student_id || enr.student_id,
        full_name: s.full_name || '',
        nickname: s.nickname || '',
        status: s.status || '',
        package: s.package || '',
        credit_class: s.credit_class || ''
      }
    };
  });

  const sessions = Db.readWhere('sessions', s => s.class_id === classId)
    .sort((a, b) => Number(a.session_no) - Number(b.session_no))
    .map(s => ({
      session_id: s.session_id,
      class_id: s.class_id,
      session_no: s.session_no,
      planned_date: s.planned_date ? toIsoDate_(s.planned_date) : '',
      actual_date: s.actual_date ? toIsoDate_(s.actual_date) : '',
      teacher_email: s.teacher_email || '',
      lesson_plan_url: s.lesson_plan_url || '',
      milestone: s.milestone || ''
    }));

  const events = Db.readWhere('events', ev => ev.class_id === classId)
    .map(ev => ({
      class_id: ev.class_id,
      event_type: ev.event_type,
      due_date: ev.due_date ? toIsoDate_(ev.due_date) : '',
      done_date: ev.done_date ? toIsoDate_(ev.done_date) : '',
      status: ev.status,
      description: ev.description || ''
    }));

  return {
    klass: Object.assign({}, klass, {
      start_date: klass.start_date ? toIsoDate_(klass.start_date) : '',
      end_date: klass.end_date ? toIsoDate_(klass.end_date) : '',
      class_name: `${klass.program || ''}-${klass.level || ''} ${klass.schedule_day || ''} ${klass.schedule_time || ''}`.trim()
    }),
    students: enrolledStudents,
    sessions: sessions,
    events: events
  };
}

/**
 * Creates a new class, 48 sessions and event milestones inside ONE lock.
 * @param {Object} form
 * @return {Object}
 */
function createClass(form) {
  if (!form || !form.center_code) throw new Error('Cabang kelas wajib dipilih.');
  if (!form.program || !form.level) throw new Error('Program dan level wajib diisi.');
  if (!form.schedule_day || !form.schedule_time) throw new Error('Jadwal hari dan jam wajib diisi.');
  if (!form.start_date) throw new Error('Tanggal mulai kelas wajib diisi.');

  const centerCode = String(form.center_code).trim().toUpperCase();
  const user = requireRole_(['HQ', 'CM', 'SA'], centerCode);

  return withLock_(() => {
    const classId = nextClassId_(centerCode, form.start_date);
    const holidays = Db.readAll('holidays');

    const klassObj = {
      class_id: classId,
      center_code: centerCode,
      program: form.program,
      level: form.level,
      schedule_day: form.schedule_day,
      schedule_time: form.schedule_time,
      room: form.room || '',
      main_teacher_email: form.main_teacher_email || '',
      sa_email: form.sa_email || user.email,
      intake: form.intake || '',
      start_date: toIsoDate_(form.start_date),
      end_date: '',
      previous_class_id: form.previous_class_id || '',
      total_sessions: 48,
      status: form.status || 'Draft'
    };

    const sessions = generateSessions_(klassObj, holidays, klassObj.start_date);
    if (sessions.length > 0) {
      klassObj.end_date = sessions[sessions.length - 1].planned_date;
    }

    const events = generateEvents_(klassObj, sessions);

    // Batched inserts
    Db.insertUnlocked_('classes', klassObj, user.email);
    Db.insertManyUnlocked_('sessions', sessions, user.email);
    Db.insertManyUnlocked_('events', events, user.email);

    return {
      class_id: classId,
      sessions_created: sessions.length,
      events_created: events.length
    };
  });
}

/**
 * Updates basic class details.
 * @param {Object} form
 * @return {Object}
 */
function updateClass(form) {
  if (!form || !form.class_id) throw new Error('ID kelas wajib diisi.');
  const existing = Db.findOne('classes', c => c.class_id === form.class_id);
  if (!existing) throw new Error('Kelas tidak ditemukan.');

  const user = requireRole_(['HQ', 'CM', 'SA'], existing.center_code);

  const patch = {
    room: form.room !== undefined ? form.room : existing.room,
    main_teacher_email: form.main_teacher_email !== undefined ? form.main_teacher_email : existing.main_teacher_email,
    sa_email: form.sa_email !== undefined ? form.sa_email : existing.sa_email,
    intake: form.intake !== undefined ? form.intake : existing.intake,
    status: form.status !== undefined ? form.status : existing.status
  };

  const updated = Db.update('classes', 'class_id', form.class_id, patch, user.email);
  return updated;
}

/**
 * Lists teachers available in a center.
 * @param {string=} centerCode
 * @return {Object[]}
 */
function listTeachers(centerCode) {
  requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  const allUsers = Db.readCached_('users');
  return allUsers.filter(u => {
    if (!u.is_active || String(u.is_active).toLowerCase() !== 'true') return false;
    if (u.role !== 'TEACHER' && u.role !== 'LEAD_TEACHER') return false;
    if (centerCode && u.center_codes && String(u.center_codes).trim().length > 0) {
      const allowed = String(u.center_codes).split(',').map(s => s.trim());
      if (!allowed.includes(centerCode)) return false;
    }
    return true;
  }).map(u => ({
    email: u.email,
    full_name: u.full_name || u.email,
    role: u.role
  }));
}

/**
 * Generates next enrollment ID formatted as ENR-000123 (6 digits).
 * Must be executed while caller holds lock or within withLock_.
 * @return {string}
 */
function nextEnrollmentId_() {
  const all = Db.readAll('enrollments', { includeDeleted: true });
  let maxSeq = 0;
  for (const e of all) {
    const eid = String(e.enrollment_id || '');
    if (eid.startsWith('ENR-')) {
      const numPart = parseInt(eid.slice(4), 10);
      if (!isNaN(numPart) && numPart > maxSeq) {
        maxSeq = numPart;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return 'ENR-' + String(nextSeq).padStart(6, '0');
}

/**
 * Places student into a class. Closes any existing open enrollment.
 * @param {string} studentId
 * @param {string} classId
 * @param {string=} joinDate
 * @param {string=} leaveReason
 * @return {Object}
 */
function placeStudent(studentId, classId, joinDate, leaveReason) {
  if (!studentId || !classId) throw new Error('ID murid dan ID kelas wajib diisi.');
  const student = Db.findOne('students', s => s.student_id === studentId);
  const targetClass = Db.findOne('classes', c => c.class_id === classId);
  if (!student) throw new Error('Murid tidak ditemukan.');
  if (!targetClass) throw new Error('Kelas target tidak ditemukan.');

  const user = requireRole_(['HQ', 'CM', 'SA'], targetClass.center_code);

  return withLock_(() => {
    const effectiveJoinDate = joinDate ? toIsoDate_(joinDate) : toIsoDate_(new Date());

    // 1. Close current open enrollments for this student
    const openEnrollments = Db.readWhere('enrollments', e => e.student_id === studentId && (!e.leave_date || e.leave_date === ''));
    for (const openEnr of openEnrollments) {
      Db.update('enrollments', 'enrollment_id', openEnr.enrollment_id, {
        leave_date: effectiveJoinDate,
        leave_reason: leaveReason || 'Pindah Kelas'
      }, user.email);
    }

    // 2. Create new enrollment
    const enrollmentId = nextEnrollmentId_();
    const newEnrollment = {
      enrollment_id: enrollmentId,
      student_id: studentId,
      class_id: classId,
      join_date: effectiveJoinDate,
      leave_date: '',
      leave_reason: ''
    };
    Db.insertUnlocked_('enrollments', newEnrollment, user.email);

    // 3. Update student status based on class status
    const newStudentStatus = targetClass.status === 'Active' ? 'Active' : 'Postponed';
    Db.update('students', 'student_id', studentId, {
      status: newStudentStatus
    }, user.email);

    return {
      ok: true,
      enrollment_id: enrollmentId,
      student_id: studentId,
      class_id: classId,
      student_status: newStudentStatus
    };
  });
}

/**
 * Closes an enrollment record.
 * @param {string} enrollmentId
 * @param {string} leaveDate
 * @param {string} leaveReason
 * @param {string=} newStatus
 * @return {Object}
 */
function closeEnrollment(enrollmentId, leaveDate, leaveReason, newStatus) {
  if (!enrollmentId) throw new Error('ID penempatan wajib disertakan.');
  const enr = Db.findOne('enrollments', e => e.enrollment_id === enrollmentId);
  if (!enr) throw new Error('Penempatan tidak ditemukan.');

  const student = Db.findOne('students', s => s.student_id === enr.student_id);
  const user = requireRole_(['HQ', 'CM', 'SA'], student ? student.center_code : null);

  return withLock_(() => {
    const lDate = leaveDate ? toIsoDate_(leaveDate) : toIsoDate_(new Date());
    const updatedEnr = Db.update('enrollments', 'enrollment_id', enrollmentId, {
      leave_date: lDate,
      leave_reason: leaveReason || 'Berhenti'
    }, user.email);

    if (newStatus && student) {
      Db.update('students', 'student_id', student.student_id, {
        status: newStatus
      }, user.email);
    }

    return updatedEnr;
  });
}

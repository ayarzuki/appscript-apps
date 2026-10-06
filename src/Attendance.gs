/**
 * Attendance.gs — Session roster, attendance recording, daily notes, and attendance rates.
 */

/**
 * Finds the session number at which a student joined a class.
 * Used for fair attendance rate calculation and looping leveling check.
 * @param {string} classId
 * @param {string} studentId
 * @return {number}
 */
function joinSessionNo_(classId, studentId) {
  const enrollment = Db.findOne('enrollments', e => e.class_id === classId && e.student_id === studentId);
  if (!enrollment || !enrollment.join_date) return 1;

  const joinDateIso = toIsoDate_(enrollment.join_date);
  const sessions = Db.readWhere('sessions', s => s.class_id === classId)
    .sort((a, b) => Number(a.session_no) - Number(b.session_no));

  for (const s of sessions) {
    if (toIsoDate_(s.planned_date) >= joinDateIso) {
      return Number(s.session_no);
    }
  }
  return sessions.length > 0 ? Number(sessions[sessions.length - 1].session_no) : 1;
}

/**
 * Computes attendance rate percentage for a student in a class.
 * Returns null if conducted sessions count is 0.
 * @param {string} classId
 * @param {string} studentId
 * @return {{present: number, absent: number, excused: number, conducted: number, rate: number|null}}
 */
function attendanceRate_(classId, studentId) {
  const todayIso = toIsoDate_(new Date());
  const minSessionNo = joinSessionNo_(classId, studentId);

  const conductedSessions = Db.readWhere('sessions', s =>
    s.class_id === classId &&
    Number(s.session_no) >= minSessionNo &&
    toIsoDate_(s.planned_date) <= todayIso
  );

  const conducted = conductedSessions.length;
  if (conducted === 0) {
    return { present: 0, absent: 0, excused: 0, conducted: 0, rate: null };
  }

  const sessionIds = new Set(conductedSessions.map(s => s.session_id));
  const attendanceRecords = Db.readWhere('attendance', a => a.student_id === studentId && sessionIds.has(a.session_id));

  let present = 0;
  let absent = 0;
  let excused = 0;

  for (const a of attendanceRecords) {
    if (a.status === 'Present') present++;
    else if (a.status === 'Absent') absent++;
    else if (a.status === 'Excused') excused++;
  }

  const rate = Math.round((present / conducted) * 100);
  return { present, absent, excused, conducted, rate };
}

/**
 * Retrieves teacher's sessions based on scope: 'today' | 'upcoming' | 'unrecorded'.
 * @param {string=} scope
 * @return {Object[]}
 */
function getMySessions(scope) {
  const user = requireRole_(['TEACHER', 'LEAD_TEACHER', 'CM', 'HQ']);
  const todayIso = toIsoDate_(new Date());
  const allClasses = Db.readAll('classes');
  const classMap = new Map();

  for (const c of allClasses) {
    let allowed = false;
    if (user.role === 'HQ') allowed = true;
    else if (user.role === 'TEACHER') {
      allowed = (c.main_teacher_email && c.main_teacher_email.toLowerCase() === user.email.toLowerCase());
    } else if (user.role === 'LEAD_TEACHER' || user.role === 'CM') {
      allowed = !user.centerList || user.centerList.includes(c.center_code);
    }
    if (allowed) classMap.set(c.class_id, c);
  }

  const allSessions = Db.readAll('sessions');
  const filtered = allSessions.filter(s => {
    if (!classMap.has(s.class_id)) return false;
    const pDate = toIsoDate_(s.planned_date);

    if (scope === 'today') {
      return pDate === todayIso;
    } else if (scope === 'upcoming') {
      return pDate > todayIso;
    } else if (scope === 'unrecorded') {
      return pDate <= todayIso && (!s.actual_date || s.actual_date === '');
    }
    return true; // default all
  });

  return filtered.map(s => {
    const k = classMap.get(s.class_id) || {};
    return {
      session_id: s.session_id,
      class_id: s.class_id,
      class_name: `${k.program || ''}-${k.level || ''} ${k.schedule_day || ''} ${k.schedule_time || ''}`.trim(),
      session_no: s.session_no,
      planned_date: toIsoDate_(s.planned_date),
      actual_date: s.actual_date ? toIsoDate_(s.actual_date) : '',
      teacher_email: s.teacher_email || k.main_teacher_email || '',
      milestone: s.milestone || '',
      room: k.room || '',
      center_code: k.center_code || ''
    };
  }).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
}

/**
 * Retrieves roster for a specific session: session details, class info, and student list with current attendance/note.
 * @param {string} sessionId
 * @return {Object}
 */
function getSessionRoster(sessionId) {
  if (!sessionId) throw new Error('ID sesi wajib diisi.');
  const session = Db.findOne('sessions', s => s.session_id === sessionId);
  if (!session) throw new Error('Sesi tidak ditemukan.');

  const klass = Db.findOne('classes', c => c.class_id === session.class_id);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  const user = requireRole_(['TEACHER', 'LEAD_TEACHER', 'CM', 'SA', 'HQ'], klass.center_code);

  // Active enrollments for this class
  const enrollments = Db.readWhere('enrollments', e => e.class_id === klass.class_id && (!e.leave_date || e.leave_date === ''));
  const allStudents = Db.readAll('students');
  const studentMap = new Map();
  for (const s of allStudents) {
    studentMap.set(s.student_id, s);
  }

  // Load existing attendance and daily notes for this session
  const attendanceList = Db.readWhere('attendance', a => a.session_id === sessionId);
  const attMap = new Map();
  for (const a of attendanceList) {
    attMap.set(a.student_id, a);
  }

  const notesList = Db.readWhere('daily_notes', n => n.session_id === sessionId);
  const noteMap = new Map();
  for (const n of notesList) {
    noteMap.set(n.student_id, n);
  }

  const students = enrollments.map(enr => {
    const s = studentMap.get(enr.student_id) || {};
    const att = attMap.get(enr.student_id) || null;
    const note = noteMap.get(enr.student_id) || null;

    return {
      student: {
        student_id: s.student_id || enr.student_id,
        full_name: s.full_name || '',
        nickname: s.nickname || ''
      },
      attendance: att ? { status: att.status, recorded_by: att.recorded_by } : null,
      note: note ? {
        score: note.score,
        achievement: note.achievement || '',
        area_of_improvement: note.area_of_improvement || '',
        recorded_by: note.recorded_by
      } : null
    };
  });

  return {
    session: Object.assign({}, session, {
      planned_date: toIsoDate_(session.planned_date),
      actual_date: session.actual_date ? toIsoDate_(session.actual_date) : ''
    }),
    klass: Object.assign({}, klass, {
      class_name: `${klass.program || ''}-${klass.level || ''} ${klass.schedule_day || ''} ${klass.schedule_time || ''}`.trim()
    }),
    students: students
  };
}

/**
 * Saves attendance and daily notes for an entire session in a batched write.
 * @param {string} sessionId
 * @param {Object} payload {actual_date, teacher_email, entries: [{student_id, status, score, achievement, area_of_improvement}]}
 * @return {{savedCount: number}}
 */
function saveSessionEntries(sessionId, payload) {
  if (!sessionId || !payload || !Array.isArray(payload.entries)) {
    throw new Error('Data absensi tidak lengkap.');
  }

  const session = Db.findOne('sessions', s => s.session_id === sessionId);
  if (!session) throw new Error('Sesi tidak ditemukan.');

  const klass = Db.findOne('classes', c => c.class_id === session.class_id);
  const user = requireRole_(['TEACHER', 'LEAD_TEACHER', 'CM', 'HQ'], klass ? klass.center_code : null);

  return withLock_(() => {
    const actualDate = payload.actual_date ? toIsoDate_(payload.actual_date) : toIsoDate_(new Date());
    const teacherEmail = payload.teacher_email || user.email;

    // 1. Update session actual_date & teacher_email
    Db.update('sessions', 'session_id', sessionId, {
      actual_date: actualDate,
      teacher_email: teacherEmail
    }, user.email);

    // 2. Batch upsert attendance & daily_notes
    // Read existing to determine insert vs update
    const existingAtt = Db.readWhere('attendance', a => a.session_id === sessionId);
    const existingNotes = Db.readWhere('daily_notes', n => n.session_id === sessionId);

    const existingAttMap = new Map(existingAtt.map(a => [a.student_id, a]));
    const existingNotesMap = new Map(existingNotes.map(n => [n.student_id, n]));

    const newAttRecords = [];
    const newNoteRecords = [];

    for (const item of payload.entries) {
      if (!item.student_id) continue;

      // Attendance
      if (item.status) {
        if (existingAttMap.has(item.student_id)) {
          // Update in place
          const existingRow = existingAttMap.get(item.student_id);
          Db.update('attendance', 'session_id', sessionId, {
            status: item.status,
            recorded_by: existingRow.recorded_by || user.email
          }, user.email);
        } else {
          newAttRecords.push({
            session_id: sessionId,
            student_id: item.student_id,
            status: item.status,
            recorded_by: user.email
          });
        }
      }

      // Daily notes
      if (existingNotesMap.has(item.student_id)) {
        const existingRow = existingNotesMap.get(item.student_id);
        Db.update('daily_notes', 'session_id', sessionId, {
          score: item.score !== undefined ? item.score : existingRow.score,
          achievement: item.achievement !== undefined ? item.achievement : existingRow.achievement,
          area_of_improvement: item.area_of_improvement !== undefined ? item.area_of_improvement : existingRow.area_of_improvement,
          recorded_by: existingRow.recorded_by || user.email
        }, user.email);
      } else {
        newNoteRecords.push({
          session_id: sessionId,
          student_id: item.student_id,
          score: item.score !== undefined ? item.score : '',
          achievement: item.achievement || '',
          area_of_improvement: item.area_of_improvement || '',
          recorded_by: user.email
        });
      }
    }

    if (newAttRecords.length > 0) {
      Db.insertManyUnlocked_('attendance', newAttRecords, user.email);
    }
    if (newNoteRecords.length > 0) {
      Db.insertManyUnlocked_('daily_notes', newNoteRecords, user.email);
    }

    return { savedCount: payload.entries.length };
  });
}

/**
 * Lists all sessions for a specific class.
 * @param {string} classId
 * @return {Object[]}
 */
function listSessionsForClass(classId) {
  if (!classId) throw new Error('ID kelas wajib diisi.');
  requireRole_(['HQ', 'CM', 'SA', 'TEACHER', 'LEAD_TEACHER']);

  return Db.readWhere('sessions', s => s.class_id === classId)
    .sort((a, b) => Number(a.session_no) - Number(b.session_no))
    .map(s => ({
      session_id: s.session_id,
      session_no: s.session_no,
      planned_date: toIsoDate_(s.planned_date),
      actual_date: s.actual_date ? toIsoDate_(s.actual_date) : '',
      teacher_email: s.teacher_email || '',
      milestone: s.milestone || ''
    }));
}

/**
 * Computes attendance summary for each enrolled student in a class.
 * @param {string} classId
 * @return {Object[]}
 */
function getClassAttendanceSummary(classId) {
  if (!classId) throw new Error('ID kelas wajib diisi.');
  requireRole_(['HQ', 'CM', 'SA', 'TEACHER', 'LEAD_TEACHER']);

  const enrollments = Db.readWhere('enrollments', e => e.class_id === classId && (!e.leave_date || e.leave_date === ''));
  const allStudents = Db.readAll('students');
  const studentMap = new Map();
  for (const s of allStudents) {
    studentMap.set(s.student_id, s);
  }

  return enrollments.map(enr => {
    const s = studentMap.get(enr.student_id) || {};
    const stats = attendanceRate_(classId, enr.student_id);
    return {
      student_id: enr.student_id,
      full_name: s.full_name || '',
      nickname: s.nickname || '',
      present: stats.present,
      absent: stats.absent,
      excused: stats.excused,
      conducted: stats.conducted,
      rate: stats.rate
    };
  });
}

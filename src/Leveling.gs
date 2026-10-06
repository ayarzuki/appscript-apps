/**
 * Leveling.gs — Achievement Day leveling evaluation, recommendation engine and decisions.
 */

/**
 * Computes leveling recommendation for a student based on final grade, attendance rate, and join session.
 * Order of evaluation follows academic policy (§6.6):
 * 1. No final grade -> NEED_ASSESSMENT
 * 2. Final grade 'D' -> LOOPING
 * 3. Join session >= 45 -> LOOPING
 * 4. Attendance < 70% -> LOOPING
 * 5. Grade >= A and attendance >= 75% -> BIG
 * 6. Grade >= C and attendance >= 70% -> SMALL
 * 7. Default -> LOOPING
 *
 * @param {Object} student
 * @param {Object} klass
 * @param {string|null} finalGrade
 * @param {number|null} attRate
 * @param {number} joinSessionNo
 * @param {Object[]} progLevels
 * @return {{recommendation_type: string, recommended_level: string, reason: string}}
 */
function computeRecommendation_(student, klass, finalGrade, attRate, joinSessionNo, progLevels) {
  const currentProgram = klass.program || '';
  const currentLevel = klass.level || '';
  const currentFull = `${currentProgram} ${currentLevel}`.trim();

  // Find level entry in programs_levels
  const levelEntry = progLevels.find(pl =>
    pl.program === currentProgram && String(pl.level).toUpperCase() === String(currentLevel).toUpperCase()
  );

  // 1. Missing grade
  if (!finalGrade) {
    return {
      recommendation_type: 'NEED_ASSESSMENT',
      recommended_level: currentFull,
      reason: 'Belum ada nilai final term untuk evaluasi leveling.'
    };
  }

  const gradeClean = String(finalGrade).trim().toUpperCase();

  // 2. Grade D -> Looping
  if (gradeClean === 'D') {
    return {
      recommendation_type: 'LOOPING',
      recommended_level: currentFull,
      reason: 'Nilai akhir D, direkomendasikan mengulang materi (looping).'
    };
  }

  // 3. Joined at session >= 45 -> Looping
  if (joinSessionNo >= LEVELING.joinSessionLooping) {
    return {
      recommendation_type: 'LOOPING',
      recommended_level: currentFull,
      reason: `Bergabung di sesi ${joinSessionNo} (>= ${LEVELING.joinSessionLooping}), materi belum lengkap.`
    };
  }

  // 4. Attendance < 70% -> Looping
  if (attRate !== null && attRate < LEVELING.minAttendanceSmall) {
    return {
      recommendation_type: 'LOOPING',
      recommended_level: currentFull,
      reason: `Kehadiran ${attRate}% (< ${LEVELING.minAttendanceSmall}%), belum memenuhi syarat naik level.`
    };
  }

  const rank = GRADE_RANK[gradeClean] || 0;

  // 5. Grade >= A (4) and attendance >= 75% -> BIG
  if (rank >= GRADE_RANK['A'] && (attRate === null || attRate >= LEVELING.minAttendanceBig)) {
    let nextBig = levelEntry ? levelEntry.next_big_level : '';
    if (nextBig && !nextBig.includes(' ')) nextBig = `${currentProgram} ${nextBig}`;
    return {
      recommendation_type: 'BIG',
      recommended_level: nextBig || currentFull,
      reason: `Performa sangat baik (Nilai ${gradeClean}, Kehadiran ${attRate !== null ? attRate + '%' : 'N/A'}), direkomendasikan naik level besar.`
    };
  }

  // 6. Grade >= C (2) and attendance >= 70% -> SMALL
  if (rank >= GRADE_RANK['C'] && (attRate === null || attRate >= LEVELING.minAttendanceSmall)) {
    let nextSmall = levelEntry ? levelEntry.next_small_level : '';
    if (nextSmall && !nextSmall.includes(' ')) nextSmall = `${currentProgram} ${nextSmall}`;
    return {
      recommendation_type: 'SMALL',
      recommended_level: nextSmall || currentFull,
      reason: `Performa memenuhi syarat reguler (Nilai ${gradeClean}, Kehadiran ${attRate !== null ? attRate + '%' : 'N/A'}), direkomendasikan naik level kecil.`
    };
  }

  // 7. Otherwise Looping
  return {
    recommendation_type: 'LOOPING',
    recommended_level: currentFull,
    reason: `Performa belum mencukupi untuk kenaikan level reguler.`
  };
}

/**
 * Retrieves Leveling Board for a class.
 * Accessible to LEAD_TEACHER, CM, SA, HQ.
 * @param {string} classId
 * @return {Object}
 */
function getLevelingBoard(classId) {
  if (!classId) throw new Error('ID kelas wajib diisi.');
  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER'], klass.center_code);

  const enrollments = Db.readWhere('enrollments', e => e.class_id === classId && (!e.leave_date || e.leave_date === ''));
  const allStudents = Db.readAll('students');
  const studentMap = new Map(allStudents.map(s => [s.student_id, s]));

  const assessments = Db.readWhere('assessments', a => a.class_id === classId);
  const levelingDecisions = Db.readWhere('leveling', l => l.class_id === classId);
  const decisionMap = new Map(levelingDecisions.map(l => [l.student_id, l]));

  const progLevels = Db.readCached_('programs_levels');

  const rows = enrollments.map(enr => {
    const s = studentMap.get(enr.student_id) || {};
    const attStats = attendanceRate_(classId, enr.student_id);
    const joinSNo = joinSessionNo_(classId, enr.student_id);

    // Look for final term assessment (FINAL_TERM_2 first, then FINAL_TERM_1)
    const studentAssessments = assessments.filter(a => a.student_id === enr.student_id);
    const ft2 = studentAssessments.find(a => a.assessment_type === 'FINAL_TERM_2');
    const ft1 = studentAssessments.find(a => a.assessment_type === 'FINAL_TERM_1');
    const finalGrade = (ft2 && ft2.grade) ? ft2.grade : ((ft1 && ft1.grade) ? ft1.grade : null);

    const rec = computeRecommendation_(s, klass, finalGrade, attStats.rate, joinSNo, progLevels);
    const existingDecision = decisionMap.get(enr.student_id) || null;

    return {
      student: {
        student_id: enr.student_id,
        full_name: s.full_name || '',
        nickname: s.nickname || '',
        status: s.status || ''
      },
      finalGrades: {
        final_term_1: ft1 ? ft1.grade : '',
        final_term_2: ft2 ? ft2.grade : '',
        effective: finalGrade || ''
      },
      attendanceRate: attStats.rate,
      joinSessionNo: joinSNo,
      recommended_level: rec.recommended_level,
      recommendation_type: rec.recommendation_type,
      reason: rec.reason,
      decision: existingDecision ? {
        final_level: existingDecision.final_level,
        decision_type: existingDecision.decision_type,
        notes: existingDecision.notes || '',
        decided_by: existingDecision.decided_by || '',
        decided_at: existingDecision.decided_at ? toIsoDateTime_(existingDecision.decided_at) : ''
      } : null
    };
  });

  return {
    class_id: classId,
    class_name: `${klass.program || ''}-${klass.level || ''} ${klass.schedule_day || ''} ${klass.schedule_time || ''}`.trim(),
    intake: klass.intake || '',
    rows: rows
  };
}

/**
 * Saves leveling decisions for students in a class.
 * Restricted to LEAD_TEACHER and HQ.
 * @param {string} classId
 * @param {Object[]} decisions [{student_id, final_level, decision_type, notes}]
 * @return {{savedCount: number}}
 */
function saveLevelingDecisions(classId, decisions) {
  if (!classId || !Array.isArray(decisions)) throw new Error('Data keputusan leveling tidak lengkap.');
  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  const user = requireRole_(['LEAD_TEACHER', 'HQ'], klass.center_code);

  return withLock_(() => {
    const existing = Db.readWhere('leveling', l => l.class_id === classId);
    const existingMap = new Map(existing.map(l => [l.student_id, l]));
    const nowIso = toIsoDateTime_(new Date());
    let count = 0;

    for (const d of decisions) {
      if (!d.student_id || !d.final_level) continue;

      if (existingMap.has(d.student_id)) {
        Db.update('leveling', 'class_id', classId, {
          final_level: d.final_level,
          decision_type: d.decision_type || 'SMALL',
          notes: d.notes || '',
          decided_by: user.email,
          decided_at: nowIso
        }, user.email);
      } else {
        Db.insertUnlocked_('leveling', {
          class_id: classId,
          student_id: d.student_id,
          intake: klass.intake || '',
          recommended_level: d.recommended_level || '',
          final_level: d.final_level,
          decision_type: d.decision_type || 'SMALL',
          notes: d.notes || '',
          decided_by: user.email,
          decided_at: nowIso
        }, user.email);
      }
      count++;
    }

    return { savedCount: count };
  });
}

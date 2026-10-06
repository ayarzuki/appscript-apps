/**
 * Reports.gs — Assessment recording, grade tracking, and PDF report generation.
 *
 * Supported Report Placeholders:
 *   {{student_name}}, {{nickname}}, {{class_name}}, {{program}}, {{level}},
 *   {{teacher_name}}, {{term}}, {{attendance_rate}}, {{sessions_present}},
 *   {{sessions_total}}, {{grades_summary}}, {{achievement_notes}},
 *   {{improvement_notes}}, {{center_name}}, {{report_date}}, {{sa_name}}
 */

/**
 * Saves or updates assessment grades for students in a class.
 * @param {string} classId
 * @param {Object[]} items [{student_id, assessment_type, grade}]
 * @return {{savedCount: number}}
 */
function saveAssessments(classId, items) {
  if (!classId || !Array.isArray(items)) throw new Error('Data assessment tidak lengkap.');
  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  const user = requireRole_(['TEACHER', 'LEAD_TEACHER', 'HQ'], klass.center_code);

  // Map assessment type to milestone session number to get planned due date
  const MILESTONE_SESSION_MAP = {
    'MIDTERM_1': 13,
    'FINAL_TERM_1': 24,
    'MIDTERM_2': 37,
    'FINAL_TERM_2': 48
  };

  const sessions = Db.readWhere('sessions', s => s.class_id === classId);
  const sessionDueMap = new Map();
  for (const s of sessions) {
    sessionDueMap.set(Number(s.session_no), toIsoDate_(s.planned_date));
  }

  return withLock_(() => {
    const existing = Db.readWhere('assessments', a => a.class_id === classId);
    let count = 0;

    for (const item of items) {
      if (!item.student_id || !item.assessment_type) continue;
      const sNo = MILESTONE_SESSION_MAP[item.assessment_type] || 24;
      const reportDueDate = sessionDueMap.get(sNo) || klass.end_date || '';

      const match = existing.find(a =>
        a.student_id === item.student_id && a.assessment_type === item.assessment_type
      );

      if (match) {
        Db.update('assessments', 'class_id', classId, {
          grade: item.grade || match.grade || '',
          report_due_date: reportDueDate || match.report_due_date || ''
        }, user.email);
      } else {
        Db.insertUnlocked_('assessments', {
          class_id: classId,
          student_id: item.student_id,
          assessment_type: item.assessment_type,
          grade: item.grade || '',
          report_due_date: reportDueDate,
          report_generated_at: '',
          report_pdf_url: ''
        }, user.email);
      }
      count++;
    }

    return { savedCount: count };
  });
}

/**
 * Lists assessment board rows filtered by center code or class ID.
 * @param {string|Object=} filter Center code, class ID, or filter object
 * @return {Object[]}
 */
function listAssessmentBoard(filter) {
  const user = requireRole_(['HQ', 'CM', 'SA', 'TEACHER', 'LEAD_TEACHER']);
  let centerFilter = '';
  let classFilter = '';

  if (typeof filter === 'object' && filter !== null) {
    centerFilter = filter.centerCode || '';
    classFilter = filter.classId || '';
  } else if (typeof filter === 'string') {
    if (filter.startsWith('C') && filter.includes('-')) {
      classFilter = filter;
    } else {
      centerFilter = filter;
    }
  }

  const allClasses = Db.readAll('classes');
  const classMap = new Map();
  for (const c of allClasses) {
    if (user.centerList && user.centerList.length > 0 && !user.centerList.includes(c.center_code)) {
      continue;
    }
    if (centerFilter && c.center_code !== centerFilter) continue;
    if (classFilter && c.class_id !== classFilter) continue;
    classMap.set(c.class_id, c);
  }

  const allAssessments = Db.readAll('assessments');
  const allStudents = Db.readAll('students');
  const studentMap = new Map(allStudents.map(s => [s.student_id, s]));

  const todayIso = toIsoDate_(new Date());

  const results = [];
  for (const a of allAssessments) {
    if (!classMap.has(a.class_id)) continue;
    const k = classMap.get(a.class_id);
    const s = studentMap.get(a.student_id) || {};

    let status = 'Belum';
    if (a.report_pdf_url) {
      status = 'Selesai';
    } else if (a.grade) {
      if (a.report_due_date && todayIso > toIsoDate_(a.report_due_date)) {
        status = 'Terlambat';
      } else {
        status = 'Tepat waktu';
      }
    }

    results.push({
      class_id: a.class_id,
      class_name: `${k.program || ''}-${k.level || ''} ${k.schedule_day || ''} ${k.schedule_time || ''}`.trim(),
      center_code: k.center_code,
      student_id: a.student_id,
      student_name: s.full_name || '',
      nickname: s.nickname || '',
      assessment_type: a.assessment_type,
      grade: a.grade || '',
      report_due_date: a.report_due_date ? toIsoDate_(a.report_due_date) : '',
      report_generated_at: a.report_generated_at || '',
      report_pdf_url: a.report_pdf_url || '',
      status: status
    });
  }

  return results;
}

/**
 * Builds data dictionary for report template substitution.
 * @param {string} classId
 * @param {string} studentId
 * @param {string} assessmentType
 * @return {Object}
 */
function buildReportData_(classId, studentId, assessmentType) {
  const student = Db.findOne('students', s => s.student_id === studentId) || {};
  const klass = Db.findOne('classes', c => c.class_id === classId) || {};
  const center = Db.findOne('centers', c => c.center_code === klass.center_code) || {};

  const teachers = Db.readCached_('users');
  const teacherUser = teachers.find(u => u.email === klass.main_teacher_email) || {};
  const saUser = teachers.find(u => u.email === klass.sa_email) || {};

  const att = attendanceRate_(classId, studentId);
  const allStudentAssessments = Db.readWhere('assessments', a => a.class_id === classId && a.student_id === studentId);
  const gradesSummary = allStudentAssessments.map(a => `${a.assessment_type}: ${a.grade}`).join(', ') || '-';

  // Latest daily note
  const notes = Db.readWhere('daily_notes', n => n.student_id === studentId);
  let latestNote = null;
  if (notes.length > 0) {
    latestNote = notes[notes.length - 1];
  }

  const className = `${klass.program || ''}-${klass.level || ''} ${klass.schedule_day || ''} ${klass.schedule_time || ''}`.trim();

  return {
    '{{student_name}}': student.full_name || '',
    '{{nickname}}': student.nickname || student.full_name || '',
    '{{class_name}}': className,
    '{{program}}': klass.program || '',
    '{{level}}': klass.level || '',
    '{{teacher_name}}': teacherUser.full_name || klass.main_teacher_email || '',
    '{{term}}': assessmentType,
    '{{attendance_rate}}': att.rate !== null ? `${att.rate}%` : 'N/A',
    '{{sessions_present}}': String(att.present || 0),
    '{{sessions_total}}': String(att.conducted || 0),
    '{{grades_summary}}': gradesSummary,
    '{{achievement_notes}}': (latestNote && latestNote.achievement) ? latestNote.achievement : '-',
    '{{improvement_notes}}': (latestNote && latestNote.area_of_improvement) ? latestNote.area_of_improvement : '-',
    '{{center_name}}': center.center_name || klass.center_code || '',
    '{{report_date}}': toIsoDate_(new Date()),
    '{{sa_name}}': saUser.full_name || klass.sa_email || ''
  };
}

/**
 * Generates PDF report from Google Docs template and saves to Drive.
 * @param {string} classId
 * @param {string} studentId
 * @param {string} assessmentType
 * @return {{url: string, file_name: string}}
 */
function generateReportPdf(classId, studentId, assessmentType) {
  if (!classId || !studentId || !assessmentType) {
    throw new Error('Parameter laporan tidak lengkap.');
  }

  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  const user = requireRole_(['HQ', 'CM', 'SA'], klass.center_code);

  const templateDocId = getProp_(PROP_KEYS.TEMPLATE_DOC_ID);
  if (!templateDocId) {
    throw new Error('Template laporan belum dikonfigurasi. Set TEMPLATE_DOC_ID di Pengaturan.');
  }

  const reportsFolderId = getProp_(PROP_KEYS.REPORTS_FOLDER_ID);
  let targetFolder;
  if (reportsFolderId) {
    try {
      targetFolder = DriveApp.getFolderById(reportsFolderId);
    } catch (e) {
      targetFolder = DriveApp.getRootFolder();
    }
  } else {
    targetFolder = DriveApp.getRootFolder();
  }

  const reportData = buildReportData_(classId, studentId, assessmentType);
  const student = Db.findOne('students', s => s.student_id === studentId) || {};
  const cleanName = (student.nickname || student.full_name || studentId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseDocName = `Report_${cleanName}_${classId}_${assessmentType}`;

  // 1. Copy template
  const templateFile = DriveApp.getFileById(templateDocId);
  const copiedFile = templateFile.makeCopy(baseDocName + '_TMP', targetFolder);
  const doc = DocumentApp.openById(copiedFile.getId());
  const body = doc.getBody();

  // 2. Replace placeholders
  for (const placeholder of REPORT_PLACEHOLDERS) {
    const val = reportData[placeholder] || '';
    body.replaceText(placeholder, val);
  }
  doc.saveAndClose();

  // 3. Export to PDF and cleanup temporary doc
  const pdfBlob = copiedFile.getAs('application/pdf');
  const pdfFileName = `${baseDocName}.pdf`;
  const pdfFile = targetFolder.createFile(pdfBlob).setName(pdfFileName);
  try {
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn('Could not set public sharing on PDF: ' + e.message);
  }
  copiedFile.setTrashed(true);

  const pdfUrl = pdfFile.getUrl();
  const nowIso = toIsoDateTime_(new Date());

  // 4. Update assessment row with PDF URL
  withLock_(() => {
    const existing = Db.findOne('assessments', a =>
      a.class_id === classId && a.student_id === studentId && a.assessment_type === assessmentType
    );
    if (existing) {
      Db.update('assessments', 'class_id', classId, {
        report_generated_at: nowIso,
        report_pdf_url: pdfUrl
      }, user.email);
    } else {
      Db.insertUnlocked_('assessments', {
        class_id: classId,
        student_id: studentId,
        assessment_type: assessmentType,
        grade: '',
        report_due_date: '',
        report_generated_at: nowIso,
        report_pdf_url: pdfUrl
      }, user.email);
    }
  });

  return {
    url: pdfUrl,
    file_name: pdfFileName
  };
}

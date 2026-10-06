/**
 * Config.gs — Central configuration constants and helper functions.
 */

const APP_TITLE = 'Sistem Administrasi Akademik Sparks Math';
const APP_VERSION = '0.1.3';

// Script Properties keys
const PROP_KEYS = {
  DB_SPREADSHEET_ID: 'DB_SPREADSHEET_ID',
  TX_DB_SPREADSHEET_ID_PREFIX: 'TX_DB_SPREADSHEET_ID_',
  MEDIA_ROOT_FOLDER_ID: 'MEDIA_ROOT_FOLDER_ID',
  REPORTS_FOLDER_ID: 'REPORTS_FOLDER_ID',
  TEMPLATE_DOC_ID: 'TEMPLATE_DOC_ID',
  TX_DB_AY: 'TX_DB_AY',
  OLD_SIS_SOURCES: 'OLD_SIS_SOURCES'
};

/**
 * Read script property by key.
 * @param {string} key
 * @return {string|null}
 */
function getProp_(key) {
  try {
    return PropertiesService.getScriptProperties().getProperty(key);
  } catch (err) {
    console.error('getProp_ error for key ' + key + ': ' + err.message);
    return null;
  }
}

/**
 * Set script property.
 * @param {string} key
 * @param {string} val
 */
function setProp_(key, val) {
  PropertiesService.getScriptProperties().setProperty(key, val);
}

// Transaction tables stored in per-academic-year spreadsheet
const TX_TABLES = ['attendance', 'daily_notes'];

// Reference tables cached in CacheService
const REF_TABLES = ['users', 'centers', 'programs_levels', 'holidays'];
const CACHE_TTL_SECONDS = 300;

// Roles allowed in the system
const ROLES = ['HQ', 'CM', 'SA', 'TEACHER', 'LEAD_TEACHER'];

// Navigation screens and mappings per role
const NAV_SCREENS = {
  beranda: 'Beranda',
  murid: 'Murid',
  kelas: 'Kelas',
  sesi: 'Sesi & Absensi',
  penilaian: 'Assessment & Laporan',
  event: 'Event Tracker',
  waiting: 'Waiting List',
  leveling: 'Leveling',
  media: 'Media',
  dashboard: 'Dashboard',
  admin: 'Admin'
};

const NAV_BY_ROLE = {
  HQ: ['beranda', 'murid', 'kelas', 'penilaian', 'event', 'waiting', 'leveling', 'media', 'dashboard', 'admin'],
  CM: ['beranda', 'murid', 'kelas', 'penilaian', 'event', 'leveling', 'dashboard'],
  SA: ['beranda', 'murid', 'kelas', 'penilaian', 'event', 'waiting', 'media'],
  TEACHER: ['beranda', 'sesi', 'penilaian', 'media'],
  LEAD_TEACHER: ['beranda', 'sesi', 'penilaian', 'leveling', 'media', 'dashboard']
};

// Status Enums
const STUDENT_STATUSES = ['Postponed', 'Active', 'Non-Active', 'Cancel (DP Only)'];
const CLASS_STATUSES = ['Draft', 'Active', 'Completed'];
const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Excused'];

const ASSESSMENT_TYPES = ['MIDTERM_1', 'FINAL_TERM_1', 'MIDTERM_2', 'FINAL_TERM_2'];
const GRADES = ['A+', 'A', 'B', 'C', 'D'];
const GRADE_RANK = { 'D': 1, 'C': 2, 'B': 3, 'A': 4, 'A+': 5 };

const EVENT_TYPES = ['PROGRESS_REPORT', 'PTM', 'CLASS_MEDIA', 'TERMLY_REPORT'];
const EVENT_STATUSES = ['Open', 'Done'];

const LEAVE_REASONS = ['Level Up', 'Looping', 'Pindah Kelas', 'Berhenti', 'Postponed'];
const DECISION_TYPES = ['LOOPING', 'SMALL', 'BIG'];
const WAITING_STATUS = ['Waiting', 'Contacted', 'Offered', 'Enrolled', 'Cancelled'];

const MILESTONE_BY_SESSION = {
  10: 'UPLOAD_MEDIA',
  13: 'MIDTERM_1',
  20: 'UPLOAD_MEDIA',
  24: 'FINAL_TERM_1',
  30: 'UPLOAD_MEDIA',
  37: 'MIDTERM_2',
  40: 'UPLOAD_MEDIA',
  48: 'FINAL_TERM_2'
};

// Event creation rules
const EVENT_RULES = {
  CLASS_MEDIA: [10, 20, 30, 40, 48],
  PTM: [13, 24, 37],
  TERMLY_REPORT: [24, 48],
  // Assumption: PROGRESS_REPORT months 1, 2, 4, 5 due date = class start_date + N months.
  PROGRESS_REPORT_MONTHS: [1, 2, 4, 5]
};

// Leveling criteria
const LEVELING = {
  minAttendanceSmall: 70,
  minAttendanceBig: 75,
  joinSessionLooping: 45
};

const ACADEMIC_YEAR_START_MONTH = 7; // July is month index 7 (1-based)

/**
 * Returns academic year string like '2026-2027' for given Date or ISO string.
 * Academic year starts in July (month 7).
 * @param {Date|string} dateOrIso
 * @return {string}
 */
function academicYearLabel_(dateOrIso) {
  const d = dateOrIso ? new Date(dateOrIso) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1..12
  if (month >= ACADEMIC_YEAR_START_MONTH) {
    return year + '-' + (year + 1);
  } else {
    return (year - 1) + '-' + year;
  }
}

// Report template placeholders
const REPORT_PLACEHOLDERS = [
  '{{student_name}}',
  '{{nickname}}',
  '{{class_name}}',
  '{{program}}',
  '{{level}}',
  '{{teacher_name}}',
  '{{term}}',
  '{{attendance_rate}}',
  '{{sessions_present}}',
  '{{sessions_total}}',
  '{{grades_summary}}',
  '{{achievement_notes}}',
  '{{improvement_notes}}',
  '{{center_name}}',
  '{{report_date}}',
  '{{sa_name}}'
];

// Media guidelines: 5 DOs and 5 DON'Ts
// TODO: replace with SIS lama content
const MEDIA_GUIDELINES = `PANDUAN DOKUMENTASI MEDIA KELAS:

DO (Dianjurkan):
1. Ambil foto aktivitas belajar interaktif dan ekspresi murid saat menyelesaikan tantangan.
2. Pastikan pencahayaan cukup dan wajah murid terlihat jelas dan fokus.
3. Sertakan karya, worksheet, atau manipulatif matematika yang sedang digunakan murid.
4. Unggah 2-4 foto terbaik per milestone sesi (sesi 10, 20, 30, 40, 48).
5. Pastikan murid mengenakan pakaian rapi atau seragam bila ada.

DON'T (Dilarang):
1. Jangan mengunggah foto yang buram, gelap, atau terpotong ekstrem.
2. Hindari foto candid yang memperlihatkan murid dalam posisi tidak siap atau cemberut.
3. Jangan mengunggah foto yang memperlihatkan informasi pribadi sensitif di layar.
4. Hindari mengunggah foto murid yang orang tuanya menolak persetujuan publikasi media.
5. Jangan menunda unggahan foto melewati tenggat milestone sesi yang bersangkutan.`;

const CONFIG = {
  APP_TITLE,
  APP_VERSION,
  PROP_KEYS,
  TX_TABLES,
  REF_TABLES,
  CACHE_TTL_SECONDS,
  ROLES,
  NAV_SCREENS,
  NAV_BY_ROLE,
  STUDENT_STATUSES,
  CLASS_STATUSES,
  ATTENDANCE_STATUSES,
  ASSESSMENT_TYPES,
  GRADES,
  GRADE_RANK,
  EVENT_TYPES,
  EVENT_STATUSES,
  LEAVE_REASONS,
  DECISION_TYPES,
  WAITING_STATUS,
  MILESTONE_BY_SESSION,
  EVENT_RULES,
  LEVELING,
  ACADEMIC_YEAR_START_MONTH,
  REPORT_PLACEHOLDERS,
  MEDIA_GUIDELINES
};

/**
 * Api.gs — Client API dispatcher, token session identity, and email-code (OTP) login.
 */

let __identityEmail_ = '';

function getIdentityOverride_() {
  return __identityEmail_;
}

function setIdentityOverride_(v) {
  __identityEmail_ = normalizeEmail_(v || '');
}

const PUBLIC_ROUTES = [
  'getAppBootstrap',
  'requestLoginCode',
  'verifyLoginCode',
  'logout',
  'diagnoseLogin',
  'getAppVersionInfo'
];

const API_ROUTES = {
  getAppBootstrap: typeof getAppBootstrap !== 'undefined' ? getAppBootstrap : null,
  diagnoseLogin: typeof diagnoseLogin !== 'undefined' ? diagnoseLogin : null,
  getAppVersionInfo: typeof getAppVersionInfo !== 'undefined' ? getAppVersionInfo : null,
  getSetupStatus: typeof getSetupStatus !== 'undefined' ? getSetupStatus : null,
  listStudents: typeof listStudents !== 'undefined' ? listStudents : null,
  getStudent: typeof getStudent !== 'undefined' ? getStudent : null,
  createStudent: typeof createStudent !== 'undefined' ? createStudent : null,
  updateStudent: typeof updateStudent !== 'undefined' ? updateStudent : null,
  listClasses: typeof listClasses !== 'undefined' ? listClasses : null,
  getClassDetail: typeof getClassDetail !== 'undefined' ? getClassDetail : null,
  createClass: typeof createClass !== 'undefined' ? createClass : null,
  updateClass: typeof updateClass !== 'undefined' ? updateClass : null,
  listTeachers: typeof listTeachers !== 'undefined' ? listTeachers : null,
  placeStudent: typeof placeStudent !== 'undefined' ? placeStudent : null,
  closeEnrollment: typeof closeEnrollment !== 'undefined' ? closeEnrollment : null,
  getMySessions: typeof getMySessions !== 'undefined' ? getMySessions : null,
  getSessionRoster: typeof getSessionRoster !== 'undefined' ? getSessionRoster : null,
  saveSessionEntries: typeof saveSessionEntries !== 'undefined' ? saveSessionEntries : null,
  listSessionsForClass: typeof listSessionsForClass !== 'undefined' ? listSessionsForClass : null,
  getClassAttendanceSummary: typeof getClassAttendanceSummary !== 'undefined' ? getClassAttendanceSummary : null,
  saveAssessments: typeof saveAssessments !== 'undefined' ? saveAssessments : null,
  listAssessmentBoard: typeof listAssessmentBoard !== 'undefined' ? listAssessmentBoard : null,
  generateReportPdf: typeof generateReportPdf !== 'undefined' ? generateReportPdf : null,
  listEvents: typeof listEvents !== 'undefined' ? listEvents : null,
  updateEventStatus: typeof updateEventStatus !== 'undefined' ? updateEventStatus : null,
  listWaitingList: typeof listWaitingList !== 'undefined' ? listWaitingList : null,
  saveWaitingEntry: typeof saveWaitingEntry !== 'undefined' ? saveWaitingEntry : null,
  setWaitingStatus: typeof setWaitingStatus !== 'undefined' ? setWaitingStatus : null,
  getLevelingBoard: typeof getLevelingBoard !== 'undefined' ? getLevelingBoard : null,
  saveLevelingDecisions: typeof saveLevelingDecisions !== 'undefined' ? saveLevelingDecisions : null,
  getMediaChecklist: typeof getMediaChecklist !== 'undefined' ? getMediaChecklist : null,
  uploadClassMedia: typeof uploadClassMedia !== 'undefined' ? uploadClassMedia : null,
  getMediaGuidelines: typeof getMediaGuidelines !== 'undefined' ? getMediaGuidelines : null,
  getDashboardHome: typeof getDashboardHome !== 'undefined' ? getDashboardHome : null,
  getDashboardStats: typeof getDashboardStats !== 'undefined' ? getDashboardStats : null,
  listUsers: typeof listUsers !== 'undefined' ? listUsers : null,
  saveUser: typeof saveUser !== 'undefined' ? saveUser : null,
  toggleUser: typeof toggleUser !== 'undefined' ? toggleUser : null,
  listCenters: typeof listCenters !== 'undefined' ? listCenters : null,
  saveCenter: typeof saveCenter !== 'undefined' ? saveCenter : null,
  listProgramsLevels: typeof listProgramsLevels !== 'undefined' ? listProgramsLevels : null,
  saveProgramLevel: typeof saveProgramLevel !== 'undefined' ? saveProgramLevel : null,
  listHolidays: typeof listHolidays !== 'undefined' ? listHolidays : null,
  saveHoliday: typeof saveHoliday !== 'undefined' ? saveHoliday : null,
  deleteHoliday: typeof deleteHoliday !== 'undefined' ? deleteHoliday : null,
  getAuditLog: typeof getAuditLog !== 'undefined' ? getAuditLog : null,
  dryRunMigration: typeof dryRunMigration !== 'undefined' ? dryRunMigration : null,
  requestLoginCode: requestLoginCode,
  verifyLoginCode: verifyLoginCode,
  logout: logout
};

/**
 * Main API dispatcher.
 * @param {string} name Function name to call
 * @param {Array} args Arguments array
 * @param {string=} token Session token from localStorage
 * @return {*} Result of the route function
 */
function callApi(name, args, token) {
  const route = API_ROUTES[name];
  if (!route) throw new Error('Fungsi tidak dikenal: ' + name);
  const list = Array.isArray(args) ? args.slice() : [];

  let sessionEmail = '';
  try {
    sessionEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  } catch (e) {
    sessionEmail = '';
  }

  const tokenEmail = resolveToken_(token);
  const identity = tokenEmail || sessionEmail;

  if (!PUBLIC_ROUTES.includes(name) && !identity) {
    throw new Error('Sesi tidak ditemukan. Silakan masuk terlebih dahulu.');
  }

  setIdentityOverride_(tokenEmail || '');
  try {
    if (name === 'getAppBootstrap' && list.length === 0 && token) {
      list.push(token);
    }
    return route.apply(null, list);
  } finally {
    setIdentityOverride_('');
  }
}

/**
 * Issues a session token for the verified email.
 * @param {string} email
 * @return {string} 64-hex-char token
 */
function issueToken_(email) {
  const u1 = Utilities.getUuid().replace(/-/g, '');
  const u2 = Utilities.getUuid().replace(/-/g, '');
  const token = u1 + u2;
  const now = new Date();
  const expiry = new Date(now.getTime() + AUTH_CFG.TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const em = normalizeEmail_(email);
  Db.insert('auth_sessions', {
    token: token,
    email: em,
    created_at: toIsoDateTime_(now),
    expires_at: toIsoDateTime_(expiry),
    last_seen_at: toIsoDateTime_(now)
  }, em);
  Db.invalidate_('auth_sessions');
  return token;
}

/**
 * Resolves email associated with a valid token.
 * @param {string} token
 * @return {string} Email or empty string
 */
function resolveToken_(token) {
  if (!token || typeof token !== 'string' || !token.trim()) return '';
  const tok = token.trim();
  const rows = Db.readCached_('auth_sessions') || [];
  const nowMs = Date.now();
  const match = rows.find(r =>
    r.token === tok &&
    !(r.is_deleted === true || String(r.is_deleted).toLowerCase() === 'true') &&
    new Date(r.expires_at).getTime() >= nowMs
  );
  return match ? normalizeEmail_(match.email) : '';
}

/**
 * Public endpoint to request a 6-digit login code.
 * @param {string} email
 * @return {{ok: boolean, message: string}}
 */
function requestLoginCode(email) {
  return withLock_(() => {
    const em = normalizeEmail_(email);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!em || !emailRegex.test(em)) {
      return { ok: false, message: 'Alamat email tidak valid.' };
    }

    const user = Db.findOne('users', u => normalizeEmail_(u.email) === em && isUserActive_(u));
    if (!user) {
      return { ok: false, message: 'Email ini belum terdaftar di sistem. Hubungi tim HQ untuk didaftarkan.' };
    }

    const allCodes = Db.readAll('auth_codes') || [];
    const userCodes = allCodes.filter(r =>
      normalizeEmail_(r.email) === em &&
      !(r.is_deleted === true || String(r.is_deleted).toLowerCase() === 'true')
    );
    userCodes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const now = new Date();
    const nowMs = now.getTime();

    if (userCodes.length > 0) {
      const lastCreatedMs = new Date(userCodes[0].created_at).getTime();
      const elapsedSec = (nowMs - lastCreatedMs) / 1000;
      if (elapsedSec < AUTH_CFG.CODE_RESEND_SECONDS) {
        const waitSec = Math.ceil(AUTH_CFG.CODE_RESEND_SECONDS - elapsedSec);
        return { ok: false, message: 'Mohon tunggu ' + waitSec + ' detik sebelum minta kode lagi.' };
      }
    }

    const oneHourAgoMs = nowMs - 60 * 60 * 1000;
    const countLastHour = userCodes.filter(r => new Date(r.created_at).getTime() >= oneHourAgoMs).length;
    if (countLastHour >= AUTH_CFG.CODE_MAX_PER_HOUR) {
      return { ok: false, message: 'Terlalu banyak permintaan kode. Coba lagi nanti.' };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(nowMs + AUTH_CFG.CODE_TTL_MINUTES * 60 * 1000);

    Db.insertUnlocked_('auth_codes', {
      email: em,
      code: code,
      expires_at: toIsoDateTime_(expiresAt),
      attempts: 0,
      created_at: toIsoDateTime_(now)
    }, 'system');
    Db.invalidate_('auth_codes');

    MailApp.sendEmail({
      to: em,
      subject: '[SIS Sparks Math] Kode masuk Anda',
      name: APP_TITLE,
      body: 'Halo,\n\nKode masuk SIS Sparks Math Anda adalah: ' + code + '\n\nKode ini berlaku selama ' + AUTH_CFG.CODE_TTL_MINUTES + ' menit. Jika Anda tidak merasa meminta kode ini, silakan abaikan email ini.\n\nTerima kasih,\n' + APP_TITLE
    });

    return { ok: true, message: 'Kode telah dikirim ke ' + em + '. Berlaku ' + AUTH_CFG.CODE_TTL_MINUTES + ' menit.' };
  });
}

/**
 * Public endpoint to verify a 6-digit login code and receive a session token.
 * @param {string} email
 * @param {string} code
 * @return {{ok: boolean, token?: string, email?: string, message: string}}
 */
function verifyLoginCode(email, code) {
  return withLock_(() => {
    const em = normalizeEmail_(email);
    const inputCode = String(code || '').trim();

    const allCodes = Db.readAll('auth_codes') || [];
    const userCodes = allCodes.filter(r =>
      normalizeEmail_(r.email) === em &&
      !(r.is_deleted === true || String(r.is_deleted).toLowerCase() === 'true')
    );
    userCodes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latestCode = userCodes[0];

    const nowMs = Date.now();
    if (!latestCode || new Date(latestCode.expires_at).getTime() < nowMs) {
      return { ok: false, message: 'Kode tidak ditemukan atau kedaluwarsa. Minta kode baru.' };
    }

    const attempts = Number(latestCode.attempts || 0);
    if (attempts >= AUTH_CFG.CODE_MAX_ATTEMPTS) {
      Db.updateWhere('auth_codes', r =>
        r.email === latestCode.email && r.code === latestCode.code && r.created_at === latestCode.created_at,
        { is_deleted: true },
        'system'
      );
      Db.invalidate_('auth_codes');
      return { ok: false, message: 'Kode diblokir karena salah terlalu banyak. Minta kode baru.' };
    }

    if (String(latestCode.code).trim() !== inputCode) {
      const newAttempts = attempts + 1;
      if (newAttempts >= AUTH_CFG.CODE_MAX_ATTEMPTS) {
        Db.updateWhere('auth_codes', r =>
          r.email === latestCode.email && r.code === latestCode.code && r.created_at === latestCode.created_at,
          { attempts: newAttempts, is_deleted: true },
          'system'
        );
        Db.invalidate_('auth_codes');
        return { ok: false, message: 'Kode diblokir karena salah terlalu banyak. Minta kode baru.' };
      }
      Db.updateWhere('auth_codes', r =>
        r.email === latestCode.email && r.code === latestCode.code && r.created_at === latestCode.created_at,
        { attempts: newAttempts },
        'system'
      );
      Db.invalidate_('auth_codes');
      const rem = AUTH_CFG.CODE_MAX_ATTEMPTS - newAttempts;
      return { ok: false, message: 'Kode salah. Sisa percobaan: ' + rem + '.' };
    }

    // Match
    Db.updateWhere('auth_codes', r =>
      r.email === latestCode.email && r.code === latestCode.code && r.created_at === latestCode.created_at,
      { is_deleted: true },
      'system'
    );
    Db.invalidate_('auth_codes');

    const user = Db.findOne('users', u => normalizeEmail_(u.email) === em && isUserActive_(u));
    if (!user) {
      return { ok: false, message: 'Akun Anda belum terdaftar atau tidak aktif.' };
    }

    const token = issueToken_(em);
    return { ok: true, token: token, email: em, message: 'Berhasil masuk.' };
  });
}

/**
 * Public logout endpoint to invalidate a session token.
 * @param {string} token
 * @return {{ok: boolean}}
 */
function logout(token) {
  try {
    if (token && typeof token === 'string' && token.trim()) {
      const tok = token.trim();
      Db.updateWhere('auth_sessions', r =>
        r.token === tok && !(r.is_deleted === true || String(r.is_deleted).toLowerCase() === 'true'),
        { is_deleted: true },
        'system'
      );
      Db.invalidate_('auth_sessions');
    }
  } catch (e) {
    console.error('logout error: ' + e.message);
  }
  return { ok: true };
}

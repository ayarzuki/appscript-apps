/**
 * Auth.gs — Authentication, authorization and application bootstrapping.
 */

function normalizeEmail_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function isUserActive_(u) {
  if (!u) return false;
  const a = u.is_active;
  return a === true || a === 'TRUE' || a === 'true' || a === 1 || a === '1';
}

/**
 * Retrieves the currently logged-in user and verifies active status.
 * Throws user-friendly Indonesian error if not registered or inactive.
 * @return {Object} User object with centerList property
 */
function getCurrentUser_() {
  let email = '';
  try {
    const override = (typeof getIdentityOverride_ === 'function') ? getIdentityOverride_() : '';
    let sessionEmail = '';
    try {
      sessionEmail = Session.getActiveUser().getEmail();
    } catch (e) {
      sessionEmail = '';
    }
    email = normalizeEmail_(override || sessionEmail);
  } catch (e) {
    email = '';
  }
  if (!email) {
    throw new Error('Sesi pengguna tidak valid. Silakan muat ulang halaman.');
  }

  const user = Db.findOne('users', u => normalizeEmail_(u.email) === email && isUserActive_(u));
  if (!user) {
    throw new Error('Akun Anda belum terdaftar di sistem.');
  }

  // Parse accessible centers (comma-separated). Empty or null = all centers (e.g. HQ)
  if (user.center_codes && String(user.center_codes).trim().length > 0) {
    user.centerList = String(user.center_codes)
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);
  } else {
    user.centerList = null; // Access to all centers
  }

  return user;
}

/**
 * Enforces role and center-level access.
 * @param {string[]} roles Array of permitted role names
 * @param {string=} centerCode Optional center code to check access against
 * @return {Object} Verified user object
 */
function requireRole_(roles, centerCode) {
  const user = getCurrentUser_();
  if (!roles.includes(user.role)) {
    throw new Error('Tidak punya akses untuk aksi ini.');
  }

  if (centerCode && user.centerList && user.centerList.length > 0) {
    if (!user.centerList.includes(centerCode)) {
      throw new Error('Tidak punya akses ke cabang ' + centerCode);
    }
  }

  return user;
}

/**
 * Checks if a user has access without throwing.
 * @param {Object} user
 * @param {string[]} roles
 * @param {string=} centerCode
 * @return {boolean}
 */
function canAccess_(user, roles, centerCode) {
  if (!user || !roles.includes(user.role)) return false;
  if (centerCode && user.centerList && user.centerList.length > 0) {
    return user.centerList.includes(centerCode);
  }
  return true;
}

/**
 * Client-callable bootstrap function. NEVER throws an error.
 * Returns user profile, dynamic navigation, and system status.
 * @return {Object}
 */
function getAppBootstrap(token) {
  let email = '';
  let dbReady = false;
  try {
    const dbId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
    dbReady = Boolean(dbId);

    let sessionEmail = '';
    try {
      sessionEmail = String(Session.getActiveUser().getEmail() || '').trim();
    } catch (e) {
      sessionEmail = '';
    }

    let tokenEmail = '';
    if (token && typeof resolveToken_ === 'function') {
      try {
        tokenEmail = resolveToken_(token);
      } catch (e) {
        tokenEmail = '';
      }
    }
    if (!tokenEmail && typeof getIdentityOverride_ === 'function') {
      try {
        tokenEmail = getIdentityOverride_();
      } catch (e) {
        tokenEmail = '';
      }
    }

    email = tokenEmail || normalizeEmail_(sessionEmail);

    if (!dbReady) {
      return {
        state: 'db-not-ready',
        email: email,
        notRegistered: true,
        dbReady: false,
        title: APP_TITLE,
        version: APP_VERSION
      };
    }

    if (email === '') {
      return {
        state: 'login-required',
        email: '',
        notRegistered: true,
        dbReady: true,
        title: APP_TITLE,
        version: APP_VERSION
      };
    }

    const normEmail = normalizeEmail_(email);
    const users = Db.readAll('users') || [];
    const matched = users.filter(u => normalizeEmail_(u.email) === normEmail);

    if (matched.length === 0) {
      return {
        state: 'not-registered',
        email: email,
        notRegistered: true,
        dbReady: true,
        title: APP_TITLE,
        version: APP_VERSION
      };
    }

    const activeUser = matched.find(isUserActive_);
    if (!activeUser) {
      return {
        state: 'inactive',
        email: email,
        notRegistered: true,
        dbReady: true,
        title: APP_TITLE,
        version: APP_VERSION
      };
    }

    let centerList = [];
    if (activeUser.center_codes && String(activeUser.center_codes).trim().length > 0) {
      centerList = String(activeUser.center_codes).split(',').map(c => c.trim()).filter(Boolean);
    }

    const allowedScreenIds = NAV_BY_ROLE[activeUser.role] || ['beranda'];
    const nav = allowedScreenIds.map(screenId => ({
      id: screenId,
      label: NAV_SCREENS[screenId] || screenId
    }));

    let sessionToken = '';
    if (tokenEmail && token) {
      sessionToken = token;
    } else if (typeof issueToken_ === 'function') {
      try {
        sessionToken = issueToken_(normEmail);
      } catch (e) {
        sessionToken = '';
      }
    }

    const payload = {
      state: 'ok',
      email: email,
      notRegistered: false,
      dbReady: true,
      title: APP_TITLE,
      version: APP_VERSION,
      user: {
        email: activeUser.email,
        full_name: activeUser.full_name || activeUser.email,
        role: activeUser.role,
        centers: centerList
      },
      nav: nav,
      roles: ROLES.slice()
    };
    if (sessionToken) {
      payload.token = sessionToken;
    }
    return payload;
  } catch (err) {
    console.error('getAppBootstrap error: ' + err.message);
    return {
      state: 'error',
      email: email,
      notRegistered: true,
      dbReady: dbReady,
      title: APP_TITLE,
      version: APP_VERSION,
      errorMessage: err.message
    };
  }
}

/**
 * Client-callable diagnostic function. Never throws.
 * @return {Object}
 */
function diagnoseLogin() {
  let activeUser = '';
  let effectiveUser = '';
  let dbReady = false;
  let dbIdTail = null;
  let usersCount = 0;
  let matchedEmail = false;
  let matchedActive = false;
  let verdict = '';
  let errorMessage = null;

  try {
    try {
      activeUser = Session.getActiveUser().getEmail() || '';
    } catch (e) {
      activeUser = '';
    }

    try {
      effectiveUser = Session.getEffectiveUser().getEmail() || '';
    } catch (e) {
      effectiveUser = '';
    }

    let dbId = null;
    try {
      dbId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
      dbReady = Boolean(dbId);
      if (dbId) {
        dbIdTail = String(dbId).slice(-6);
      }
    } catch (e) {
      dbReady = false;
      errorMessage = e.message;
    }

    const normEmail = normalizeEmail_(activeUser);

    if (dbReady) {
      try {
        const users = Db.readAll('users') || [];
        usersCount = users.length;
        const matched = users.filter(u => normalizeEmail_(u.email) === normEmail);
        if (normEmail && matched.length > 0) {
          matchedEmail = true;
          if (matched.some(isUserActive_)) {
            matchedActive = true;
          }
        }
      } catch (e) {
        if (!errorMessage) {
          errorMessage = e.message;
        }
      }
    }

    if (!dbReady) {
      verdict = 'Database belum disiapkan (jalankan setupDatabase).';
    } else if (!normEmail) {
      verdict = 'Email tidak terbaca dari sesi Google.';
    } else if (!matchedEmail) {
      verdict = 'Email ' + activeUser + ' belum terdaftar.';
    } else if (!matchedActive) {
      verdict = 'Akun ' + activeUser + ' non-aktif.';
    } else if (errorMessage) {
      verdict = 'Terjadi kesalahan: ' + errorMessage;
    } else {
      verdict = 'Siap digunakan.';
    }
  } catch (err) {
    errorMessage = err.message;
    verdict = 'Terjadi kesalahan: ' + err.message;
  }

  let authMode = 'none';
  const override = (typeof getIdentityOverride_ === 'function') ? getIdentityOverride_() : '';
  if (override) {
    authMode = 'token';
  } else if (activeUser) {
    authMode = 'session';
  }

  return {
    activeUser: activeUser,
    effectiveUser: effectiveUser,
    authMode: authMode,
    dbReady: dbReady,
    dbIdTail: dbIdTail,
    usersCount: usersCount,
    matchedEmail: matchedEmail,
    matchedActive: matchedActive,
    verdict: verdict,
    errorMessage: errorMessage
  };
}

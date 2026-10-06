/**
 * Auth.gs — Authentication, authorization and application bootstrapping.
 */

/**
 * Retrieves the currently logged-in user and verifies active status.
 * Throws user-friendly Indonesian error if not registered or inactive.
 * @return {Object} User object with centerList property
 */
function getCurrentUser_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Sesi pengguna tidak valid. Silakan muat ulang halaman.');
  }

  const user = Db.findOne('users', u => u.email && u.email.toLowerCase() === email.toLowerCase() && (u.is_active === true || u.is_active === 'TRUE'));
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
function getAppBootstrap() {
  try {
    const email = Session.getActiveUser().getEmail();
    const dbSpreadsheetId = getProp_(PROP_KEYS.DB_SPREADSHEET_ID);
    const dbReady = Boolean(dbSpreadsheetId);

    if (!email) {
      return {
        notRegistered: true,
        email: '',
        title: APP_TITLE,
        version: APP_VERSION,
        dbReady: dbReady
      };
    }

    const user = Db.findOne('users', u => u.email && u.email.toLowerCase() === email.toLowerCase() && (u.is_active === true || u.is_active === 'TRUE'));
    if (!user) {
      return {
        notRegistered: true,
        email: email,
        title: APP_TITLE,
        version: APP_VERSION,
        dbReady: dbReady
      };
    }

    let centerList = [];
    if (user.center_codes && String(user.center_codes).trim().length > 0) {
      centerList = String(user.center_codes).split(',').map(c => c.trim()).filter(Boolean);
    }

    const allowedScreenIds = NAV_BY_ROLE[user.role] || ['beranda'];
    const nav = allowedScreenIds.map(screenId => ({
      id: screenId,
      label: NAV_SCREENS[screenId] || screenId
    }));

    return {
      notRegistered: false,
      user: {
        email: user.email,
        full_name: user.full_name || user.email,
        role: user.role,
        centers: centerList
      },
      nav: nav,
      dbReady: dbReady,
      title: APP_TITLE,
      version: APP_VERSION
    };
  } catch (err) {
    console.error('getAppBootstrap error: ' + err.message);
    return {
      notRegistered: true,
      email: '',
      title: APP_TITLE,
      version: APP_VERSION,
      dbReady: false,
      error: err.message
    };
  }
}

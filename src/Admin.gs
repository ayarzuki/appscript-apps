/**
 * Admin.gs — Master data management, user administration, and system audit logs.
 * Restricted strictly to HQ role.
 */

/**
 * Lists all registered system users.
 * @return {Object[]}
 */
function listUsers() {
  requireRole_(['HQ']);
  return Db.readAll('users').map(u => ({
    email: u.email,
    full_name: u.full_name || '',
    role: u.role || 'TEACHER',
    center_codes: u.center_codes || '',
    is_active: u.is_active === true || String(u.is_active).toLowerCase() === 'true'
  }));
}

/**
 * Creates or updates a user profile.
 * @param {Object} form
 * @return {Object}
 */
function saveUser(form) {
  if (!form || !form.email) throw new Error('Email pengguna wajib diisi.');
  const user = requireRole_(['HQ']);
  const email = String(form.email).trim().toLowerCase();

  return withLock_(() => {
    const existing = Db.findOne('users', u => u.email && u.email.toLowerCase() === email);
    let result;

    if (existing) {
      result = Db.update('users', 'email', existing.email, {
        full_name: form.full_name || existing.full_name || '',
        role: form.role || existing.role || 'TEACHER',
        center_codes: form.center_codes !== undefined ? form.center_codes : existing.center_codes,
        is_active: form.is_active !== undefined ? form.is_active : existing.is_active
      }, user.email);
    } else {
      result = Db.insertUnlocked_('users', {
        email: email,
        full_name: form.full_name || email,
        role: form.role || 'TEACHER',
        center_codes: form.center_codes || '',
        is_active: form.is_active !== undefined ? form.is_active : true
      }, user.email);
    }

    Db.invalidate_('users');
    return result;
  });
}

/**
 * Toggles a user active/inactive state.
 * @param {string} email
 * @param {boolean} isActive
 * @return {Object}
 */
function toggleUser(email, isActive) {
  if (!email) throw new Error('Email pengguna wajib diisi.');
  const user = requireRole_(['HQ']);

  const updated = Db.update('users', 'email', email, {
    is_active: Boolean(isActive)
  }, user.email);

  Db.invalidate_('users');
  return updated;
}

/**
 * Lists centers.
 * @return {Object[]}
 */
function listCenters() {
  requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  return Db.readAll('centers').map(c => ({
    center_code: c.center_code,
    center_no: c.center_no || '',
    center_name: c.center_name || '',
    is_active: c.is_active === true || String(c.is_active).toLowerCase() === 'true'
  }));
}

/**
 * Saves (creates or updates) a center record.
 * @param {Object} form
 * @return {Object}
 */
function saveCenter(form) {
  if (!form || !form.center_code) throw new Error('Kode cabang wajib diisi.');
  const user = requireRole_(['HQ']);
  const code = String(form.center_code).trim().toUpperCase();

  return withLock_(() => {
    const existing = Db.findOne('centers', c => c.center_code === code);
    let result;

    if (existing) {
      result = Db.update('centers', 'center_code', code, {
        center_no: form.center_no !== undefined ? form.center_no : existing.center_no,
        center_name: form.center_name || existing.center_name,
        is_active: form.is_active !== undefined ? form.is_active : existing.is_active
      }, user.email);
    } else {
      result = Db.insertUnlocked_('centers', {
        center_code: code,
        center_no: form.center_no || '01',
        center_name: form.center_name || code,
        is_active: form.is_active !== undefined ? form.is_active : true
      }, user.email);
    }

    Db.invalidate_('centers');
    return result;
  });
}

/**
 * Lists programs and level hierarchy.
 * @return {Object[]}
 */
function listProgramsLevels() {
  requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER']);
  return Db.readAll('programs_levels').sort((a, b) => Number(a.level_order || 0) - Number(b.level_order || 0));
}

/**
 * Creates or updates a program level row.
 * @param {Object} form
 * @return {Object}
 */
function saveProgramLevel(form) {
  if (!form || !form.program || !form.level) throw new Error('Program dan level wajib diisi.');
  const user = requireRole_(['HQ']);

  return withLock_(() => {
    const existing = Db.findOne('programs_levels', pl =>
      pl.program === form.program && pl.level === form.level
    );
    let result;

    if (existing) {
      result = Db.updateWhere('programs_levels', pl => pl.program === form.program && pl.level === form.level, {
        level_order: form.level_order !== undefined ? Number(form.level_order) : existing.level_order,
        next_small_level: form.next_small_level || existing.next_small_level,
        next_big_level: form.next_big_level || existing.next_big_level
      }, user.email);
    } else {
      result = Db.insertUnlocked_('programs_levels', {
        program: form.program,
        level: form.level,
        level_order: Number(form.level_order || 1),
        next_small_level: form.next_small_level || '',
        next_big_level: form.next_big_level || ''
      }, user.email);
    }

    Db.invalidate_('programs_levels');
    return result;
  });
}

/**
 * Lists holidays, optionally filtered by center.
 * @param {string=} centerCode
 * @return {Object[]}
 */
function listHolidays(centerCode) {
  requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER']);
  const allHolidays = Db.readAll('holidays');
  return allHolidays.filter(h => {
    if (centerCode && h.center_code && h.center_code !== centerCode) return false;
    return true;
  }).map(h => ({
    date: toIsoDate_(h.date),
    center_code: h.center_code || '',
    description: h.description || ''
  })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Saves a new holiday.
 * @param {Object} form
 * @return {Object}
 */
function saveHoliday(form) {
  if (!form || !form.date || !form.description) throw new Error('Tanggal dan keterangan libur wajib diisi.');
  const user = requireRole_(['HQ']);

  return withLock_(() => {
    const newHoliday = {
      date: toIsoDate_(form.date),
      center_code: form.center_code ? String(form.center_code).trim().toUpperCase() : '',
      description: String(form.description).trim()
    };
    Db.insertUnlocked_('holidays', newHoliday, user.email);
    Db.invalidate_('holidays');
    return newHoliday;
  });
}

/**
 * Deletes a holiday matching date and center.
 * @param {string} date
 * @param {string=} centerCode
 * @return {boolean}
 */
function deleteHoliday(date, centerCode) {
  if (!date) throw new Error('Tanggal libur wajib diisi.');
  const user = requireRole_(['HQ']);
  const dateIso = toIsoDate_(date);
  const targetCenter = centerCode ? String(centerCode).trim().toUpperCase() : '';

  return withLock_(() => {
    const deleted = Db.softDeleteWhere('holidays', h =>
      toIsoDate_(h.date) === dateIso && (h.center_code || '') === targetCenter,
      user.email
    );
    if (!deleted) throw new Error('Data libur tidak ditemukan.');

    Db.invalidate_('holidays');
    return deleted;
  });
}

/**
 * Retrieves the latest 500 audit log entries.
 * @param {Object=} filters
 * @return {Object[]}
 */
function getAuditLog(filters) {
  requireRole_(['HQ']);
  const f = filters || {};
  const allLogs = Db.readAll('audit_log', { includeDeleted: true });

  const filtered = allLogs.filter(log => {
    if (f.tableName && log.table_name !== f.tableName) return false;
    if (f.userEmail && !String(log.user_email || '').toLowerCase().includes(f.userEmail.toLowerCase())) return false;
    return true;
  });

  return filtered.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, 500);
}

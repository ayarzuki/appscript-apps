/**
 * Events.gs — Event tracking for progress reports, PTMs, class media, and termly reports.
 */

/**
 * Lists events with filters, decorated with class_label and overdue flag.
 * @param {Object=} filters {center: string, type: string, status: string, dueBefore: string}
 * @return {Object[]}
 */
function listEvents(filters) {
  const user = requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER', 'TEACHER']);
  const f = filters || {};
  const todayIso = toIsoDate_(new Date());

  const allClasses = Db.readAll('classes');
  const classMap = new Map();
  for (const c of allClasses) {
    if (user.centerList && user.centerList.length > 0 && !user.centerList.includes(c.center_code)) {
      continue;
    }
    if (f.center && c.center_code !== f.center) continue;
    classMap.set(c.class_id, c);
  }

  const allEvents = Db.readAll('events');
  const results = [];

  for (const ev of allEvents) {
    if (!classMap.has(ev.class_id)) continue;
    const k = classMap.get(ev.class_id);

    if (f.type && ev.event_type !== f.type) continue;
    if (f.status && ev.status !== f.status) continue;
    const dueDateIso = ev.due_date ? toIsoDate_(ev.due_date) : '';
    if (f.dueBefore && dueDateIso && dueDateIso > toIsoDate_(f.dueBefore)) continue;

    const isOverdue = (ev.status !== 'Done') && Boolean(dueDateIso && todayIso > dueDateIso);
    const classLabel = `${k.program || ''}-${k.level || ''} (${k.schedule_day || ''} ${k.schedule_time || ''})`;
    const eventId = `${ev.class_id}::${ev.event_type}::${dueDateIso || ev.description || ''}`;

    results.push(Object.assign({}, ev, {
      event_id: eventId,
      class_label: classLabel,
      center_code: k.center_code,
      due_date: dueDateIso,
      done_date: ev.done_date ? toIsoDate_(ev.done_date) : '',
      overdue: isOverdue
    }));
  }

  return results.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
}

/**
 * Updates event status and completion date.
 * Supports composite eventId string ('class_id::event_type::due_date') or filter object.
 * @param {string|Object} eventId
 * @param {string} status 'Open' | 'Done'
 * @param {string=} doneDate
 * @return {Object}
 */
function updateEventStatus(eventId, status, doneDate) {
  let classId = '';
  let eventType = '';
  let dueDateOrDesc = '';

  if (typeof eventId === 'object' && eventId !== null) {
    classId = eventId.class_id;
    eventType = eventId.event_type;
    dueDateOrDesc = eventId.due_date || eventId.description || '';
  } else if (typeof eventId === 'string') {
    const parts = eventId.split('::');
    classId = parts[0] || '';
    eventType = parts[1] || '';
    dueDateOrDesc = parts[2] || '';
  }

  if (!classId || !eventType) {
    throw new Error('ID event tidak valid.');
  }

  const klass = Db.findOne('classes', c => c.class_id === classId);
  const user = requireRole_(['HQ', 'CM', 'SA', 'LEAD_TEACHER'], klass ? klass.center_code : null);

  return withLock_(() => {
    const sheet = Db.sheet_('events');
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1) throw new Error('Data event kosong.');

    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0];
    const classCol = headers.indexOf('class_id');
    const typeCol = headers.indexOf('event_type');
    const dueCol = headers.indexOf('due_date');
    const descCol = headers.indexOf('description');
    const statusCol = headers.indexOf('status');
    const doneCol = headers.indexOf('done_date');
    const updateAtCol = headers.indexOf('updated_at');
    const updateByCol = headers.indexOf('updated_by');

    let targetRow = -1;
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (row[classCol] === classId && row[typeCol] === eventType) {
        const rowDue = toIsoDate_(row[dueCol]);
        const rowDesc = String(row[descCol] || '');
        if (!dueDateOrDesc || rowDue === dueDateOrDesc || rowDesc === dueDateOrDesc) {
          targetRow = r + 1; // 1-based row index
          break;
        }
      }
    }

    if (targetRow === -1) {
      throw new Error('Event tidak ditemukan untuk diperbarui.');
    }

    const effectiveDoneDate = (status === 'Done') ? (doneDate ? toIsoDate_(doneDate) : toIsoDate_(new Date())) : '';
    const nowIso = toIsoDateTime_(new Date());

    if (statusCol !== -1) sheet.getRange(targetRow, statusCol + 1).setValue(status);
    if (doneCol !== -1) sheet.getRange(targetRow, doneCol + 1).setValue(effectiveDoneDate);
    if (updateAtCol !== -1) sheet.getRange(targetRow, updateAtCol + 1).setValue(nowIso);
    if (updateByCol !== -1) sheet.getRange(targetRow, updateByCol + 1).setValue(user.email);

    Db.auditUnlocked_(user.email, 'UPDATE_STATUS', 'events', `${classId}_${eventType}`, null, {
      status: status,
      done_date: effectiveDoneDate
    });

    return {
      ok: true,
      class_id: classId,
      event_type: eventType,
      status: status,
      done_date: effectiveDoneDate
    };
  });
}

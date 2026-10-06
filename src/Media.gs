/**
 * Media.gs — Class media upload, Drive storage management, and milestone checklist.
 */

/**
 * Retrieves the media upload checklist and files for a class.
 * @param {string} classId
 * @return {Object}
 */
function getMediaChecklist(classId) {
  if (!classId) throw new Error('ID kelas wajib diisi.');
  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  requireRole_(['SA', 'TEACHER', 'LEAD_TEACHER', 'CM', 'HQ'], klass.center_code);

  const mediaMilestoneSessions = [10, 20, 30, 40, 48];
  const allMedia = Db.readWhere('media', m => m.class_id === classId);

  const checklists = mediaMilestoneSessions.map(sNo => {
    const milestoneLabel = `SESI_${sNo}`;
    const matchingFiles = allMedia.filter(m =>
      m.milestone === milestoneLabel || m.milestone === String(sNo) || m.milestone === `Sesi ${sNo}`
    );

    const files = matchingFiles.map(m => ({
      drive_file_id: m.drive_file_id,
      name: m.file_name,
      url: m.drive_file_id ? `https://drive.google.com/file/d/${m.drive_file_id}/view` : '#',
      uploaded_by: m.uploaded_by,
      uploaded_at: m.uploaded_at ? toIsoDateTime_(m.uploaded_at) : ''
    }));

    return {
      milestone: milestoneLabel,
      sessionNo: sNo,
      count: files.length,
      required: '2–4',
      files: files
    };
  });

  return {
    class_id: classId,
    class_name: `${klass.program || ''}-${klass.level || ''} ${klass.schedule_day || ''} ${klass.schedule_time || ''}`.trim(),
    checklists: checklists
  };
}

/**
 * Uploads a single media file for a class milestone to Google Drive.
 * @param {string} classId
 * @param {string} milestone
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} base64Data
 * @return {{url: string, file_name: string}}
 */
function uploadClassMedia(classId, milestone, fileName, mimeType, base64Data) {
  if (!classId || !milestone || !fileName || !base64Data) {
    throw new Error('Data unggahan media tidak lengkap.');
  }

  const klass = Db.findOne('classes', c => c.class_id === classId);
  if (!klass) throw new Error('Kelas tidak ditemukan.');

  const user = requireRole_(['SA', 'TEACHER', 'LEAD_TEACHER', 'HQ'], klass.center_code);

  // 1. Resolve or create Drive folder: Media/<classId>
  const rootFolderId = getProp_(PROP_KEYS.MEDIA_ROOT_FOLDER_ID);
  let baseFolder;
  if (rootFolderId) {
    try {
      baseFolder = DriveApp.getFolderById(rootFolderId);
    } catch (e) {
      baseFolder = DriveApp.getRootFolder();
    }
  } else {
    baseFolder = DriveApp.getRootFolder();
  }

  // Find or create 'Media' subfolder
  let mediaSubfolder = null;
  const folders = baseFolder.getFoldersByName('Media');
  if (folders.hasNext()) {
    mediaSubfolder = folders.next();
  } else {
    mediaSubfolder = baseFolder.createFolder('Media');
  }

  // Find or create class subfolder
  let classFolder = null;
  const classFolders = mediaSubfolder.getFoldersByName(classId);
  if (classFolders.hasNext()) {
    classFolder = classFolders.next();
  } else {
    classFolder = mediaSubfolder.createFolder(classId);
  }

  // 2. Decode and save file
  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName);
  const driveFile = classFolder.createFile(blob);
  try {
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn('Could not set link sharing on uploaded media: ' + e.message);
  }

  const nowIso = toIsoDateTime_(new Date());

  // 3. Record in media table
  Db.insert('media', {
    class_id: classId,
    milestone: milestone,
    drive_file_id: driveFile.getId(),
    file_name: fileName,
    uploaded_by: user.email,
    uploaded_at: nowIso
  }, user.email);

  return {
    url: driveFile.getUrl(),
    file_name: fileName
  };
}

/**
 * Returns media guidelines text for UI display.
 * @return {{text: string}}
 */
function getMediaGuidelines() {
  return {
    text: MEDIA_GUIDELINES
  };
}


/**
 * Absen Asrama
 * Google Apps Script + Google Spreadsheet
 *
 * Backend API: deploy sebagai Web app, lalu simpan URL /exec di
 * environment variable APPS_SCRIPT_URL pada project Vercel.
 *
 * Catatan:
 * - Jika project ini dibuat dari Spreadsheet (container-bound),
 *   SPREADSHEET_ID boleh dibiarkan kosong.
 * - Jika project standalone, isi SPREADSHEET_ID dengan ID Spreadsheet.
 */

const CONFIG = {
  APP_NAME: 'Absen Asrama',
  SPREADSHEET_ID: '', // kosongkan jika Apps Script dibuat dari Spreadsheet
  TIMEZONE: Session.getScriptTimeZone() || 'Asia/Jakarta',

  SHEETS: {
    SISWA: 'Siswa',
    GURU: 'Guru',
    KELAS: 'Kelas',
    ABSENSI: 'Absensi',
    USERS: 'Users'
  },

  STATUS_SISWA: ['Aktif', 'Nonaktif'],
  STATUS_GURU: ['Aktif', 'Nonaktif'],
  STATUS_ABSENSI: ['Hadir', 'Izin', 'Sakit', 'Alpa', 'Pulang']
};

const HEADERS = {
  Siswa: ['ID_Siswa', 'NIS', 'Nama', 'ID_Kelas', 'Status'],
  Guru: ['ID_Guru', 'NIP', 'Nama_Guru', 'Jenis_Kelamin', 'No_HP', 'Status'],
  Kelas: ['ID_Kelas', 'Nama_Kelas', 'ID_Guru', 'Wali_Kelas', 'Status'],
  Absensi: ['ID_Absensi', 'Tanggal', 'ID_Kelas', 'ID_Siswa', 'Status', 'Keterangan', 'WaktuInput', 'InputOleh'],
  // Password tidak pernah disimpan dalam bentuk teks biasa.
  Users: ['ID_User', 'Username', 'PasswordHash', 'Salt', 'Nama', 'Role', 'ID_Guru', 'Status', 'NIP', 'Jenis_Kelamin', 'No_HP', 'CatatanAdmin', 'DibuatPada', 'DiprosesPada', 'ID_Kelas_Diminta']
};

const CLASS_GROUPS = {
  Tsanawiyah: ['1.1', '1.2', '1.3', '1.4', '1.5', '2.1', '2.2', '2.3', '2.4', '2.5', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6'],
  Aliyah: ['4.1', '4.2', '4.3', '4.4', '5.1', '5.2', '5.3', '6.1', '6.2', '6.3'],
  'Khusus tingkat 7': ['7.1', '7.2']
};

/* =========================================================
 * WEB APP
 * ========================================================= */

function doGet() {
  return jsonResponse_({ success: true, service: CONFIG.APP_NAME });
}

// API JSON untuk proxy Vercel. Nama metode dibatasi agar fungsi internal
// Apps Script tidak dapat dipanggil dari internet.
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const methods = {
      adminSetupDatabase, adminUpdateUserAccount, bootstrapAdmin,
      getAttendanceForClass, getBootstrapStatus, getDashboardData,
      getMasterData, getMyProfile, getRekap, getSessionInfo,
      getTeacherRegistrationRequests, getUserAccounts, login, logout,
      processTeacherRegistration, registerTeacher, checkTeacherRegistration, getRegistrationClasses, saveAttendance,
      saveGuru, saveKelas, saveSiswa, testDatabase, updateMyProfile
    };
    if (!body || !Object.prototype.hasOwnProperty.call(methods, body.action)) {
      throw new Error('Metode API tidak dikenal.');
    }
    const args = Array.isArray(body.args) ? body.args : [];
    return jsonResponse_({ success: true, data: methods[body.action].apply(null, args) });
  } catch (error) {
    return jsonResponse_({ success: false, error: error && error.message ? error.message : String(error) });
  }
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// Dipanggil setiap halaman dibuka: hanya membuat/melengkapi sheet, tanpa
// auto-resize berulang yang sangat mahal pada spreadsheet besar.
function ensureDatabaseFast_() {
  const ss = getSpreadsheet();
  Object.keys(HEADERS).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, HEADERS[sheetName].length).setValues([HEADERS[sheetName]]);
      formatHeader(sheet, HEADERS[sheetName].length);
    } else {
      ensureHeaders(sheet, HEADERS[sheetName]);
    }
  });
}

/* =========================================================
 * AUTENTIKASI & OTORISASI
 * ========================================================= */

const SESSION_PREFIX = 'absensi-session:';
const SESSION_TTL_SECONDS = 21600; // 6 jam
const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', name: 'Administrator' };

function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function publicUser_(user) {
  return {
    idUser: user.ID_User,
    username: user.Username,
    nama: user.Nama,
    role: user.Role,
    idGuru: user.ID_Guru || ''
  };
}

function getBootstrapStatus() {
  setupDatabase();
  ensureDefaultAdmin_();
  return { needsSetup: false, defaultAccount: DEFAULT_ADMIN.username };
}

// Menjamin akses awal yang sederhana sesuai kebutuhan instalasi ini.
// Ganti password ini sebelum aplikasi dipakai secara publik.
function ensureDefaultAdmin_() {
  const users = getRecords(CONFIG.SHEETS.USERS);
  const existing = users.find(u => String(u.Username || '').toLowerCase() === DEFAULT_ADMIN.username);
  if (existing) {
    // Memperbaiki data admin lama dari versi sebelum autentikasi berbasis hash.
    if (!existing.Salt || !existing.PasswordHash || String(existing.Role) !== 'Admin') {
      const salt = makeSalt_();
      updateObject(CONFIG.SHEETS.USERS, 'ID_User', existing.ID_User, {
        PasswordHash: hashPassword_(DEFAULT_ADMIN.password, salt), Salt: salt,
        Nama: existing.Nama || DEFAULT_ADMIN.name, Role: 'Admin', Status: 'Aktif'
      });
    }
    return;
  }
  const salt = makeSalt_();
  appendObject(CONFIG.SHEETS.USERS, {
    ID_User: nextId('U', CONFIG.SHEETS.USERS, 'ID_User'), Username: DEFAULT_ADMIN.username,
    PasswordHash: hashPassword_(DEFAULT_ADMIN.password, salt), Salt: salt,
    Nama: DEFAULT_ADMIN.name, Role: 'Admin', ID_Guru: '', Status: 'Aktif',
    NIP: '', Jenis_Kelamin: '', No_HP: '', CatatanAdmin: 'Akun bawaan', DibuatPada: new Date(), DiprosesPada: ''
  });
}

function bootstrapAdmin(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupDatabase();
    if (getRecords(CONFIG.SHEETS.USERS).some(u => String(u.Role).toLowerCase() === 'admin')) {
      throw new Error('Akun administrator sudah dibuat. Silakan masuk.');
    }
    const username = String(data && data.username || '').trim().toLowerCase();
    const password = String(data && data.password || '');
    const nama = String(data && data.nama || 'Administrator').trim();
    if (!/^[a-z0-9._-]{4,40}$/.test(username)) throw new Error('Username admin harus 4–40 karakter (huruf, angka, titik, garis bawah, atau strip).');
    if (password.length < 8) throw new Error('Password minimal 8 karakter.');
    const salt = makeSalt_();
    appendObject(CONFIG.SHEETS.USERS, {
      ID_User: nextId('U', CONFIG.SHEETS.USERS, 'ID_User'), Username: username,
      PasswordHash: hashPassword_(password, salt), Salt: salt, Nama: nama,
      Role: 'Admin', ID_Guru: '', Status: 'Aktif', DibuatPada: new Date()
    });
    return { success: true, message: 'Administrator berhasil dibuat. Silakan masuk.' };
  } finally { lock.releaseLock(); }
}

function login(username, password) {
  const identity = String(username || '').trim().toLowerCase();
  const user = getRecords(CONFIG.SHEETS.USERS).find(u =>
    String(u.Username || '').toLowerCase() === identity || String(u.Email || '').toLowerCase() === identity
  );
  if (!user || !user.Salt || user.PasswordHash !== hashPassword_(password, user.Salt)) {
    throw new Error('Username/email atau password tidak tepat.');
  }
  if (String(user.Status) === 'Menunggu') throw new Error('Pendaftaran Anda masih menunggu persetujuan administrator.');
  if (String(user.Status) === 'Ditolak') throw new Error('Pendaftaran Anda ditolak. Data login ini tidak dapat digunakan.');
  if (String(user.Status || 'Aktif') !== 'Aktif') throw new Error('Akun tidak aktif. Hubungi administrator.');
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(publicUser_(user)), SESSION_TTL_SECONDS);
  return { success: true, token: token, user: publicUser_(user), expiresIn: SESSION_TTL_SECONDS };
}

function registerTeacher(data) {
  const name = String(data && data.nama || '').trim();
  const username = String(data && data.username || '').trim().toLowerCase();
  const password = String(data && data.password || '');
  const nip = String(data && data.nip || '').trim();
  const idKelas = String(data && data.idKelas || '').trim();
  if (!name) throw new Error('Nama lengkap wajib diisi.');
  if (!/^[a-z0-9._-]{4,40}$/.test(username)) throw new Error('Username harus 4–40 karakter (huruf, angka, titik, garis bawah, atau strip).');
  if (password.length < 8) throw new Error('Password minimal 8 karakter.');
  if (!idKelas) throw new Error('Pilih kelas yang akan menjadi tanggung jawab Anda.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureDatabaseFast_();
    const requestedClass = getRecords(CONFIG.SHEETS.KELAS).find(k => String(k.ID_Kelas) === idKelas);
    if (!requestedClass || String(requestedClass.Status || 'Aktif') !== 'Aktif') throw new Error('Kelas yang dipilih tidak tersedia. Muat ulang halaman dan pilih kelas aktif.');
    if (String(requestedClass.ID_Guru || '').trim()) throw new Error('Kelas tersebut sudah memiliki wali kelas. Silakan pilih kelas lain.');
    const users = getRecords(CONFIG.SHEETS.USERS);
    if (users.some(u => String(u.Username || '').toLowerCase() === username)) {
      throw new Error('Username ini sudah pernah digunakan dan tidak dapat didaftarkan kembali.');
    }
    if (nip && users.some(u => String(u.NIP || '').trim() === nip)) {
      throw new Error('NIP ini sudah pernah digunakan dan tidak dapat didaftarkan kembali.');
    }
    const salt = makeSalt_();
    appendObject(CONFIG.SHEETS.USERS, {
      ID_User: nextId('U', CONFIG.SHEETS.USERS, 'ID_User'), Username: username,
      PasswordHash: hashPassword_(password, salt), Salt: salt, Nama: name, Role: 'Guru',
      ID_Guru: '', Status: 'Menunggu', NIP: nip,
      Jenis_Kelamin: String(data.jenisKelamin || ''), No_HP: String(data.noHp || '').trim(),
      CatatanAdmin: '', DibuatPada: new Date(), DiprosesPada: '', ID_Kelas_Diminta: idKelas
    });
    return { success: true, message: 'Pendaftaran terkirim. Tunggu persetujuan administrator sebelum masuk.' };
  } finally { lock.releaseLock(); }
}

function getRegistrationClasses() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureDatabaseFast_();
    ensureDefaultClasses_();
  } finally { lock.releaseLock(); }
  return getRecords(CONFIG.SHEETS.KELAS)
    .filter(k => String(k.Status || 'Aktif') === 'Aktif' && !String(k.ID_Guru || '').trim())
    .map(k => ({ ID_Kelas: String(k.ID_Kelas), Nama_Kelas: String(k.Nama_Kelas || ''), Jenjang: classLevel_(k.Nama_Kelas) }))
    .sort((a, b) => a.Nama_Kelas.localeCompare(b.Nama_Kelas, 'id', { numeric: true }));
}

// Status hanya dapat dilihat oleh pemilik akun dengan password yang benar.
function checkTeacherRegistration(username, password) {
  const identity = String(username || '').trim().toLowerCase();
  const user = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.Username || '').toLowerCase() === identity);
  if (!user || String(user.Role) !== 'Guru' || !user.Salt || user.PasswordHash !== hashPassword_(password, user.Salt)) {
    throw new Error('Username atau password tidak sesuai.');
  }
  return { status: String(user.Status || ''), nama: String(user.Nama || '') };
}

function getTeacherRegistrationRequests(token) {
  requireAdmin_(token);
  const classes = getRecords(CONFIG.SHEETS.KELAS);
  const classById = Object.fromEntries(classes.map(k => [String(k.ID_Kelas), k]));
  return getRecords(CONFIG.SHEETS.USERS)
    .filter(u => String(u.Role) === 'Guru' && String(u.Status) === 'Menunggu')
    .map(u => {
      const kelas = classById[String(u.ID_Kelas_Diminta || '')];
      return { ID_User: u.ID_User, Nama: u.Nama, Username: u.Username, NIP: u.NIP || '', Jenis_Kelamin: u.Jenis_Kelamin || '', No_HP: u.No_HP || '', DibuatPada: u.DibuatPada || '', ID_Kelas_Diminta: u.ID_Kelas_Diminta || '', Nama_Kelas_Diminta: kelas ? kelas.Nama_Kelas : '', Jenjang_Diminta: kelas ? classLevel_(kelas.Nama_Kelas) : '' };
    });
}

function processTeacherRegistration(idUser, action, note, token) {
  requireAdmin_(token);
  const choice = String(action || '');
  if (!['approve', 'reject'].includes(choice)) throw new Error('Aksi pendaftaran tidak valid.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.ID_User) === String(idUser));
    if (!user || String(user.Role) !== 'Guru' || String(user.Status) !== 'Menunggu') throw new Error('Permohonan tidak ditemukan atau sudah diproses.');
    if (choice === 'reject') {
      updateObject(CONFIG.SHEETS.USERS, 'ID_User', idUser, { Status: 'Ditolak', CatatanAdmin: String(note || '').trim(), DiprosesPada: new Date() });
      return { success: true, message: 'Pendaftaran ditolak. Kredensial tersebut tidak dapat digunakan.' };
    }
    const duplicateNip = user.NIP && getGuruRecords_().find(g => String(g.NIP || '').trim() === String(user.NIP).trim());
    if (duplicateNip) throw new Error('NIP pendaftar sudah terdaftar pada data guru.');
    const requestedClassId = String(user.ID_Kelas_Diminta || '').trim();
    const requestedClass = requestedClassId && getRecords(CONFIG.SHEETS.KELAS).find(k => String(k.ID_Kelas) === requestedClassId);
    if (requestedClassId && (!requestedClass || String(requestedClass.Status || 'Aktif') !== 'Aktif' || String(requestedClass.ID_Guru || '').trim())) {
      throw new Error('Kelas yang diminta sudah tidak tersedia. Ubah penempatan melalui Data Kelas lalu ajukan kembali persetujuan.');
    }
    const idGuru = nextId('G', CONFIG.SHEETS.GURU, 'ID_Guru');
    appendObject(CONFIG.SHEETS.GURU, {
      ID_Guru: idGuru, NIP: user.NIP || '', Nama_Guru: user.Nama,
      Jenis_Kelamin: user.Jenis_Kelamin || '', No_HP: user.No_HP || '', Status: 'Aktif'
    });
    if (requestedClass) updateObject(CONFIG.SHEETS.KELAS, 'ID_Kelas', requestedClassId, { ID_Guru: idGuru, Wali_Kelas: user.Nama });
    updateObject(CONFIG.SHEETS.USERS, 'ID_User', idUser, {
      ID_Guru: idGuru, Status: 'Aktif', CatatanAdmin: String(note || '').trim(), DiprosesPada: new Date()
    });
    return { success: true, message: requestedClass ? `Pendaftaran disetujui. ${requestedClass.Nama_Kelas} ditetapkan sebagai kelas wali dan absensinya kini dapat diakses guru.` : 'Pendaftaran disetujui. Akun lama ini belum memiliki kelas permintaan; tetapkan kelasnya melalui Data Kelas.', idGuru: idGuru };
  } finally { lock.releaseLock(); }
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove(SESSION_PREFIX + token);
  return { success: true };
}

function getSessionInfo(token) {
  return requireSession_(token, ['Admin', 'Guru']);
}

function getMyProfile(token) {
  const session = requireSession_(token, ['Admin', 'Guru']);
  const user = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.ID_User) === String(session.idUser));
  if (!user) throw new Error('Profil pengguna tidak ditemukan.');
  const guru = user.ID_Guru ? getGuruById(user.ID_Guru) : null;
  return {
    nama: user.Nama || '', username: user.Username || '', role: user.Role || '',
    nip: guru ? guru.NIP || '' : user.NIP || '',
    jenisKelamin: guru ? guru.Jenis_Kelamin || '' : user.Jenis_Kelamin || '',
    noHp: guru ? guru.No_HP || '' : user.No_HP || ''
  };
}

function updateMyProfile(data, token) {
  const session = requireSession_(token, ['Admin', 'Guru']);
  const user = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.ID_User) === String(session.idUser));
  if (!user) throw new Error('Profil pengguna tidak ditemukan.');
  const nama = String(data && data.nama || '').trim();
  const passwordLama = String(data && data.passwordLama || '');
  const passwordBaru = String(data && data.passwordBaru || '');
  if (!nama) throw new Error('Nama wajib diisi.');
  if (passwordBaru) {
    if (!passwordLama || hashPassword_(passwordLama, user.Salt) !== user.PasswordHash) throw new Error('Password lama tidak tepat.');
    if (passwordBaru.length < 8) throw new Error('Password baru minimal 8 karakter.');
  }
  const perubahanUser = { Nama: nama };
  if (passwordBaru) {
    const salt = makeSalt_();
    perubahanUser.Salt = salt;
    perubahanUser.PasswordHash = hashPassword_(passwordBaru, salt);
  }
  if (user.Role === 'Guru') {
    const nip = String(data.nip || '').trim();
    const duplicate = nip && getGuruRecords_().find(g => String(g.NIP || '').trim() === nip && String(g.ID_Guru) !== String(user.ID_Guru));
    if (duplicate) throw new Error('NIP tersebut sudah digunakan guru lain.');
    updateObject(CONFIG.SHEETS.GURU, 'ID_Guru', user.ID_Guru, {
      Nama_Guru: nama, NIP: nip, Jenis_Kelamin: String(data.jenisKelamin || ''), No_HP: String(data.noHp || '').trim()
    });
    Object.assign(perubahanUser, { NIP: nip, Jenis_Kelamin: String(data.jenisKelamin || ''), No_HP: String(data.noHp || '').trim() });
  }
  updateObject(CONFIG.SHEETS.USERS, 'ID_User', user.ID_User, perubahanUser);
  const updatedSession = { ...publicUser_({ ...user, ...perubahanUser }) };
  CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(updatedSession), SESSION_TTL_SECONDS);
  return { success: true, message: passwordBaru ? 'Profil dan password berhasil diperbarui.' : 'Profil berhasil diperbarui.', user: updatedSession };
}

function getUserAccounts(token) {
  requireAdmin_(token);
  const guruMap = {};
  getGuruRecords_().forEach(g => guruMap[String(g.ID_Guru)] = g);
  return getRecords(CONFIG.SHEETS.USERS).map(u => {
    const guru = guruMap[String(u.ID_Guru)] || {};
    return {
      ID_User: u.ID_User, Username: u.Username || '', Nama: u.Nama || '', Role: u.Role || '',
      Status: u.Status || 'Aktif', ID_Guru: u.ID_Guru || '',
      NIP: guru.NIP || u.NIP || '', Jenis_Kelamin: guru.Jenis_Kelamin || u.Jenis_Kelamin || '',
      No_HP: guru.No_HP || u.No_HP || ''
    };
  });
}

function adminUpdateUserAccount(data, token) {
  const admin = requireAdmin_(token);
  const idUser = String(data && data.idUser || '').trim();
  const user = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.ID_User) === idUser);
  if (!user) throw new Error('Akun pengguna tidak ditemukan.');
  const username = String(data.username || '').trim().toLowerCase();
  const nama = String(data.nama || '').trim();
  const status = String(data.status || 'Aktif');
  const passwordBaru = String(data.passwordBaru || '');
  if (!/^[a-z0-9._-]{4,40}$/.test(username)) throw new Error('Username tidak valid.');
  if (!nama) throw new Error('Nama wajib diisi.');
  if (!['Aktif', 'Nonaktif'].includes(status)) throw new Error('Status akun tidak valid.');
  if (String(user.ID_User) === String(admin.idUser) && status !== 'Aktif') throw new Error('Admin yang sedang digunakan tidak boleh dinonaktifkan.');
  const duplicate = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.Username || '').toLowerCase() === username && String(u.ID_User) !== idUser);
  if (duplicate) throw new Error('Username tersebut sudah digunakan.');
  if (passwordBaru && passwordBaru.length < 8) throw new Error('Password baru minimal 8 karakter.');

  const perubahan = { Username: username, Nama: nama, Status: status };
  if (passwordBaru) {
    const salt = makeSalt_();
    perubahan.Salt = salt;
    perubahan.PasswordHash = hashPassword_(passwordBaru, salt);
  }
  if (user.Role === 'Guru' && user.ID_Guru) {
    const nip = String(data.nip || '').trim();
    const duplicateNip = nip && getGuruRecords_().find(g => String(g.NIP || '').trim() === nip && String(g.ID_Guru) !== String(user.ID_Guru));
    if (duplicateNip) throw new Error('NIP tersebut sudah digunakan guru lain.');
    updateObject(CONFIG.SHEETS.GURU, 'ID_Guru', user.ID_Guru, {
      Nama_Guru: nama, NIP: nip, Jenis_Kelamin: String(data.jenisKelamin || ''),
      No_HP: String(data.noHp || '').trim(), Status: status
    });
    Object.assign(perubahan, { NIP: nip, Jenis_Kelamin: String(data.jenisKelamin || ''), No_HP: String(data.noHp || '').trim() });
  }
  updateObject(CONFIG.SHEETS.USERS, 'ID_User', idUser, perubahan);
  const updatedCurrentUser = String(user.ID_User) === String(admin.idUser) ? publicUser_({ ...user, ...perubahan }) : null;
  if (updatedCurrentUser) {
    CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(updatedCurrentUser), SESSION_TTL_SECONDS);
  }
  return { success: true, message: passwordBaru ? 'Akun dan password berhasil diperbarui.' : 'Akun berhasil diperbarui.', user: updatedCurrentUser };
}

function requireSession_(token, allowedRoles) {
  const raw = token && CacheService.getScriptCache().get(SESSION_PREFIX + token);
  if (!raw) throw new Error('Sesi telah berakhir. Silakan masuk kembali.');
  const user = JSON.parse(raw);
  if (allowedRoles && !allowedRoles.includes(user.role)) throw new Error('Anda tidak memiliki akses ke fitur ini.');
  return user;
}

function requireAdmin_(token) { return requireSession_(token, ['Admin']); }

function getTeacherClassIds_(user) {
  if (user.role === 'Admin') return getKelasAktif_().map(k => String(k.ID_Kelas));
  if (!user.idGuru) return [];
  return getKelasAktif_().filter(k => String(k.ID_Guru) === String(user.idGuru)).map(k => String(k.ID_Kelas));
}

function assertClassAccess_(user, idKelas) {
  if (!getTeacherClassIds_(user).includes(String(idKelas))) {
    throw new Error('Anda tidak memiliki akses ke kelas ini.');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* =========================================================
 * DATABASE
 * ========================================================= */

function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim()) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID.trim());
  }

  // Simpan ID saat setup dijalankan dari editor spreadsheet. Web App tidak
  // selalu memiliki spreadsheet aktif, walaupun script-nya bound ke sheet.
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty('BOUND_SPREADSHEET_ID');
  if (savedId) return SpreadsheetApp.openById(savedId);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    properties.setProperty('BOUND_SPREADSHEET_ID', ss.getId());
    return ss;
  }

  if (!ss) {
    throw new Error(
      'Spreadsheet belum terhubung. Buka Apps Script dari spreadsheet database, jalankan setupDatabase() sekali, lalu deploy ulang. Atau isi CONFIG.SPREADSHEET_ID dengan ID spreadsheet.'
    );
  }
}

function getSheet(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  }
  return sheet;
}

function setupDatabase() {
  const ss = getSpreadsheet();

  Object.keys(HEADERS).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, HEADERS[sheetName].length)
        .setValues([HEADERS[sheetName]]);
      formatHeader(sheet, HEADERS[sheetName].length);
      return;
    }

    ensureHeaders(sheet, HEADERS[sheetName]);
    formatHeader(sheet, HEADERS[sheetName].length);
  });

  ensureDefaultClasses_();

  return {
    success: true,
    message: 'Database siap digunakan.',
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    sheets: Object.values(CONFIG.SHEETS)
  };
}

function ensureHeaders(sheet, requiredHeaders) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(v => String(v || '').trim());

  // Jika benar-benar kosong.
  if (current.every(v => !v)) {
    sheet.getRange(1, 1, 1, requiredHeaders.length)
      .setValues([requiredHeaders]);
    return;
  }

  // Tambahkan header yang belum ada tanpa menghapus data lama.
  const missing = requiredHeaders.filter(h => !current.includes(h));
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length)
      .setValues([missing]);
  }
}

function formatHeader(sheet, count) {
  sheet.getRange(1, 1, 1, count)
    .setFontWeight('bold')
    .setBackground('#173B6C')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, count);
}

function getHeaders(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(v => String(v || '').trim());
}

function normalizeCell(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  return value;
}

function getRecords(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();

  if (!values.length) return [];

  const headers = values[0].map(v => String(v || '').trim());

  return values.slice(1)
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        if (header) obj[header] = normalizeCell(row[i]);
      });
      return obj;
    });
}

function findRowById(sheetName, idHeader, idValue) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return -1;

  const headers = values[0].map(v => String(v || '').trim());
  const idIndex = headers.indexOf(idHeader);
  if (idIndex === -1) throw new Error(`Kolom ${idHeader} tidak ditemukan.`);

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]).trim() === String(idValue).trim()) {
      return i + 1;
    }
  }
  return -1;
}

function rowObjectToValues(sheet, obj) {
  const headers = getHeaders(sheet);
  return headers.map(header => obj[header] !== undefined ? obj[header] : '');
}

function appendObject(sheetName, obj) {
  const sheet = getSheet(sheetName);
  sheet.appendRow(rowObjectToValues(sheet, obj));
}

function updateObject(sheetName, idHeader, idValue, obj) {
  const sheet = getSheet(sheetName);
  const rowNumber = findRowById(sheetName, idHeader, idValue);
  if (rowNumber === -1) throw new Error(`${idHeader} "${idValue}" tidak ditemukan.`);

  const headers = getHeaders(sheet);
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const merged = {};

  headers.forEach((header, i) => {
    merged[header] = current[i];
  });

  Object.keys(obj).forEach(key => {
    if (headers.includes(key)) merged[key] = obj[key];
  });

  sheet.getRange(rowNumber, 1, 1, headers.length)
    .setValues([rowObjectToValues(sheet, merged)]);

  return true;
}

function nextId(prefix, sheetName, idHeader) {
  const rows = getRecords(sheetName);
  let max = 0;

  rows.forEach(row => {
    const value = String(row[idHeader] || '');
    const match = value.match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
    if (match) max = Math.max(max, Number(match[1]));
  });

  return prefix + String(max + 1).padStart(3, '0');
}

/* =========================================================
 * MASTER DATA: GURU
 * ========================================================= */

function getGuruRecords_() {
  return getRecords(CONFIG.SHEETS.GURU);
}

function adminSetupDatabase(token) {
  requireAdmin_(token);
  return setupDatabase();
}

function getGuruAktif_() {
  return getGuruRecords_().filter(g => String(g.Status || 'Aktif') === 'Aktif');
}

function getGuru(token) {
  requireAdmin_(token);
  const userByGuru = {};
  getRecords(CONFIG.SHEETS.USERS).forEach(u => { if (u.ID_Guru) userByGuru[String(u.ID_Guru)] = u; });
  return getGuruRecords_().map(g => ({
    ...g,
    Username: userByGuru[String(g.ID_Guru)] ? userByGuru[String(g.ID_Guru)].Username : '',
    HasLogin: !!userByGuru[String(g.ID_Guru)]
  }));
}

function getGuruById(idGuru) {
  return getGuruRecords_().find(g => String(g.ID_Guru) === String(idGuru)) || null;
}

function saveGuru(data, token) {
  requireAdmin_(token);
  if (!data || !String(data.nama || '').trim()) {
    throw new Error('Nama guru wajib diisi.');
  }

  const nama = String(data.nama).trim();
  const nip = String(data.nip || '').trim();
  const requestedUsername = String(data.username || '').trim();
  const requestedPassword = String(data.password || '');
  if (!data.idGuru && !requestedUsername) {
    throw new Error('Username login guru wajib diisi.');
  }
  if (requestedUsername && !/^[a-z0-9._-]{4,40}$/i.test(requestedUsername)) {
    throw new Error('Username guru tidak valid.');
  }
  if (!data.idGuru && requestedPassword.length < 8) {
    throw new Error('Password guru minimal 8 karakter.');
  }

  const all = getGuruRecords_();
  const duplicate = all.find(g =>
    nip &&
    String(g.NIP || '').trim() === nip &&
    String(g.ID_Guru) !== String(data.idGuru || '')
  );

  if (duplicate) throw new Error('NIP tersebut sudah terdaftar.');

  if (data.idGuru) {
    updateObject(CONFIG.SHEETS.GURU, 'ID_Guru', data.idGuru, {
      NIP: nip,
      Nama_Guru: nama,
      Jenis_Kelamin: data.jenisKelamin || '',
      No_HP: String(data.noHp || '').trim(),
      Status: data.status || 'Aktif'
    });
    syncGuruLogin_(data.idGuru, data, nama);
    return { success: true, message: 'Data guru berhasil diperbarui.' };
  }

  const idGuru = nextId('G', CONFIG.SHEETS.GURU, 'ID_Guru');
  appendObject(CONFIG.SHEETS.GURU, {
    ID_Guru: idGuru,
    NIP: nip,
    Nama_Guru: nama,
    Jenis_Kelamin: data.jenisKelamin || '',
    No_HP: String(data.noHp || '').trim(),
    Status: data.status || 'Aktif'
  });

  syncGuruLogin_(idGuru, data, nama, true);

  return { success: true, message: 'Guru berhasil ditambahkan.', idGuru };
}

// Menambahkan daftar kelas standar satu kali per nama, tanpa menghapus data lama.
function ensureDefaultClasses_() {
  const existing = getRecords(CONFIG.SHEETS.KELAS);
  const existingNames = new Set(existing.map(k => String(k.Nama_Kelas || '').trim()));
  Object.keys(CLASS_GROUPS).forEach(level => {
    CLASS_GROUPS[level].forEach(name => {
      if (existingNames.has(name)) return;
      appendObject(CONFIG.SHEETS.KELAS, {
        ID_Kelas: nextId('K', CONFIG.SHEETS.KELAS, 'ID_Kelas'),
        Nama_Kelas: name, ID_Guru: '', Wali_Kelas: '', Status: 'Aktif'
      });
      existingNames.add(name);
    });
  });
}

function classLevel_(name) {
  const value = String(name || '').trim();
  for (const level in CLASS_GROUPS) {
    if (CLASS_GROUPS[level].includes(value)) return level;
  }
  return 'Lainnya';
}

function syncGuruLogin_(idGuru, data, nama, isNew) {
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '');
  const existing = getRecords(CONFIG.SHEETS.USERS).find(u => String(u.ID_Guru) === String(idGuru));
  if (!username && !existing) {
    if (isNew) throw new Error('Username login guru wajib diisi.');
    return;
  }
  if (username && !/^[a-z0-9._-]{4,40}$/.test(username)) throw new Error('Username guru tidak valid.');
  if (!existing && password.length < 8) throw new Error('Password guru minimal 8 karakter.');
  const duplicate = username && getRecords(CONFIG.SHEETS.USERS).find(u =>
    String(u.Username).toLowerCase() === username && String(u.ID_Guru) !== String(idGuru));
  if (duplicate) throw new Error('Username tersebut sudah dipakai.');
  const user = existing || { ID_User: nextId('U', CONFIG.SHEETS.USERS, 'ID_User'), Salt: makeSalt_(), DibuatPada: new Date() };
  user.Username = username || user.Username;
  user.Nama = nama; user.Role = 'Guru'; user.ID_Guru = idGuru; user.Status = data.status || 'Aktif';
  if (password) user.PasswordHash = hashPassword_(password, user.Salt);
  if (existing) updateObject(CONFIG.SHEETS.USERS, 'ID_User', user.ID_User, user);
  else appendObject(CONFIG.SHEETS.USERS, user);
}

/* =========================================================
 * MASTER DATA: KELAS
 * ========================================================= */

function getKelasRecords_() {
  return getRecords(CONFIG.SHEETS.KELAS).map(k => ({
    ...k,
    Jenjang: classLevel_(k.Nama_Kelas)
  }));
}

function getKelasAktif_() {
  return getKelasRecords_().filter(k => String(k.Status || 'Aktif') === 'Aktif');
}

function getKelas(token) {
  const user = requireSession_(token, ['Admin', 'Guru']);
  const allowed = getTeacherClassIds_(user);
  return getKelasRecords_().filter(k => user.role === 'Admin' || allowed.includes(String(k.ID_Kelas)));
}

function getKelasById(idKelas) {
  return getKelasRecords_().find(k => String(k.ID_Kelas) === String(idKelas)) || null;
}

function saveKelas(data, token) {
  requireAdmin_(token);
  if (!data || !String(data.namaKelas || '').trim()) {
    throw new Error('Nama kelas wajib diisi.');
  }

  const namaKelas = String(data.namaKelas).trim();
  const all = getKelasRecords_();
  const presetNames = Object.values(CLASS_GROUPS).flat();
  const currentClass = data.idKelas && all.find(k => String(k.ID_Kelas) === String(data.idKelas));
  if (!presetNames.includes(namaKelas) && (!currentClass || String(currentClass.Nama_Kelas) !== namaKelas)) {
    throw new Error('Pilih salah satu kelas yang tersedia: 1.1 sampai 7.2.');
  }

  const duplicate = all.find(k =>
    String(k.Nama_Kelas || '').trim().toLowerCase() === namaKelas.toLowerCase() &&
    String(k.ID_Kelas) !== String(data.idKelas || '')
  );

  if (duplicate) throw new Error('Nama kelas tersebut sudah terdaftar.');

  const guru = data.idGuru ? getGuruById(data.idGuru) : null;
  const wali = guru ? guru.Nama_Guru : '';

  if (data.idKelas) {
    updateObject(CONFIG.SHEETS.KELAS, 'ID_Kelas', data.idKelas, {
      Nama_Kelas: namaKelas,
      ID_Guru: data.idGuru || '',
      Wali_Kelas: wali,
      Status: data.status || 'Aktif'
    });
    return { success: true, message: 'Data kelas berhasil diperbarui.' };
  }

  const idKelas = nextId('K', CONFIG.SHEETS.KELAS, 'ID_Kelas');
  appendObject(CONFIG.SHEETS.KELAS, {
    ID_Kelas: idKelas,
    Nama_Kelas: namaKelas,
    ID_Guru: data.idGuru || '',
    Wali_Kelas: wali,
    Status: data.status || 'Aktif'
  });

  return { success: true, message: 'Kelas berhasil ditambahkan.', idKelas };
}

/* =========================================================
 * MASTER DATA: SISWA
 * ========================================================= */

function getSiswaRecords_() {
  const siswa = getRecords(CONFIG.SHEETS.SISWA);
  const kelas = getKelasRecords_();
  const classMap = {};
  kelas.forEach(k => classMap[String(k.ID_Kelas)] = k);

  return siswa.map(s => {
    const k = classMap[String(s.ID_Kelas)] || {};
    return {
      ...s,
      Nama_Kelas: k.Nama_Kelas || '',
      Wali_Kelas: k.Wali_Kelas || ''
    };
  });
}

function getSiswaAktif_() {
  return getSiswaRecords_().filter(s => String(s.Status || 'Aktif') === 'Aktif');
}

function getSiswa(token) {
  const user = requireSession_(token, ['Admin', 'Guru']);
  const allowed = getTeacherClassIds_(user);
  return getSiswaRecords_().filter(s => user.role === 'Admin' || allowed.includes(String(s.ID_Kelas)));
}

// Mengurangi tiga panggilan API menjadi satu saat halaman master dibuka.
function getMasterData(token) {
  const user = requireSession_(token, ['Admin', 'Guru']);
  const allowed = getTeacherClassIds_(user);
  const kelas = getKelasRecords_().filter(k => user.role === 'Admin' || allowed.includes(String(k.ID_Kelas)));
  const siswa = getSiswaRecords_().filter(s => user.role === 'Admin' || allowed.includes(String(s.ID_Kelas)));
  if (user.role !== 'Admin') return { siswa: siswa, guru: [], kelas: kelas };
  const userByGuru = {};
  getRecords(CONFIG.SHEETS.USERS).forEach(u => { if (u.ID_Guru) userByGuru[String(u.ID_Guru)] = u; });
  const guru = getGuruRecords_().map(g => ({
    ...g, Username: userByGuru[String(g.ID_Guru)] ? userByGuru[String(g.ID_Guru)].Username : '',
    HasLogin: !!userByGuru[String(g.ID_Guru)]
  }));
  return { siswa: siswa, guru: guru, kelas: kelas };
}

function getSiswaById(idSiswa) {
  return getSiswaRecords_().find(s => String(s.ID_Siswa) === String(idSiswa)) || null;
}

function getSiswaByKelas(idKelas) {
  return getSiswaAktif_()
    .filter(s => String(s.ID_Kelas) === String(idKelas))
    .sort((a, b) => String(a.Nama || '').localeCompare(String(b.Nama || ''), 'id'));
}

function saveSiswa(data, token) {
  requireAdmin_(token);
  if (!data || !String(data.nama || '').trim()) {
    throw new Error('Nama siswa wajib diisi.');
  }
  if (!String(data.nis || '').trim()) {
    throw new Error('NIS wajib diisi.');
  }
  if (!String(data.idKelas || '').trim()) {
    throw new Error('Kelas wajib dipilih.');
  }

  const nis = String(data.nis).trim();
  const all = getRecords(CONFIG.SHEETS.SISWA);

  const duplicate = all.find(s =>
    String(s.NIS || '').trim() === nis &&
    String(s.ID_Siswa) !== String(data.idSiswa || '')
  );

  if (duplicate) throw new Error('NIS tersebut sudah terdaftar.');

  const kelas = getKelasById(data.idKelas);
  if (!kelas) throw new Error('Kelas yang dipilih tidak ditemukan.');

  if (data.idSiswa) {
    updateObject(CONFIG.SHEETS.SISWA, 'ID_Siswa', data.idSiswa, {
      NIS: nis,
      Nama: String(data.nama).trim(),
      ID_Kelas: data.idKelas,
      Status: data.status || 'Aktif'
    });
    return { success: true, message: 'Data siswa berhasil diperbarui.' };
  }

  const idSiswa = nextId('S', CONFIG.SHEETS.SISWA, 'ID_Siswa');
  appendObject(CONFIG.SHEETS.SISWA, {
    ID_Siswa: idSiswa,
    NIS: nis,
    Nama: String(data.nama).trim(),
    ID_Kelas: data.idKelas,
    Status: data.status || 'Aktif'
  });

  return { success: true, message: 'Siswa berhasil ditambahkan.', idSiswa };
}

/* =========================================================
 * ABSENSI
 * ========================================================= */

function todayString() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function validDateString(dateValue) {
  const value = String(dateValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Format tanggal harus YYYY-MM-DD.');
  }
  return value;
}

function getAttendanceByDateClass_(tanggal, idKelas) {
  const date = validDateString(tanggal);
  return getRecords(CONFIG.SHEETS.ABSENSI)
    .filter(a =>
      String(a.Tanggal) === date &&
      String(a.ID_Kelas) === String(idKelas)
    );
}

function saveAttendance(payload, token) {
  if (!payload) throw new Error('Data absensi tidak ditemukan.');

  const tanggal = validDateString(payload.tanggal);
  const idKelas = String(payload.idKelas || '').trim();
  const records = Array.isArray(payload.records) ? payload.records : [];

  if (!idKelas) throw new Error('Kelas wajib dipilih.');
  if (!records.length) throw new Error('Tidak ada data siswa untuk disimpan.');

  const kelas = getKelasById(idKelas);
  if (!kelas) throw new Error('Kelas tidak ditemukan.');
  const user = requireSession_(token, ['Admin', 'Guru']);
  assertClassAccess_(user, idKelas);

  const siswaAktif = getSiswaByKelas(idKelas);
  const allowed = {};
  siswaAktif.forEach(s => allowed[String(s.ID_Siswa)] = true);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet(CONFIG.SHEETS.ABSENSI);
    const existingValues = sheet.getDataRange().getValues();
    const headers = existingValues[0].map(v => String(v || '').trim());

    const col = {};
    headers.forEach((h, i) => col[h] = i);

    const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    let inserted = 0;
    let updated = 0;
    let maxId = 0;
    const existingIndex = {};
    for (let i = 1; i < existingValues.length; i++) {
      const row = existingValues[i];
      const id = String(row[col.ID_Absensi] || '');
      const match = id.match(/^A(\d+)$/i);
      if (match) maxId = Math.max(maxId, Number(match[1]));
      const rowDate = String(row[col.Tanggal] instanceof Date
        ? Utilities.formatDate(row[col.Tanggal], CONFIG.TIMEZONE, 'yyyy-MM-dd') : row[col.Tanggal] || '');
      existingIndex[rowDate + '|' + String(row[col.ID_Siswa] || '')] = i;
    }
    const newRows = [];

    records.forEach(r => {
      const idSiswa = String(r.idSiswa || '').trim();
      const status = String(r.status || '').trim();
      const keterangan = String(r.keterangan || '').trim();

      if (!allowed[idSiswa]) return;
      if (!CONFIG.STATUS_ABSENSI.includes(status)) return;

      const foundIndex = existingIndex[tanggal + '|' + idSiswa];
      if (foundIndex !== undefined) {
        const row = existingValues[foundIndex];
        row[col.Tanggal] = tanggal; row[col.ID_Kelas] = idKelas; row[col.ID_Siswa] = idSiswa;
        row[col.Status] = status; row[col.Keterangan] = keterangan; row[col.WaktuInput] = now; row[col.InputOleh] = user.nama;
        updated++;
      } else {
        const obj = {
          ID_Absensi: 'A' + String(++maxId).padStart(3, '0'),
          Tanggal: tanggal,
          ID_Kelas: idKelas,
          ID_Siswa: idSiswa,
          Status: status,
          Keterangan: keterangan,
          WaktuInput: now,
          InputOleh: user.nama
        };
        newRows.push(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
        inserted++;
      }
    });

    // Satu tulis massal untuk semua pembaruan dan satu append massal untuk data baru.
    if (updated) sheet.getRange(2, 1, existingValues.length - 1, headers.length).setValues(existingValues.slice(1));
    if (newRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);

    return {
      success: true,
      message: `Absensi tersimpan. ${inserted} baru, ${updated} diperbarui.`,
      inserted,
      updated
    };
  } finally {
    lock.releaseLock();
  }
}

function getAttendanceForClass(tanggal, idKelas, token) {
  const user = requireSession_(token, ['Admin', 'Guru']);
  assertClassAccess_(user, idKelas);
  const students = getSiswaByKelas(idKelas);
  const existing = getAttendanceByDateClass_(tanggal, idKelas);

  const map = {};
  existing.forEach(a => {
    map[String(a.ID_Siswa)] = a;
  });

  return students.map(s => {
    const a = map[String(s.ID_Siswa)] || {};
    return {
      ID_Siswa: s.ID_Siswa,
      NIS: s.NIS,
      Nama: s.Nama,
      ID_Kelas: s.ID_Kelas,
      Nama_Kelas: s.Nama_Kelas,
      Status: a.Status || 'Hadir',
      Keterangan: a.Keterangan || ''
    };
  });
}

/* =========================================================
 * REKAP
 * ========================================================= */

function getRekap(tanggalMulai, tanggalSelesai, idKelas, token) {
  const user = requireAdmin_(token);
  const start = validDateString(tanggalMulai);
  const end = validDateString(tanggalSelesai);

  if (start > end) throw new Error('Tanggal mulai tidak boleh lebih besar dari tanggal selesai.');

  const allowed = getTeacherClassIds_(user);
  const siswa = getSiswaRecords_();
  const kelas = getKelasRecords_();
  const kelasMap = {};
  kelas.forEach(k => kelasMap[String(k.ID_Kelas)] = k);

  const filterClass = String(idKelas || '').trim();
  if (user.role === 'Guru' && filterClass) assertClassAccess_(user, filterClass);

  const attendance = getRecords(CONFIG.SHEETS.ABSENSI)
    .filter(a => {
      const d = String(a.Tanggal || '');
      return d >= start && d <= end &&
        (!filterClass || String(a.ID_Kelas) === filterClass) &&
        (user.role === 'Admin' || allowed.includes(String(a.ID_Kelas)));
    });

  const studentMap = {};
  siswa.forEach(s => {
    if (
      String(s.Status || 'Aktif') === 'Aktif' &&
      (!filterClass || String(s.ID_Kelas) === filterClass) &&
      (user.role === 'Admin' || allowed.includes(String(s.ID_Kelas)))
    ) {
      studentMap[String(s.ID_Siswa)] = {
        ID_Siswa: s.ID_Siswa,
        NIS: s.NIS,
        Nama: s.Nama,
        Nama_Kelas: s.Nama_Kelas || '',
        Hadir: 0,
        Izin: 0,
        Sakit: 0,
        Alpa: 0,
        Pulang: 0,
        Total: 0
      };
    }
  });

  attendance.forEach(a => {
    const id = String(a.ID_Siswa);
    if (!studentMap[id]) return;

    const status = String(a.Status || '');
    if (studentMap[id][status] !== undefined) {
      studentMap[id][status]++;
    }
    studentMap[id].Total++;
  });

  const rows = Object.values(studentMap)
    .sort((a, b) => String(a.Nama).localeCompare(String(b.Nama), 'id'));

  const summary = {
    Hadir: attendance.filter(a => a.Status === 'Hadir').length,
    Izin: attendance.filter(a => a.Status === 'Izin').length,
    Sakit: attendance.filter(a => a.Status === 'Sakit').length,
    Alpa: attendance.filter(a => a.Status === 'Alpa').length,
    Pulang: attendance.filter(a => a.Status === 'Pulang').length,
    Total: attendance.length
  };

  const daily = attendance
    .map(a => {
      const s = siswa.find(x => String(x.ID_Siswa) === String(a.ID_Siswa)) || {};
      const k = kelasMap[String(a.ID_Kelas)] || {};
      return {
        Tanggal: a.Tanggal,
        ID_Siswa: a.ID_Siswa,
        Nama_Kelas: k.Nama_Kelas || '',
        NIS: s.NIS || '',
        Nama: s.Nama || '',
        Status: a.Status || '',
        Keterangan: a.Keterangan || ''
      };
    })
    .sort((a, b) => {
      if (a.Tanggal !== b.Tanggal) return a.Tanggal.localeCompare(b.Tanggal);
      return a.Nama.localeCompare(b.Nama, 'id');
    });

  return {
    success: true,
    start,
    end,
    rows,
    daily,
    summary
  };
}

/* =========================================================
 * DASHBOARD
 * ========================================================= */

function getDashboardData(token) {
  const user = requireAdmin_(token);
  const siswa = getSiswaAktif_();
  const guru = getGuruAktif_();
  const kelas = getKelasAktif_();
  const today = todayString();

  const attendanceToday = getRecords(CONFIG.SHEETS.ABSENSI)
    .filter(a => String(a.Tanggal) === today);

  const summary = {
    Hadir: attendanceToday.filter(a => a.Status === 'Hadir').length,
    Izin: attendanceToday.filter(a => a.Status === 'Izin').length,
    Sakit: attendanceToday.filter(a => a.Status === 'Sakit').length,
    Alpa: attendanceToday.filter(a => a.Status === 'Alpa').length,
    Pulang: attendanceToday.filter(a => a.Status === 'Pulang').length,
    Total: attendanceToday.length
  };

  return {
    tanggal: today,
    totalSiswa: siswa.length,
    totalGuru: guru.length,
    totalKelas: kelas.length,
    summary
  };
}

/* =========================================================
 * IMPORT / EXPORT CSV SEDERHANA
 * ========================================================= */

function exportSiswaCsv(token) {
  requireAdmin_(token);
  const rows = getSiswaRecords_();
  const header = ['ID_Siswa', 'NIS', 'Nama', 'ID_Kelas', 'Nama_Kelas', 'Status'];
  const data = [header].concat(rows.map(r => header.map(h => r[h] || '')));
  return makeCsv(data);
}

function exportGuruCsv(token) {
  requireAdmin_(token);
  const rows = getGuruRecords_();
  const header = ['ID_Guru', 'NIP', 'Nama_Guru', 'Jenis_Kelamin', 'No_HP', 'Status'];
  const data = [header].concat(rows.map(r => header.map(h => r[h] || '')));
  return makeCsv(data);
}

function exportKelasCsv(token) {
  requireAdmin_(token);
  const rows = getKelasRecords_();
  const header = ['ID_Kelas', 'Nama_Kelas', 'ID_Guru', 'Wali_Kelas', 'Status'];
  const data = [header].concat(rows.map(r => header.map(h => r[h] || '')));
  return makeCsv(data);
}

function makeCsv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(',')).join('\n');
}

/* =========================================================
 * UTILITAS
 * ========================================================= */

function testDatabase(token) {
  requireAdmin_(token);
  setupDatabase();
  return {
    success: true,
    spreadsheet: getSpreadsheet().getName(),
    sheets: Object.values(CONFIG.SHEETS),
    today: todayString(),
    siswa: getSiswaRecords_().length,
    guru: getGuruRecords_().length,
    kelas: getKelasRecords_().length,
    absensi: getRecords(CONFIG.SHEETS.ABSENSI).length
  };
}

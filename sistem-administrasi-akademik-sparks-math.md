# Sistem Administrasi Akademik Sparks Math — Proyek Baru

> Rancangan sistem administrasi akademik Sparks Math dengan **Google Apps Script** sebagai UI (web app) dan **Google Sheets** sebagai database.
>
> Status: draft rancangan · Dibuat: 2026-10-06

---

## 0. Prinsip utama: proyek baru, SIS lama tidak disentuh

Sistem ini adalah **proyek terpisah** dari SIS Sparks Math yang sedang berjalan (folder Drive *"SIS Sparks Math [Active Centers]"*, 20 sheet `Student Information System SM <Cabang>`, Class Data per kelas, dan AD Leveling Tracker).

Aturan yang wajib dipegang selama pengembangan dan sesudahnya:

| Aturan | Artinya |
|---|---|
| **SIS lama = read-only** | Proyek baru **tidak boleh** menulis, mengedit, menghapus, memindahkan, atau mengganti nama file/tab/sel apa pun di SIS lama. |
| **Tidak mengubah akses** | Tidak menambah/menghapus sharing di folder atau sheet SIS lama. |
| **Tidak ada formula silang ke SIS lama** | Tidak memasang `IMPORTRANGE`, trigger, add-on, atau script yang terikat (*bound*) ke file SIS lama. |
| **Semua aset baru di lokasi baru** | Spreadsheet database, project Apps Script, folder Drive, dan template laporan dibuat baru, di folder terpisah. |
| **Migrasi = salin, bukan pindah** | Data lama hanya **dibaca** lalu **disalin** ke database baru. Sumbernya tetap utuh. |
| **Akses baca pakai akun terpisah** | Pembacaan SIS lama untuk migrasi dilakukan oleh satu akun/service account dengan izin **Viewer** saja, supaya secara teknis tidak mungkin menulis. |

Selama masa transisi, SIS lama tetap menjadi sistem resmi sampai cabang dinyatakan pindah (lihat §10).

---

## 1. Latar belakang

SIS Sparks Math saat ini berjalan di Google Sheets, satu sheet per cabang (20 cabang). Fungsinya: buku induk murid, data kelas, absensi, laporan perkembangan, dan penentuan naik level.

Hal-hal yang ingin diperbaiki lewat proyek baru:

| Kondisi sekarang | Dampak |
|---|---|
| 20 sheet SIS terpisah, ditambah 1 sheet Class Data per kelas yang dibuat dengan *copy template* | Data tersebar di ratusan file, sulit direkap lintas cabang |
| Antar-sheet tersambung `IMPORTRANGE` + langkah manual "Allow Access" | Mudah putus (`#REF!`), bergantung langkah manual SA |
| Input langsung di sel sheet | Tidak ada validasi kuat; salah ketik nama/tanggal/status mudah terjadi |
| Akses diatur lewat share folder | Siapa pun yang punya akses Editor bisa mengubah semua data, termasuk formula |
| Status & hitungan (attendance rate, retensi, tenggat report) dihitung formula besar | Sheet berat dan lambat |

**Tujuan proyek baru:** satu aplikasi web untuk semua cabang, data terpusat dan terstruktur, input tervalidasi lewat form, akses sesuai peran, tanpa mengganggu SIS lama.

---

## 2. Ruang lingkup fungsi

Fungsi diturunkan dari SIS lama (tab *Guide*, *Student Database*, *Class Database*, *Attendance Rate*, *Student Report Tracker*, *Event Tracker*, *Waiting list*, Class Data/CMCU, AD Leveling Tracker, Class Media).

| Modul | Menggantikan (di SIS lama) | Isi |
|---|---|---|
| **Murid** | Student Database | Data murid, status, paket, credit, pembayaran, retensi |
| **Kelas** | Class Database | Data kelas, jadwal, ruang, teacher, SA, intake, status kelas |
| **Penempatan (Enrollment)** | Kolom *Current/Previous Class ID* | Riwayat murid masuk/keluar kelas |
| **Absensi** | Class Data → Attendance | Absensi per sesi (1–48) per murid |
| **Catatan Harian (CMCU)** | Class Data → tab CMCU per murid | Komentar & nilai harian per sesi |
| **Assessment & Laporan** | Student Report Tracker, Progress Report Generator | Nilai midterm/final term, status & tenggat laporan, generate PDF |
| **Event & Tenggat** | Event Tracker | Tenggat progress report, PTM, upload media |
| **Waiting List** | Waiting list | Permintaan jadwal/kelas |
| **Leveling (Achievement Day)** | AD Leveling Tracker | Rekomendasi & keputusan level baru |
| **Class Media** | Folder foto per kelas | Upload & checklist foto per milestone |
| **Dashboard** | AR Analysis, Quick Search | Rekap kehadiran, kepatuhan input, status murid/kelas |

### Definisi status (dipertahankan dari SIS lama)

**Status kelas**

| Status | Arti |
|---|---|
| `Draft` | Kelas sudah memiliki murid tapi belum mulai berjalan |
| `Active` | Kelas sedang berjalan |
| `Completed` | Kelas sudah selesai (sudah graduation) |

**Status murid**

| Status | Arti |
|---|---|
| `Postponed` | Sudah bayar (DP/FP) tapi belum masuk kelas, kelasnya belum aktif, atau sedang berhenti sementara |
| `Active` | Terdaftar di kelas yang sedang berjalan |
| `Non-Active` | Kelasnya sudah berakhir dan tidak punya credit untuk lanjut |
| `Cancel (DP Only)` | Sudah bayar DP tapi batal ikut kelas (DP hangus) |

---

## 3. Arsitektur

```
 Pengguna (CM / SA / Teacher / Lead Teacher / HQ)
        │  browser, login akun Google @seven-retail.com
        ▼
 ┌──────────────────────────────────────────────┐
 │  Apps Script Web App (HtmlService)           │
 │  - doGet() menyajikan UI (HTML/CSS/JS)       │
 │  - google.script.run → fungsi server         │
 │  - Otorisasi per peran & per cabang          │
 │  - LockService untuk penulisan               │
 └──────────────────────────────────────────────┘
        │ SpreadsheetApp / DriveApp / DocumentApp
        ▼
 ┌──────────────────────────┐   ┌──────────────────────────┐
 │ DB Spreadsheet (BARU)    │   │ Drive folder (BARU)      │
 │ master + transaksi       │   │ media kelas, PDF laporan │
 └──────────────────────────┘   └──────────────────────────┘
        ▲ baca saja (migrasi, sekali jalan per cabang)
        │
 ┌──────────────────────────┐
 │ SIS Sparks Math LAMA     │   ← tidak pernah ditulis
 └──────────────────────────┘
```

### Pilihan teknis

| Topik | Pilihan | Alasan |
|---|---|---|
| UI | Apps Script **Web App** (`HtmlService`, `doGet`) | Tidak perlu server, login otomatis pakai akun Google kantor |
| Komunikasi UI ↔ server | `google.script.run.withSuccessHandler(...)` | Pola standar Apps Script, asinkron |
| Deploy | *Execute as:* **Me** (akun pemilik sistem) · *Who has access:* **Anyone within seven-retail.com** | Pengguna tidak perlu akses langsung ke spreadsheet DB, sehingga data hanya bisa diubah lewat aplikasi |
| Identitas pengguna | `Session.getActiveUser().getEmail()` dicocokkan dengan tabel `users` | Otorisasi dilakukan di server, bukan di UI |
| Konkurensi | `LockService.getScriptLock()` saat menulis & membuat ID | Mencegah dua SA membuat ID murid yang sama atau saling menimpa |
| Cache baca | `CacheService` untuk data referensi (kelas, user, holiday) | Mengurangi pembacaan sheet berulang |
| Laporan PDF | Template Google Docs → `makeCopy` → `replaceText` → `getAs('application/pdf')` | Menggantikan Progress Report Generator / AutoCrat |
| Versi kode | **clasp** + git (folder ini, `appscript-zuki/sis-sparks-math/`) | Kode tidak hanya hidup di editor online |

### Satu database pusat, bukan 20 file

Semua cabang memakai **satu spreadsheet database** dengan kolom `center_code` di setiap tabel. Pemisahan data per cabang dilakukan oleh aplikasi (filter berdasarkan cabang pengguna), bukan oleh file terpisah.

Keuntungan: rekap lintas cabang mudah, skema seragam, dan cukup satu DAG jika nanti datanya dimasukkan ke BigQuery (§9).

Pengecualian: tabel yang tumbuh paling cepat (absensi & catatan harian) disimpan di **spreadsheet terpisah per tahun ajaran** supaya tidak mendekati batas sel (§11).

---

## 4. Model data

Setiap tabel = satu tab di spreadsheet DB. **Baris 1 = nama kolom** (snake_case), data mulai baris 2. Tidak ada formula di tab data; semua hitungan dilakukan oleh script.

Kolom standar di setiap tabel: `created_at`, `created_by`, `updated_at`, `updated_by`, `is_deleted` (soft delete; baris tidak pernah dihapus fisik).

### 4.1 Tabel master

**`centers`**

| Kolom | Contoh | Catatan |
|---|---|---|
| `center_code` | `BTR` | PK |
| `center_no` | `01` | Urutan cabang, dipakai di Class ID (asumsi, lihat §12) |
| `center_name` | `Bintaro` | |
| `is_active` | `TRUE` | |

**`users`**

| Kolom | Contoh | Catatan |
|---|---|---|
| `email` | `nama@seven-retail.com` | PK |
| `full_name` | | |
| `role` | `SA` | `HQ`, `CM`, `SA`, `TEACHER`, `LEAD_TEACHER` |
| `center_codes` | `BTR,KGD` | Cabang yang boleh diakses; kosong = semua (khusus `HQ`) |
| `is_active` | `TRUE` | |

**`programs_levels`**

| Kolom | Contoh | Catatan |
|---|---|---|
| `program` | `LE` | Program yang terlihat di SIS lama: `LE`, `CT`, `BS` |
| `level` | `1A` | |
| `level_order` | `1` | Urutan untuk aturan naik level (mis. LE-3 → CT-1) |
| `next_small_level` | `1B` | Naik level kecil |
| `next_big_level` | `2A` | Naik level besar |

**`holidays`** — `date`, `center_code` (kosong = semua cabang), `description`. Menggantikan *Reference Holiday*.

### 4.2 Murid & kelas

**`students`**

| Kolom | Contoh | Catatan |
|---|---|---|
| `student_id` | `BTR0001` | PK, format lama dipertahankan: kode cabang + 4 digit |
| `center_code` | `BTR` | FK → `centers` |
| `full_name`, `nickname` | | |
| `dob` | `2017-02-02` | Umur dihitung, tidak disimpan |
| `parent_name`, `parent_phone` | | |
| `language` | `Indonesian` | *WS Language* |
| `school` | | |
| `status` | `Active` | Status murid (§2) |
| `intake` | `Intake 1 Aug 2025` | |
| `actual_join_date` | `2025-08-04` | |
| `package` | `Math - 12 mo` | |
| `credit_class` | `48` | Sisa credit sesi |
| `payment_status` | `Full` | |
| `retention_status` | `Paid Retention - FP` | |
| `last_membership_date` | | |

**`classes`**

| Kolom | Contoh | Catatan |
|---|---|---|
| `class_id` | `C01-25089` | PK, format lama dipertahankan |
| `center_code` | `BTR` | |
| `program`, `level` | `LE`, `2A` | FK → `programs_levels` |
| `schedule_day`, `schedule_time` | `TTh`, `15:00` | |
| `room` | `L3-Monkey D` | |
| `main_teacher_email` | | FK → `users` |
| `sa_email` | | FK → `users` |
| `intake` | `Intake 4 Mar 2026` | |
| `start_date`, `end_date` | | |
| `previous_class_id` | | Kelas asal (untuk kelas lanjutan) |
| `total_sessions` | `48` | |
| `status` | `Active` | Status kelas (§2) |

`class_name` (mis. `LE-2A TTh 15:00`) dibentuk otomatis dari program, level, hari, dan jam.

**`enrollments`** — riwayat penempatan, menggantikan kolom *Current/Previous Class ID* dan *1st–4th Class*

| Kolom | Contoh | Catatan |
|---|---|---|
| `enrollment_id` | `ENR-000123` | PK |
| `student_id` | `BTR0001` | |
| `class_id` | `C01-25183` | |
| `join_date` | | |
| `leave_date` | | Kosong = masih di kelas ini |
| `leave_reason` | `Level Up` | `Level Up`, `Looping`, `Pindah Kelas`, `Berhenti`, `Postponed` |

"Kelas saat ini" murid = enrollment dengan `leave_date` kosong.

### 4.3 Transaksi kelas

**`sessions`** — dibuat otomatis saat kelas dibuat, 1 baris per pertemuan

| Kolom | Contoh | Catatan |
|---|---|---|
| `session_id` | `C01-25089-S13` | PK = class_id + nomor sesi |
| `class_id` | | |
| `session_no` | `13` | 1–48 |
| `planned_date` | | Dari jadwal, melewati `holidays` |
| `actual_date` | | Diisi saat sesi berjalan |
| `teacher_email` | | Bisa beda dari main teacher (pengganti) |
| `lesson_plan_url` | | |
| `milestone` | `MIDTERM_1` | Lihat tabel milestone di bawah |

**`attendance`** *(spreadsheet terpisah per tahun ajaran)*

| Kolom | Contoh |
|---|---|
| `session_id` | `C01-25089-S13` |
| `student_id` | `BTR0001` |
| `status` | `Present` / `Absent` / `Excused` |
| `recorded_by` | email teacher |

**`daily_notes`** (pengganti CMCU) *(spreadsheet terpisah per tahun ajaran)*

| Kolom | Contoh |
|---|---|
| `session_id`, `student_id` | |
| `score` | nilai performa harian |
| `achievement` | komentar capaian |
| `area_of_improvement` | komentar hal yang perlu ditingkatkan |
| `recorded_by` | email teacher |

**`assessments`**

| Kolom | Contoh | Catatan |
|---|---|---|
| `class_id`, `student_id` | | |
| `assessment_type` | `FINAL_TERM_1` | `MIDTERM_1`, `FINAL_TERM_1`, `MIDTERM_2`, `FINAL_TERM_2` |
| `grade` | `B` | `A+`, `A`, `B`, `C`, `D` |
| `report_due_date`, `report_generated_at`, `report_pdf_url` | | |

**Milestone sesi** (dari SIS lama, dijadikan konfigurasi):

| Sesi | Milestone |
|---|---|
| 10 | Upload media |
| 13 | Midterm 1 |
| 20 | Upload media |
| 24 | Final Term 1 + PTM + Termly Report 1 |
| 30 | Upload media |
| 37 | Midterm 2 |
| 40 | Upload media |
| 48 | Final Term 2 + Termly Report 2 + Graduation |

Progress report bulanan (M1, M2, M4, M5) juga dijadwalkan sebagai event.

### 4.4 Tabel pendukung

- **`events`** — `class_id`, `event_type` (`PROGRESS_REPORT`, `PTM`, `CLASS_MEDIA`, `TERMLY_REPORT`), `due_date`, `done_date`, `status`. Dibuat otomatis dari milestone; menggantikan *Event Tracker*.
- **`waiting_list`** — `input_date`, `source`, `student_id`/nama calon, `program`, `level`, `day`, `time` (request 1 & 2), `status`.
- **`leveling`** — `class_id`, `student_id`, `intake`, `recommended_level` (otomatis), `final_level` (diputuskan), `decision_type` (`LOOPING` / `SMALL` / `BIG`), `notes`, `decided_by`, `decided_at`.
- **`media`** — `class_id`, `milestone`, `drive_file_id`, `uploaded_by`, `uploaded_at`.
- **`audit_log`** — `timestamp`, `user_email`, `action`, `table`, `record_id`, `before_json`, `after_json`. Setiap perubahan data tercatat.

### 4.5 Nilai turunan (dihitung, tidak disimpan)

| Nilai | Rumus |
|---|---|
| Umur | dari `dob` |
| Attendance rate | hadir ÷ sesi yang sudah berjalan, per murid per kelas |
| Absen sesi terakhir | dari `attendance` sesi terakhir |
| Kepatuhan input | sesi yang sudah lewat tanpa absensi/catatan |
| Status laporan | `Belum`, `Tepat waktu`, `Terlambat` dibanding `report_due_date` |

Untuk dashboard yang berat, hasil hitungan disimpan ke tab `snapshot_*` oleh **time-driven trigger** tiap malam.

---

## 5. Peran & hak akses

| Fitur | HQ | Center Manager | Student Advisor | Teacher | Lead Teacher |
|---|---|---|---|---|---|
| Lihat data | Semua cabang | Cabangnya | Cabangnya | Kelas yang diajar | Cabangnya |
| Tambah/ubah murid | ✔ | ✔ | ✔ | — | — |
| Buat/ubah kelas, penempatan | ✔ | ✔ | ✔ | — | — |
| Absensi & catatan harian | — | lihat | lihat | ✔ (kelasnya) | ✔ |
| Nilai assessment | — | lihat | lihat | ✔ (kelasnya) | ✔ |
| Generate laporan PDF | ✔ | ✔ | ✔ | — | — |
| Keputusan leveling | — | lihat | lihat | usul | ✔ |
| Upload media | — | — | ✔ | ✔ | ✔ |
| Kelola user & master data | ✔ | — | — | — | — |

Tanggung jawab per peran mengikuti tab *Guide* SIS lama: CM memastikan kepatuhan input, SA mengurus data murid & kelas serta laporan ke orang tua, Teacher mengisi absensi/komentar/nilai harian, Lead Teacher memantau kualitas dan kepatuhan.

**Keamanan:**
- Spreadsheet DB **tidak di-share** ke pengguna aplikasi. Mereka hanya bisa mengubah data lewat web app, yang selalu mengecek peran & cabang di server.
- Setiap fungsi server diawali `requireRole_(...)` (§8).
- Data pribadi murid (nama, tanggal lahir, kontak orang tua) hanya tampil untuk peran yang membutuhkannya.

---

## 6. Alur kerja utama

### 6.1 Murid baru
1. SA membuka **Murid → Tambah**, mengisi form (validasi: nama wajib, tanggal lahir valid, paket dari daftar).
2. Server mengambil lock, membuat `student_id` berikutnya untuk cabang itu (mis. `BTR0412`), menyimpan, mencatat `audit_log`.
3. Status awal `Postponed` sampai murid ditempatkan di kelas aktif.

### 6.2 Kelas baru (menggantikan *copy template Class Data + Allow Access*)
1. SA membuka **Kelas → Tambah**: program, level, hari, jam, ruang, teacher, intake, tanggal mulai.
2. Server membuat `class_id`, lalu otomatis membuat **48 baris `sessions`** (tanggal dihitung dari jadwal, melewati `holidays`) dan semua **`events`** dari tabel milestone.
3. Tidak ada file yang perlu dicopy dan tidak ada langkah "Allow Access".

### 6.3 Penempatan murid
SA memilih murid → kelas. Server menutup enrollment lama (`leave_date`) dan membuka yang baru. Status murid mengikuti status kelas.

### 6.4 Absensi & catatan harian (Teacher)
1. Teacher membuka **Kelas Saya → Sesi hari ini**.
2. Satu layar berisi daftar murid dengan pilihan hadir/absen, nilai harian, dan dua kolom komentar.
3. Simpan sekali untuk semua murid (satu kali tulis batch ke sheet).

### 6.5 Laporan perkembangan
1. Dashboard **Event** menampilkan laporan yang mendekati/lewat tenggat.
2. Teacher mengisi nilai assessment; SA menekan **Generate**.
3. Server mengisi template Google Docs dengan data murid (absensi, nilai, komentar), menyimpan PDF ke folder baru, dan mencatat link di `assessments`.

### 6.6 Achievement Day / leveling
Sistem membuat **rekomendasi otomatis** sesuai aturan di *AD Leveling Tracker*:

| Rekomendasi | Syarat (dari guideline) |
|---|---|
| `LOOPING` | Nilai akhir term `D`, atau join di sesi 45–48, atau kehadiran rendah |
| `SMALL` (mis. LE 1A → LE 1B) | Nilai akhir minimal `C` dan kehadiran ≥ 70% |
| `BIG` (mis. LE 1A → LE 2A) | Nilai akhir minimal `A` dan kehadiran ≥ 75% |

Lead Teacher meninjau, mengubah bila perlu (berdasarkan diskusi dengan teacher), lalu menyimpan `final_level`. Keputusan tetap di tangan manusia; sistem hanya memberi usulan. Perubahan level masih bisa dilakukan sampai H-7 sesuai aturan lama.

### 6.7 Class media
Upload 2–4 foto per milestone (sesi 10, 20, 30, 40, PTM, graduation). File disimpan di folder Drive **baru** per kelas, dan checklist milestone terisi otomatis. Panduan do's & don'ts dari SIS lama ditampilkan di layar upload.

---

## 7. Layar aplikasi

| Layar | Pengguna | Isi |
|---|---|---|
| **Beranda** | semua | Ringkasan sesuai peran: kelas hari ini, tenggat terdekat, input yang belum diisi |
| **Murid** | SA, CM, HQ | Cari (pengganti *Quick Search*), daftar, form tambah/ubah, riwayat kelas |
| **Kelas** | SA, CM, HQ | Daftar & filter (status, program, hari), detail kelas, daftar murid |
| **Sesi & Absensi** | Teacher, Lead Teacher | Input absensi + catatan harian per sesi |
| **Assessment & Laporan** | Teacher, SA | Input nilai, generate PDF, status laporan |
| **Event Tracker** | SA, CM | Tenggat progress report, PTM, media |
| **Waiting List** | SA | Antrean request jadwal |
| **Leveling** | Lead Teacher | Rekomendasi & keputusan Achievement Day |
| **Media** | SA, Teacher | Upload foto per milestone |
| **Dashboard** | CM, HQ | Attendance rate per program/teacher/cabang, kepatuhan input |
| **Admin** | HQ | Kelola user, cabang, program/level, holiday |

---

## 8. Struktur project Apps Script

```
sis-sparks-math/
├── sistem-administrasi-akademik-sparks-math.md   ← dokumen ini
├── .clasp.json            ← scriptId project BARU (bukan script SIS lama)
├── appsscript.json        ← manifest: webapp, timeZone Asia/Jakarta, oauthScopes
└── src/
    ├── Code.gs            ← doGet, include()
    ├── Config.gs          ← ID spreadsheet DB baru, folder Drive baru, milestone
    ├── Auth.gs            ← getCurrentUser_, requireRole_
    ├── Db.gs              ← akses tabel generik (baca/tulis berdasarkan header)
    ├── Students.gs
    ├── Classes.gs         ← termasuk generate sessions & events
    ├── Attendance.gs
    ├── Reports.gs         ← template Docs → PDF
    ├── Leveling.gs
    ├── Migration.gs       ← baca SIS lama (read-only) → tulis DB baru
    ├── Index.html         ← layout utama
    ├── Styles.html
    └── Scripts.html       ← JS client (google.script.run)
```

### Contoh kerangka kode

`Code.gs`

```javascript
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sistem Administrasi Akademik Sparks Math')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
```

`Auth.gs`

```javascript
function getCurrentUser_() {
  const email = Session.getActiveUser().getEmail();
  const user = Db.findOne('users', row => row.email === email && row.is_active === true);
  if (!user) throw new Error('Akun Anda belum terdaftar di sistem.');
  user.centerList = user.center_codes ? String(user.center_codes).split(',') : null; // null = semua cabang
  return user;
}

function requireRole_(roles, centerCode) {
  const user = getCurrentUser_();
  if (!roles.includes(user.role)) throw new Error('Tidak punya akses untuk aksi ini.');
  if (centerCode && user.centerList && !user.centerList.includes(centerCode)) {
    throw new Error('Tidak punya akses ke cabang ' + centerCode);
  }
  return user;
}
```

`Db.gs` — akses tabel berdasarkan nama kolom di baris 1, tulis selalu di dalam lock

```javascript
const Db = {
  sheet_(table) {
    return SpreadsheetApp.openById(CONFIG.DB_SPREADSHEET_ID).getSheetByName(table);
  },

  readAll(table) {
    const values = this.sheet_(table).getDataRange().getValues();
    const header = values.shift();
    return values.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  },

  findOne(table, predicate) {
    return this.readAll(table).find(predicate) || null;
  },

  // Pemanggil WAJIB sudah memegang lock
  insertUnlocked_(table, record, userEmail) {
    const sheet = this.sheet_(table);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const now = new Date();
    const full = Object.assign({}, record, {
      created_at: now, created_by: userEmail, updated_at: now, updated_by: userEmail, is_deleted: false,
    });
    sheet.appendRow(header.map(h => (h in full ? full[h] : '')));
    return full;
  },

  insert(table, record, userEmail) {
    return withLock_(() => this.insertUnlocked_(table, record, userEmail));
  },
};

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
```

`Students.gs` — membuat ID murid dengan aman

```javascript
function createStudent(form) {
  const user = requireRole_(['HQ', 'CM', 'SA'], form.center_code);
  // Baca ID terakhir dan simpan baris baru di dalam satu lock supaya dua SA tidak mendapat ID yang sama
  return withLock_(() => {
    const prefix = form.center_code;
    const lastNo = Db.readAll('students')
      .filter(s => String(s.student_id).startsWith(prefix))
      .map(s => Number(String(s.student_id).slice(prefix.length)) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const studentId = prefix + String(lastNo + 1).padStart(4, '0');
    return Db.insertUnlocked_('students', Object.assign({}, form, { student_id: studentId, status: 'Postponed' }), user.email);
  });
}
```

Client (`Scripts.html`)

```html
<script>
  function saveStudent(form) {
    google.script.run
      .withSuccessHandler(s => showToast('Murid tersimpan: ' + s.student_id))
      .withFailureHandler(err => showToast(err.message, 'error'))
      .createStudent(form);
  }
</script>
```

### Praktik performa

- Baca satu tab sekali dengan `getDataRange().getValues()`, olah di memori; jangan baca sel satu per satu.
- Tulis banyak baris sekaligus dengan `setValues` (mis. absensi satu kelas).
- Cache data referensi (`users`, `classes`, `programs_levels`, `holidays`) di `CacheService` dan hapus cache saat data itu berubah. Batas CacheService: nilai maks 100 KB per key, kedaluwarsa maks 6 jam.
- Proses berat (snapshot dashboard, generate banyak PDF) dijalankan lewat time-driven trigger dan dipecah per cabang, karena satu eksekusi Apps Script dibatasi 6 menit.

---

## 9. Integrasi data (opsional)

Karena database baru berupa Google Sheets dengan header rapi di baris 1, datanya bisa masuk BigQuery dengan pola DAG yang sudah ada di `sr-airflow-repo` (`GoogleSheetToGCSOperator` → staging → bronze). Satu spreadsheet pusat = satu DAG dengan satu task per tab, bukan 20 DAG per cabang seperti jika membaca SIS lama.

---

## 10. Migrasi dari SIS lama

Migrasi **hanya membaca** SIS lama dan **menyalin** ke database baru (§0).

| Sumber (SIS lama, read-only) | Tujuan (DB baru) | Catatan |
|---|---|---|
| `Student Database` (header di baris 2, data mulai baris 3) | `students`, `enrollments` | *Current/Previous Class ID* dipecah jadi riwayat enrollment |
| `Class Database` (header baris 2) | `classes`, `sessions`, `events` | Sesi dibangkitkan ulang dari jadwal |
| Class Data per kelas → absensi | `attendance` | Link Class Data ada di Class Database kolom K |
| Class Data → tab CMCU | `daily_notes` | Opsional, bisa hanya kelas aktif |
| `Student Report Tracker`, nilai term | `assessments` | |
| `Waiting list` | `waiting_list` | |
| AD Leveling Tracker (tab `AD Intake X`) | `leveling` | Opsional, hanya intake berjalan |

Langkah:
1. **Akun migrasi** diberi akses **Viewer** saja ke folder SIS lama.
2. `Migration.gs` membaca satu cabang, memetakan kolom, menulis ke DB baru, dan membuat laporan selisih (jumlah murid/kelas per status, sumber vs tujuan).
3. **Uji coba** di 1 cabang pilot, verifikasi bersama CM & SA cabang tersebut.
4. **Masa paralel** (mis. 2–4 minggu): SIS lama tetap resmi, sistem baru dipakai berdampingan.
5. **Cut-over per cabang**: setelah disetujui, cabang pindah ke sistem baru. SIS lama cabang itu **tetap dibiarkan apa adanya** sebagai arsip; pembekuan/arsip file lama diputuskan oleh pemiliknya, bukan oleh proyek ini.

---

## 11. Batasan & risiko

| Batasan | Dampak | Mitigasi |
|---|---|---|
| Satu spreadsheet maks **10 juta sel** | Tabel absensi & catatan harian tumbuh paling cepat | Pisah per tahun ajaran; hitung perkiraan: `jumlah kelas × murid per kelas × 48 sesi × jumlah kolom` sebelum go-live |
| Eksekusi Apps Script maks **6 menit** | Proses massal bisa terpotong | Batch per cabang, trigger bertahap |
| Kuota harian Apps Script (email, pembuatan dokumen, dll.) | Generate PDF massal bisa terkena kuota | Jadwalkan bertahap; cek kuota di dokumentasi resmi Google untuk akun Workspace |
| Sheets bukan database transaksional | Tulis bersamaan bisa saling timpa | `LockService` untuk semua penulisan |
| Sheet DB diedit manual oleh orang | Data rusak, validasi terlewati | DB tidak di-share ke pengguna; hanya pemilik sistem + tim data (read-only) |
| Ketergantungan pada akun pemilik deploy | Jika akun nonaktif, aplikasi berhenti | Deploy dari akun tim/akun teknis, bukan akun pribadi |

**Kapan perlu pindah dari Sheets:** jika data absensi mendekati batas sel walau sudah dipecah, jika pengguna serentak sering antre lock, atau jika butuh laporan kompleks real-time — pertimbangkan Cloud SQL / Firestore dengan UI tetap di Apps Script atau aplikasi web terpisah.

---

## 12. Pertanyaan yang perlu dikonfirmasi

1. **Format Class ID** `C01-25089`: apakah `C01` = nomor cabang (BTR = folder "01."), `25` = tahun, `089` = urutan? Perlu konfirmasi sebelum ID baru dibuat otomatis.
2. **Program `LE`, `CT`, `BS`**: kepanjangan, daftar level lengkap, dan urutan naik levelnya.
3. **Paket & credit**: apakah pembayaran/credit dikelola di sistem ini atau tetap di sistem lain (mis. Paper.id / finance)?
4. **Template laporan**: format Monthly & Termly Progress Report yang sekarang dipakai.
5. **Cabang pilot** untuk uji coba.
6. **Pemilik sistem**: akun yang men-deploy web app dan memiliki spreadsheet DB.
7. **Data historis**: seberapa jauh ke belakang data yang perlu dimigrasikan (semua intake, atau hanya murid/kelas aktif)?

---

## 13. Tahapan pengembangan

| Fase | Isi | Hasil |
|---|---|---|
| **0. Persiapan** | Konfirmasi §12, buat spreadsheet DB baru + folder Drive baru + project Apps Script baru | Fondasi siap, SIS lama tidak tersentuh |
| **1. MVP** | Master data, user & peran, Murid, Kelas (+ auto sessions/events), Penempatan, Absensi | Cabang pilot bisa mencatat murid, kelas, absensi |
| **2. Akademik** | Catatan harian, Assessment, generate laporan PDF, Event Tracker | Pengganti Class Data/CMCU & Progress Report Generator |
| **3. Lanjutan** | Leveling, Waiting list, Media, Dashboard | Fitur setara SIS lama |
| **4. Migrasi & rollout** | Migrasi read-only per cabang, masa paralel, cut-over bertahap | 20 cabang pindah ke sistem baru |
| **5. Integrasi** *(opsional)* | DAG ke BigQuery | Data akademik tersedia untuk analitik |

# SIS Sparks Math — Sistem Administrasi Akademik (BARU)

Implementasi Google Apps Script (web app) + Google Sheets (database) sesuai rancangan di
[`sistem-administrasi-akademik-sparks-math.md`](sistem-administrasi-akademik-sparks-math.md).

> **SIS lama tidak disentuh.** Semua aset (spreadsheet DB, folder Drive, project Apps Script)
> dibuat baru di lokasi terpisah. Migrasi (opsional, fase 4) hanya **membaca** SIS lama.

- **Editor Apps Script:** https://script.google.com/d/1r8DWfWOJkjGowjVbDZ1JpHmq82rIXWwM4rlcaNiK4CA37kV5B5adKBx2/edit
- **Web App (deployment "MVP v0.1.0"):** https://script.google.com/macros/s/AKfycbzuafpVJnlRaNBq9lXw0ym6ShFT1Pp6lpkcwuYHSB-WpSzZCwcjHKE0qzRw5_Uie39sgA/exec
  (deployment ID: `AKfycbzuafpVJnlRaNBq9lXw0ym6ShFT1Pp6lpkcwuYHSB-WpSzZCwcjHKE0qzRw5_Uie39sgA`)
- Pemilik/deployer: `aulya.kustyawan@seven-retail.com` · Akses web app: semua akun domain `seven-retail.com` · Execute as: pemilik deploy.

---

## 1. Struktur file

```
sis-sparks-math/
├── sistem-administrasi-akademik-sparks-math.md   ← dokumen rancangan (jangan diubah)
├── TASK.md                ← spesifikasi build (untuk agent/peninjau)
├── verify.js              ← checker lokal: `node verify.js` (exit 0 = lolos)
├── README.md              ← dokumen ini
├── .clasp.json            ← scriptId project (jangan diubah manual)
└── src/                   ← SEMUA kode yang di-push ke Apps Script
    ├── appsscript.json    ← manifest (webapp DOMAIN, scope spreadsheets+drive, timezone Jakarta)
    ├── Code.gs            ← doGet + include
    ├── Config.gs          ← konstanta: tabel, peran/nav, enum status, milestone, aturan event, aturan leveling
    ├── Setup.gs           ← TABLE_SCHEMAS + setupDatabase/seedMasterData/authorizeSmokeTest/installNightlyTriggers
    ├── Auth.gs            ← identitas & otorisasi (Session → tabel users, requireRole_)
    ├── Db.gs              ← lapisan tabel generik (lock, cache, audit log, batch write)
    ├── Students.gs        ← murid (CRUD, ID BTR0001, riwayat kelas)
    ├── Classes.gs         ← kelas + auto 48 sesi + auto event + penempatan murid
    ├── Attendance.gs      ← absensi & catatan harian (batch save per sesi)
    ├── Reports.gs         ← assessment + generate PDF (template Docs → PDF)
    ├── Events.gs          ← event tracker (tenggat, tandai selesai)
    ├── WaitingList.gs     ← waiting list
    ├── Leveling.gs        ← rekomendasi & keputusan Achievement Day
    ├── Media.gs           ← upload foto milestone kelas
    ├── Dashboard.gs       ← ringkasan + snapshot harian (trigger 01:00)
    ├── Admin.gs           ← kelola user/cabang/program/holiday + audit log (HQ)
    ├── Migration.gs       ← migrasi read-only SIS lama (fase 4, default OFF)
    ├── Index.html         ← shell web app
    ├── Styles.html        ← CSS
    ├── Views.html         ← template layar & modal
    └── Scripts.html       ← logika klien (router, semua layar)
```

## 2. Aktivasi (sekali saja, manual — butuh klik izin OAuth)

1. Buka **editor** (link di atas) dengan akun `aulya.kustyawan@seven-retail.com`.
2. Pilih fungsi **`setupDatabase`** → **Run** → setujui izin OAuth
   (layar izin → *Advanced* → *Go to ...* bila muncul "unverified app" — normal untuk script internal).
   Hasil: spreadsheet **"SIS Sparks Math — Database"**, spreadsheet transaksi
   **"SIS Sparks Math — Transaksi AY2026-2027"**, dan folder Drive
   **"SIS Sparks Math (New System)"** (berisi Media/Reports/Templates) dibuat otomatis.
3. Jalankan **`authorizeSmokeTest`** → pastikan `ok: true` (menulis heartbeat ke audit_log).
4. Jalankan **`seedMasterData`** → data awal: user HQ (`aulya.kustyawan@...`),
   cabang contoh `BTR / Bintaro`, program/level contoh (LE 1A–3B + placeholder CT/BS).
5. (Opsional) Jalankan **`installNightlyTriggers`** untuk snapshot dashboard harian 01:00 WIB.
6. Buka **Web App URL** → login → aplikasi siap dipakai. (Pertama kali, ikuti layar izin bila diminta.)
7. **Khusus v0.2.0 — dua langkah aktivasi manual:** (a) jalankan **`authorizeSmokeTest`** sekali lagi →
   setujui izin baru **"Send email as you"** (`script.send_mail`, untuk kirim kode login);
   (b) **Deploy → Manage deployments → ikon ✏️ → Who has access = "Anyone with Google account" → Deploy**.
   Deployment yang sudah ada menyimpan pengaturan aksesnya sendiri — mengubah manifest saja tidak cukup.

## 3. Alur kerja pengembangan

```bash
cd sis-sparks-math
# edit file di src/ ...
node verify.js            # checker lokal harus exit 0
clasp push                # kirim ke Apps Script
clasp create-version "..."          # buat versi
clasp update-deployment AKfycbzuafpVJnlRaNBq9lXw0ym6ShFT1Pp6lpkcwuYHSB-WpSzZCwcjHKE0qzRw5_Uie39sgA "deskripsi"
# atau deployment baru: clasp create-deployment -V <n> -d "..."
clasp open-script         # buka editor
```

## 4. Script Properties (diisi otomatis oleh setupDatabase)

| Key | Isi |
|---|---|
| `DB_SPREADSHEET_ID` | Spreadsheet database utama (semua tabel non-transaksi) |
| `TX_DB_SPREADSHEET_ID_<AY>` | Spreadsheet transaksi tahun ajaran (absensi & catatan harian) |
| `TX_DB_AY` | Label tahun ajaran aktif (mis. `2026-2027`) |
| `MEDIA_ROOT_FOLDER_ID` | Folder Drive root baru |
| `REPORTS_FOLDER_ID` | Subfolder PDF laporan |
| `TEMPLATE_DOC_ID` | **Isi manual**: ID Google Docs template laporan (lihat §5) |
| `OLD_SIS_SOURCES` | **Isi manual**: JSON sumber SIS lama untuk migrasi (lihat §7) |

## 5. Template laporan PDF

Buat Google Docs template, isi placeholder berikut (persis, termasuk `{{ }}`), lalu simpan ID-nya
di property `TEMPLATE_DOC_ID` (File → lihat URL `.../d/<ID>/edit`):

`{{student_name}} {{nickname}} {{class_name}} {{program}} {{level}} {{teacher_name}} {{term}}
{{attendance_rate}} {{sessions_present}} {{sessions_total}} {{grades_summary}} {{achievement_notes}}
{{improvement_notes}} {{center_name}} {{report_date}} {{sa_name}}`

Tanpa template, tombol Generate PDF akan menolak dengan pesan yang jelas.

## 6. Data master yang perlu diganti (setelah uji coba)

- **centers**: seed hanya berisi `BTR`. Ganti/tambah 20 cabang asli (center_code, center_no, nama).
- **users**: daftarkan SA/CM/Teacher/Lead Teacher dengan `center_codes` (mis. `BTR,KGD`; kosong = semua / khusus HQ).
- **programs_levels**: lengkapi program `LE`, `CT`, `BS` beserta urutan level & next level sesuai kurikulum.
- **holidays**: tambahkan tanggal libur per cabang (kosong = semua cabang).

## 7. Migrasi SIS lama (fase 4 — opsional, READ-ONLY)

1. Isi property `OLD_SIS_SOURCES` (JSON), contoh bentuk:
   `{"BTR": {"studentDatabaseSheetId": "<ID>", "sheetName": "Student Database", "headerRow": 2}}`
2. Jalankan `dryRunMigration("BTR")` → laporan jumlah & selisih **tanpa menulis apa pun**.
3. Penulisan hanya jika disengaja: ubah `MIGRATION_WRITE_ENABLED = true` di `Migration.gs` **dan**
   token konfirmasi `SAYA-SETUJU`. Sumber tetap tidak pernah ditulis (hanya `getDataRange().getValues()`).

## 8. Asumsi (pertanyaan §12 dokumen rancangan — perlu konfirmasi ke akademik)

| # | Asumsi implementasi | Status |
|---|---|---|
| 1 | Format Class ID `C{no cabang}-{thn}{urut}` (mis. `C01-25089`), terisolasi di `nextClassId_()` | perlu konfirmasi §12 Q1 |
| 2 | Progress report M1/M2/M4/M5 jatuh tempo = tanggal mulai kelas + 1/2/4/5 bulan | konfigurasi `EVENT_RULES` |
| 3 | PTM otomatis di sesi 13, 24, 37; Termly Report di 24 & 48 | konfigurasi `EVENT_RULES` |
| 4 | Panduan media 5 do/5 don't masih placeholder generik | TODO: ganti konten SIS lama |
| 5 | Tahun ajaran mulai Juli (label `2026-2027`) | `ACADEMIC_YEAR_START_MONTH` |
| 6 | Status waiting list: Waiting/Contacted/Offered/Enrolled/Cancelled | sesuaikan bila beda |
| 7 | Kelas = 48 sesi; media 2–4 foto per milestone | dari dokumen |

## 9. Keamanan & integritas data

- DB **tidak di-share** ke pengguna aplikasi; akses hanya lewat web app (peran dicek di server, `requireRole_`).
- Semua penulisan lewat `LockService` (anti tabrakan), soft delete, dan tercatat di `audit_log`.
- Manifest: `executeAs: USER_DEPLOYING`, `access: ANYONE` (siapa pun dengan akun Google). Staf domain tetap otomatis; akun Gmail pribadi lewat **kode verifikasi email** 6 digit (`auth_codes` → `auth_sessions`, token 30 hari di `localStorage`); semua fungsi server tetap dicek peran (`requireRole_`).
- Kuota Apps Script & batas 6 menit per eksekusi: proses berat (snapshot, PDF massal) dijadwalkan lewat trigger / dipecah per cabang.

## 10. Troubleshooting & diagnostik

Setiap layar kegagalan web app punya tombol **"Tampilkan Diagnostik"** — tekan untuk melihat email
terdeteksi, status DB, jumlah user, dan *verdict* penyebab. Diagnostik yang sama juga bisa dijalankan
dari editor: jalankan fungsi **`diagnoseLogin`**.

| Gejala | Arti & tindakan |
|---|---|
| "Database Belum Siap" | `setupDatabase()` belum dijalankan → buka editor, jalankan `setupDatabase()` lalu `seedMasterData()` |
| "Email Tidak Terbaca" | Sejak **v0.2.0** akun luar domain otomatis diarahkan ke **layar Masuk (kode email)** — bukan error lagi. Bila akun domain tetap tidak terbaca: hindari multi-akun di browser, muat ulang |
| "Akses Ditolak — (email) belum terdaftar" | Email terbaca benar tetapi tidak ada di tabel `users` → daftarkan lewat menu Admin |
| "Akun Non-Aktif" | Baris `users` ada tapi `is_active` = FALSE → aktifkan lewat Admin |
| "Klik menu → halaman kosong" | Bug sandbox Apps Script (navigasi hash + `base target="_top"`) — **sudah diperbaiki di v0.1.2**; cukup muat ulang halaman |
| "Bagaimana menambah akun Teacher (guru)?" | Login sebagai HQ → menu **Admin** → tab **Pengguna (Users)** → **+ Tambah Pengguna** → role **TEACHER**, centang cabang → Simpan. Akun langsung bisa login; nama otomatis muncul di dropdown "Pilih Teacher" saat membuat Kelas. |
| "Tab Admin cuma bisa lihat (read-only)" | Sejak **v0.1.3** semua tab Admin bisa tambah/edit: Pengguna, Cabang, Program & Level, Hari Libur. |
| "Tombol ☰ di header tidak berfungsi" | Sudah diperbaiki **v0.1.4**: di desktop ☰ melipat/menampilkan sidebar; di layar kecil ☰ membuka/menutup menu (dan menutup otomatis setelah pindah menu). |
| "Bisa login pakai Gmail pribadi?" | **Bisa (v0.2.0).** Buka web app dengan akun Google apa pun → layar **Masuk** → isi email **yang sudah terdaftar di Admin** → kode 6 digit dikirim ke inbox (berlaku 10 menit) → masuk. Sesi 30 hari, tombol **Keluar** ada di sidebar. Email belum terdaftar? Minta HQ daftarkan dulu (Admin → Pengguna). |

**PENTING pasca-update v0.2.0 (dua langkah manual):** (1) di editor jalankan sekali **`authorizeSmokeTest`**
dan setujui izin baru **"Send email as you"** (`script.send_mail` — untuk kirim kode login); (2) **Deploy →
Manage deployments → ikon ✏️ → Who has access = "Anyone with Google account" → Deploy** — tanpa langkah ini
akun Gmail pribadi masih ditolak Google sebelum aplikasi terbuka.

Test lokal: `node login-sim.js` mensimulasikan **11 skenario** (status DB, akun domain, alur kode email:
kirim/salah/benar/limit, validasi token) tanpa perlu akun Google; `node ui-sim.js` menguji UI termasuk
alur login kode.

---
*Dibangun: 6–7 Okt 2026 · **v0.2.0** (login kode-email untuk akun Gmail pribadi: dispatcher `callApi` + token sesi 30 hari + layar Masuk + tombol Keluar) ·
diverifikasi: `node verify.js` + `node login-sim.js` (11/11) + `node ui-sim.js` (11 HQ + 8 admin + 4 TEACHER + toggle desktop/mobile + alur OTP) + `node admin-sim.js` (5/5) + diff byte-identik dengan project remote.*

# Absen Asrama

Front end disajikan oleh Vercel dan backend berjalan sebagai Google Apps Script Web App. Data tersimpan di Google Sheets.

## 1. Siapkan spreadsheet dan Apps Script

1. Buat atau buka spreadsheet Google, lalu pilih **Extensions → Apps Script**.
2. Salin isi `Code.gs` ke file `Code.gs` di project Apps Script.
3. Jika Apps Script dibuka melalui **Extensions → Apps Script** dari spreadsheet database, biarkan `CONFIG.SPREADSHEET_ID` kosong.
4. Jalankan `setupDatabase()` sekali dari editor Apps Script dan berikan izin akses spreadsheet. Langkah ini menyimpan ID spreadsheet yang terhubung agar tetap bisa diakses oleh Web App.
   Fungsi ini juga melengkapi kelas standar: 1–3 sebagai Tsanawiyah, 4–6 sebagai Aliyah, dan 7 sebagai kelas khusus.
5. Pilih **Deploy → New deployment → Web app**. Jalankan aplikasi sebagai akun Anda dan pilih akses **Anyone** agar proxy Vercel dapat memanggil API.
6. Salin URL deployment yang berakhiran `/exec`.

Jika Apps Script dibuat sebagai project standalone, isi `CONFIG.SPREADSHEET_ID` dengan ID spreadsheet (bagian antara `/d/` dan `/edit` pada URL) sebelum menjalankan `setupDatabase()`.

## 2. Siapkan Vercel

1. Import folder/repository ini sebagai project Vercel. Root directory tetap folder ini; `index.html` adalah aplikasi utama.
2. Tambahkan environment variable `APPS_SCRIPT_URL` dengan URL `/exec` dari langkah sebelumnya untuk Production (dan Preview bila diperlukan).
3. Deploy atau redeploy setelah mengatur environment variable.

Browser hanya memanggil `/api/backend` di domain Vercel. Fungsi tersebut meneruskan panggilan ke Apps Script, sehingga tidak memerlukan CORS lintas domain di browser.

Jika dropdown kelas menampilkan gagal dimuat setelah perubahan kode, buka **Deploy â†’ Manage deployments â†’ Edit** pada Apps Script, pilih **New version**, lalu deploy. Pastikan environment variable `APPS_SCRIPT_URL` di Vercel memakai URL `/exec` deployment terbaru; setelah itu redeploy Vercel. API dropdown memakai metode `getRegistrationClasses`, yang tidak tersedia di versi Apps Script lama.

## Halaman dan URL

- `/login/` — masuk ke akun.
- `/regis/` — pendaftaran akun guru.
- `/menunggu/` — melihat status pengajuan guru.
- `/dashboard`, `/absensi`, `/siswa`, `/guru`, `/kelas`, `/rekap`, `/profil`, dan `/pengaturan` — halaman aplikasi. Setiap slug dapat dibuka langsung, di-refresh, dan dinavigasi dengan tombol Back browser.

Status pengajuan hanya dapat diperiksa menggunakan username dan password pendaftar. Password tidak disimpan pada URL atau browser storage.

Kelas standar akan ditambahkan tanpa menghapus kelas lama atau mengubah penempatan siswa/riwayat absensi yang sudah ada. Kelas lama ditampilkan sebagai **Lainnya** supaya dapat dipindahkan secara manual dengan aman.

Saat mendaftar, guru memilih kelas aktif yang belum memiliki wali. Pilihan kelas disimpan bersama permohonan dan ditampilkan kepada administrator. Ketika permohonan disetujui, guru otomatis ditetapkan sebagai wali kelas tersebut; akses absensi mengikuti kelas yang tercatat di sheet **Kelas**. Permohonan lama tanpa kelas tetap dapat disetujui, lalu kelasnya dapat ditetapkan melalui menu **Data Kelas**.

Setelah memperbarui kode, salin `Code.gs` terbaru ke Apps Script dan jalankan `setupDatabase()` sekali agar kolom `ID_Kelas_Diminta` ditambahkan pada sheet **Users**. Deploy versi Web App Apps Script yang baru, lalu deploy ulang frontend Vercel.

## Catatan akun awal

Backend membuat akun awal `admin` dengan password `admin123`. Segera masuk dan ubah password melalui **Pengaturan → Kelola akun** sebelum aplikasi dipakai.

## Struktur

- `index.html` — antarmuka dan pemanggil API browser.
- `login/`, `regis/`, `menunggu/` — halaman autentikasi dan status pengajuan.
- `api/backend.js` — proxy Vercel ke Apps Script.
- `Code.gs` — API, autentikasi, dan operasi Google Sheets.
- `vercel.json` — konfigurasi fungsi Vercel.

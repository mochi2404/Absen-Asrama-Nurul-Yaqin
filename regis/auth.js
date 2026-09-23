async function submitRegistration(event) {
  event.preventDefault();
  const form = document.getElementById('registration-fields');
  if (!form.reportValidity()) return;
  const password = document.getElementById('reg_password').value;
  if (password.length < 8) { document.getElementById('register-error').textContent = 'Password minimal 8 karakter.'; return; }
  if (password !== document.getElementById('reg_password_confirm').value) {
    document.getElementById('register-error').textContent = 'Konfirmasi password belum sama.';
    document.getElementById('reg_password_confirm').focus();
    return;
  }
  const username = document.getElementById('reg_username').value.trim().toLowerCase();
  const payload = {
    nama: document.getElementById('full_name').value.trim(),
    username,
    password,
    nip: document.getElementById('no_nip_toggle').checked ? '' : document.getElementById('nip_field').value.trim(),
    idKelas: document.getElementById('requested-class').value,
    jenisKelamin: document.querySelector('input[name="gender"]:checked')?.value || '',
    noHp: document.getElementById('phone_number').value.trim()
  };
  const button = document.getElementById('register-submit');
  document.getElementById('register-error').textContent = '';
  button.disabled = true;
  button.dataset.label = button.textContent.trim();
  button.textContent = 'Mengirim pendaftaran...';
  try {
    const response = await fetch('/api/backend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'registerTeacher', args: [payload] })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Tidak dapat menghubungi server.');
    sessionStorage.setItem('registrationUsername', username);
    window.location.assign('/menunggu/');
  } catch (error) {
    document.getElementById('register-error').textContent = error.message || 'Pendaftaran belum berhasil.';
  } finally {
    button.disabled = false;
    button.textContent = button.dataset.label || 'Kirim Permohonan Pendaftaran';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const nip = document.getElementById('nip_field');
  document.getElementById('no_nip_toggle')?.addEventListener('change', event => {
    nip.value = '';
    nip.disabled = event.target.checked;
    nip.classList.toggle('opacity-50', event.target.checked);
  });
  const username = document.getElementById('reg_username');
  username.value = '';
  loadRegistrationClasses();
});

async function loadRegistrationClasses() {
  const select = document.getElementById('requested-class');
  const hint = document.getElementById('class-hint');
  try {
    const response = await fetch('/api/backend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getRegistrationClasses', args: [] })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Daftar kelas gagal dimuat.');
    const classes = result.data || [];
    select.replaceChildren(new Option(classes.length ? 'Pilih kelas' : 'Belum ada kelas yang tersedia', ''));
    classes.forEach(k => select.add(new Option(`${k.Nama_Kelas} — ${k.Jenjang}`, k.ID_Kelas)));
    select.disabled = classes.length === 0;
    if (!classes.length) hint.textContent = 'Semua kelas aktif sudah memiliki wali kelas. Hubungi administrator sekolah.';
  } catch (error) {
    select.replaceChildren(new Option('Daftar kelas gagal dimuat', ''));
    select.disabled = true;
    hint.textContent = `${error.message || 'Tidak dapat menghubungi server.'} Pastikan deployment Apps Script terbaru sudah aktif dan APPS_SCRIPT_URL di Vercel mengarah ke deployment tersebut, lalu muat ulang halaman.`;
  }
}

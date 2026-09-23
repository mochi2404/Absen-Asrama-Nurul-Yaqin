document.addEventListener('DOMContentLoaded', () => {
  const username = document.getElementById('status-username');
  username.value = sessionStorage.getItem('registrationUsername') || '';
  const name = new URLSearchParams(location.search).get('nama');
  if (name) document.getElementById('pending-name').textContent = name;
});

async function checkLatestStatus() {
  const username = document.getElementById('status-username').value.trim();
  const password = document.getElementById('status-password').value;
  const resultBox = document.getElementById('status-result');
  if (!username || !password) { resultBox.textContent = 'Masukkan username dan password untuk memeriksa status.'; return; }
  const button = document.getElementById('refresh-status-btn');
  const text = document.getElementById('refresh-text');
  button.disabled = true;
  text.textContent = 'Memeriksa status...';
  try {
    const response = await fetch('/api/backend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'checkTeacherRegistration', args: [username, password] })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Tidak dapat menghubungi server.');
    const status = result.data.status;
    if (status === 'Menunggu') resultBox.textContent = 'Permohonan masih menunggu persetujuan administrator.';
    else if (status === 'Aktif') resultBox.textContent = 'Permohonan disetujui. Silakan masuk menggunakan akun Anda.';
    else if (status === 'Ditolak') resultBox.textContent = 'Permohonan ditolak. Silakan hubungi administrator sekolah.';
    else resultBox.textContent = 'Status akun: ' + status;
    if (status === 'Aktif') setTimeout(() => location.assign('/login/'), 1600);
  } catch (error) {
    resultBox.textContent = error.message || 'Status belum dapat diperiksa.';
  } finally {
    button.disabled = false;
    text.textContent = 'Periksa Status Terbaru';
  }
}

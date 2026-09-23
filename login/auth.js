let currentRole = 'admin';

function togglePasswordVisibility() {
  const password = document.getElementById('user-password');
  const icon = document.getElementById('password-toggle-icon');
  password.type = password.type === 'password' ? 'text' : 'password';
  icon.textContent = password.type === 'password' ? 'visibility' : 'visibility_off';
}

function switchRole(role) {
  currentRole = role === 'guru' ? 'guru' : 'admin';
  const admin = document.getElementById('role-admin-btn');
  const guru = document.getElementById('role-guru-btn');
  admin.classList.toggle('active', currentRole === 'admin');
  guru.classList.toggle('active', currentRole === 'guru');
  const label = document.getElementById('identity-label');
  label.textContent = currentRole === 'guru' ? 'Username / Email Guru' : 'Username / Email Administrator';
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const button = document.getElementById('submit-button');
  const text = document.getElementById('submit-text');
  const icon = document.getElementById('submit-icon');
  const username = document.getElementById('user-identity').value.trim();
  const password = document.getElementById('user-password').value;
  button.disabled = true;
  text.textContent = 'Memeriksa akun...';
  icon.textContent = 'sync';
  icon.classList.add('animate-spin');
  try {
    const response = await fetch('/api/backend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', args: [username, password] })
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (_) {
      const detail = responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      throw new Error(detail
        ? `Server mengirim respons yang bukan JSON (HTTP ${response.status}): ${detail}`
        : `Server mengirim respons kosong atau tidak valid (HTTP ${response.status}).`);
    }
    if (!response.ok || !result.success) throw new Error(result.error || 'Tidak dapat menghubungi server.');
    const expectedRole = currentRole === 'guru' ? 'Guru' : 'Admin';
    if (result.data.user?.role !== expectedRole) {
      throw new Error(currentRole === 'guru' ? 'Akun ini bukan akun guru.' : 'Akun ini bukan akun administrator.');
    }
    sessionStorage.setItem('absensiSession', result.data.token);
    const requested = new URLSearchParams(location.search).get('next') || '/dashboard';
    const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard';
    const destination = result.data.user?.role === 'Guru' && !['/absensi', '/profil'].includes(next.split('?')[0])
      ? '/absensi' : next;
    window.location.assign(destination);
  } catch (error) {
    const message = error.message || 'Terjadi kesalahan saat masuk.';
    if (message.toLowerCase().includes('menunggu')) {
      sessionStorage.setItem('registrationUsername', username);
      window.location.assign('/menunggu/');
      return;
    }
    document.getElementById('login-message').textContent = message;
    document.getElementById('user-password').value = '';
  } finally {
    button.disabled = false;
    text.textContent = 'Masuk ke Sistem Absensi';
    icon.textContent = 'arrow_forward';
    icon.classList.remove('animate-spin');
  }
}

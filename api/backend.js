module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const backendUrl = process.env.APPS_SCRIPT_URL;
  if (!backendUrl) {
    return res.status(500).json({ error: 'Environment variable APPS_SCRIPT_URL belum diatur di Vercel.' });
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(backendUrl)) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL harus berupa URL deployment Apps Script yang berakhir dengan /exec.' });
  }

  try {
    const upstream = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      const detail = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      return res.status(502).json({
        error: `Apps Script tidak mengembalikan JSON (HTTP ${upstream.status}). Periksa deployment Web App dan akses Anyone.${detail ? ' Respons: ' + detail : ''}`
      });
    }
    return res.status(upstream.ok ? 200 : 502).json(payload);
  } catch (error) {
    return res.status(502).json({ error: 'Tidak dapat menghubungi Apps Script: ' + error.message });
  }
}

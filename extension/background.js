// Roda no service worker da extensão — com host_permissions, esse fetch não
// esbarra em CORS (diferente de um fetch feito pela própria página).
async function getAuthAndServer() {
  const { serverUrl, authUser, authPass } = await chrome.storage.local.get(['serverUrl', 'authUser', 'authPass']);
  const headers = {};
  if (authUser) headers.Authorization = 'Basic ' + btoa(`${authUser}:${authPass || ''}`);
  return { serverUrl, headers };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'JOBHUNTER_FETCH_AUTOFILL') {
    (async () => {
      try {
        const { serverUrl, headers } = await getAuthAndServer();
        const { profileId } = await chrome.storage.local.get(['profileId']);
        if (!serverUrl || !profileId) {
          sendResponse({ error: 'Configure a extensão primeiro (clique no ícone dela).' });
          return;
        }
        const url = `${serverUrl.replace(/\/$/, '')}/api/autofill?profile_id=${encodeURIComponent(profileId)}&url=${encodeURIComponent(msg.pageUrl)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return sendResponse({ error: `Servidor respondeu HTTP ${res.status}` });
        sendResponse({ data: await res.json() });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'JOBHUNTER_CAPTURE_JOB') {
    (async () => {
      try {
        const { serverUrl, headers } = await getAuthAndServer();
        if (!serverUrl) {
          sendResponse({ error: 'Configure a extensão primeiro (clique no ícone dela).' });
          return;
        }
        const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/jobs/capture`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.job),
        });
        if (!res.ok) return sendResponse({ error: `Servidor respondeu HTTP ${res.status}` });
        sendResponse({ data: await res.json() });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'JOBHUNTER_CAPTURE_FREETEXT') {
    (async () => {
      try {
        const { serverUrl, headers } = await getAuthAndServer();
        if (!serverUrl) {
          sendResponse({ error: 'Configure a extensão primeiro (clique no ícone dela).' });
          return;
        }
        const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/jobs/capture-freetext`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg.text, url: msg.pageUrl }),
        });
        const data = await res.json();
        if (!res.ok) return sendResponse({ error: data.error || `Servidor respondeu HTTP ${res.status}` });
        sendResponse({ data });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  return false;
});

const $ = (id) => document.getElementById(id);

async function load() {
  const { serverUrl, authUser, authPass, profileId } = await chrome.storage.local.get([
    'serverUrl', 'authUser', 'authPass', 'profileId',
  ]);
  if (serverUrl) $('serverUrl').value = serverUrl;
  if (authUser) $('authUser').value = authUser;
  if (authPass) $('authPass').value = authPass;
  if (profileId) {
    const opt = document.createElement('option');
    opt.value = profileId;
    opt.textContent = `Perfil #${profileId} (salvo)`;
    opt.selected = true;
    $('profileId').appendChild(opt);
  }
}

$('loadProfiles').addEventListener('click', async () => {
  const status = $('status');
  status.textContent = 'Buscando...';
  try {
    const serverUrl = $('serverUrl').value.trim().replace(/\/$/, '');
    const headers = {};
    if ($('authUser').value) {
      headers.Authorization = 'Basic ' + btoa(`${$('authUser').value}:${$('authPass').value}`);
    }
    const res = await fetch(`${serverUrl}/api/profiles`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const profiles = await res.json();

    const select = $('profileId');
    select.innerHTML = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    }
    status.textContent = `${profiles.length} perfil(is) encontrado(s).`;
  } catch (err) {
    status.textContent = 'Erro: ' + err.message;
  }
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    serverUrl: $('serverUrl').value.trim(),
    authUser: $('authUser').value.trim(),
    authPass: $('authPass').value,
    profileId: $('profileId').value,
  });
  $('status').textContent = 'Salvo ✓';
  setTimeout(() => ($('status').textContent = ''), 2000);
});

load();

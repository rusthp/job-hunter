function renderSidebar(active) {
  const items = [
    { href: 'index.html', label: 'Início' },
    { href: 'perfil.html', label: 'Perfil' },
    { href: 'configuracoes.html', label: 'Configurações' },
  ];
  const nav = items
    .map((i) => `<a href="${i.href}" class="${i.href === active ? 'active' : ''}">${i.label}</a>`)
    .join('');
  document.getElementById('sidebar').innerHTML = `
    <div class="brand">Job Hunter</div>
    <div class="profile-switcher-wrap">
      <label for="profile-switcher">Perfil ativo</label>
      <select id="profile-switcher"></select>
    </div>
    <nav>${nav}</nav>
  `;
}

async function initProfileSwitcher() {
  const profiles = await fetch('api/profiles').then((r) => r.json());
  const stored = Number(localStorage.getItem('jobhunter_profile_id'));
  let activeId = profiles.find((p) => p.id === stored) ? stored : profiles[0]?.id;
  if (!activeId) return null;
  localStorage.setItem('jobhunter_profile_id', activeId);

  const switcher = document.getElementById('profile-switcher');
  switcher.innerHTML =
    profiles.map((p) => `<option value="${p.id}">${p.name}</option>`).join('') +
    '<option value="__new__">+ Novo perfil...</option>';
  switcher.value = activeId;

  switcher.addEventListener('change', async () => {
    if (switcher.value === '__new__') {
      const name = window.prompt('Nome do novo perfil:');
      if (name && name.trim()) {
        const created = await fetch('api/profiles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
        }).then((r) => r.json());
        localStorage.setItem('jobhunter_profile_id', created.id);
        location.reload();
      } else {
        switcher.value = String(activeId);
      }
      return;
    }
    localStorage.setItem('jobhunter_profile_id', switcher.value);
    location.reload();
  });

  return activeId;
}

function getActiveProfileId() {
  return Number(localStorage.getItem('jobhunter_profile_id'));
}

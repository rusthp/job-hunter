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
    <nav>${nav}</nav>
  `;
}

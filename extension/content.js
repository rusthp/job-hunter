(function () {
  if (document.getElementById('jobhunter-fab')) return;

  const isLinkedIn = location.hostname.includes('linkedin.com');

  const fab = document.createElement('button');
  fab.id = 'jobhunter-fab';
  fab.type = 'button';
  fab.textContent = isLinkedIn ? '🎯 Capturar vaga' : '🎯 Job Hunter';
  fab.title = isLinkedIn
    ? 'Enviar essa vaga pro banco do Job Hunter'
    : 'Preencher candidatura com dados do Job Hunter';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'jobhunter-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  function renderPanel(html) {
    panel.innerHTML = html;
    panel.hidden = false;
  }

  function setText(selector, text) {
    const el = panel.querySelector(selector);
    if (el) el.textContent = text;
  }

  function wireClose() {
    panel.querySelector('.jh-close')?.addEventListener('click', () => (panel.hidden = true));
  }

  // ---------- Modo Gupy / Vagas.com: preencher candidatura ----------

  function fieldMatches(el, patterns) {
    const haystack = [
      el.name, el.id, el.placeholder,
      el.getAttribute('aria-label'),
      el.closest('label')?.textContent,
      document.querySelector(`label[for="${el.id}"]`)?.textContent,
    ].filter(Boolean).join(' ').toLowerCase();
    return patterns.some((p) => haystack.includes(p));
  }

  function fillIfEmpty(el, value) {
    if (!el || !value || el.value) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function autofillPage(data) {
    const inputs = [...document.querySelectorAll('input, textarea')];
    let filledCount = 0;

    const emailField = inputs.find((el) => el.type === 'email' || fieldMatches(el, ['email', 'e-mail']));
    if (fillIfEmpty(emailField, data.email)) filledCount++;

    const phoneField = inputs.find((el) => el.type === 'tel' || fieldMatches(el, ['telefone', 'celular', 'phone']));
    if (fillIfEmpty(phoneField, data.phone)) filledCount++;

    const nameField = inputs.find((el) => fieldMatches(el, ['nome completo', 'nome', 'name']) && el.type !== 'email');
    if (fillIfEmpty(nameField, data.name)) filledCount++;

    const linkedinField = inputs.find((el) => fieldMatches(el, ['linkedin']));
    if (fillIfEmpty(linkedinField, data.linkedin_url)) filledCount++;

    const coverField = inputs.find((el) =>
      el.tagName === 'TEXTAREA' && fieldMatches(el, ['carta', 'apresentação', 'mensagem', 'cover', 'motivo', 'por que'])
    ) || inputs.find((el) => el.tagName === 'TEXTAREA');
    if (data.cover_letter && fillIfEmpty(coverField, data.cover_letter)) filledCount++;

    return filledCount;
  }

  function runAutofill() {
    renderPanel('<div class="jh-loading">Buscando seus dados no Job Hunter...</div>');

    chrome.runtime.sendMessage(
      { type: 'JOBHUNTER_FETCH_AUTOFILL', pageUrl: location.href },
      (response) => {
        if (!response || response.error) {
          renderPanel('<div class="jh-error" id="jh-error"></div><button class="jh-close">Fechar</button>');
          setText('#jh-error', 'Erro: ' + (response?.error || 'sem resposta'));
          wireClose();
          return;
        }

        const data = response.data;
        const filledCount = autofillPage(data);

        renderPanel(`
          <div class="jh-header">
            <strong>Job Hunter</strong>
            <button class="jh-close" title="Fechar">×</button>
          </div>
          <div class="jh-hint" id="jh-hint"></div>
          <div class="jh-status">${filledCount} campo(s) preenchido(s) automaticamente.</div>
          ${data.cover_letter ? `
            <div class="jh-cover-label">Carta de apresentação (revise antes de usar):</div>
            <textarea class="jh-cover-text" readonly id="jh-cover-textarea"></textarea>
            <button class="jh-copy">Copiar carta</button>
          ` : ''}
          <div class="jh-footer">Revise tudo antes de enviar — a extensão nunca clica em enviar por você.</div>
        `);

        setText('#jh-hint', data.job_matched
          ? `Vaga reconhecida: ${data.job_title}`
          : 'Vaga não está no banco — só preenchi seus dados de perfil, sem carta personalizada.');

        const coverTextarea = panel.querySelector('#jh-cover-textarea');
        if (coverTextarea) coverTextarea.value = data.cover_letter;

        wireClose();
        const copyBtn = panel.querySelector('.jh-copy');
        if (copyBtn) {
          copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(data.cover_letter);
            copyBtn.textContent = 'Copiado ✓';
            setTimeout(() => (copyBtn.textContent = 'Copiar carta'), 2000);
          });
        }
      }
    );
  }

  // ---------- Modo LinkedIn: capturar vaga da tela (passivo) ----------

  function textOf(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  function extractLinkedInJob() {
    // Seletores com fallback múltiplo — LinkedIn muda a estrutura com frequência,
    // não testado ao vivo nesta versão (nenhum anúncio ainda válido no momento da escrita).
    const title = textOf([
      'h1.job-details-jobs-unified-top-card__job-title',
      'h1.top-card-layout__title',
      '.jobs-unified-top-card__job-title',
      'h1',
    ]);
    const company = textOf([
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '.jobs-unified-top-card__company-name',
    ]);
    const locationText = textOf([
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet',
    ]);
    const description = textOf([
      '.jobs-description__content',
      '.jobs-box__html-content',
      '#job-details',
      '.description__text',
    ]);

    let city = null, state = null;
    if (locationText) {
      const parts = locationText.split(',').map((s) => s.trim());
      if (parts.length >= 2) { city = parts[0]; state = parts[1]; }
      else city = locationText;
    }

    const pageText = document.body.innerText;
    let workplace_type = null;
    if (/\bremoto\b/i.test(pageText.slice(0, 3000))) workplace_type = 'remote';
    else if (/\bh[íi]brido\b/i.test(pageText.slice(0, 3000))) workplace_type = 'hybrid';
    else if (/\bpresencial\b/i.test(pageText.slice(0, 3000))) workplace_type = 'on-site';

    // Só LinkedIn não obriga candidatura pelo formulário próprio da plataforma —
    // às vezes quem posta cola um e-mail direto na descrição. Regex simples,
    // sem chamar nenhuma API externa, sem navegar em lugar nenhum.
    const emailMatch = (description || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const contactEmail = emailMatch ? emailMatch[0] : null;

    return { title, company, city, state, description, workplace_type, contactEmail, url: location.href.split('?')[0] };
  }

  function runCapture() {
    const job = extractLinkedInJob();

    if (!job.title) {
      renderPanel(`
        <div class="jh-header"><strong>Job Hunter</strong><button class="jh-close" title="Fechar">×</button></div>
        <div class="jh-error">Não consegui achar o título da vaga nessa página. Layout do LinkedIn pode ter mudado — avise pra eu ajustar os seletores.</div>
      `);
      wireClose();
      return;
    }

    renderPanel('<div class="jh-loading">Enviando vaga pro Job Hunter...</div>');

    chrome.runtime.sendMessage({ type: 'JOBHUNTER_CAPTURE_JOB', job }, (response) => {
      if (!response || response.error) {
        renderPanel('<div class="jh-error" id="jh-error"></div><button class="jh-close">Fechar</button>');
        setText('#jh-error', 'Erro: ' + (response?.error || 'sem resposta'));
        wireClose();
        return;
      }

      renderPanel(`
        <div class="jh-header"><strong>Job Hunter</strong><button class="jh-close" title="Fechar">×</button></div>
        <div class="jh-status" id="jh-captured"></div>
        ${job.contactEmail ? `
          <div class="jh-email-found">
            📧 E-mail encontrado na descrição:
            <div class="jh-email-value" id="jh-email-value"></div>
            <button class="jh-copy" id="jh-copy-email">Copiar e-mail</button>
          </div>
        ` : ''}
        <div class="jh-footer">Só essa vaga foi enviada — nada de navegação automática, nada mais foi lido.</div>
      `);
      setText('#jh-captured', `Vaga "${job.title}" salva no banco ✓`);
      if (job.contactEmail) {
        setText('#jh-email-value', job.contactEmail);
        panel.querySelector('#jh-copy-email').addEventListener('click', () => {
          navigator.clipboard.writeText(job.contactEmail);
        });
      }
      wireClose();
    });
  }

  fab.addEventListener('click', isLinkedIn ? runCapture : runAutofill);
})();

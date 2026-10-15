const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// f_WT (workplace type) usado pelo endpoint público (guest) de busca do LinkedIn: 1=presencial, 2=remoto, 3=híbrido.
const F_WT = { 'on-site': '1', remote: '2', hybrid: '3' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobIdFromUrn(urn) {
  const match = (urn || '').match(/jobPosting:(\d+)/);
  return match ? match[1] : null;
}

/**
 * Endpoint público (sem login) usado pela própria página de busca de vagas do LinkedIn
 * pra paginar resultados via scroll. Não é uma API oficial documentada — pode mudar ou
 * ser bloqueada sem aviso. Risco de ToS assumido explicitamente (Ally, 2026-09-22).
 */
async function fetchSearchPage(term, { location, workplaceTypes, start = 0 } = {}) {
  const params = new URLSearchParams({ keywords: term, start: String(start) });
  if (location) params.set('location', location);
  if (workplaceTypes?.length) params.set('f_WT', workplaceTypes.map((w) => F_WT[w]).join(','));

  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`LinkedIn search respondeu HTTP ${res.status} pra "${term}"`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cards = [];
  $('div.base-card').each((_, el) => {
    const $el = $(el);
    const id = jobIdFromUrn($el.attr('data-entity-urn'));
    if (!id) return;
    const href = $el.find('a.base-card__full-link').attr('href');
    const [city, state] = $el
      .find('.job-search-card__location')
      .text()
      .trim()
      .split(',')
      .map((s) => s.trim());
    cards.push({
      id,
      url: href ? href.split('?')[0] : null,
      title: $el.find('h3.base-search-card__title').text().replace(/\s+/g, ' ').trim(),
      company: $el.find('h4.base-search-card__subtitle').text().replace(/\s+/g, ' ').trim() || null,
      city: city || null,
      state: state === 'Brazil' || state === 'Brasil' ? null : state || null,
      published_date: $el.find('time.job-search-card__listdate').attr('datetime') || null,
    });
  });
  return cards;
}

async function fetchSearchTerm(term, opts, { maxPages = 1 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    try {
      const cards = await fetchSearchPage(term, { ...opts, start: page * 25 });
      all.push(...cards);
      if (cards.length < 25) break;
    } catch (err) {
      console.error(`[linkedin] busca falhou pra "${term}" (página ${page}):`, err.message);
      break;
    }
    await sleep(700);
  }
  return all;
}

// Contrato/modalidade não vêm estruturados na página pública — a descrição costuma
// dizer "Contrato: Efetivo." / "PJ" / "Presencial"/"Híbrido"/"Remoto" em texto livre.
function detectContractType(text) {
  const t = (text || '').toLowerCase();
  if (/\bpj\b|pessoa jur[íi]dica/.test(t)) return 'vacancy_legal_entity';
  if (/\bclt\b|efetivo/.test(t)) return 'effective';
  if (/est[áa]gio/.test(t)) return 'internship';
  if (/temporári[oa]/.test(t)) return 'temporary';
  return null;
}

function detectWorkplaceType(text) {
  const t = (text || '').toLowerCase();
  if (/\bh[íi]brido\b/.test(t)) return 'hybrid';
  if (/\bremot[oa]\b/.test(t)) return 'remote';
  if (/\bpresencial\b/.test(t)) return 'on-site';
  return null;
}

async function fetchJobDetail(card) {
  if (!card.url) return card;
  try {
    const res = await fetch(card.url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    if (!res.ok) return card;
    const html = await res.text();
    const $ = cheerio.load(html);
    const description = $('.show-more-less-html__markup').first().text().replace(/\s+/g, ' ').trim().slice(0, 4000);
    return {
      ...card,
      description: description || null,
      detected_contract_type: detectContractType(description),
      detected_workplace_type: detectWorkplaceType(description),
    };
  } catch (err) {
    console.error(`[linkedin] detalhe falhou pra "${card.url}":`, err.message);
    return card;
  }
}

/**
 * Roda uma busca (termos x localização/modalidade) e devolve jobs no formato da
 * tabela `jobs`. `assumedWorkplaceType` é usado quando a passada já restringe a
 * modalidade (ex: remote) — a descrição pode confirmar/sobrescrever quando detectada.
 */
async function scrapeLinkedInPass(terms, { location, workplaceTypes, assumedWorkplaceType, fetchDetails = true } = {}) {
  const byId = new Map();
  for (const term of terms) {
    const cards = await fetchSearchTerm(term, { location, workplaceTypes }, { maxPages: 1 });
    for (const card of cards) {
      if (!byId.has(card.id)) byId.set(card.id, { ...card, search_term: term });
    }
    await sleep(700);
  }

  const results = [];
  for (const card of byId.values()) {
    let full = card;
    if (fetchDetails) {
      full = await fetchJobDetail(card);
      await sleep(500);
    }
    results.push({
      id: `linkedin:${full.id}`,
      source: 'linkedin',
      title: full.title,
      company: full.company,
      contract_type: full.detected_contract_type || null,
      workplace_type: full.detected_workplace_type || assumedWorkplaceType || null,
      city: full.city,
      state: full.state,
      published_date: full.published_date,
      url: full.url,
      description: full.description || null,
      search_term: full.search_term,
    });
  }
  return results;
}

/**
 * `remoteLocation` cobre vagas remotas (qualquer lugar dentro dela, ex: "Brasil").
 * `localLocation` cobre presencial/híbrido restrito a uma cidade (ex: hybrid_city
 * do perfil) — presencial fica sujeito ao onsite_policy configurado, híbrido é
 * filtrado por cidade exata na elegibilidade (ver matching.js).
 */
async function scrapeLinkedIn(terms, { remoteLocation = 'Brasil', localLocation } = {}) {
  const passes = [scrapeLinkedInPass(terms, { location: remoteLocation, workplaceTypes: ['remote'], assumedWorkplaceType: 'remote' })];
  if (localLocation) {
    passes.push(scrapeLinkedInPass(terms, { location: localLocation, workplaceTypes: ['on-site', 'hybrid'] }));
  }
  const results = (await Promise.all(passes)).flat();
  const seen = new Set();
  return results.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

module.exports = { scrapeLinkedIn, scrapeLinkedInPass, detectContractType, detectWorkplaceType };

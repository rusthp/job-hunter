const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function slugify(term) {
  return term
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * "Há N dias"/"Hoje"/"Ontem" viram data aproximada (UTC, hora zerada).
 * Datas absolutas (dd/mm/aaaa) são parseadas direto. Formato desconhecido vira null.
 */
function parsePublishedDate(text) {
  const t = (text || '').trim().toLowerCase();
  const now = new Date();
  if (t === 'hoje') return now.toISOString();
  if (t === 'ontem') {
    now.setUTCDate(now.getUTCDate() - 1);
    return now.toISOString();
  }
  const relMatch = t.match(/há (\d+) dias?/);
  if (relMatch) {
    now.setUTCDate(now.getUTCDate() - Number(relMatch[1]));
    return now.toISOString();
  }
  const absMatch = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (absMatch) {
    const [, d, m, y] = absMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).toISOString();
  }
  return null;
}

const UF_TO_STATE = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará',
  PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

function parseLocal(text) {
  const firstLine = (text || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const match = firstLine.match(/^(.+?)\s*\/\s*([A-Z]{2})$/);
  if (match) return { city: match[1].trim(), state: UF_TO_STATE[match[2].trim()] || match[2].trim() };
  return { city: null, state: null };
}

/**
 * Vagas.com não marca contrato/modalidade no card da vaga — só nos filtros
 * (facets) da página. Por isso cada busca roda em passadas separadas por
 * facet (CLT, Temporário, Empresa+Home Office) pra saber o tipo com
 * confiança, e uma passada ampla sem filtro pra cobertura geral (sem marcar
 * contrato/modalidade quando não é possível confirmar).
 */
async function scrapeVagasComTerm(term, { contractFacet, workplaceFacet, contractType, workplaceType } = {}) {
  const params = new URLSearchParams();
  if (contractFacet) params.append('mo[]', contractFacet);
  if (workplaceFacet) params.append('m[]', workplaceFacet);
  const qs = params.toString();
  const url = `https://www.vagas.com.br/vagas-de-${slugify(term)}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Vagas.com respondeu HTTP ${res.status} para termo "${term}"`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const jobs = [];
  $('li.vaga').each((_, el) => {
    const $el = $(el);
    const href = $el.find('h2.cargo a').attr('href');
    const idMatch = href?.match(/\/vagas\/v(\d+)\//);
    if (!idMatch) return;

    const { city, state } = parseLocal($el.find('.vaga-local').text());

    jobs.push({
      id: `vagascom:${idMatch[1]}`,
      source: 'vagascom',
      title: $el.find('h2.cargo a').text().replace(/\s+/g, ' ').trim(),
      company: $el.find('.emprVaga').text().trim() || null,
      contract_type: contractType || null,
      workplace_type: workplaceType || null,
      city,
      state,
      published_date: parsePublishedDate($el.find('.data-publicacao').text()),
      url: `https://www.vagas.com.br${href}`,
      description: $el.find('.detalhes p').text().replace(/\s+/g, ' ').trim().slice(0, 4000),
      search_term: term,
    });
  });

  return jobs;
}

const PASSES = [
  {}, // ampla, sem marcar contrato/modalidade
  { contractFacet: 'Regime CLT', contractType: 'effective' },
  { contractFacet: 'Temporário', contractType: 'temporary' },
  { workplaceFacet: 'Empresa e Home Office', workplaceType: 'hybrid' },
];

async function scrapeVagasCom(terms) {
  const byId = new Map();

  for (const term of terms) {
    for (const pass of PASSES) {
      try {
        const jobs = await scrapeVagasComTerm(term, pass);
        for (const job of jobs) {
          const existing = byId.get(job.id);
          if (!existing) {
            byId.set(job.id, job);
          } else {
            // preenche campos que a passada anterior não sabia confirmar
            if (!existing.contract_type && job.contract_type) existing.contract_type = job.contract_type;
            if (!existing.workplace_type && job.workplace_type) existing.workplace_type = job.workplace_type;
          }
        }
      } catch (err) {
        console.error(`[vagascom] falhou pra termo "${term}" (passe ${JSON.stringify(pass)}):`, err.message);
      }
    }
  }

  return [...byId.values()];
}

module.exports = { scrapeVagasCom, slugify, parsePublishedDate };

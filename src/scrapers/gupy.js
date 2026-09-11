const crypto = require('crypto');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function jobId(source, remoteId) {
  return `${source}:${remoteId}`;
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Gupy's job-search page is server-rendered: the first page of results
 * (up to `pagination.limit`, currently 12) comes embedded in __NEXT_DATA__.
 * There is no public paginated API for further pages (client fetches more
 * via an internal endpoint not reachable without a browser session), so
 * this scraper covers page 1 per search term. Broader coverage comes from
 * running multiple search terms, not from paging one term.
 */
async function scrapeGupyTerm(term, workplaceTypes) {
  const params = `term=${encodeURIComponent(term)}` + (workplaceTypes?.length ? `&workplaceTypes=${workplaceTypes.join(',')}` : '');
  const url = `https://portal.gupy.io/job-search/${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Gupy respondeu HTTP ${res.status} para termo "${term}"`);
  const html = await res.text();
  const data = extractNextData(html);
  const list = data?.props?.pageProps?.initialJobList;
  if (!list) return [];

  return list.data.map((job) => ({
    id: jobId('gupy', job.id),
    source: 'gupy',
    title: job.name,
    company: job.careerPageName || null,
    contract_type: (job.type || '').replace('vacancy_type_', '') || null,
    workplace_type: job.workplaceType || null,
    city: job.city || null,
    state: job.state || null,
    published_date: job.publishedDate || null,
    url: job.jobUrl,
    description: (job.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000),
    search_term: term,
  }));
}

/**
 * Cada termo só traz 12 resultados (limite do SSR), e a mistura natural é
 * majoritariamente presencial — vagas remoto/híbrido existem mas ficam
 * afogadas. Por isso, além da busca ampla, roda uma segunda passada por
 * termo filtrando explicitamente workplaceTypes=remote,hybrid (Gupy aceita
 * esse filtro no servidor, testado e confirmado), garantindo que essas
 * vagas apareçam mesmo quando não estão entre as 12 primeiras da busca ampla.
 */
async function scrapeGupy(terms, { includeRemoteHybridPass = true } = {}) {
  const results = [];
  for (const term of terms) {
    try {
      results.push(...(await scrapeGupyTerm(term)));
    } catch (err) {
      console.error(`[gupy] falhou pra termo "${term}":`, err.message);
    }
    if (includeRemoteHybridPass) {
      try {
        results.push(...(await scrapeGupyTerm(term, ['remote', 'hybrid'])));
      } catch (err) {
        console.error(`[gupy] falhou pra termo "${term}" (remoto/híbrido):`, err.message);
      }
    }
  }
  // dedupe by id (same job can match multiple search terms/passes)
  const seen = new Set();
  return results.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

module.exports = { scrapeGupy, jobId, extractNextData };

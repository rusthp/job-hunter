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
async function scrapeGupyTerm(term) {
  const url = `https://portal.gupy.io/job-search/term=${encodeURIComponent(term)}`;
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

async function scrapeGupy(terms) {
  const results = [];
  for (const term of terms) {
    try {
      const jobs = await scrapeGupyTerm(term);
      results.push(...jobs);
    } catch (err) {
      console.error(`[gupy] falhou pra termo "${term}":`, err.message);
    }
  }
  // dedupe by id (same job can match multiple search terms)
  const seen = new Set();
  return results.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

module.exports = { scrapeGupy, jobId, extractNextData };

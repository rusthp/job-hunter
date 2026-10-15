const { scrapeLinkedIn } = require('./scrapers/linkedin');
const { upsertJobs, listProfiles, getSettingsByProfileId } = require('./db/db');

/**
 * Separado do scrape.js (Gupy/Vagas.com, 3x/dia) porque o endpoint do LinkedIn
 * não é oficial — rodar com menos frequência (1x/dia, ver crontab) reduz o
 * risco de bloqueio. Corre por perfil (não união de termos) porque a busca do
 * LinkedIn precisa de localização, e cada perfil pode ter uma hybrid_city diferente.
 */
async function main() {
  const argProfileIdx = process.argv.indexOf('--profile');
  const profiles = argProfileIdx !== -1 && process.argv[argProfileIdx + 1]
    ? listProfiles().filter((p) => p.id === Number(process.argv[argProfileIdx + 1]))
    : listProfiles();

  for (const p of profiles) {
    const settings = getSettingsByProfileId(p.id);
    const terms = settings?.search_terms?.length ? settings.search_terms : [];
    if (!terms.length) {
      console.log(`[linkedin] perfil "${p.name}" sem termos de busca, pulando.`);
      continue;
    }
    console.log(`[linkedin] perfil "${p.name}": ${terms.length} termo(s), remoto=Brasil, local=${settings.hybrid_city || '(nenhuma)'}`);
    const jobs = await scrapeLinkedIn(terms, { remoteLocation: 'Brasil', localLocation: settings.hybrid_city || undefined });
    console.log(`[linkedin] perfil "${p.name}": ${jobs.length} vaga(s) coletada(s).`);
    upsertJobs(jobs);
  }
  console.log('[linkedin] concluído, salvo em jobs.db.');
}

main().catch((err) => {
  console.error('[linkedin] erro na coleta:', err);
  process.exit(1);
});

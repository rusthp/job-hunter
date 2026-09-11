const { scrapeGupy } = require('./scrapers/gupy');
const { scrapeVagasCom } = require('./scrapers/vagascom');
const { upsertJobs, listProfiles, getSettingsByProfileId } = require('./db/db');

// Fallback quando nenhum perfil tem termos salvos ainda: RH, Financeiro
// e Gestão de empresas — nada de vagas de tecnologia/dev.
const DEFAULT_TERMS = [
  'recursos humanos',
  'analista de rh',
  'departamento pessoal',
  'recrutamento e seleção',
  'business partner rh',
  'analista financeiro',
  'assistente financeiro',
  'controladoria',
  'contas a pagar',
  'contas a receber',
  'gerente financeiro',
  'gestão de empresas',
  'gerente administrativo',
  'coordenador administrativo',
  'gestão de pessoas',
  'planejamento estratégico',
];

function collectSearchTerms() {
  const profiles = listProfiles();
  const terms = new Set();
  for (const p of profiles) {
    const settings = getSettingsByProfileId(p.id);
    for (const t of settings?.search_terms || []) terms.add(t);
  }
  return terms.size ? [...terms] : DEFAULT_TERMS;
}

async function main() {
  const argTerms = process.argv.slice(2);
  // Roda pra um perfil específico (--profile 2) ou pra união dos termos de todos os perfis.
  const profileFlagIdx = argTerms.indexOf('--profile');
  let searchTerms;
  if (profileFlagIdx !== -1 && argTerms[profileFlagIdx + 1]) {
    const settings = getSettingsByProfileId(Number(argTerms[profileFlagIdx + 1]));
    searchTerms = settings?.search_terms?.length ? settings.search_terms : DEFAULT_TERMS;
  } else if (argTerms.length) {
    searchTerms = argTerms;
  } else {
    searchTerms = collectSearchTerms();
  }

  console.log(`Coletando vagas para ${searchTerms.length} termo(s): Gupy + Vagas.com`);

  const [gupyJobs, vagasComJobs] = await Promise.all([
    scrapeGupy(searchTerms),
    scrapeVagasCom(searchTerms),
  ]);

  console.log(`Gupy: ${gupyJobs.length} vagas. Vagas.com: ${vagasComJobs.length} vagas.`);

  upsertJobs([...gupyJobs, ...vagasComJobs]);
  console.log('Salvas no banco (jobs.db).');
}

main().catch((err) => {
  console.error('Erro na coleta:', err);
  process.exit(1);
});

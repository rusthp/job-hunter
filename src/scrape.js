const { scrapeGupy } = require('./scrapers/gupy');
const { upsertJobs, getSettings } = require('./db/db');

// Fallback quando Configurações ainda não tem termos salvos: RH, Financeiro
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

async function main() {
  const argTerms = process.argv.slice(2);
  const settingsTerms = getSettings().search_terms;
  const searchTerms = argTerms.length ? argTerms : settingsTerms.length ? settingsTerms : DEFAULT_TERMS;

  console.log(`Coletando vagas Gupy para ${searchTerms.length} termo(s)...`);
  const jobs = await scrapeGupy(searchTerms);
  console.log(`Coletadas ${jobs.length} vagas únicas.`);

  upsertJobs(jobs);
  console.log('Salvas no banco (jobs.db).');
}

main().catch((err) => {
  console.error('Erro na coleta:', err);
  process.exit(1);
});

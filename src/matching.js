// Gupy não expõe nível de senioridade como campo estruturado — infere a partir do título,
// usando o vocabulário comum em vagas de RH/Financeiro/Gestão no Brasil.
const SENIORITY_KEYWORDS = [
  { key: 'gerencial', label: 'Gerencial/Diretoria', words: ['gerente', 'gestor(a)', 'diretor', 'diretora', 'head de', 'superintendente'] },
  { key: 'senior', label: 'Sênior', words: ['sênior', 'senior', ' sr ', ' sr.', 'especialista', 'coordenador', 'coordenadora', 'supervisor', 'supervisora'] },
  { key: 'pleno', label: 'Pleno', words: ['pleno', 'analista'] },
  { key: 'junior', label: 'Júnior', words: ['júnior', 'junior', ' jr ', ' jr.', 'assistente', 'auxiliar'] },
  { key: 'estagio', label: 'Estágio', words: ['estagiário', 'estagiária', 'estágio', 'jovem aprendiz', 'aprendiz'] },
];

function inferSeniority(title) {
  const t = ` ${(title || '').toLowerCase()} `;
  for (const level of SENIORITY_KEYWORDS) {
    if (level.words.some((w) => t.includes(w))) return level.key;
  }
  return null;
}

function seniorityLabel(key) {
  return SENIORITY_KEYWORDS.find((l) => l.key === key)?.label || 'Não identificado';
}

/**
 * Match simples por sobreposição de palavras-chave entre o perfil (skills +
 * skills obrigatórias) e o texto da vaga (título + descrição). Skills
 * obrigatórias que não aparecem zeram o match. Não é semântico — é
 * contagem de termos, suficiente pra priorizar a lista, não pra decidir sozinho.
 */
function computeMatch(job, profile, settings) {
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  const skills = (profile?.skills || []).map((s) => s.toLowerCase());
  const required = (settings?.required_skills || []).map((s) => s.toLowerCase());

  if (required.length && !required.every((r) => text.includes(r))) {
    return 0;
  }
  if (!skills.length) return null;

  const hits = skills.filter((s) => text.includes(s)).length;
  return Math.round((hits / skills.length) * 100);
}

/**
 * Gupy não expõe salário estruturado. Extrai valores em R$ mencionados na
 * descrição (quando existem) pra comparar com o piso configurado. Se a vaga
 * não menciona valor nenhum, não dá pra confirmar nem violar — vira aviso,
 * não exclusão (não temos como saber o real salário sem abrir a vaga).
 */
function extractSalaryMentions(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/g)];
  return matches
    .map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Avalia uma vaga contra a política de busca configurada. Retorna
 * { excluded, warnings } — excluded=true tira a vaga da listagem padrão,
 * warnings são mostrados mas não escondem a vaga (evita falso positivo
 * de matching de texto decidir sozinho por exclusão).
 */
function computeEligibility(job, settings) {
  const warnings = [];
  let excluded = false;

  if (settings.contract_filter?.length && !settings.contract_filter.includes(job.contract_type)) {
    excluded = true;
  }

  // on-site é governado só por onsite_policy (abaixo) — não pelo workplace_filter,
  // pra permitir "não indicar por padrão, mas avaliar exceção" em vez de exclusão dura.
  if (
    job.workplace_type !== 'on-site' &&
    settings.workplace_filter?.length &&
    !settings.workplace_filter.includes(job.workplace_type)
  ) {
    excluded = true;
  }

  if (job.workplace_type === 'hybrid' && settings.hybrid_city) {
    if ((job.city || '').toLowerCase() !== settings.hybrid_city.toLowerCase()) {
      excluded = true;
    }
  }

  if (job.workplace_type === 'on-site') {
    if (settings.onsite_policy === 'hide') excluded = true;
    else if (settings.onsite_policy === 'flag') warnings.push('Presencial — fora da preferência, avalie com cuidado');
  }

  const seniorityKey = inferSeniority(job.title);
  if (settings.seniority_filter?.length && seniorityKey && !settings.seniority_filter.includes(seniorityKey)) {
    excluded = true;
  }

  if (settings.min_salary) {
    const mentions = extractSalaryMentions(job.description);
    if (mentions.length) {
      const lowest = Math.min(...mentions);
      if (lowest < settings.min_salary) excluded = true;
    } else {
      warnings.push('Salário não informado na vaga — confira antes de aplicar');
    }
  }

  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  for (const kw of settings.exclude_keywords || []) {
    if (kw && text.includes(kw.toLowerCase())) {
      warnings.push(`Contém termo a evitar: "${kw}"`);
    }
  }

  return { excluded, warnings };
}

module.exports = { inferSeniority, seniorityLabel, computeMatch, computeEligibility, extractSalaryMentions, SENIORITY_KEYWORDS };

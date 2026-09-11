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

module.exports = { inferSeniority, seniorityLabel, computeMatch, SENIORITY_KEYWORDS };

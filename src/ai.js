// Chamadas de IA usam modelo free do OpenRouter (regra do projeto: Claude é
// reservado pra tarefas críticas; extração de texto estruturado não é uma delas).
// Fallback invisível pro DeepSeek se o OpenRouter falhar (rate-limit, timeout, etc).
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL_TASKS || 'qwen/qwen3-next-80b-a3b-instruct:free';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function callOpenRouter(systemPrompt, userContent) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY não configurada');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter não retornou conteúdo');
  return content;
}

async function callDeepSeek(systemPrompt, userContent) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY não configurada');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek não retornou conteúdo');
  return content;
}

function extractJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Resposta da IA não é JSON válido: ' + content.slice(0, 200));
  }
}

async function callWithFallback(systemPrompt, userContent) {
  try {
    const content = await callOpenRouter(systemPrompt, userContent);
    return extractJson(content);
  } catch (primaryErr) {
    console.warn('[ai] OpenRouter falhou, caindo pro DeepSeek:', primaryErr.message);
    try {
      const content = await callDeepSeek(systemPrompt, userContent);
      return extractJson(content);
    } catch (fallbackErr) {
      console.error('[ai] DeepSeek também falhou:', fallbackErr.message);
      throw new Error(`Ambos provedores de IA falharam. OpenRouter: ${primaryErr.message} | DeepSeek: ${fallbackErr.message}`);
    }
  }
}

const RESUME_SYSTEM_PROMPT = `Você extrai dados estruturados de um currículo em português (área de RH, Financeiro ou Gestão de empresas).
Responda APENAS com um JSON no formato:
{
  "headline": "cargo/área em uma linha, ex: 'Analista de RH | Recrutamento e Seleção'",
  "about": "resumo de 2-4 frases da experiência e objetivo profissional",
  "email": "email encontrado ou null",
  "phone": "telefone encontrado ou null",
  "linkedin_url": "url do linkedin encontrada ou null",
  "skills": ["lista de 5 a 15 skills/palavras-chave curtas, ex: 'folha de pagamento', 'recrutamento e seleção', 'excel avançado', 'sap', 'conciliação bancária'"]
}
Não invente dados que não estão no texto. Se não encontrar um campo, use null (ou lista vazia para skills).`;

async function extractProfileFromResume(resumeText) {
  return callWithFallback(RESUME_SYSTEM_PROMPT, resumeText.slice(0, 12000));
}

const PROMPT_FILTER_SYSTEM_PROMPT = `Você converte uma busca em linguagem natural (português) sobre vagas de emprego
(área de RH, Financeiro ou Gestão de empresas no Brasil) em filtros estruturados.
Responda APENAS com um JSON no formato:
{
  "keywords": "termos livres pra buscar no título/empresa, ou null",
  "contract_type": "um de: effective, temporary, internship, apprentice, vacancy_legal_entity — ou null",
  "workplace_type": "um de: remote, hybrid, on-site — ou null",
  "seniority": "um de: estagio, junior, pleno, senior, gerencial — ou null",
  "state": "nome do estado brasileiro por extenso (ex: 'São Paulo') se mencionado, ou null"
}
"effective" = CLT/efetivo. "vacancy_legal_entity" = PJ. Se o usuário não mencionar um filtro, use null nele.`;

async function parseJobPrompt(prompt) {
  return callWithFallback(PROMPT_FILTER_SYSTEM_PROMPT, prompt);
}

module.exports = { extractProfileFromResume, parseJobPrompt };

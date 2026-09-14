require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const path = require('path');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const {
  db,
  upsertJobs,
  listProfiles,
  createProfile,
  getProfileById,
  saveProfileById,
  getSettingsByProfileId,
  saveSettingsByProfileId,
  markJobApplied,
  unmarkJobApplied,
  getAppliedJobIds,
} = require('./db/db');
const crypto = require('crypto');
const { inferSeniority, seniorityLabel, computeMatch, computeEligibility, SENIORITY_KEYWORDS } = require('./matching');
const { extractProfileFromResume, parseJobPrompt, parsePreferences, generateCoverLetter } = require('./ai');

const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const APPLICATION_TYPE_LABELS = {
  email: '🟢 E-mail',
  whatsapp: '🟢 WhatsApp',
  formulario_direto: '🟢 Formulário direto',
  candidatura_rapida: '🟡 Candidatura rápida',
  cadastro_plataforma: '🟠 Cadastro em plataforma',
  processo_externo: '🔴 Processo externo',
};

const CONTRACT_LABELS = {
  effective: 'Efetivo (CLT)',
  temporary: 'Temporário',
  internship: 'Estágio',
  apprentice: 'Aprendiz',
  associate: 'Associado',
  vacancy_legal_entity: 'PJ',
  parter: 'Parceiro',
};

const WORKPLACE_LABELS = {
  'on-site': 'Presencial',
  hybrid: 'Híbrido',
  remote: 'Remoto',
};

function requireProfile(req, res) {
  const profileId = Number(req.query.profile_id || req.params.id || req.body.profile_id);
  if (!profileId) {
    res.status(400).json({ error: 'profile_id é obrigatório.' });
    return null;
  }
  const profile = getProfileById(profileId);
  if (!profile) {
    res.status(404).json({ error: 'Perfil não encontrado.' });
    return null;
  }
  return profileId;
}

app.get('/api/profiles', (req, res) => res.json(listProfiles()));

app.post('/api/profiles', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do perfil é obrigatório.' });
  res.json(createProfile(name.trim()));
});

app.get('/api/profiles/:id', (req, res) => {
  const profile = getProfileById(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Perfil não encontrado.' });
  res.json(profile);
});

app.put('/api/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfileById(id)) return res.status(404).json({ error: 'Perfil não encontrado.' });
  res.json(saveProfileById(id, req.body));
});

app.get('/api/profiles/:id/settings', (req, res) => {
  const id = Number(req.params.id);
  const settings = getSettingsByProfileId(id);
  if (!settings) return res.status(404).json({ error: 'Perfil não encontrado.' });
  res.json(settings);
});

app.put('/api/profiles/:id/settings', (req, res) => {
  const id = Number(req.params.id);
  if (!getSettingsByProfileId(id)) return res.status(404).json({ error: 'Perfil não encontrado.' });
  res.json(saveSettingsByProfileId(id, req.body));
});

app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM jobs').get().c;
  const byContract = db
    .prepare('SELECT contract_type, COUNT(*) c FROM jobs GROUP BY contract_type ORDER BY c DESC')
    .all()
    .map((r) => ({ key: r.contract_type, label: CONTRACT_LABELS[r.contract_type] || r.contract_type || 'Não informado', count: r.c }));
  const byWorkplace = db
    .prepare('SELECT workplace_type, COUNT(*) c FROM jobs GROUP BY workplace_type ORDER BY c DESC')
    .all()
    .map((r) => ({ key: r.workplace_type, label: WORKPLACE_LABELS[r.workplace_type] || r.workplace_type || 'Não informado', count: r.c }));
  const byState = db
    .prepare("SELECT state, COUNT(*) c FROM jobs WHERE state != '' GROUP BY state ORDER BY c DESC LIMIT 15")
    .all();
  const lastCollected = db.prepare('SELECT MAX(collected_at) t FROM jobs').get().t;

  const titles = db.prepare('SELECT title FROM jobs').all();
  const senCounts = {};
  for (const { title } of titles) {
    const key = inferSeniority(title) || 'nao_identificado';
    senCounts[key] = (senCounts[key] || 0) + 1;
  }
  const bySeniority = Object.entries(senCounts)
    .map(([key, count]) => ({ key, label: key === 'nao_identificado' ? 'Não identificado' : seniorityLabel(key), count }))
    .sort((a, b) => b.count - a.count);

  res.json({ total, byContract, byWorkplace, byState, bySeniority, lastCollected });
});

app.get('/api/jobs', (req, res) => {
  const profileId = requireProfile(req, res);
  if (!profileId) return;

  const { contract_type, workplace_type, state, seniority, q, show_all, applied, page, page_size } = req.query;
  const clauses = [];
  const params = {};
  if (contract_type) {
    clauses.push('contract_type = @contract_type');
    params.contract_type = contract_type;
  }
  if (workplace_type) {
    clauses.push('workplace_type = @workplace_type');
    params.workplace_type = workplace_type;
  }
  if (state) {
    clauses.push('state = @state');
    params.state = state;
  }
  if (q) {
    clauses.push('(title LIKE @q OR company LIKE @q)');
    params.q = `%${q}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const profile = getProfileById(profileId);
  const settings = getSettingsByProfileId(profileId);
  const appliedJobIds = getAppliedJobIds();

  let rows = db
    .prepare(
      `SELECT id, source, title, company, contract_type, workplace_type, city, state, published_date, url, description, search_term, application_type
       FROM jobs ${where} ORDER BY published_date DESC`
    )
    .all(params)
    .map((r) => {
      const seniorityKey = inferSeniority(r.title);
      const { excluded, warnings } = computeEligibility(r, settings);
      return {
        ...r,
        description: undefined,
        contract_label: CONTRACT_LABELS[r.contract_type] || r.contract_type || 'Não informado',
        workplace_label: WORKPLACE_LABELS[r.workplace_type] || r.workplace_type || 'Não informado',
        seniority: seniorityKey,
        seniority_label: seniorityKey ? seniorityLabel(seniorityKey) : 'Não identificado',
        application_type_label: APPLICATION_TYPE_LABELS[r.application_type] || null,
        match: computeMatch(r, profile, settings),
        excluded_by_policy: excluded,
        warnings,
        applied: appliedJobIds.has(r.id),
      };
    });

  if (seniority) rows = rows.filter((r) => r.seniority === seniority);

  // Aba "Enviadas" ignora a política de elegibilidade — uma candidatura já enviada
  // continua relevante mesmo que a vaga tenha sido marcada fora da política depois.
  if (applied === '1') {
    rows = rows.filter((r) => r.applied);
  } else if (!show_all) {
    rows = rows.filter((r) => !r.excluded_by_policy);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(Math.max(Number(page_size) || 50, 1), 1000);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (pageNum - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);

  res.json({ items, total, page: pageNum, page_size: pageSize, total_pages: totalPages });
});

app.get('/api/timeseries', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  const rows = db
    .prepare(
      `SELECT date(collected_at) d, COUNT(*) c FROM jobs
       WHERE date(collected_at) >= date('now', '-' || @days || ' days')
       GROUP BY date(collected_at)`
    )
    .all({ days });
  const byDate = Object.fromEntries(rows.map((r) => [r.d, r.c]));

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: byDate[key] || 0 });
  }
  res.json(series);
});

app.get('/api/seniority-levels', (req, res) => {
  res.json(SENIORITY_KEYWORDS.map(({ key, label }) => ({ key, label })));
});

app.get('/api/autofill', async (req, res) => {
  const profileId = Number(req.query.profile_id);
  const rawUrl = req.query.url;
  if (!profileId || !rawUrl) return res.status(400).json({ error: 'profile_id e url são obrigatórios.' });

  const profile = getProfileById(profileId);
  if (!profile) return res.status(404).json({ error: 'Perfil não encontrado.' });

  const baseUrl = rawUrl.split('?')[0];
  const job = db.prepare('SELECT * FROM jobs WHERE url LIKE ? LIMIT 1').get(`${baseUrl}%`);

  const base = {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    linkedin_url: profile.linkedin_url,
    headline: profile.headline,
    about: profile.about,
    skills: profile.skills,
  };

  if (!job) {
    return res.json({ ...base, job_matched: false, cover_letter: null });
  }

  try {
    const coverLetter = await generateCoverLetter(profile, job);
    res.json({ ...base, job_matched: true, job_title: job.title, cover_letter: coverLetter });
  } catch (err) {
    console.error('[autofill]', err);
    res.json({ ...base, job_matched: true, job_title: job.title, cover_letter: null, cover_letter_error: err.message });
  }
});

app.post('/api/profile/import-resume', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  try {
    let text;
    const { mimetype, buffer, originalname } = req.file;
    if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
      const parser = new PDFParse({ data: buffer });
      text = (await parser.getText()).text;
      await parser.destroy();
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      originalname.toLowerCase().endsWith('.docx')
    ) {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (mimetype.startsWith('text/') || originalname.toLowerCase().endsWith('.txt')) {
      text = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Formato não suportado. Envie PDF, DOCX ou TXT.' });
    }

    if (!text || text.trim().length < 30) {
      return res.status(422).json({ error: 'Não consegui extrair texto legível do arquivo.' });
    }

    const extracted = await extractProfileFromResume(text);
    res.json(extracted);
  } catch (err) {
    console.error('[import-resume]', err);
    res.status(500).json({ error: err.message });
  }
});

const APPLICATION_TYPES = new Set(['email', 'whatsapp', 'formulario_direto', 'candidatura_rapida', 'cadastro_plataforma', 'processo_externo']);

app.post('/api/jobs/capture', (req, res) => {
  const { title, company, city, state, url, description, contract_type, workplace_type, published_date, contactEmail, application_type } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'title e url são obrigatórios.' });

  const id = 'linkedin:' + crypto.createHash('sha1').update(url.split('?')[0]).digest('hex').slice(0, 16);
  const descriptionWithEmail = contactEmail
    ? `[E-mail de contato encontrado na vaga: ${contactEmail}]\n\n${description || ''}`
    : (description || '');

  upsertJobs([{
    id,
    source: 'linkedin',
    title,
    company: company || null,
    contract_type: contract_type || null,
    workplace_type: workplace_type || null,
    city: city || null,
    state: state || null,
    published_date: published_date || new Date().toISOString(),
    url,
    description: descriptionWithEmail.slice(0, 4000),
    search_term: 'captura manual (extensão)',
    application_type: APPLICATION_TYPES.has(application_type) ? application_type : null,
  }]);

  res.json({ ok: true, id, contactEmail: contactEmail || null });
});

app.put('/api/jobs/:id/application-type', (req, res) => {
  const jobId = req.params.id;
  const { application_type } = req.body;
  if (application_type !== null && !APPLICATION_TYPES.has(application_type)) {
    return res.status(400).json({ error: 'application_type inválido.' });
  }
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Vaga não encontrada.' });
  db.prepare('UPDATE jobs SET application_type = ? WHERE id = ?').run(application_type, jobId);
  res.json({ ok: true, id: jobId, application_type });
});

app.post('/api/jobs/:id/mark-applied', (req, res) => {
  const jobId = req.params.id;
  const profileId = Number(req.body.profile_id) || null;
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Vaga não encontrada.' });
  res.json(markJobApplied(jobId, profileId));
});

app.delete('/api/jobs/:id/mark-applied', (req, res) => {
  unmarkJobApplied(req.params.id);
  res.json({ ok: true });
});

app.post('/api/settings/import-preferences', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Texto vazio.' });

  try {
    const parsed = await parsePreferences(text);
    res.json(parsed);
  } catch (err) {
    console.error('[import-preferences]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs/parse-prompt', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt vazio.' });

  try {
    const filters = await parseJobPrompt(prompt);
    res.json(filters);
  } catch (err) {
    console.error('[parse-prompt]', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Dashboard em http://${HOST}:${PORT}`));

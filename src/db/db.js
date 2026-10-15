const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', '..', 'jobs.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  contract_type TEXT,
  workplace_type TEXT,
  city TEXT,
  state TEXT,
  published_date TEXT,
  url TEXT NOT NULL,
  description TEXT,
  search_term TEXT,
  collected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_contract_type ON jobs(contract_type);
CREATE INDEX IF NOT EXISTS idx_jobs_workplace_type ON jobs(workplace_type);
`);

// application_type é opcional e foi adicionado depois — better-sqlite3 não
// suporta "ADD COLUMN IF NOT EXISTS", então checa antes de rodar o ALTER.
const jobsColumns = db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name);
if (!jobsColumns.includes('application_type')) {
  db.exec("ALTER TABLE jobs ADD COLUMN application_type TEXT");
}

db.exec(`

CREATE TABLE IF NOT EXISTS job_applications (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- profile/settings (singular) são o schema antigo, de perfil único.
-- profiles/profile_settings (plural) suportam múltiplos perfis (ex: um perfil por pessoa).
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  headline TEXT,
  about TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  salary_expectation REAL,
  currency TEXT DEFAULT 'BRL',
  skills TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  search_terms TEXT NOT NULL DEFAULT '[]',
  required_skills TEXT NOT NULL DEFAULT '[]',
  seniority_filter TEXT NOT NULL DEFAULT '[]',
  workplace_filter TEXT NOT NULL DEFAULT '[]',
  contract_filter TEXT NOT NULL DEFAULT '[]',
  daily_send_limit INTEGER NOT NULL DEFAULT 5,
  min_salary REAL,
  hybrid_city TEXT,
  onsite_policy TEXT NOT NULL DEFAULT 'flag',
  exclude_keywords TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  headline TEXT,
  about TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  salary_expectation REAL,
  currency TEXT DEFAULT 'BRL',
  skills TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS profile_settings (
  profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  search_terms TEXT NOT NULL DEFAULT '[]',
  required_skills TEXT NOT NULL DEFAULT '[]',
  seniority_filter TEXT NOT NULL DEFAULT '[]',
  workplace_filter TEXT NOT NULL DEFAULT '[]',
  contract_filter TEXT NOT NULL DEFAULT '[]',
  daily_send_limit INTEGER NOT NULL DEFAULT 5,
  min_salary REAL,
  hybrid_city TEXT,
  onsite_policy TEXT NOT NULL DEFAULT 'flag',
  exclude_keywords TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);
`);

const DEFAULT_SEARCH_TERMS = [
  'recursos humanos', 'analista de rh', 'departamento pessoal', 'recrutamento e seleção',
  'business partner rh', 'analista financeiro', 'assistente financeiro', 'controladoria',
  'contas a pagar', 'contas a receber', 'gerente financeiro', 'gestão de empresas',
  'gerente administrativo', 'coordenador administrativo', 'gestão de pessoas', 'planejamento estratégico',
];

// Migração única: se profiles estiver vazia e existir o perfil antigo (id=1)
// com dado real, vira o primeiro perfil da lista nomeado "Ally" — não perde nada.
function migrateLegacyProfileIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) c FROM profiles').get().c;
  if (count > 0) return;

  const legacyProfile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  const legacySettings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const hasRealData = legacyProfile && (legacyProfile.headline || legacyProfile.email || (legacyProfile.skills && legacyProfile.skills !== '[]'));

  const name = 'Ally';
  const insertProfile = db.prepare(
    `INSERT INTO profiles (name, headline, about, email, phone, linkedin_url, salary_expectation, currency, skills, updated_at)
     VALUES (@name, @headline, @about, @email, @phone, @linkedin_url, @salary_expectation, @currency, @skills, @updated_at)`
  );
  const info = insertProfile.run({
    name,
    headline: hasRealData ? legacyProfile.headline : null,
    about: hasRealData ? legacyProfile.about : null,
    email: hasRealData ? legacyProfile.email : null,
    phone: hasRealData ? legacyProfile.phone : null,
    linkedin_url: hasRealData ? legacyProfile.linkedin_url : null,
    salary_expectation: hasRealData ? legacyProfile.salary_expectation : null,
    currency: (hasRealData && legacyProfile.currency) || 'BRL',
    skills: hasRealData ? legacyProfile.skills : '[]',
    updated_at: hasRealData ? legacyProfile.updated_at : null,
  });

  const profileId = info.lastInsertRowid;
  const s = legacySettings || {};
  db.prepare(
    `INSERT INTO profile_settings (profile_id, search_terms, required_skills, seniority_filter, workplace_filter,
     contract_filter, daily_send_limit, min_salary, hybrid_city, onsite_policy, exclude_keywords, updated_at)
     VALUES (@profile_id, @search_terms, @required_skills, @seniority_filter, @workplace_filter,
     @contract_filter, @daily_send_limit, @min_salary, @hybrid_city, @onsite_policy, @exclude_keywords, @updated_at)`
  ).run({
    profile_id: profileId,
    search_terms: s.search_terms || JSON.stringify(DEFAULT_SEARCH_TERMS),
    required_skills: s.required_skills || '[]',
    seniority_filter: s.seniority_filter || '[]',
    workplace_filter: s.workplace_filter || '[]',
    contract_filter: s.contract_filter || '[]',
    daily_send_limit: s.daily_send_limit ?? 5,
    min_salary: s.min_salary ?? null,
    hybrid_city: s.hybrid_city ?? null,
    onsite_policy: s.onsite_policy || 'flag',
    exclude_keywords: s.exclude_keywords || '[]',
    updated_at: s.updated_at ?? null,
  });
}

migrateLegacyProfileIfNeeded();

const upsertStmt = db.prepare(`
INSERT INTO jobs (id, source, title, company, contract_type, workplace_type, city, state, published_date, url, description, search_term, application_type)
VALUES (@id, @source, @title, @company, @contract_type, @workplace_type, @city, @state, @published_date, @url, @description, @search_term, @application_type)
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title,
  company=excluded.company,
  contract_type=excluded.contract_type,
  workplace_type=excluded.workplace_type,
  city=excluded.city,
  state=excluded.state,
  published_date=excluded.published_date,
  url=excluded.url,
  description=excluded.description,
  search_term=excluded.search_term,
  application_type=COALESCE(excluded.application_type, jobs.application_type)
`);

// Coleta em massa (scrapers) não sabe o tipo de candidatura; captura manual/extensão
// pode informar. COALESCE no UPDATE evita apagar um valor já classificado antes.
function upsertJobs(jobs) {
  const tx = db.transaction((list) => {
    for (const job of list) upsertStmt.run({ application_type: null, ...job });
  });
  tx(jobs);
}

function markJobApplied(jobId, profileId) {
  db.prepare(
    `INSERT INTO job_applications (job_id, profile_id) VALUES (@job_id, @profile_id)
     ON CONFLICT(job_id) DO UPDATE SET profile_id=excluded.profile_id, applied_at=datetime('now')`
  ).run({ job_id: jobId, profile_id: profileId });
  return db.prepare('SELECT * FROM job_applications WHERE job_id = ?').get(jobId);
}

function unmarkJobApplied(jobId) {
  db.prepare('DELETE FROM job_applications WHERE job_id = ?').run(jobId);
}

function getAppliedJobIds() {
  return new Set(db.prepare('SELECT job_id FROM job_applications').all().map((r) => r.job_id));
}

function parseProfileRow(row) {
  if (!row) return null;
  return { ...row, skills: JSON.parse(row.skills || '[]') };
}

function parseSettingsRow(row) {
  if (!row) return null;
  return {
    ...row,
    search_terms: JSON.parse(row.search_terms || '[]'),
    required_skills: JSON.parse(row.required_skills || '[]'),
    seniority_filter: JSON.parse(row.seniority_filter || '[]'),
    workplace_filter: JSON.parse(row.workplace_filter || '[]'),
    contract_filter: JSON.parse(row.contract_filter || '[]'),
    exclude_keywords: JSON.parse(row.exclude_keywords || '[]'),
  };
}

function listProfiles() {
  return db.prepare('SELECT id, name, headline, updated_at FROM profiles ORDER BY id').all();
}

function createProfile(name) {
  const info = db.prepare('INSERT INTO profiles (name, skills) VALUES (?, ?)').run(name, '[]');
  const profileId = info.lastInsertRowid;
  db.prepare(
    'INSERT INTO profile_settings (profile_id, search_terms) VALUES (?, ?)'
  ).run(profileId, JSON.stringify(DEFAULT_SEARCH_TERMS));
  return getProfileById(profileId);
}

function getProfileById(id) {
  return parseProfileRow(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id));
}

function saveProfileById(id, p) {
  db.prepare(
    `UPDATE profiles SET name=@name, headline=@headline, about=@about, email=@email, phone=@phone,
     linkedin_url=@linkedin_url, salary_expectation=@salary_expectation, currency=@currency,
     skills=@skills, updated_at=datetime('now') WHERE id = @id`
  ).run({
    id,
    name: p.name || getProfileById(id).name,
    headline: p.headline || null,
    about: p.about || null,
    email: p.email || null,
    phone: p.phone || null,
    linkedin_url: p.linkedin_url || null,
    salary_expectation: p.salary_expectation ?? null,
    currency: p.currency || 'BRL',
    skills: JSON.stringify(p.skills || []),
  });
  return getProfileById(id);
}

function getSettingsByProfileId(id) {
  return parseSettingsRow(db.prepare('SELECT * FROM profile_settings WHERE profile_id = ?').get(id));
}

function saveSettingsByProfileId(id, s) {
  db.prepare(
    `UPDATE profile_settings SET search_terms=@search_terms, required_skills=@required_skills,
     seniority_filter=@seniority_filter, workplace_filter=@workplace_filter,
     contract_filter=@contract_filter, daily_send_limit=@daily_send_limit,
     min_salary=@min_salary, hybrid_city=@hybrid_city, onsite_policy=@onsite_policy,
     exclude_keywords=@exclude_keywords, updated_at=datetime('now') WHERE profile_id = @profile_id`
  ).run({
    profile_id: id,
    search_terms: JSON.stringify(s.search_terms || []),
    required_skills: JSON.stringify((s.required_skills || []).slice(0, 2)),
    seniority_filter: JSON.stringify(s.seniority_filter || []),
    workplace_filter: JSON.stringify(s.workplace_filter || []),
    contract_filter: JSON.stringify(s.contract_filter || []),
    daily_send_limit: s.daily_send_limit ?? 5,
    min_salary: s.min_salary ?? null,
    hybrid_city: s.hybrid_city || null,
    onsite_policy: s.onsite_policy || 'flag',
    exclude_keywords: JSON.stringify(s.exclude_keywords || []),
  });
  return getSettingsByProfileId(id);
}

module.exports = {
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
};

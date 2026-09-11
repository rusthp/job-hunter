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
  updated_at TEXT
);
`);

const DEFAULT_SEARCH_TERMS = [
  'recursos humanos', 'analista de rh', 'departamento pessoal', 'recrutamento e seleção',
  'business partner rh', 'analista financeiro', 'assistente financeiro', 'controladoria',
  'contas a pagar', 'contas a receber', 'gerente financeiro', 'gestão de empresas',
  'gerente administrativo', 'coordenador administrativo', 'gestão de pessoas', 'planejamento estratégico',
];

db.prepare('INSERT OR IGNORE INTO profile (id, skills) VALUES (1, ?)').run('[]');
db.prepare('INSERT OR IGNORE INTO settings (id, search_terms) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SEARCH_TERMS));

const upsertStmt = db.prepare(`
INSERT INTO jobs (id, source, title, company, contract_type, workplace_type, city, state, published_date, url, description, search_term)
VALUES (@id, @source, @title, @company, @contract_type, @workplace_type, @city, @state, @published_date, @url, @description, @search_term)
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
  search_term=excluded.search_term
`);

function upsertJobs(jobs) {
  const tx = db.transaction((list) => {
    for (const job of list) upsertStmt.run(job);
  });
  tx(jobs);
}

function getProfile() {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  return { ...row, skills: JSON.parse(row.skills || '[]') };
}

function saveProfile(p) {
  db.prepare(
    `UPDATE profile SET headline=@headline, about=@about, email=@email, phone=@phone,
     linkedin_url=@linkedin_url, salary_expectation=@salary_expectation, currency=@currency,
     skills=@skills, updated_at=datetime('now') WHERE id = 1`
  ).run({
    headline: p.headline || null,
    about: p.about || null,
    email: p.email || null,
    phone: p.phone || null,
    linkedin_url: p.linkedin_url || null,
    salary_expectation: p.salary_expectation ?? null,
    currency: p.currency || 'BRL',
    skills: JSON.stringify(p.skills || []),
  });
  return getProfile();
}

function getSettings() {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  return {
    ...row,
    search_terms: JSON.parse(row.search_terms || '[]'),
    required_skills: JSON.parse(row.required_skills || '[]'),
    seniority_filter: JSON.parse(row.seniority_filter || '[]'),
    workplace_filter: JSON.parse(row.workplace_filter || '[]'),
    contract_filter: JSON.parse(row.contract_filter || '[]'),
  };
}

function saveSettings(s) {
  db.prepare(
    `UPDATE settings SET search_terms=@search_terms, required_skills=@required_skills,
     seniority_filter=@seniority_filter, workplace_filter=@workplace_filter,
     contract_filter=@contract_filter, daily_send_limit=@daily_send_limit,
     updated_at=datetime('now') WHERE id = 1`
  ).run({
    search_terms: JSON.stringify(s.search_terms || []),
    required_skills: JSON.stringify((s.required_skills || []).slice(0, 2)),
    seniority_filter: JSON.stringify(s.seniority_filter || []),
    workplace_filter: JSON.stringify(s.workplace_filter || []),
    contract_filter: JSON.stringify(s.contract_filter || []),
    daily_send_limit: s.daily_send_limit ?? 5,
  });
  return getSettings();
}

module.exports = { db, upsertJobs, getProfile, saveProfile, getSettings, saveSettings };

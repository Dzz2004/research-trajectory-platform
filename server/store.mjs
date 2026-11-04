import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details = []) { super(message); this.status = status; this.details = details; }
}

export class Store {
  constructor(dataDir) {
    if (dataDir !== ':memory:') mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : resolve(dataDir, 'trajectories.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
        current_revision INTEGER NOT NULL DEFAULT 0, confirmed_revision INTEGER
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id),
        status TEXT NOT NULL, mode TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL, finished_at TEXT,
        error TEXT, details TEXT NOT NULL DEFAULT '[]', raw_response TEXT, revision INTEGER,
        prompt_version TEXT NOT NULL DEFAULT 'faithful-v1'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_attempt ON attempts(submission_id) WHERE status IN ('pending','running');
      CREATE TABLE IF NOT EXISTS revisions (
        submission_id TEXT NOT NULL REFERENCES submissions(id), revision INTEGER NOT NULL,
        trajectory TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT,
        warnings TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(submission_id,revision)
      );`);
    this.db.prepare("UPDATE attempts SET status='failed', error='服务已重启，请手动重新提取。', finished_at=? WHERE status IN ('pending','running')").run(new Date().toISOString());
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  create(input) {
    const id = randomUUID(), now = new Date().toISOString();
    const source = { id: randomUUID(), input_kind: input.input_kind, filename: input.filename || null,
      narrative_origin: input.narrative_origin, content: input.content,
      sha256: createHash('sha256').update(input.content, 'utf8').digest('hex') };
    const title = input.title?.trim() || input.content.split(/\r?\n/).find(s => s.trim())?.replace(/^#+\s*/, '').slice(0, 70) || '未命名研究记录';
    this.db.prepare('INSERT INTO submissions(id,title,source,created_at) VALUES(?,?,?,?)').run(id, title, JSON.stringify(source), now);
    return id;
  }
  raw(id) {
    const row = this.db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '记录不存在。');
    return row;
  }
  activeAttempt(id) { return this.db.prepare("SELECT id FROM attempts WHERE submission_id=? AND status IN ('pending','running')").get(id); }
  startAttempt(id, mode, model) {
    this.raw(id);
    if (this.activeAttempt(id)) throw new HttpError(409, '这条记录正在提取，请等待完成。');
    const attempt = randomUUID();
    this.db.prepare('INSERT INTO attempts(id,submission_id,status,mode,model,created_at) VALUES(?,?,?,?,?,?)').run(attempt, id, 'pending', mode, model, new Date().toISOString());
    return attempt;
  }
  setRunning(attempt) { this.db.prepare("UPDATE attempts SET status='running' WHERE id=?").run(attempt); }
  attemptRaw(attempt, text) { this.db.prepare('UPDATE attempts SET raw_response=? WHERE id=?').run(text, attempt); }
  failAttempt(attempt, message, details = []) {
    this.db.prepare("UPDATE attempts SET status='failed',error=?,details=?,finished_at=? WHERE id=?").run(message, JSON.stringify(details), new Date().toISOString(), attempt);
  }
  writeRevision(id, trajectory, origin, warnings = [], attempt = null, baseRevision = null) {
    return this.transaction(() => {
      const row = this.raw(id);
      if (baseRevision !== null && row.current_revision !== baseRevision) throw new HttpError(409, '版本已更新，请重新打开最新版本后编辑。');
      const revision = row.current_revision + 1;
      this.db.prepare('INSERT INTO revisions(submission_id,revision,trajectory,origin,created_at,warnings) VALUES(?,?,?,?,?,?)').run(id, revision, JSON.stringify(trajectory), origin, new Date().toISOString(), JSON.stringify(warnings));
      this.db.prepare('UPDATE submissions SET current_revision=?,title=? WHERE id=?').run(revision, trajectory.title, id);
      if (attempt) this.db.prepare("UPDATE attempts SET status='succeeded',revision=?,finished_at=? WHERE id=?").run(revision, new Date().toISOString(), attempt);
      return revision;
    });
  }
  get(id, revision = null) {
    const row = this.raw(id);
    const selected = revision ?? row.current_revision;
    const saved = selected ? this.db.prepare('SELECT * FROM revisions WHERE submission_id=? AND revision=?').get(id, selected) : null;
    if (selected && !saved) throw new HttpError(404, '指定版本不存在。');
    const attempts = this.db.prepare('SELECT id,status,mode,model,created_at,finished_at,error,details,revision,prompt_version FROM attempts WHERE submission_id=? ORDER BY created_at DESC,rowid DESC').all(id).map(a => ({ ...a, details: JSON.parse(a.details) }));
    const revisions = this.db.prepare('SELECT revision,origin,created_at,confirmed_at FROM revisions WHERE submission_id=? ORDER BY revision DESC').all(id);
    return {
      id, title: row.title, created_at: row.created_at, source: JSON.parse(row.source),
      latest_revision: row.current_revision, selected_revision: selected, confirmed_revision: row.confirmed_revision,
      review_status: saved?.confirmed_at ? 'confirmed' : 'draft',
      trajectory: saved ? JSON.parse(saved.trajectory) : null,
      warnings: saved ? JSON.parse(saved.warnings) : [], attempts, revisions,
      extraction_status: attempts[0]?.status || 'idle',
    };
  }
  list() {
    return this.db.prepare('SELECT id,title,created_at,current_revision,confirmed_revision,source FROM submissions ORDER BY created_at DESC,rowid DESC LIMIT 100').all().map(row => {
      const attempt = this.db.prepare('SELECT status FROM attempts WHERE submission_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(row.id);
      const revision = row.current_revision ? this.db.prepare('SELECT confirmed_at,trajectory FROM revisions WHERE submission_id=? AND revision=?').get(row.id,row.current_revision) : null;
      const t = revision ? JSON.parse(revision.trajectory) : null;
      return { id: row.id, title: row.title, created_at: row.created_at, revision: row.current_revision,
        review_status: revision?.confirmed_at ? 'confirmed' : 'draft', extraction_status: attempt?.status || 'idle',
        narrative_origin: JSON.parse(row.source).narrative_origin, node_count: t?.nodes.length || 0 };
    });
  }
  confirm(id, revision) {
    return this.transaction(() => {
      const row = this.raw(id);
      if (row.current_revision !== revision || !revision) throw new HttpError(409, '只能确认最新草稿，请先刷新版本。');
      this.db.prepare('UPDATE revisions SET confirmed_at=? WHERE submission_id=? AND revision=?').run(new Date().toISOString(), id, revision);
      this.db.prepare('UPDATE submissions SET confirmed_revision=? WHERE id=?').run(revision, id);
    });
  }
}

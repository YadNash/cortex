import { createHash } from "node:crypto";
export const DEFAULT_ORG = "org-studio";
export const intents = [
  "brainstorm",
  "specify",
  "review",
  "decide",
  "plan",
  "handoff",
];
export const defaultIntent = (type) =>
  ({
    spec: "specify",
    decision: "decide",
    handoff: "handoff",
    code_snippet: "specify",
  })[type] || "brainstorm";
export const fingerprint = (a) =>
  createHash("sha256")
    .update(JSON.stringify([a.title, a.content, a.updated_at]))
    .digest("hex");
export function migrateMemory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_user_id TEXT REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT OR IGNORE INTO organizations(id,name) VALUES ('org-studio','Studio workspace');`);
  function column(table, name, definition) {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  column("users", "org_id", "TEXT NOT NULL DEFAULT 'org-studio'");
  column("artifacts", "org_id", "TEXT NOT NULL DEFAULT 'org-studio'");
  db.exec(`CREATE TRIGGER IF NOT EXISTS user_org_insert BEFORE INSERT ON users WHEN NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Unknown organization'); END;
    CREATE TRIGGER IF NOT EXISTS user_org_update BEFORE UPDATE OF org_id ON users WHEN NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Unknown organization'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_org_insert BEFORE INSERT ON artifacts WHEN NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Unknown organization'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_org_update BEFORE UPDATE OF org_id ON artifacts WHEN NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Unknown organization'); END;
    CREATE TRIGGER IF NOT EXISTS org_delete_guard BEFORE DELETE ON organizations WHEN EXISTS(SELECT 1 FROM users WHERE org_id=OLD.id) OR EXISTS(SELECT 1 FROM artifacts WHERE org_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Organization still has members or artifacts'); END;`);
  column("artifacts", "intent", "TEXT NOT NULL DEFAULT 'brainstorm'");
  column("artifacts", "steward_user_id", "TEXT REFERENCES users(id)");
  column("artifacts", "decided_by_user_id", "TEXT REFERENCES users(id)");
  column("artifacts", "decided_at", "TEXT");
  column("artifacts", "status", "TEXT NOT NULL DEFAULT 'active'");
  db.exec(`CREATE TABLE IF NOT EXISTS memory_migrations(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS artifact_links(id TEXT PRIMARY KEY,artifact_id TEXT NOT NULL REFERENCES artifacts(id),source_artifact_id TEXT NOT NULL REFERENCES artifacts(id),relation TEXT NOT NULL,source_snapshot TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(artifact_id,source_artifact_id,relation));
    CREATE INDEX IF NOT EXISTS links_source ON artifact_links(source_artifact_id);
    CREATE TABLE IF NOT EXISTS agent_answers(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),org_id TEXT NOT NULL REFERENCES organizations(id),intent TEXT NOT NULL,word_count INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS answer_artifacts(answer_id TEXT NOT NULL REFERENCES agent_answers(id),artifact_id TEXT NOT NULL REFERENCES artifacts(id),PRIMARY KEY(answer_id,artifact_id));
    CREATE TABLE IF NOT EXISTS answer_feedback(answer_id TEXT PRIMARY KEY REFERENCES agent_answers(id),user_id TEXT NOT NULL REFERENCES users(id),rating TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artifact_views(artifact_id TEXT NOT NULL REFERENCES artifacts(id),user_id TEXT NOT NULL REFERENCES users(id),last_viewed_at TEXT NOT NULL,PRIMARY KEY(artifact_id,user_id));
    CREATE TABLE IF NOT EXISTS conflict_reports(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),topic TEXT NOT NULL,severity TEXT NOT NULL,summary TEXT NOT NULL,evidence TEXT NOT NULL,source_versions TEXT NOT NULL,signature TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'open',created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS concepts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,artifact_ids TEXT NOT NULL,source_versions TEXT NOT NULL,signature TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS concept_relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL REFERENCES concepts(id),to_id TEXT NOT NULL REFERENCES concepts(id),type TEXT NOT NULL,evidence_artifact_ids TEXT NOT NULL,UNIQUE(from_id,to_id,type));
    CREATE TABLE IF NOT EXISTS org_vocabulary(org_id TEXT PRIMARY KEY REFERENCES organizations(id),mappings TEXT NOT NULL DEFAULT '[]',hints TEXT NOT NULL DEFAULT '[]',updated_by TEXT REFERENCES users(id),updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS answer_user ON agent_answers(user_id);
    CREATE INDEX IF NOT EXISTS conflict_org ON conflict_reports(org_id,topic);
    CREATE INDEX IF NOT EXISTS concept_org ON concepts(org_id);`);
  if (
    !db
      .prepare("SELECT name FROM memory_migrations WHERE name='memory-v1'")
      .get()
  ) {
    db.exec(`BEGIN; UPDATE artifacts SET steward_user_id=owner_user_id, intent=CASE type WHEN 'decision' THEN 'decide' WHEN 'spec' THEN 'specify' WHEN 'code_snippet' THEN 'specify' WHEN 'handoff' THEN 'handoff' ELSE 'brainstorm' END;
      UPDATE artifacts SET decided_by_user_id=owner_user_id,decided_at=created_at WHERE type='decision';
      INSERT INTO memory_migrations VALUES ('memory-v1'); COMMIT;`);
  }
}
export function initializeOrgOwners(db) {
  db.exec(
    "UPDATE organizations SET owner_user_id=(SELECT id FROM users WHERE org_id=organizations.id ORDER BY rowid LIMIT 1) WHERE owner_user_id IS NULL",
  );
}

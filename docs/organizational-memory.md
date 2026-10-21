# Organizational memory: implementation and next boundaries

This release makes knowledge traceable and inspectable. It does not automatically resolve conflicts, merge documents, archive sources, approve decisions, or grant cross-organization access. Existing databases migrate on startup. Existing artifacts, comments, users, passwords, and role settings are retained.

## What is implemented

| Direction                      | Current implementation                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision lineage and ownership | Declared decision maker/date, recorded-by owner, knowledge steward, versioned source links, topic timelines                                      |
| Conflict detection             | On-demand tag clustering, live AI or explicit local contradiction heuristics, persisted evidence-backed reports, reviewed/resolved state         |
| Context budget                 | One ranking/packing service used by chat and its debugger; relevance, freshness, type, feedback/use history, intent, and estimated token cost    |
| Concept graph                  | Persisted source-backed concept nodes, evidence-bearing typed relationships, browse/extract APIs and an idea-map view                            |
| Knowledge health               | Local duplicate and inactivity signals, topic coverage, optional generated cleanup advice                                                        |
| Impact simulation              | Declared dependency traversal, title/ID mentions, concepts, and weak topic matches; conditional live/demo summary                                |
| Multi-org/shared spaces        | Organization ownership and an enforced org boundary are implemented. Shared-space membership and grants are designed below, not active endpoints |
| Feedback and preferences       | Per-answer feedback associated with supplied artifacts; bounded ranking influence; per-user style hints and team aggregates                      |
| Intent workflows               | Intent on artifacts and answer metadata; chat prompt routing, intent filters, saving from chat with sources                                      |
| Org shadow model preparation   | Owner-managed terminology dictionary and team patterns; query normalization, prompt reference data, response wording conversion; no fine-tuning  |

## Permissions are a property of every derived result

`User.org_id` and `Artifact.org_id` default existing records to `org-studio`. Team visibility now means the artifact's organization, not every account in the database. Lists, detail, search, activity, onboarding, reviews, graphs, history, health, and impact use the same permission gate. User listings and sharing/assignment recipients are restricted to the current organization. Public signup still joins Studio in this MVP; organization provisioning and invitations are not exposed.

A conflict or concept can paraphrase any input source, even if the model cites only some inputs. Its privacy dependency set therefore includes **every artifact supplied to that model operation**. A viewer must currently be allowed to read all of them. No hidden-source titles, counts, placeholder nodes, or raw source IDs are returned. This intentionally favors privacy over graph availability. Reports with revoked sources disappear; source content changes mark saved results stale instead of presenting them as newly verified.

Model outputs are validated against JSON schemas and against supplied IDs. Conflict evidence must be an exact quote from at least two distinct supplied sources. Unsupported evidence or invented references fail the operation before records are saved. Relevant sources are checked again after async provider calls. Model content remains untrusted reference data, never authority to write or share records.

## Lineage: what was known at the time

`artifact_links` connects a child/decision to its source, with a relation of `supports`, `depends_on`, `refines`, `supersedes`, or `contradicts`. `artifact_id` is the dependent/refining/superseding artifact; `source_artifact_id` is the supporting/base/older artifact. The link records the actor, time, and a snapshot of the source's title, full content, and `updated_at`. Editing the source later does not overwrite this evidence. Links to oneself or a source chain that would create a cycle are rejected. Owners can explicitly remove links; removal is recorded as an artifact update. This is curated provenance, not an immutable audit ledger.

Artifacts have `steward_user_id`. Stewardship identifies the person responsible for keeping knowledge useful; it **does not grant edit or read rights**. Decisions additionally have `decided_by_user_id` and `decided_at`. These default to the creator and creation time. Existing decisions are backfilled using the same rule. Treat these fields as declared attribution, not automatic meeting-speaker identification. The independent recorded-by owner remains visible. Only the artifact owner can change attribution, stewardship, status, or lineage links.

- `GET /api/artifacts/:id/lineage`: recorded by, steward, declared decision maker/date, visible source nodes, directed links, and preserved source snapshots. Traversal stops at depth 8 or 50 nodes and reports truncation.
- `POST /api/artifacts/:id/links`: `{source_artifact_id, relation?}`. Captures a source snapshot; no source text is copied into the artifact itself.
- `DELETE /api/artifacts/:id/links/:linkId`: owner removes one outgoing source link.
- `PATCH /api/artifacts/:id/memory`: any of `{steward_user_id, decided_by_user_id, decided_at, intent, status}`. Decision attribution is valid only for decision artifacts. `status` is `active` or `archived`; archiving excludes it from ordinary active discovery while explicit detail access and decision history remain permission checked.
- `GET /api/history?tag=pricing`: up to 50 visible decision artifacts in declared-decision-date order, each with its visible source chain. Includes archived decisions. Tags match exactly, ignoring case.

Saving an answer as an artifact preserves its intent and links its supplied context sources. Decision extraction accepts `source_artifact_ids` (up to 12) and uses their excerpts as references; creating the resulting artifact and source snapshots is one database transaction. The extraction dialog explicitly shows its sharing scope. Extracted text can contain facts from selected sources; the person extracting is intentionally authoring that new artifact into the chosen scope. Source links alone never grant access to their source.

Tickets, PRs, and external meeting summaries can currently be represented as `other`/note artifacts with the reference URL in their content. There are no external-source connectors or automatic imports.

## Conflict service

`POST /api/conflicts/detect` with optional `{tag}` is an **on-demand** scan. It groups accessible active artifacts by exact tag, picks up to six clusters, and inspects up to eight recent sources per cluster. The result reports coverage/truncation. No background scheduler is installed. A future job should run under an explicit organization service principal and apply the same privacy dependency sets; it must never write a globally readable report from private inputs.

Live mode asks the LLM to distinguish genuine inconsistencies from scope differences, temporal changes, or deliberate supersession. Demo mode only flags matching sentence structures with different numeric values or opposing negation. These are candidates for review, not proof. Reports persist with severity, topic, exact quotations, input fingerprints, creator, time, and open/resolved status. Equivalent evidence for the same source versions is deduplicated. Updating a source marks older reports stale. Rechecking a resolved report does not silently reopen it.

- `GET /api/conflicts?tag=pricing&status=open`: accessible reports sorted by high/medium/low impact. `status` may also be `resolved` or `all`. Up to 500 stored reports are considered per organization.
- `PATCH /api/conflicts/:id`: `{status: "open" | "resolved"}`; requires the report creator or organization owner and current access to all dependencies. Resolving a report never modifies its sources.

## Context selection and feedback

The shared selector considers up to 100 results from permission-filtered retrieval. Archived artifacts are excluded unless explicitly pinned as primary context. A primary source supplied by ID or unambiguous exact title remains first; it is trimmed if necessary. The value score is:

```
0.55 × relevance
+ 0.15 × freshness
+ 0.15 × artifact-type priority
+ 0.10 × usefulness
+ 0.05 × intent match
```

Freshness decays over 60 days. Decisions receive a higher type prior than notes. Usefulness combines a smoothed positive/negative feedback ratio (80%) with capped logarithmic prior context-use frequency (20%). It is based on the current user's history, not another person's private conversations. Helpful feedback increases the posterior; unhelpful/too-vague feedback reduces it. These are weak signals: feedback on an entire answer cannot prove which individual artifact helped.

Candidates are packed by value per square-root estimated cost. Up to eight sources, each normally excerpted to 3,200 characters, fit the configured artifact payload budget. All primary source metadata must fit; otherwise the API asks for a larger budget. Non-primary items that do not fit are skipped with a reason. The budget counts the serialized artifact payload using **UTF-8 bytes / 3**, a heuristic, not a model tokenizer or exact total-prompt cap. System instructions, current user input, vocabulary, and conversation history are outside this artifact budget. History has a separate cap of six entries, 3,000 characters each. The API continues to validate the current message and history lengths.

- `GET /api/agent/context-debug?query=...&intent=plan&budget_tokens=2400`: selected excerpts, scores/components, value per budget, rejection reasons, normalized question, estimated cost, weights, and limits. Supports optional `artifact_id`, `tag`, and `type`. It records no answer use/feedback; live mode may refresh missing embeddings.
- `POST /api/agent/chat` also accepts `intent` and `context_budget` (256–8,000 estimated artifact tokens, default 2,400). Returns `answer_id`, selected sources, `intent`, `context_tokens`, and `context_budget`.
- `POST /api/agent/feedback`: `{answer_id, rating: "helpful" | "unhelpful" | "too_long" | "too_vague"}`. Only that answer's authenticated user can rate it. One current rating per answer is upserted; repeated clicks do not add votes.
- `GET /api/team/preferences`: estimated median preferred answer word count (150-word default), feedback count, visible recurring tags, visible frequently supplied artifacts, and the current user's style hints. Length statistics aggregate within the organization; source IDs/titles remain permission filtered. This is inferred guidance, not an explicit team policy.

Stored answer metadata contains ID, user/org, intent, word count, timestamp, and supplied artifact associations. Full chat messages and answer bodies are **not persisted** by this layer. The supplied-source record is not a claim that the LLM actually cited every artifact. Recent too-long feedback requests a shorter answer; too-vague feedback requests a specific example and actionable next step. This is prompt adaptation, not training.

## Concepts and relationships

`Concept` stores ID, org, name, short description, tags, related artifact IDs, all-input fingerprints/privacy dependencies, extraction actor, and timestamp. `concept_relations` stores `from_id`, `to_id`, one of `refines | contradicts | depends_on`, and supporting artifact IDs. Relationships are visible only when both nodes and their evidence are visible. Nodes are versioned by name and the input fingerprint set; repeat extraction of the same versions does not duplicate a node. Old versions can remain visible and are marked stale when inputs change; no background re-extraction happens.

- `POST /api/concepts/extract`: `{artifact_ids: [...]}`; 1–12 selected accessible sources. Live AI proposes grounded concepts and supported edges. Invalid node references, edge references, or source IDs are rejected before any graph write.
- `GET /api/concepts?tag=...`: visible nodes and edges, up to 500 stored nodes considered per org.

Demo mode builds an honest tag-based topic index, with relationships only from declared artifact links; it does not pretend to infer semantic relationships. The UI offers source-backed cards and a typed relationship list rather than an ornamental force graph.

## Knowledge health and impact

`GET /api/knowledge/health?stale_days=90` analyzes up to 200 recent accessible active artifacts and reports truncation. Exact normalized content matches and word-vector cosine >= 0.9 with a shared tag/compatible length produce candidate duplicate pairs. Similarity is computed locally in both runtime modes. Inactivity considers updates, detail views, and supplied chat context use, not just creation age. A topic with at least five sources is flagged for possible consolidation; one non-spec/non-decision source is a thin-coverage signal. These relative counts say nothing about sources outside the viewer's access.

`POST /api/knowledge/health/recommendations` asks live AI (or deterministic demo templates) for grounded merge, review-for-archive, and canonical-overview recommendations. No writes to source artifacts occur. It returns `applied:false`. Owners can choose subsequent manual edits or archive actions; the cleanup tool never performs them automatically.

`POST /api/artifacts/:id/impact` accepts optional `{scenario: "change" | "remove", change: "hypothesis"}`. It traverses visible reverse source links (up to 50 visited nodes), then adds visible title/ID mentions, concept connections, and weaker shared-tag matches. Up to 30 affected sources are returned with reasons and evidence strength (`declared`, `mention`, `concept`, `heuristic`), plus a conditional live/demo summary and `applied:false`. Shared tags are explicitly not confirmed dependencies. A no-results response does not claim there are no dependencies in inaccessible sources or external systems.

## Intent and the organization shadow adapter

Artifacts and answer metadata carry `brainstorm | specify | review | decide | plan | handoff`. Chat uses distinct fixed prompt hints per intent. New artifacts infer a sensible intent from type unless the author selects one. Existing artifacts are migrated once. The save-from-chat dialog preserves the answer intent and source IDs, and the library offers an intent filter. Both `GET /api/artifacts` and `POST /api/search/artifacts` support optional `intent`, `type`, and exact `tag` filters.

`GET /api/team/vocabulary` returns mappings, hints, and `can_manage`. `PUT /api/team/vocabulary` replaces the org's mappings/hints and is restricted to its organization owner. The first existing or first signing-up user becomes the Studio owner during initialization; this is a bootstrap policy, not an invitation/admin system.

```json
{
  "mappings": [
    {
      "canonical": "subscription",
      "preferred": "plan",
      "synonyms": ["membership", "package"]
    }
  ],
  "hints": ["We favor small, reversible product experiments."]
}
```

Mapping collisions are rejected. Normalization matches whole Unicode terms, handles longer phrases first, and performs one replacement pass to avoid recursive expansion. Query normalization happens before retrieval and model input. The model receives org terminology/patterns as reference data. Response rendering replaces canonical terms with preferred terms. Stored artifacts, source snapshots, and source metadata are never rewritten. This presentational wording adaptation can change a displayed quote; use linked originals/snapshots as evidence.

The current adapter is represented by `memory.vocabulary`, `normalize`, `denormalize`, and `personalStyle`. A later `OrgContextAdapter` can swap in a learned representation without changing permission-filtered retrieval or source attribution. Its contract should remain: obtain the authorized org profile, normalize a query, supply non-authoritative org hints, and adapt presentation. It must never manufacture evidence, widen access, or use private training data without an explicit policy.

## Shared spaces: proposed schema and API, not yet active

The implemented org columns and gate provide a safe starting point. Cross-org grants and membership transitions are intentionally **not** enabled in this release. The following additional schema is the next step:

```sql
CREATE TABLE organization_memberships (
  org_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id),
  org_role TEXT CHECK(org_role IN ('owner','admin','member')) NOT NULL,
  status TEXT CHECK(status IN ('invited','active','suspended')) NOT NULL,
  PRIMARY KEY(org_id,user_id)
);
CREATE TABLE shared_spaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_by_org_id TEXT REFERENCES organizations(id),
  created_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE shared_space_organizations (
  space_id TEXT REFERENCES shared_spaces(id), org_id TEXT REFERENCES organizations(id),
  status TEXT CHECK(status IN ('pending','accepted','revoked')) NOT NULL,
  accepted_by_user_id TEXT REFERENCES users(id), accepted_at TEXT,
  PRIMARY KEY(space_id,org_id)
);
CREATE TABLE artifact_space_grants (
  artifact_id TEXT REFERENCES artifacts(id), space_id TEXT REFERENCES shared_spaces(id),
  granted_by_user_id TEXT REFERENCES users(id), access_level TEXT CHECK(access_level='read'),
  granted_at TEXT NOT NULL, revoked_at TEXT,
  PRIMARY KEY(artifact_id,space_id)
);
```

Proposed endpoints:

| Endpoint                                           | Required policy and behavior                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /api/organizations`                          | Verified provisioning flow; creates owner membership. Must not reuse public Studio signup semantics |
| `POST /api/organizations/:id/invitations`          | Org owner/admin invites a member; acceptance verifies identity and membership                       |
| `POST /api/shared-spaces` `{name, partner_org_id}` | Org owner/admin creates a pending partnership; no access until partner accepts                      |
| `POST /api/shared-spaces/:id/accept`               | Partner owner/admin explicitly accepts; records approver/time                                       |
| `GET /api/shared-spaces`                           | Active memberships only; never enumerates unaccepted partner artifacts                              |
| `PUT /api/artifacts/:id/spaces/:spaceId`           | Artifact owner plus org export policy approval; explicit read-only grant to an accepted space       |
| `DELETE /api/artifacts/:id/spaces/:spaceId`        | Owner/admin revokes a grant immediately                                                             |
| `POST /api/shared-spaces/:id/revoke`               | Either org admin revokes partnership; invalidates all derived external access                       |

An external viewer must have active membership in an accepted partner org, the partnership must be accepted on both sides, and the specific artifact must have an active explicit export grant. `team` visibility alone never crosses organizations. No access is granted transitively through tags, concepts, lineage, or search. Source chains still require independent source grants. A shared-space decision with an internal-only source must omit that source and any derived report that might paraphrase it. External grants start read-only; editing and comments need separate deliberate policies. Revocation must affect detail, search, caches, generated reports, embeddings, exports, and model context immediately. Background jobs need a scoped service identity. The current gate must be extended centrally before these endpoints can be implemented; bypassing it in a shared-space route would be incorrect.

## Validation and operational limits

The API integration suite covers provenance/snapshots/cycles, source revocation, decision extraction, report dedup/staleness, all-input privacy for concepts, budgeted pinning, feedback ownership, org-boundary isolation, term mapping, health signals, and impact evidence. Browser tests cover the actual knowledge tools in dark mode and mobile widths, plus Phase 2 regression flows. Live model quality/latency still requires a real configured credential; mocks verify request/response contracts and rejection of unsupported evidence instead of claiming live validation.

All AI-heavy operations are explicit. Scans, graph extraction, cleanup advice, impact, reviews, and live debugging can use provider quota. There is no scheduler, fine-tuning, auto-merge, automatic archival, or automatic conflict resolution. Corpus limits and heuristic labels are returned in responses; larger deployments should add pagination, indexed topic queries, model-specific tokenization, queued jobs, background retention, owner/admin membership management, and version-aware report invalidation.

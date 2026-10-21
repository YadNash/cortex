# Cortex

A shared context layer for teams, with a warm, editorial interface. Each person has a private AI conversation and access to a permissioned library of notes, ideas, specs, code snippets, and handoffs.

## Run locally

Requires Node.js **22.13 or later** (Node 24 recommended). SQLite is built into Node; no database service is needed.

```sh
npm ci
npm run dev
```

The Vite frontend runs on port **5173** and proxies `/api` and `/auth` to Express on **3001**. Run from the repository root. On machines with a restricted home directory, use `npm ci --cache /workspace/.npm-cache`.

```sh
npm test           # isolated, in-memory integration tests
npm run build     # production frontend, with locally bundled fonts
npm start         # Express serves the built frontend and API on port 3001
```

Application records persist in `data/cortex.sqlite`. A locally generated JWT signing key persists in `data/.jwt-secret` unless `JWT_SECRET` is set. Both are ignored by Git. Back up the database and signing key when retaining an installation. Development uses watch mode; production requires a restart after backend configuration changes.

## Explore the demo

On the sign-in screen, choose **Explore as Alex** or **Explore as Jamie**. Demo seeding is enabled in development and disabled by default in production. It only runs if the user table is empty.

All seeded accounts use the development-only password `CortexDemo2026!`:

| Person      | Email             | Perspective                   |
| ----------- | ----------------- | ----------------------------- |
| Alex Morgan | alex@cortex.demo  | Product and personal thinking |
| Jamie Chen  | jamie@cortex.demo | Research and handoffs         |
| Sarah Park  | sarah@cortex.demo | Design and brand              |
| Sam Rivera  | sam@cortex.demo   | Engineering                   |

Use **Create an account** for your own user. The MVP has one shared workspace: every registered user belongs to it. Team artifacts are available to every registered user. Private and explicitly shared artifacts remain permission-restricted.

### Two-person handoff walkthrough

1. Enter as Alex and choose **Pass the baton**, or ask for an onboarding outline.
2. Under the response, choose **Save as artifact**. Enter a title, choose **Handoff**, and assign it to Jamie. For a new handoff, the form automatically includes the assignee in sharing.
3. Save. In **Artifacts**, open the item to read its content, add a comment, or manage sharing as the owner.
4. Sign out using the account menu at the bottom left. Enter as Jamie.
5. Open **Handoffs to me** or **Artifacts → Assigned to me**. Open the artifact, then **Open in chat**. The backend explicitly includes it as primary context after checking access.
6. Choose **Edit artifact** to incorporate technical details. An assignee may edit handoff content, title, and tags; only the owner may change the assignment, type, or sharing.
7. Sign back in as Alex to see the saved changes and comments. Alex’s private exploration note must never be visible to Jamie in lists, search, or agent context.

## Connect live AI

Without configuration, Cortex uses **demo mode**. The chat assembles saved excerpts and a fixed next-step suggestion; it does not generate new reasoning. The local vector index uses hashed word similarity, not semantic embeddings. Both are labeled in the UI.

Copy `.env.example` to `.env` and configure server-side values:

```dotenv
LLM_PROVIDER=openai
CORTEX_AI_API_KEY=your-key-entered-securely
OPENAI_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
```

Restart the API. The key needs access to chat completions and embeddings at `api.openai.com`. `OPENAI_API_KEY` is also accepted in a standard local deployment; `CORTEX_AI_API_KEY` works with cloud environment settings that reserve the `OPENAI_` prefix. Never put keys in frontend variables or commit `.env`.

Live mode uses OpenAI chat and semantic embeddings. Each artifact has an embedding record with its owner, visibility, model, and vector. Existing local embeddings are regenerated lazily when first searched in live mode. Permission filtering happens **before** ranking and before including context in the model request. Source links include artifact titles and owners. Name-based queries such as “Jamie’s onboarding notes” narrow retrieval to that owner. Embeddings and chat calls have timeouts; provider errors are surfaced without silently falling back to demo answers.

### Configuration

| Variable            | Default                                  | Purpose                                                     |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| `PORT`              | `3001`                                   | API and production HTTP port                                |
| `LLM_PROVIDER`      | `demo`                                   | `demo` or `openai`                                          |
| `CORTEX_AI_API_KEY` | unset                                    | Server-only OpenAI credential                               |
| `OPENAI_MODEL`      | `gpt-4o-mini`                            | Chat model                                                  |
| `EMBEDDING_MODEL`   | `text-embedding-3-small`                 | Embedding model                                             |
| `JWT_SECRET`        | generated locally                        | Strong signing secret; provide via deployment secrets       |
| `SEED_DEMO`         | true in development; false in production | Seed demo users into an empty database                      |
| `NODE_ENV`          | development                              | Production serves `dist/` and disables default demo seeding |

`npm start` sets `NODE_ENV=production`. To try the production build with an empty database and demo fixtures, explicitly set `SEED_DEMO=true npm start`. Existing development demo users remain in an existing database; use a fresh database directory for a real deployment. The known demo passwords are intended for local evaluation only.

## Architecture

- `src/main.jsx`: React app, authentication, agent chat, context panel, library, artifact forms, comments, and team/settings dialogs.
- `src/styles.css`: responsive ivory-and-forest design, pastel artifact accents, serif display typography, locally hosted DM Sans and Manrope, keyboard focus styles, and reduced-motion support.
- `server/index.js`: Express REST API, JWT authentication, validation, permission-filtered queries, and production static serving.
- `server/db.js`: SQLite schema, salted scrypt password hashing, and development seed data.
- `server/ai.js`: demo retrieval, live embeddings, similarity scoring, and OpenAI chat adapter.
- `tests/api.test.js`: authentication, private-data isolation, grants and revocation, comments, handoff edits, primary-context authorization, and search filtering.

The REST endpoints follow the supplied product brief: `/auth/signup`, `/auth/login`, `/api/users`, `/api/artifacts`, `/api/artifacts/:id`, `/api/artifacts/:id/share`, `/api/artifacts/:id/comments`, `/api/search/artifacts`, and `/api/agent/chat`. `/api/me` validates sessions; `/api/health` reports runtime mode. Protected routes require `Authorization: Bearer <token>`.

### Permission rules

- Private: owner only.
- Shared with teammates: owner plus explicit permission rows.
- Team: all users in this single workspace.
- Editing: owner, explicit writers, or the handoff assignee, provided they can access the artifact.
- Sharing, reassignment, and type changes: owner only.
- Assignment alone never grants read access. The API rejects an assignment if the assignee cannot see the artifact.
- Inaccessible artifacts return 404. Agent context and semantic search use the same access rules as detail requests. Artifact text is treated as untrusted reference material in the model prompt.

## MVP boundaries

Chat transcripts live only in the current browser session’s React state and reset on reload/sign-out. Artifacts, permissions, embeddings, comments, and users persist. Chat never autonomously writes an artifact; saving and editing are explicit UI actions. There is no deletion, password reset, email verification, invitation system, multi-workspace membership, pagination, or realtime collaboration yet. JWTs are stored in localStorage per the MVP brief; a public production service should add its deployment-specific session, HTTPS, account, abuse-prevention, and backup controls. Live OpenAI behavior requires a valid credential and was not exercised by the offline demo tests.

## Validation

`npm test` exercises the API against a new in-memory database and never modifies development data. The production bundle and a real Chromium browser flow were also checked during implementation: demo sign-in, chat, save-as-artifact, handoff auto-sharing, comments, owner sharing changes, sign-out, assignee editing, and mobile navigation. No live AI credential is required for these checks.

## Phase 2

Phase 2 adds an onboarding companion, decision capture, three-persona reviews, an activity feed, role-aware chat, and light/dark/system appearance. No new credentials or services are required for the demo. Existing SQLite databases migrate automatically on startup without replacing users or artifacts.

### Set your role and appearance

Open your account menu at the bottom left and choose **Settings & AI**. Select Engineer, Product manager, Designer, or Other, then **Save role**. The role is stored on your user account and shapes future chat answers and onboarding plans. Existing accounts default to Other; freshly seeded demo accounts have representative roles.

Use the moon/sun button in the top bar for a quick appearance change, or choose **Light**, **Dark**, or **System** in settings. The preference is stored in this browser and applies to the sign-in page, chat, artifact library, forms, reviews, onboarding, and activity. System mode follows operating-system changes. A small initialization script applies the preference before React renders to avoid a bright flash.

### Onboarding companion

Choose **Onboarding** in the sidebar. Cortex builds a path from artifacts you can access, blending search relevance with onboarding/architecture/process tags, role topics, and decisions. Change the perspective using the role selector (a temporary override for this plan), or **Regenerate** after your workspace changes. The plan uses up to 15 source artifacts and produces fewer modules when your workspace is small; it never fabricates filler sources.

Each step has a source link and a completion button. Progress is stored locally per account and role, keyed by the step title and source IDs. It survives page reloads in the same browser; it is not synchronized across devices. Renaming a source or generating a different plan can introduce new unchecked steps. Source access is rechecked when opening an artifact.

### Capture meeting decisions

On **My Agent**, choose **Capture decisions** (the notebook icon on mobile). Paste a meeting transcript, optionally name it, and choose Team or Private. **Team is the default**: the sharing scope is displayed before saving. **Extract decisions** saves the result as a `decision` artifact and opens its detail view, with separate statements, rationale, and areas. The full input transcript is not persisted. There is no preview/approval step between extraction and saving.

Try these demo notes:

```text
Decision: We will use single-use invitation tokens.
We agreed to expire invitations after seven days.
TODO: Sam will write the implementation outline.
```

Demo mode detects explicit decision cues such as “Decision:”, “We agreed”, “We decided”, “Chose”, and “Approved”. It does not infer implicit decisions or rationale, and it excludes ordinary task lines. If it finds no explicit decisions, it reports that and creates no artifact. Live AI extracts durable decisions with structured, validated JSON. It is instructed not to invent rationale or confuse open questions with decisions. Review extracted results for accuracy. Decision artifacts participate in search, chat context, onboarding, sharing, editing, and comments like other artifacts.

### Multi-Agent Review

Open any artifact you can access and choose **Multi-Agent Review**. Three independent AI calls review the same full artifact through different lenses:

- **Architect**: structure, consistency, maintainability, and technical risk.
- **Product**: user value, clear goals, scope, and tradeoffs.
- **Engineer**: implementability, edge cases, and concrete next steps.

Results appear in expandable panels. Reviews do not edit the artifact and are not stored as comments. Each review invocation uses three model calls in live mode; **Review again** invokes them again. Demo mode shows clearly labeled persona checklists rather than claiming content-specific generated analysis. Access is checked before review and again before results are returned.

### Activity feed

Choose **Activity** in the sidebar for recent artifact creations, updates, sharing changes (recorded as updates), and comments. Click an entry to open its source. **Refresh** fetches current events; **A little further back** increases the limit from 20 up to 100. Events identify the actual actor, including a handoff assignee who edits someone else’s artifact.

Access filtering happens in SQL before applying the limit. Revoking access hides the source’s historical events on the next fetch. Existing creation and comment history is backfilled once per source event using stable IDs; startup does not duplicate events. Pre-Phase-2 edit history cannot be reconstructed and is not invented. This is a refreshable feed, not realtime synchronization.

### Smarter chat references

**Open in chat** pins its source explicitly. Messages containing an exact accessible artifact title or `artifact <id>` also select that source as primary context. Inaccessible explicit IDs return 404. Possessive queries such as “Jamie’s recent work” or “Jamie Chen’s notes” restrict retrieval to that owner while maintaining access checks. Full names take precedence; ambiguous first names do not silently pick one teammate. Source titles in responses remain clickable.

### Phase 2 API

All endpoints require the same Bearer-token authentication as the MVP:

| Method  | Endpoint                     | Body or query                                             |
| ------- | ---------------------------- | --------------------------------------------------------- |
| `GET`   | `/api/me`                    | Returns `{id, name, email, role}`                         |
| `PATCH` | `/api/me`                    | `{role: "engineer" \| "pm" \| "designer" \| "other"}`     |
| `POST`  | `/api/onboarding/plan`       | `{role?}`; defaults to the authenticated user’s role      |
| `POST`  | `/api/decisions/extract`     | `{source_text, title?, visibility?: "team" \| "private"}` |
| `POST`  | `/api/agent/review-artifact` | `{artifact_id}`                                           |
| `GET`   | `/api/activity`              | `?limit=20`; integer from 1 to 100                        |

Plans return role, steps with artifact IDs, source metadata, and runtime mode. Decision extraction returns the created artifact plus its structured decisions and runtime mode; no decisions returns 422. Review returns the artifact ID and three `{role, text}` results. Model-generated plans must reference only the supplied, permission-filtered source IDs; malformed output is rejected. A provider error never silently switches live operations into demo behavior.

New code is grouped in `server/phase-two.js` (routes), `server/phase-two-ai.js` (structured AI operations/personas), and `src/phase-two.jsx` (views, profile, and theme). Existing artifact creation and access helpers are reused. Activity events are committed in the same transaction as their source writes. No vector or database service is added.

### Phase 2 verification

```sh
npm test
npm run test:browser
```

API tests use isolated in-memory databases and cover role updates, permission-filtered plans, decision extraction/no-write cases, reviews, event actors and revocation, explicit chat references, and a migration from an old database. AI contract tests stub provider responses to verify JSON validation, role prompts, independent reviewers, and provider-error handling. These mocks do not validate real model quality or credentials.

`npm run test:browser` builds production assets and starts a separate in-memory demo server on port 4174. It checks the Phase 2 journey, appearance persistence/system changes, and mobile navigation. It never changes your development database. Playwright uses `/usr/bin/chromium` if present; otherwise install its browser with `npx playwright install chromium`, or set `CHROMIUM_PATH` to a compatible executable. Browser screenshots and traces are generated under ignored `test-results/`. Real OpenAI end-to-end validation remains optional and requires a valid server credential.

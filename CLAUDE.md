# CollabForge — Claude Code Project Context

## What this project is
CollabForge is a real-time collaborative document/code editor where an AI agent
participates as a genuine collaborator — not a sidebar chatbot, but a server-side
Yjs peer that joins document rooms, makes live edits via tool calls, and appears
as a cursor/presence to human collaborators just like another human would.

Built as a portfolio/resume project by a B.Tech CSE student (NITK Surathkal, 2024-2028)
actively preparing for internship recruitment. Every architectural decision is chosen
to be defensible in a system design interview, not just to make features work.

The hard technical problems in this project, in order of interview value:
1. CRDT conflict resolution across concurrent human + AI edits (Yjs)
2. Horizontal scaling of stateful WebSocket servers via Redis pub/sub fan-out
3. AI agent as a Yjs peer: translating LLM tool calls into real CRDT operations
4. Multi-tenant MCP tool access (Notion OAuth per user, passed to the agent's toolbelt)

---

## Monorepo structure
```
collabforge/                         ← pnpm workspace root
├── apps/
│   ├── web/                         ← @collabforge/web      (Next.js 14 App Router, port 3000)
│   ├── api-server/                  ← @collabforge/api-server (Express, port 3001)
│   ├── realtime-server/             ← @collabforge/realtime-server (Yjs/ws, port 3002) [NOT BUILT YET]
│   └── desktop/                     ← Tauri 2.0 shell [STRETCH GOAL, NOT STARTED]
├── packages/
│   ├── shared-types/                ← @collabforge/shared-types (TS interfaces only, no runtime)
│   └── config/                      ← shared eslint/tsconfig base [placeholder only]
├── infra/
│   ├── nginx/                       ← nginx.conf for WS load balancing [NOT BUILT YET]
│   └── docker/                      ← docker-compose.yml for local dev
├── .github/workflows/               ← CI placeholder [NOT BUILT YET]
├── .claude/agents/                  ← per-section subagents (api-server, realtime-server, agent-worker, web-frontend)
├── pnpm-workspace.yaml
├── tsconfig.base.json               ← strict mode, ES2022, noEmit true (overridden per app)
├── docker-compose.yml               ← mongo:7 (27017) + redis:7 (6379) for local dev
└── .env.example                     ← documents all env vars across all services
```

Subagents scoped to each code section live in `.claude/agents/`. When a task is
squarely inside one section, delegate to its agent (see "Working with subagents").

---

## Current build state
### What exists and works
- Root monorepo config: pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml, .env.example
- `pnpm install` has been run — `node_modules/` is populated for all workspaces
- `apps/api-server`: Express entry point (`src/index.ts`), Mongo (`src/config/db.ts`) + Redis
  (`src/config/redis.ts`) connection config, health check at `GET /health`. Empty `models/`,
  `routes/`, `middleware/` dirs. No schemas, no routes, no auth yet.
- `apps/web`: Next.js 14 App Router shell, Tailwind, placeholder landing page only
- `packages/shared-types`: `User`, `AuthTokens`, `DocumentMeta`, `CollaboratorRole` interfaces
  (API-surface types only — DB-only fields like `passwordHash` are NOT here)
- Docker: mongo:7 and redis:7 running locally via `docker compose up -d`

### What does NOT exist yet
- `apps/realtime-server` — only `.gitkeep`; entire package built in Week 2
- Mongoose schemas (User, Document, DocumentSession, AgentInvocation, Session)
- Auth routes (register, login, refresh, logout)
- Any frontend routes beyond landing page
- Yjs/WebSocket anything
- LLM/agent anything
- Notion OAuth/MCP anything
- Nginx config
- CI/CD
- Tauri desktop shell

### Known issues to fix before / while building features
1. `.env.example` has `NEXT_PUBLIC_WS_URL=ws://localhost:3001` — should be `3002`
   (separate realtime-server port). Same in root `.env`.
2. `api-server` doesn't depend on `@collabforge/shared-types` yet — wire when implementing schemas
3. Root `package.json` declares npm-style `"workspaces"` alongside `pnpm-workspace.yaml` —
   harmless with pnpm, but pnpm-workspace.yaml is the source of truth

---

## Tech stack decisions (and the WHY, for interview context)
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 App Router + TypeScript | SSR for document metadata, App Router for layout nesting |
| Styling | Tailwind CSS | Rapid UI iteration |
| State | Zustand | Lightweight, no boilerplate vs Redux |
| Rich text | Tiptap (built on ProseMirror) + Yjs binding | y-prosemirror gives native CRDT binding; Tiptap has better DX than raw ProseMirror |
| Realtime | Yjs (CRDT) + y-websocket | CRDTs resolve conflicts without a central arbiter — more scalable than OT, more correct than last-write-wins |
| WS server | Node.js + ws + custom y-websocket server | |
| Horizontal WS scaling | Redis pub/sub via ioredis | Without this, users on different server instances can't see each other's edits. Each instance subscribes to doc channels, publishes local diffs, applies remote diffs — this is the core scaling mechanism |
| API | Express + TypeScript | Familiar, explicit, easy to reason about |
| DB | MongoDB via Mongoose | Document model fits doc editor naturally |
| Cache | Redis (same instance as pub/sub, separate logical usage) | Hot-path caching for doc metadata + session lookups |
| Auth | JWT access + refresh token rotation | Access token in memory (not localStorage, XSS risk), refresh in httpOnly cookie |
| Validation | Zod | Type-safe, shared with frontend via shared-types |
| LLM | Anthropic API (claude-sonnet-4-6) with tool use + streaming | Tool use API lets agent make structured edits; streaming pipes token-by-token over same WS channel |
| MCP | Notion MCP server via mcp_servers param in Anthropic API call | Per-user OAuth token, passed per-invocation |
| Reverse proxy | Nginx | Upstream block + WebSocket upgrade headers + load balancing across realtime-server replicas |
| Deployment | Vercel (web) + Railway/Render (api-server + realtime-server) + optional Oracle Cloud VM (Nginx + Docker) | Vercel can't host long-lived WS processes |
| Monitoring | Sentry (Week 6) | |
| Desktop | Tauri 2.0 (Rust) wrapping apps/web | Stretch goal — native Windows/Mac app, adds Rust to resume |

---

## MongoDB schema (implement in this order)
### User
```typescript
{
  _id: ObjectId,
  email: string,              // unique index
  passwordHash: string,
  name: string,
  avatarUrl: string | null,
  refreshTokenHash: string,
  integrations: {
    notion: {
      accessToken: string,    // encrypted at rest
      workspaceId: string,
      connectedAt: Date
    }
  },
  createdAt: Date,
  updatedAt: Date
}
```
### Document
```typescript
{
  _id: ObjectId,
  title: string,
  ownerId: ObjectId,           // ref User
  collaborators: [{ userId: ObjectId, role: "editor" | "viewer", addedAt: Date }],
  yjsState: Buffer,            // periodic Y.Doc snapshot (Y.encodeStateAsUpdate)
  yjsStateVersion: number,     // increments per snapshot, for cache invalidation
  lastEditedAt: Date,
  lastEditedBy: ObjectId,
  isArchived: boolean,
  createdAt: Date,
  updatedAt: Date
}
// Indexes: collaborators.userId, lastEditedAt
```
### DocumentSession
```typescript
{
  _id: ObjectId,
  documentId: ObjectId,
  participants: [{ userId: ObjectId, joinedAt: Date, leftAt: Date, role: "human" | "agent" }],
  realtimeServerInstanceId: string,
  startedAt: Date,
  endedAt: Date
}
```
### AgentInvocation
```typescript
{
  _id: ObjectId,
  documentId: ObjectId,
  invokedBy: ObjectId,
  prompt: string,
  toolCalls: [{
    tool: string,              // "editDocument" | "insertText" | "notion.search" | ...
    input: object,
    output: object,
    isMcpTool: boolean,
    timestamp: Date
  }],
  status: "pending" | "streaming" | "complete" | "error",
  createdAt: Date
}
// Index: documentId + createdAt
```
### Session (refresh token tracking)
```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  refreshTokenHash: string,
  userAgent: string,
  ip: string,
  expiresAt: Date,
  createdAt: Date
}
```

---

## Redis key design
### Role A — Yjs update fan-out (pub/sub)
```
Channel: doc:{documentId}:updates
Payload: binary Yjs update (Y.encodeStateAsUpdate diff)
Purpose: cross-instance edit propagation
```
### Role B — Awareness/presence (pub/sub)
```
Channel: doc:{documentId}:awareness
Payload: { userId, cursorPos, selection, color, status: "active"|"idle"|"agent-thinking" }
Purpose: cross-instance cursor/presence sync
Throttle: publish max every 100-200ms
```
### Role C — Hot-path caching
```
Key: doc:{documentId}:meta          TTL: 5 min, invalidate on write
Key: user:{userId}:session          TTL: matches access token expiry
Key: doc:{documentId}:snapshot:lock TTL: 10s (prevent concurrent Mongo snapshot writes)
```
### Role D — Rate limiting
```
Key: ratelimit:agent:{userId}:{minute}
Type: INCR + EXPIRE 60
Purpose: cap LLM/MCP invocations per user per minute
```

---

## AI agent architecture (the standout feature)
The agent is NOT a sidebar chatbot. It is a **server-side Yjs peer** — it opens its own
Y.Doc connection to the same document room as human editors, publishes awareness state
(so its cursor appears alongside human cursors), and makes edits by calling tools that
translate to Yjs operations.

### Flow
```
1. User types "@Electra [prompt]" in the document
2. api-server creates AgentInvocation record (status: "pending")
3. Agent worker opens a server-side Y.Doc connection to the document room
4. LLM call (claude-sonnet-4-6) with:
   - tools: [editDocument, insertText, formatSelection, ...]
   - mcp_servers: [{ type: "url", url: notionMcpUrl }]  ← user's Notion OAuth token attached
5. Each tool call → translated to Yjs ops on agent's Y.Doc
6. Yjs ops → published to doc:{id}:updates Redis channel
7. All connected clients (human + agent) see edits propagate live via CRDT sync
8. AgentInvocation.toolCalls[] updated as audit trail
9. Agent awareness state: "agent-thinking" → "composing" → null (leaves room)
```

### Why this is hard (interview answer)
- AI-generated edits must be reconciled with concurrent human edits via CRDT
- Multi-tenant: each user's Notion token is different, passed per-invocation
- Agent must emit awareness state updates the same way a human client would
- Tool calls can partially fail mid-stream — partial edits must not corrupt the CRDT state

---

## API routes (to be implemented)
### Auth (api-server)
```
POST /auth/register        body: { email, password, name }
POST /auth/login           body: { email, password } → sets httpOnly refresh cookie + returns access token
POST /auth/refresh         reads httpOnly cookie → rotates refresh token, returns new access token
POST /auth/logout          invalidates refresh token
GET  /auth/notion/connect  → redirects to Notion OAuth
GET  /auth/notion/callback → stores Notion token in User.integrations.notion
```
### Documents (api-server)
```
GET    /documents           list user's documents (owned + collaborator)
POST   /documents           create new document
GET    /documents/:id       get document metadata
PATCH  /documents/:id       update title, collaborators
DELETE /documents/:id       soft delete (isArchived: true)
```
### Agent (api-server)
```
POST /documents/:id/agent   invoke agent with a prompt
GET  /documents/:id/agent   get AgentInvocation history for a document
```

---

## Conventions (follow these exactly)
- Package names: `@collabforge/*` scope
- TypeScript strict mode everywhere — match tsconfig.base.json (no `any`, no loose nulls).
  Note `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are ON — respect them.
- Module resolution is NodeNext ESM: relative imports in `shared-types` use explicit `.js`
  extensions (e.g. `export * from "./user.types.js"`)
- Workspace deps: `"workspace:*"` in package.json
- Per-app `.env.example` scoped to only what that app reads
- Access token: store in memory only (never localStorage — XSS risk)
- Refresh token: httpOnly cookie only
- Passwords: bcrypt, never stored raw
- Refresh tokens: store only the hash in DB, compare hash on use, rotate on every use
- Zod schemas: define in `shared-types` where they're reused across web + api-server
- No `console.log` in production paths — use structured logging or at minimum `console.error` for errors only
- Git commits: only when explicitly asked, with conventional commit format (`feat:`, `chore:`, `fix:`)
- Do not re-scaffold existing files — extend or edit them

---

## 6-week build timeline (where we are)
```
Week 1 (NOW)  — Auth + REST API + Mongo schemas + Next.js shell + Docker local dev
Week 2        — Yjs core: single-instance collaboration, Tiptap binding, awareness/presence
Week 3        — Redis pub/sub fan-out, multiple realtime-server instances, Nginx load balancing
Week 4        — LLM agent participant (Anthropic tool use, agent as Yjs peer)
Week 5        — Notion MCP + OAuth, deployment (Vercel + Railway/Render)
Week 6        — Sentry, polish, load testing, README, resume bullet drafting
Week 7        — Tauri desktop shell (stretch goal)
```

---

## Environment
- OS: Windows 11
- Terminal: PowerShell / CMD (NOT WSL for this project); Git Bash available for POSIX scripts
- Node target: 22.x LTS (nvm-windows for version management)
- Docker Desktop: running, mongo:7 + redis:7 containers up via docker compose
- Package manager: pnpm (workspace)
- Git remote: GitHub (@somyaknotfound)

---

## Working with subagents
Section-scoped subagents live in `.claude/agents/`. Delegate a task to the matching
agent when the work is squarely inside one section:

| Agent | Owns |
|---|---|
| `api-server` | Express, Mongoose schemas, JWT auth + refresh rotation, REST routes, Zod validation, Notion OAuth callback |
| `realtime-server` | Yjs CRDT core, y-websocket server, Redis pub/sub fan-out, awareness/presence, snapshot persistence |
| `agent-worker` | LLM agent as Yjs peer, Anthropic tool use + streaming, tool-call→Yjs translation, Notion MCP wiring |
| `web-frontend` | Next.js App Router pages, Tiptap editor + Yjs binding, Zustand stores, presence UI, auth token handling |

Cross-cutting work (touching shared-types + multiple apps, or wiring contracts between
sections) stays in the main thread.

---

## Your role as Claude Code
- You are the primary implementation assistant for this project
- Before writing any code, read the actual file in the repo to confirm it matches this briefing
- Respect existing naming, conventions, and file structure — do not re-scaffold what exists
- Scope every change to only what the current task requires
- Flag (don't silently fix) any divergence between this briefing and what you find in the repo
- When suggesting architectural changes, explain the tradeoff explicitly — this is a learning
  project and interview prep, not just "make it work"
- Prefer small, reviewable diffs over large rewrites — especially in Yjs/Redis/agent code
  where subtle bugs are hard to catch
- If a task involves Yjs CRDT logic, Redis pub/sub wiring, or the agent tool-call translation
  layer: write it step by step and explain each piece — do NOT one-shot these, the developer
  needs to understand them for interviews

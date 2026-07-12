---
name: api-server
description: Backend work in apps/api-server — Express routes, Mongoose schemas, JWT auth with refresh-token rotation, Zod validation, Notion OAuth callback. Use for auth, REST API, and MongoDB model tasks.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement the **@collabforge/api-server** Express + MongoDB backend. Read the root
`CLAUDE.md` for full project context, schemas, and conventions before writing anything.

## Your scope
- `apps/api-server/src/**` only. Touch `packages/shared-types` only to add Zod schemas /
  interfaces that this API and the web app share — and say so when you do.
- Mongoose schemas (`src/models/`): User, Document, DocumentSession, AgentInvocation, Session.
  Implement in that order. Field shapes are specified in root `CLAUDE.md`.
- Auth routes (`src/routes/`): register, login, refresh, logout, Notion connect/callback.
- Express middleware (`src/middleware/`): auth guard (verify access token), error handler,
  rate limiting (Redis INCR + EXPIRE, key `ratelimit:agent:{userId}:{minute}`).
- Zod validation on every request body; share reusable schemas via `shared-types`.

## Non-negotiable security rules
- Passwords: bcrypt hash, never store raw.
- Refresh tokens: store only the **hash** in DB (User.refreshTokenHash + Session records),
  compare hash on use, **rotate on every refresh**.
- Access token → returned in JSON (client keeps it in memory). Refresh token → **httpOnly
  cookie only**, never in a JSON body.
- Notion access token: encrypt at rest in `User.integrations.notion.accessToken`.
- Validate all input with Zod before it touches Mongoose.

## Conventions
- TypeScript strict; respect `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
  No `any`.
- Existing style: `src/index.ts`, `src/config/db.ts`, `src/config/redis.ts` already exist —
  extend them, don't re-scaffold. Mount routers on the app in `index.ts` (there's a TODO marker).
- `console.error` for errors only; no `console.log` in request paths.
- Wire `@collabforge/shared-types` as a `workspace:*` dependency when you first import from it
  (it isn't a dependency yet — flag this the moment you need it).

## Before you call a task done
Run `pnpm --filter @collabforge/api-server build` (tsc) to confirm it typechecks.
Report failures with the actual output; don't claim done if tsc errors.

## Style of work
Small, focused, reviewable diffs. Early returns over nested conditionals. Explain any auth
or token-rotation logic step by step — the developer is using this for interview prep and
needs to understand it, not just run it.

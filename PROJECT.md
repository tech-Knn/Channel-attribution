# Channel Attribution System — Project Plan

## Directory Structure
```
channel-attribution/
├── src/
│   ├── config/          — Environment, constants
│   │   └── index.js
│   ├── db/              — PostgreSQL schema, migrations, queries
│   │   ├── schema.sql
│   │   ├── migrations/
│   │   ├── pool.js      — PG connection pool
│   │   └── queries.js   — All SQL queries as functions
│   ├── redis/           — Redis connection, channel queue, state ops
│   │   ├── client.js
│   │   ├── channelQueue.js
│   │   └── stateStore.js
│   ├── workers/         — BullMQ workers (one file each)
│   │   ├── matchingEngine.js    — Assigns idle channels to new articles
│   │   ├── channelState.js      — Handles channel status changes
│   │   ├── revenueAttribution.js — Pulls AFS API, writes revenue
│   │   └── expiryWorker.js      — 3-day zero-traffic reclaim
│   ├── api/             — REST API for dashboard + external triggers
│   │   ├── server.js
│   │   └── routes/
│   │       ├── articles.js
│   │       ├── channels.js
│   │       ├── assignments.js
│   │       ├── revenue.js
│   │       └── health.js
│   └── index.js         — Main entry point, starts all workers + API
├── dashboard/           — React/Next.js frontend
├── scripts/             — Utility scripts (seed data, manual ops)
├── package.json
├── .env.example
└── docker-compose.yml   — Redis + PostgreSQL for local dev
```

## Sub-Agent Assignments

### Agent 1: Database & Core (DB_AGENT)
- PostgreSQL schema (schema.sql)
- Connection pool (db/pool.js)
- All query functions (db/queries.js)
- Config module (config/index.js)
- .env.example
- docker-compose.yml (Redis + PG)
- package.json dependencies

### Agent 2: Redis & Queue System (REDIS_AGENT)
- Redis client (redis/client.js)
- Channel idle queue — sorted set ops (redis/channelQueue.js)
- State store — assignment lookups (redis/stateStore.js)
- BullMQ queue definitions and connection

### Agent 3: Workers (WORKER_AGENT)
- Matching engine worker (workers/matchingEngine.js)
- Channel state worker (workers/channelState.js)
- Revenue attribution worker (workers/revenueAttribution.js)
- Expiry worker (workers/expiryWorker.js)
- Main entry point (index.js)

### Agent 4: API & Dashboard (API_AGENT)
- Express REST API (api/server.js)
- All route handlers (api/routes/*)
- Health check endpoint
- Dashboard frontend (React)

## Conventions
- Node.js, CommonJS modules
- pg (node-postgres) for PostgreSQL
- ioredis for Redis
- bullmq for job queues
- express for API
- All async/await, no callbacks
- Every function properly documented
- Error handling + logging (console for now, structured later)

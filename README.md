# MedSupply B2B

A production-ready B2B medicine supply management system built using a TypeScript MERN monorepo architecture.

## Overview

- **Backend API**: Node.js, Express, MongoDB, Mongoose, Redis.
- **Web App**: React, Vite, Tailwind CSS.
- **Mobile App**: React Native, Expo.
- **Monorepo**: Turborepo, pnpm workspaces.

## Getting Started

Please refer to [docs/SETUP.md](docs/SETUP.md) for local development instructions.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the high-level architecture details.
The API documents itself at `/api/v1/docs`, with the OpenAPI 3.1 document at `/api/v1/docs/openapi.json`.

Phases 0-12 are implemented and the build is functionally complete: authentication, shops, catalogue and batch inventory, ordering, approval, transactional picking/packing/invoicing, delivery with custody and proof, verified payments with balanced customer ledgers and credit control, a templated notification pipeline with real-time updates and a permission-filtered activity timeline, persisted system settings with administrative user management and a read-only audit log, customer returns from request through inspection to an immutable credit note, sales/order/inventory/delivery/returns/receivables analytics with CSV export, and a hardened, indexed, documented platform packaged for deployment.

Phase 12 closed four vulnerabilities carried by earlier phases and added the protections around them - security headers, tiered rate limiting, NoSQL-injection defence, correlation identifiers, redacted structured logging, immediate session revocation with self-service session management on web and mobile, the indexes the reporting layer needed, split liveness and readiness probes, graceful shutdown, container images, an nginx reference configuration and a CI pipeline on Node 20 LTS. See [docs/SECURITY.md](docs/SECURITY.md) for what was found and what was done about it, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the release sequence.

Redis is optional in development: without it the API runs an in-process notification queue, per-instance rate-limit budgets and a single-instance Socket.IO server, and reports which drivers it started with at `/api/v1/admin/runtime`.

The full stack is verified on Docker. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build` brings up MongoDB, Redis, the API and an nginx-served web tier on one origin; the integration suite also passes against a real MongoDB 6.0 replica set. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the release sequence and the first-sign-in step.

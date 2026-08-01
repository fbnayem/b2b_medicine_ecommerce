# Seed Strategy

The seed strategy for MedSupply B2B ensures that the database is populated with deterministic, non-production test data for development and testing environments.

## Development Seeding

- **Users**: Seed users for every role (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `STOREKEEPER`, `DELIVERY_PERSON`, `SHOP_OWNER`) using predictable credentials (e.g., `admin@medsupply.local` / `Password123!`).
- **Shops**: Seed 2-3 shops with different statuses (Active, Suspended, Credit Blocked).
- **Medicines & Inventory**: Seed a small catalogue of ~10 common medicines, with 2-3 batches each, to test FEFO logic.
- **Settings**: Seed basic system settings (currency, timezone).

## Execution

Seeding will be executed via a dedicated Turborepo script:
`pnpm run seed`

This script will:

1. Check `NODE_ENV` to strictly prevent execution in `production`.
2. Clear existing collections (if forced).
3. Insert predefined JSON/TypeScript objects in the correct foreign-key dependency order (Roles -> Users -> Shops -> Medicines -> Batches).

_(Detailed implementation of the seed data is deferred to Phase 1 and Phase 2)._

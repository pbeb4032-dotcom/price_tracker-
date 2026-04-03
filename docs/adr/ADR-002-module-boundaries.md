# ADR-002: Domain/Module Boundaries

## Status: Accepted

## Context
The application spans multiple domains: price data, products, stores, regions, user management, moderation, and alerts. Without clear boundaries, the codebase will become tangled.

## Decision
Organize code by domain module, not by technical layer. Each module owns its types, hooks, components, and validation schemas.

```
src/
  modules/
    auth/       → login, signup, profile
    prices/     → price reports, voting
    products/   → product catalog, aliases
    stores/     → store registry
    alerts/     → user alert subscriptions
    moderation/ → review queue, actions
  lib/          → shared utilities (errors, telemetry, validation helpers)
  components/   → shared UI primitives (design system)
```

## Rationale
1. **Cohesion**: Related code lives together — easier to understand and modify.
2. **Independence**: Modules can evolve independently. Changing alert logic doesn't touch price reporting.
3. **Clear ownership**: Each module has a defined responsibility and database tables.
4. **Testability**: Modules can be tested in isolation.

## Consequences
- Cross-module imports should go through explicit public APIs (index.ts barrel exports).
- Shared types (e.g., region references) live in `lib/types/`.
- Circular dependencies between modules are forbidden.

# ADR-004: Testing Strategy

## Status: Accepted

## Context
A fair-price intelligence system must be trustworthy. Bugs in price aggregation or authorization can erode user trust or expose sensitive data.

## Decision
Adopt a testing pyramid with Vitest for unit/integration tests and browser-based smoke tests for critical flows.

### Testing Layers

| Layer | Tool | What to Test |
|-------|------|-------------|
| **Unit** | Vitest | Zod schemas, utility functions, data transformations |
| **Component** | Vitest + Testing Library | Form validation, RTL rendering, accessibility |
| **Integration** | Vitest | Hook behavior, API client mocking |
| **E2E Smoke** | Browser tools | Auth flow, price submission, alert creation |

### Critical Test Cases (Priority Order)
1. Zod schema validation: valid/invalid price reports
2. Authentication: signup, login, session persistence
3. RLS: unauthorized access attempts return errors
4. Price submission: valid data persists, invalid rejected
5. Moderation: only moderators can take actions
6. RTL rendering: layout doesn't break in Arabic

## Consequences
- All new features must include unit tests for validation schemas.
- CI must run `vitest run` and `tsc --noEmit` before merge.
- Test files co-located with modules: `module/__tests__/`.
- Test utilities in `src/test/` for shared helpers.

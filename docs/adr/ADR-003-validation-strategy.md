# ADR-003: Validation Strategy

## Status: Accepted

## Context
User-submitted price data is the core of the system. Invalid, malicious, or nonsensical data must be rejected at every boundary.

## Decision
Use Zod as the single validation library for all runtime input validation. Validate at three boundaries:

1. **Client-side forms**: Zod schemas + react-hook-form for immediate user feedback.
2. **Edge functions**: Zod validation before any database write.
3. **Database**: CHECK constraints and validation triggers as final safety net.

## Rationale
1. **Single source of truth**: One schema definition used across client and server.
2. **TypeScript integration**: Zod infers TypeScript types — no type/schema drift.
3. **Composable**: Schemas can extend and compose for complex validation rules.
4. **Arabic text support**: Custom refinements for Arabic-specific validation (text direction, character ranges).

## Schema Hierarchy
```
Base Schema (shared types)
  └─ Form Schema (client validation, UI error messages in Arabic)
       └─ API Schema (server validation, strict mode)
            └─ DB Constraints (final safety net)
```

## Consequences
- All form inputs validated before submission.
- All edge function inputs validated before database writes.
- Error messages must be bilingual (Arabic primary, English fallback).
- No `any` types — all inputs typed via Zod inference.

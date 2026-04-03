# ADR-005: Observability Strategy

## Status: Accepted

## Context
Production issues in a price intelligence app (wrong prices displayed, failed submissions, auth errors) must be detected and diagnosed quickly.

## Decision
Implement structured error handling with telemetry hooks that can be connected to external providers.

### Error Handling
- All errors wrapped in `AppError` class with code, message, and context.
- Error boundary components catch React rendering errors.
- Edge function errors return standardized error envelope.

### Telemetry Hooks
```typescript
// Pluggable telemetry interface
interface TelemetryProvider {
  trackEvent(name: string, properties?: Record<string, unknown>): void;
  trackError(error: AppError): void;
  setUser(userId: string): void;
}
```

### Integration Points
- **Console logger**: Default provider for development.
- **Future**: Sentry, PostHog, or similar — swap provider without code changes.

### Key Metrics to Track
1. Price report submission success/failure rate
2. Auth flow completion rate
3. API response times (edge functions)
4. Client-side errors by module
5. RLS policy denial rate (via Postgres logs)

## Consequences
- All error handling uses `AppError` — no raw `throw new Error()`.
- Telemetry provider is injected via React context.
- No PII in telemetry events (user IDs only, no names/emails).
- Development uses console logger; production provider configured via environment.

# ADR-001: Why Supabase + Row Level Security

## Status: Accepted

## Context
Shkad Aadel needs a backend with authentication, a relational database, and fine-grained authorization. The team is small and speed-to-production matters. We need a solution that doesn't require managing servers, yet provides enterprise-grade security.

## Decision
Use Lovable Cloud (powered by Supabase) as the backend platform, with Row Level Security (RLS) as the primary authorization mechanism.

## Rationale
1. **Zero-infra management**: Hosted PostgreSQL, auth, edge functions, and storage — no servers to manage.
2. **RLS is policy-based**: Authorization is enforced at the database level, not in application code. Even if frontend code is bypassed, data remains protected.
3. **Security definer functions**: Prevent RLS recursion when checking roles.
4. **Realtime subscriptions**: Built-in support for live price updates.
5. **Edge functions**: Serverless compute for moderation workflows, notifications, and anomaly detection.

## Consequences
- All tables MUST have RLS enabled and policies defined before use.
- Role checks via `has_role()` function to avoid infinite recursion.
- Developers must understand RLS to modify data access patterns.
- Testing requires mocking auth context for policy verification.

## Alternatives Considered
- **Custom Node.js API**: More flexibility, but requires managing servers, auth, and authorization manually. Higher maintenance burden.
- **Firebase**: Firestore rules are less expressive than SQL RLS. No relational model.

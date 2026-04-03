# Shkad Aadel — Architecture Document

## 1. System Context

Shkad Aadel is a fair-price intelligence platform for Iraq. Users (consumers, shoppers, community reporters) submit price observations for everyday products across Iraqi regions. The system aggregates, validates, and surfaces fair price signals so citizens can make informed purchasing decisions.

### Actors

| Actor | Description |
|-------|-------------|
| **Consumer** | Browses prices, sets alerts, votes on reports |
| **Reporter** | Submits price observations from stores |
| **Moderator** | Reviews flagged reports, takes moderation actions |
| **System** | Background processes: aggregation, anomaly detection |

### External Dependencies

- **Lovable Cloud (Supabase)**: PostgreSQL, Auth, Edge Functions, Storage
- **Frontend**: React + Vite + Tailwind (RTL Arabic-first)

## 2. Module Boundaries

```
┌─────────────────────────────────────────────┐
│                  Frontend                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │   Auth    │ │  Prices  │ │   Alerts     ││
│  │  Module   │ │  Module  │ │   Module     ││
│  └──────────┘ └──────────┘ └──────────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │ Products │ │  Stores  │ │  Moderation  ││
│  │  Module  │ │  Module  │ │   Module     ││
│  └──────────┘ └──────────┘ └──────────────┘│
└─────────────────────────────────────────────┘
          │              │
          ▼              ▼
┌─────────────────────────────────────────────┐
│           Lovable Cloud (Supabase)           │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐│
│  │   Auth   │ │ Database │ │Edge Functions ││
│  └──────────┘ └──────────┘ └──────────────┘│
│  ┌──────────┐ ┌──────────────────────────┐  │
│  │ Storage  │ │    Row Level Security    │  │
│  └──────────┘ └──────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Module Responsibilities

| Module | Responsibility | DB Tables |
|--------|---------------|-----------|
| **Auth** | Sign up, login, profile management | profiles |
| **Prices** | Report submission, browsing, voting | price_reports, report_votes |
| **Products** | Product catalog, aliases for Arabic variants | products, product_aliases |
| **Stores** | Store registry by region | stores, regions |
| **Alerts** | User price alert subscriptions | alerts |
| **Moderation** | Report review, actions, audit trail | moderation_actions, audit_logs |

## 3. Data Flow

1. **Reporter** submits price → `price_reports` (status: pending)
2. **Community** votes on report → `report_votes` (trust signal)
3. **Moderator** reviews flagged reports → `moderation_actions`
4. **Consumer** browses approved prices, sets alerts
5. All write operations → `audit_logs` (append-only via triggers)

## 4. Security Model

- **Authentication**: Email/password via Lovable Cloud Auth
- **Authorization**: RLS policies on every table — no client-side authorization
- **Roles**: Stored in `user_roles` table (enum: user, moderator, admin)
- **Role checking**: `has_role()` security definer function to prevent RLS recursion
- **Write paths**: All writes require `auth.uid()` — no anonymous writes
- **Audit**: All moderation actions logged immutably

## 5. Scalability Notes

- PostgreSQL indexes on high-cardinality columns (region_id, product_id, created_at)
- Composite indexes for common query patterns (product + region + date)
- Views for aggregated price data (avoid N+1 queries)
- Edge functions for compute-heavy operations (anomaly detection, future)
- Pagination on all list endpoints (cursor-based preferred)

## 6. Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| DB connection loss | Full outage | Retry with exponential backoff, error boundary UI |
| Auth service down | No logins/writes | Graceful degradation, cached reads still work |
| Malicious price data | Corrupted signals | Moderation queue, vote-based trust, anomaly flags |
| RLS misconfiguration | Data leak | Security definer functions, automated RLS linting |
| High write volume | Slow inserts | Rate limiting via edge functions, batch writes |
| Region data gaps | Incomplete coverage | UI shows data availability indicators |

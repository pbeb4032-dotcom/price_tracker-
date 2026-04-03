# Shkad Aadel — API Contract

## 1. Conventions

### Endpoint Naming
All data access uses Supabase client SDK (PostgREST). Edge functions for custom logic follow:

```
/functions/v1/{domain}-{action}
```

Examples:
- `POST /functions/v1/prices-submit` — Submit a price report
- `POST /functions/v1/moderation-action` — Take moderation action
- `GET  /functions/v1/prices-aggregate` — Get aggregated price data

### Versioning
- Edge function paths include `v1` prefix.
- Breaking changes require new version (`v2`).
- Old versions maintained for 2 release cycles minimum.

## 2. Request/Response Schemas

### Standard Success Envelope
```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2026-02-09T12:00:00Z",
    "request_id": "uuid"
  }
}
```

### Standard Error Envelope
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message (Arabic)",
    "message_en": "Human-readable message (English)",
    "details": [
      {
        "field": "price",
        "issue": "يجب أن يكون السعر رقماً موجباً",
        "issue_en": "Price must be a positive number"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-02-09T12:00:00Z",
    "request_id": "uuid"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate resource |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## 3. Authentication
All write endpoints require `Authorization: Bearer <token>` header.
Read endpoints for approved data are public (enforced via RLS).

## 4. Pagination
List endpoints support cursor-based pagination:
```
?cursor=<last_id>&limit=20
```

Response includes:
```json
{
  "data": [...],
  "meta": {
    "has_more": true,
    "next_cursor": "uuid"
  }
}
```

## 5. Rate Limiting
- Authenticated users: 60 requests/minute
- Price submissions: 10 per hour per user (abuse prevention)
- Voting: 1 vote per report per user (enforced via unique constraint)

## 6. Key Endpoints (Future)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/functions/v1/prices-submit` | POST | Required | Submit price report |
| `/functions/v1/prices-aggregate` | GET | Public | Aggregated prices by product/region |
| `/functions/v1/moderation-action` | POST | Moderator | Take moderation action |
| `/functions/v1/alerts-check` | POST | System | Check and fire alerts |

# Shkad Aadel — Security Permission Matrix

## Actor Definitions

| Actor | Description |
|-------|------------|
| **anon** | Unauthenticated user (public) |
| **auth** | Authenticated user with `user` role |
| **mod** | Authenticated user with `moderator` role |
| **admin** | Authenticated user with `admin` role |
| **service** | Backend triggers / service_role key |

## Table-by-Table Permissions

### profiles
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (public) | ✅ (public) | ✅ (public) | ✅ (public) | ✅ |
| INSERT | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| UPDATE | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| DELETE | ❌ | ❌ | ❌ | ❌ | ✅ |

### price_reports
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (approved only) | ✅ (approved + own) | ✅ (all) | ✅ (all) | ✅ |
| INSERT | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| UPDATE | ❌ | ✅ (own, pending only) | ✅ (all) | ✅ (all) | ✅ |
| DELETE | ❌ | ❌ | ✅ | ✅ | ✅ |

### report_votes
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (public) | ✅ (public) | ✅ (public) | ✅ (public) | ✅ |
| INSERT | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| UPDATE | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| DELETE | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |

### alerts
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| INSERT | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| UPDATE | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| DELETE | ❌ | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |

### products
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (public) | ✅ (public) | ✅ (public) | ✅ (all) | ✅ |
| INSERT | ❌ | ❌ | ❌ | ✅ | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ✅ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ✅ | ✅ |

### product_aliases
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (public) | ✅ (public) | ✅ (public) | ✅ (all) | ✅ |
| INSERT | ❌ | ❌ | ❌ | ✅ | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ✅ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ✅ | ✅ |

### regions
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (public) | ✅ (public) | ✅ (public) | ✅ (all) | ✅ |
| INSERT | ❌ | ❌ | ❌ | ✅ | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ✅ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ✅ | ✅ |

### stores
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ✅ (public) | ✅ (public) | ✅ (public) | ✅ (all) | ✅ |
| INSERT | ❌ | ✅ (own) | ✅ (own) | ✅ (all) | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ✅ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ✅ | ✅ |

### moderation_actions
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ❌ | ❌ | ✅ | ✅ | ✅ |
| INSERT | ❌ | ❌ | ✅ (own) | ✅ | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ❌ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ❌ | ✅ |

### audit_logs
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ❌ | ❌ | ❌ | ✅ | ✅ |
| INSERT | ❌ | ❌ | ❌ | ❌ | ✅ (triggers only) |
| UPDATE | ❌ | ❌ | ❌ | ❌ | ❌ |
| DELETE | ❌ | ❌ | ❌ | ❌ | ❌ |

### user_roles
| Operation | anon | auth | mod | admin | service |
|-----------|------|------|-----|-------|---------|
| SELECT | ❌ | ✅ (own) | ✅ (own) | ✅ (all) | ✅ |
| INSERT | ❌ | ❌ | ❌ | ✅ | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ✅ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ✅ | ✅ |

## Views (Public Read)

| View | Description | Exposed Columns |
|------|-------------|----------------|
| `v_approved_reports` | Approved reports without user_id | id, product_id, store_id, region_id, price, currency, unit, quantity, notes, upvotes, downvotes, trust_score, reported_at, created_at |
| `v_product_price_summary` | Aggregated stats per product/region | product_id, name_ar, name_en, category, unit, region_id, report_count, avg_price, min_price, max_price, latest_report_at |

## Database Constraints (Hardening)

| Table | Constraint | Rule |
|-------|-----------|------|
| report_votes | uq_report_votes_user_report | One vote per user per report |
| product_aliases | uq_product_alias_norm | Unique alias per product+language |
| alerts | uq_alerts_dedup | One alert per user/product/region/type |
| price_reports | chk_price_range | 0 < price ≤ 999,999,999 |
| price_reports | chk_quantity_positive | quantity > 0 when set |
| price_reports | chk_trust_score_range | 0 ≤ trust_score ≤ 100 |
| alerts | chk_alert_target_price | target_price > 0 when set |
| stores | chk_store_latitude/longitude | Valid geo ranges |
| regions | chk_region_latitude/longitude | Valid geo ranges |

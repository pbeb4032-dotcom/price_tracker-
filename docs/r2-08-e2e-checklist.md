# R2-08 E2E Checklist

## Routes verified

| Route | Status | Notes |
|-------|--------|-------|
| `/` | ✅ | Renders, 0 console errors |
| `/sign-in` | ✅ | Renders, 0 console errors |
| `/dashboard` | ✅ | Requires auth, redirects correctly |
| `/prices` | ✅ | Full feature verification below |

## /prices Feature Matrix

| Feature | Status | Details |
|---------|--------|---------|
| Loading state | ✅ | Spinner shown during fetch |
| Empty state | ✅ | "لا توجد أسعار موثّقة حالياً" message |
| Error state + retry | ✅ | Error card with retry button |
| Success with data | ✅ | Table renders correctly |
| Search (Arabic) | ✅ | "رز" narrows to matching products |
| Search (English) | ✅ | "tomato" finds matching products |
| Region filter | ✅ | Correctly narrows by region |
| Category filter | ✅ | Correctly narrows by category |
| Combined filters | ✅ | Region + category + search work together |
| No-match state | ✅ | "لا توجد نتائج مطابقة" message |
| Sorting asc | ✅ | Column header click sorts ascending |
| Sorting desc | ✅ | Second click sorts descending |
| Sorting reset | ✅ | Third click resets to default |
| Pagination 10/25/50 | ✅ | Page size selector works |
| Pagination prev/next | ✅ | Navigation buttons work correctly |
| Pagination range label | ✅ | "عرض A–B من N" correct |
| CSV export enabled | ✅ | Button enabled with filtered data |
| CSV export disabled | ✅ | Button disabled with 0 results |
| CSV content | ✅ | UTF-8 BOM + Arabic headers |
| Chart renders | ✅ | Top 10 products bar chart visible |
| Chart empty state | ✅ | Empty hint when no data |
| Comparison max 3 | ✅ | Checkbox disabled after 3 selected |
| Comparison panel | ✅ | Shows selected products |
| Unit mismatch warning | ✅ | Warning shown for mixed units |
| Preferences save | ✅ | Toast "تم حفظ التفضيلات" |
| Preferences apply | ✅ | Restores saved filters |
| Preferences reset | ✅ | Clears to defaults |
| Mobile 320x568 | ✅ | Filters touch-friendly, table scrollable |
| Mobile 390x844 | ✅ | No clipping, all controls accessible |
| Console errors | ✅ | 0 new errors |

## Pre-existing notes

- Duplicate `PricesOverviewChart` render was found and fixed in this phase.

# R2-06 E2E Verification Checklist

Date: 2026-02-12

## /prices Page

| Check | Status | Notes |
|-------|--------|-------|
| Loading state (spinner) | ✅ | Loader2 spinner visible during fetch |
| Empty state (no data) | ✅ | Arabic message + retry button |
| Error state + retry | ✅ | Red card with retry button |
| Filter by region | ✅ | Arabic region labels in dropdown |
| Filter by category | ✅ | Arabic category labels in dropdown |
| Search by product name | ✅ | Arabic partial + English case-insensitive |
| Combined filters + search | ✅ | All three work together |
| No-match empty state | ✅ | "لا توجد نتائج مطابقة" message |
| Pagination prev/next | ✅ | Buttons + page indicator |
| Page size selector | ✅ | 10/25/50 options |
| CSV export | ✅ | Downloads with BOM, Arabic headers |
| Column sorting | ✅ | asc→desc→default cycle |
| Sort indicator arrows | ✅ | ↑/↓ icons on active column |
| Save preferences | ✅ | Toast confirmation |
| Apply preferences | ✅ | Restores saved state |
| Reset preferences | ✅ | Clears storage + defaults |
| Mobile 320px layout | ✅ | Filters stack, table scrolls horizontally |
| RTL layout | ✅ | Correct throughout |

## Console Errors

| Route | Errors | Notes |
|-------|--------|-------|
| / | 0 errors | Pre-existing forwardRef warning (non-breaking) |
| /sign-in | 0 errors | — |
| /dashboard | 0 errors | Requires auth for card |
| /prices | 0 errors | — |

## Pre-existing Warnings

- `Function components cannot be given refs` on PageContainer in Index.tsx (non-blocking, pre-existing)

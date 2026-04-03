# R2-07 E2E Verification Checklist

## Date: 2026-02-12

---

## / (Home)
- [ ] Page loads without console errors
- [ ] Navigation links visible and functional

## /sign-in
- [ ] Page loads without console errors
- [ ] Form fields render correctly (RTL)

## /dashboard
- [ ] Page loads (requires auth)
- [ ] No console errors

## /prices — Core States
- [ ] **Loading state**: spinner visible during fetch
- [ ] **Empty state**: message shown when no data
- [ ] **Error state**: error card + retry button shown on fetch failure
- [ ] **Retry**: clicking retry re-fetches data

## /prices — Search
- [ ] Arabic search (e.g. "رز") narrows results
- [ ] English search (e.g. "rice") narrows results
- [ ] Clearing search restores full list
- [ ] Diacritics ignored in search

## /prices — Filters
- [ ] Region dropdown populated with Arabic labels
- [ ] Category dropdown populated with Arabic labels
- [ ] Selecting region narrows results
- [ ] Selecting category narrows results
- [ ] Combined region + category narrows correctly
- [ ] **No-match state**: message shown when filters yield 0 results

## /prices — Sorting
- [ ] Click header → asc (↑ indicator)
- [ ] Click again → desc (↓ indicator)
- [ ] Click again → default (no indicator)
- [ ] Sorting applies after filter, before pagination

## /prices — Pagination
- [ ] Page size 10/25/50 selector works
- [ ] "التالي" advances page
- [ ] "السابق" goes back
- [ ] Buttons disabled at boundaries
- [ ] Range text "عرض A–B من N" correct
- [ ] Changing filters/search/pageSize resets to page 1

## /prices — CSV Export
- [ ] Button disabled when 0 filtered results
- [ ] Button enabled when results exist
- [ ] Download triggers with Arabic filename
- [ ] CSV contains all filtered rows (not just current page)

## /prices — Preferences
- [ ] "حفظ التفضيلات" saves to localStorage
- [ ] "تطبيق المحفوظة" restores saved state
- [ ] "إعادة تعيين" clears and resets defaults
- [ ] Toast messages appear for each action

## /prices — Chart (R2-07B)
- [ ] Chart renders below filters showing top 10 products
- [ ] Chart updates with filter/search changes
- [ ] Empty state shows hint when no data
- [ ] Arabic labels readable

## /prices — Product Comparison (R2-07C)
- [ ] Checkbox selection on rows (max 3)
- [ ] Comparison panel appears with selected products
- [ ] Mixed-unit warning shown when applicable
- [ ] "مسح التحديد" clears selection
- [ ] Empty selection shows no panel

## Mobile Checks
- [ ] 320px viewport: all elements accessible, no horizontal overflow
- [ ] 390px viewport: filters stack vertically, table scrollable

## Console Errors
- [ ] `/` — 0 new errors
- [ ] `/sign-in` — 0 new errors
- [ ] `/dashboard` — 0 new errors
- [ ] `/prices` — 0 new errors

# Final DB Proof Runbook

استخدم هذا الملف فقط لما تكون PostgreSQL/API شغالة فعلًا.

## 1) تثبيت الحزم
```bash
npm ci --no-audit --no-fund
npm --prefix api ci --no-audit --no-fund
```

## 2) تحديد DATABASE_URL
مثال محلي:
```bash
export DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54321/price_tracker_iraq'
export APP_JWT_SECRET='local-dev-secret'
```

PowerShell:
```powershell
$env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54321/price_tracker_iraq'
$env:APP_JWT_SECRET='local-dev-secret'
```

## 3) DB preflight (شبكة + auth + select 1 فعلي)
هذا يثبت أولًا أن `DATABASE_URL` نفسها توصل إلى PostgreSQL صحيحة:
```bash
npm run validate:db:preflight
```

## 4) Proof عام على البيانات الحقيقية
يشغّل patches + taxonomy jobs + snapshot before/after:
```bash
npm run validate:db:live
```

## 5) Proof deterministic للـ conflict queue
ينشئ fixture product/conflict مؤقتين ويثبت insert/open/resolve على DB نفسها:
```bash
npm run validate:db:fixture
```

## 6) DB bundle + Proof suite الأوفلاين + build
```bash
npm run validate:db:bundle
npm run validate:all:light
npm run validate:build
```

## النجاح المطلوب قبل final release
- `validate:api` = pass
- `validate:frontend:syntax` = pass
- `validate:classifier` = pass
- `validate:governance:e2e` = pass
- `validate:build` = pass
- `validate:db:preflight` = pass
- `validate:db:fixture` = pass
- `validate:db:live` = pass

إذا فشل `validate:db:live` بـ `ECONNREFUSED` فهذا مو فشل بالكود؛ هذا يعني PostgreSQL/API مو شغالة أو `DATABASE_URL` غلط.

# Final Release Runbook

هذا الملف يحوّل المشروع من **checkpoint جاهز** إلى **final release** أول ما تكون PostgreSQL شغالة.

## المتطلبات
- Node/npm
- PostgreSQL قابلة للوصول عبر `DATABASE_URL`
- يفضّل أيضًا `zip` على Linux/macOS أو PowerShell على Windows للحزم النهائية

## 1) تثبيت الحزم
```bash
npm ci --no-audit --no-fund
npm --prefix api ci --no-audit --no-fund
```

## 2) ضبط البيئة
```bash
export DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54321/price_tracker_iraq'
export APP_JWT_SECRET='local-dev-secret'
```

PowerShell:
```powershell
$env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54321/price_tracker_iraq'
$env:APP_JWT_SECRET='local-dev-secret'
```

## 3) تشغيل release gate الكامل
```bash
npm run validate:release:full
```
هذا الأمر يكتب أيضًا:
- `artifacts/final-release-proof.json`

## 4) إنشاء ZIP النهائي
Linux/macOS:
```bash
bash scripts/build-final-release.sh
```

Windows PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-final-release.ps1
```

## النجاح المطلوب قبل إعلان النسخة final
- كل خطوات `validate:release:full` = PASS
- `artifacts/final-release-proof.json` يحتوي `allPassed: true`
- ملف `artifacts/price-tracker-iraq-final-release.zip` ينشأ بنجاح

## إذا الrelease gate يوقف قبل الفحوص
إذا طلع `blocked: dependency_install` داخل `artifacts/final-release-proof.json` فهذا طبيعي في نسخ checkpoint لأن `node_modules` غير مضمنة. وقتها نفّذ فقط:
```bash
npm ci --no-audit --no-fund
npm --prefix api ci --no-audit --no-fund
```
وبعدين أعد تشغيل `npm run validate:release:full`.

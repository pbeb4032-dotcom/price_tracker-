# Price Tracker Iraq — تشغيل النسخة الحالية (ChatGPT final checkpoint)

## شنو موجود بهذي النسخة
- **سورس كامل للمشروع** (واجهة + API + DB + migrations + scripts)
- التعديلات المثبتة في هذه الدفعة تشمل:
  - Quarantine end-to-end أثناء الجلب
  - Review من واجهة الأدمن + **اعتماد + استرجاع السعر**
  - تحسينات compare/QR الموجودة في checkpoint
- **غير مرفق**: `node_modules` / أسرار `.env` / بيانات قاعدة البيانات (طبيعي)



## ✅ تشغيل كامل على Docker Desktop (DB + API + Web + SearxNG) — بدون Supabase
هذا هو الخيار اللي تريده إذا تريد "شغل عالمي" بدون تعقيد.

### Windows
شغّل:
- `scripts\run-docker.ps1`

أو من التيرمنال:
```bash
docker compose -f docker-compose.full.yml up -d --build
```

### Linux / macOS
```bash
bash scripts/run-docker.sh
```

بعدها:
- Web: `http://localhost:8080`
- API: `http://localhost:8787/health`
- SearxNG: `http://localhost:8081`

> ملاحظة: SearxNG مطلوب لميزة **Auto Source Discovery** (+300/+1000 مصدر).

---

---

## 1) المتطلبات
- **Node.js 20+**
- يفضل **Bun** (لأن المشروع مهيأ له)، لكن تگدر تستخدم npm
- **PostgreSQL / Supabase** جاهز (أو Docker Compose إذا تريد تشغيل محلي)

تحقق سريع:
```bash
node -v
npm -v
# اختياري
bun -v
```

---

## 2) إعداد ملفات البيئة (.env)
أنشئ ملف `.env` في **جذر المشروع** (root) باستخدام `.env.example`:

```bash
cp .env.example .env
```

### أهم القيم المطلوبة في `.env`
- `DATABASE_URL` ✅ (مهم جدًا للـ API)
- `APP_JWT_SECRET` ✅ (مهم)
- `INTERNAL_JOB_SECRET` ✅ (للـ jobs/admin endpoints الداخلية)
- `DEV_LOGIN_SECRET` ✅ (للدخول التطويري إذا تستخدمه)
- `API_PORT` (اختياري، الافتراضي 8787)
- `VITE_API_BASE_URL` (للواجهة، مثال: `http://localhost:8787`)

> ملاحظة: ملف `api/src/server.ts` يقرأ **نفس ملف `.env` من جذر المشروع**.

---

## 3) تثبيت الحزم (dependencies)
### خيار Bun (الموصى به)
```bash
bun install
cd api && bun install && cd ..
```

### خيار npm
```bash
npm install
cd api && npm install && cd ..
```

---

## 4) إعداد قاعدة البيانات + المايغريشنات
إذا أنت تستخدم **Supabase محلي/بعيد**:

### (أ) تطبيق مخطط القاعدة الأساسي (إذا القاعدة جديدة)
نفّذ SQL الموجود داخل:
- `db/init/00_schema.sql`

### (ب) تطبيق المايغريشنات
تأكد من تشغيل المايغريشنات (خصوصًا:
- `db/migrations/0006_price_anomaly_quarantine_review.sql`
)

إذا عندك Supabase CLI:
```bash
supabase db push
```

> إذا صار اختلاف بين النسخة المحلية والبعيدة، طبق SQL migration يدويًا من ملف المايغريشن.

---

## 5) التشغيل المحلي
## الطريقة السريعة (سكربتات جاهزة)
### Linux / macOS
```bash
chmod +x scripts/run-dev.sh
./scripts/run-dev.sh
```

### Windows PowerShell
```powershell
Set-ExecutionPolicy -Scope Process Bypass
./scripts/run-dev.ps1
```

هذي السكربتات تشغّل:
- Frontend (Vite) غالبًا على: `http://localhost:8080`
- API (Hono) على: `http://localhost:8787`

## الطريقة اليدوية
### Terminal 1 — API
```bash
cd api
# Bun
bun run dev
# أو npm
npm run dev
```

### Terminal 2 — Frontend
```bash
# من جذر المشروع
# Bun
bun run dev
# أو npm
npm run dev
```

---

## 6) اختبارات سريعة بعد التشغيل (لازم تسويها)
## A) فحص الـ API الأساسي
```bash
curl http://localhost:8787/health
```
(إذا المشروع ما بي `/health` استخدم أي endpoint views معروف عندك)

## B) فحص واجهة المسح QR/Barcode
- افتح الواجهة
- روح لصفحة **/scan**
- جرّب barcode أو نص/رابط QR
- تأكد يظهر:
  - المنتج
  - العروض
  - أفضل عرض
  - أزرار المقارنة/الفتح

## C) فحص المقارنة
- افتح صفحة منتج فيها عروض متعددة
- تأكد الترتيب ينعمل من السيرفر (compare_offers) مو فقط محلي

## D) فحص Quarantine (الميزة الجديدة end-to-end)
1. شغّل ingestion/job يجيب أسعار (أو أرسل سعر شاذ/مكسور)
2. افتح **Admin > Jobs**
3. تأكد تظهر عناصر quarantine
4. جرّب:
   - اعتماد
   - رفض
   - تجاهل
   - **اعتماد + استرجاع السعر** ✅
5. تأكد بعد الاعتماد+الاسترجاع أن السعر ينضاف إلى `source_price_observations`

## E) فحص FX (سعر الصرف) — rollover لليوم
إذا الـ UI يعتمد على "سعر اليوم" وDB ما بي صف لليوم، شغّل هالـ job:

```powershell
./scripts/fx-rollover-today.ps1
```

يرح ينسخ آخر أسعار موجودة ويضيفها كسعر **لليوم الحالي** (مفيد للتطوير المحلي).

---

## ✅ إصلاح نهائي للكاتيجوري والأسعار (مرة واحدة بعد التحديث)
إذا كانت عندك بيانات قديمة من نسخة سابقة، فطبيعي تشوف:
- كاتيجوريز ملخبطة (غذائيات تطلع عطور/ملابس…)
- أسعار مقطوعة (مثل 100 بدل 100,000)

بهذه النسخة انصلحت جذريًا:
- **Parsing الأسعار** يدعم 100.000 / 1.250.000 / الأرقام العربية
- **Domain hints** صار محافظ (شيلنا "market" حتى لا يلوّث التصنيف)
- **Ingestion** يسمح بتصحيح التصنيف إذا كان الدليل النصي قوي

لكن حتى تنظّف القديم، شغّل هذي الـ Jobs مرة وحدة:

### 1) تعليم الأسعار المنخفضة جدًا كـ Anomaly (منع "100.000" -> 100)
```powershell
$api = "http://localhost:8787"
$secret = "job-secret"
$headers = @{ "Content-Type"="application/json"; "x-job-secret"=$secret }
Invoke-RestMethod -Method Post -Uri "$api/admin/jobs/fix_low_price_outliers" -Headers $headers -Body '{"limit":20000,"min":1,"max":999,"dryRun":false}'
```

### 2) إعادة تصنيف كل المنتجات (تنظيف الأقسام)
```powershell
Invoke-RestMethod -Method Post -Uri "$api/admin/jobs/reclassify_categories" -Headers $headers -Body '{"limit":50000,"force":true}'
```

### 3) (اختياري) شغّل ingest حتى يثبت الأسعار/التصنيف الجديد على البيانات الجديدة
```powershell
Invoke-RestMethod -Method Post -Uri "$api/admin/jobs/ingest" -Headers $headers -Body '{"limit":5000,"concurrency":16,"perDomain":80}'
```

## 7) ملاحظات مهمة جدًا
- هذه النسخة **قابلة للتشغيل كمشروع حقيقي** لكن تحتاج:
  - dependencies
  - `.env`
  - DB/migrations
- ما ضفنا `node_modules` داخل الـ ZIP (حتى يبقى نظيف وخفيف)
- إذا تستخدم Supabase Edge Functions لبعض المسارات القديمة، تأكد أسرار/روابط المشروع مضبوطة

---

## 8) إذا صار خطأ سريع (Checklist)
- `Failed to connect database` → راجع `DATABASE_URL`
- `401` على jobs/admin endpoints → راجع `INTERNAL_JOB_SECRET` / صلاحيات الأدمن
- الواجهة ما تجيب API → راجع `VITE_API_BASE_URL`
- quarantine table ما تظهر → طبّق migration رقم 0006
- الفلاتر (الكاتيجوري) تطلع نتائج غلط → لازم يصير ingest حقيقي حتى المنتجات تنحفظ بكتايجوري صحيح (صار بيها تحسين قوي بهالنسخة)

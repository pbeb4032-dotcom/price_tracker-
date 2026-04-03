# Price Tracker Iraq — Standalone (بدون Supabase)

مشروع لتجميع أكبر عدد ممكن من المنتجات داخل العراق من مواقع حقيقية، مع **صورة + وصف** للمنتج.

الفكرة الأساسية في الـ ingestion:
- **Sitemaps + Robots.txt** بدل Crawl عشوائي
- Extract بدون Headless عبر: **JSON‑LD + __NEXT_DATA__ + OG meta**
- **نخزن روابط الصور** (URL) بدل تخزين الصور داخل السيرفر

---

## التشغيل السريع (كبسة وحدة)

### المتطلبات
- **Docker Desktop** (لتشغيل Postgres محلي)
- **Node.js 18+**

### Windows (PowerShell)
```powershell
./scripts/run-dev.ps1
```

### macOS / Linux
```bash
bash scripts/run-dev.sh
```

بعد التشغيل:
- الواجهة: `http://localhost:5173`
- الـ API: `http://localhost:8787`

### دخول الإدارة
- Email: `admin@local`
- Password: `admin123`

---

## أول مرة — خلي المشروع “يعبي” بيانات
1) افتح `/admin`
2) من تبويب **حزم جاهزة للمصادر (Source Packs)**
   - نصب: **حزمة العراق الكبرى (55 مصدر)**
3) من تبويب **تشغيل**
   - اضغط: **تشغيل الكل (Seed → APIs → Ingest → Images)**

> ملاحظة: بعض المواقع ممكن تمنع بسرعة أو ما عدها Sitemap واضح. هذي طبيعي.
> تقدر تختبر أي رابط بصفحة البلجنات وتضبط regex/entrypoints.

---

## هيكل المشروع
- `db/` — سكربتات بناء قاعدة البيانات + seed
- `api/` — API + Jobs (seed/ingest/apis/images)
- `public/source-packs/` — حزم JSON جاهزة لمواقع العراق
- `src/` — الواجهة (React/Vite)

---

## إذا تريد تشغيل على سيرفر (Production لاحقًا)
النسخة الحالية مهيأة لتشتغل محليًا بسرعة.
نقلها لسيرفر ممكن يصير بنفس الـ API + Postgres (مثل Neon) لاحقًا بدون تغيير كبير بالواجهة.

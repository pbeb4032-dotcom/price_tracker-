# Price Tracker Iraq - Complete Codebase Analysis
**Comprehensive Code Review & Implementation Status**
***

## Table of Contents
1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Core Components](#core-components)
5. [Data Flow & Models](#data-flow--models)
6. [Frontend Implementation](#frontend-implementation)
7. [Backend Implementation](#backend-implementation)
8. [Database Architecture](#database-architecture)
9. [Ingestion Pipeline](#ingestion-pipeline)
10. [Security & Authentication](#security--authentication)
11. [Admin Dashboard](#admin-dashboard)
12. [Current Status](#current-status)
13. [Required Functionality Gaps](#required-functionality-gaps)
14. [Deployment & Running](#deployment--running)

---

## Project Overview

### Purpose
**Shkad Aadel (شكد عادل)** is a fair-price intelligence platform designed specifically for Iraq. It enables citizens (consumers, shoppers, community reporters) to:
- Submit price observations for everyday products
- Browse aggregated fair prices by product/region
- Set price alerts for products
- Vote on price reports (crowd trust mechanism)
- Scan product barcodes via QR codes
- Compare prices across stores and regions

### Core Idea
Instead of traditional web scraping or manual data entry, the system uses:
- **Crowdsourced price reporting** from community members
- **Product ingestion** from e-commerce sites using sitemaps/JSON-LD extraction
- **Crowd voting** to validate or flag incorrect prices
- **Admin moderation** for suspicious or flagged reports
- **Anomaly detection** to quarantine outlier prices

### Target Users
1. **Consumers** - Browse fair prices, set alerts
2. **Reporters** - Submit price observations from stores
3. **Moderators** - Review flagged reports, approve/reject
4. **Admins** - Manage sources, categories, system configuration

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser (Client)                    │
│         React + Next.js Router + shadcn/ui           │
└─────────────────┬───────────────────────────────────┘
                  │ HTTPS/HTTP
                  ▼
┌─────────────────────────────────────────────────────┐
│            Frontend (Vite + React + Tailwind)        │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Pages:                                          │ │
│  │ - Home (Index)                                 │ │
│  │ - Dashboard (Protected)                        │ │
│  │ - Prices / Products / Explore                  │ │
│  │ - Admin Dashboard                              │ │
│  │ - Price Comparison                             │ │
│  │ - QR Scan                                       │ │
│  │ - Watchlist / Notifications                    │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Features:                                       │ │
│  │ - Authentication (Sign In/Up)                   │ │
│  │ - Real-time Price Alerts                        │ │
│  │ - Product Comparison Panel                      │ │
│  │ - Exchange Rate Widget (USD/IQD)               │ │
│  │ - Theme Switching (Light/Dark + RTL)           │ │
│  │ - Barcode Scanning                             │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────┬───────────────────────────────────┘
                  │ REST API Calls
                  ▼
┌─────────────────────────────────────────────────────┐
│         Backend API (Hono.js + Node.ts)              │
│   - Port: 8787 (configurable via API_PORT)          │
│   - Authentication: JWT-based                        │
│   - Database: PostgreSQL with Drizzle ORM           │
│                                                      │
│  Routes:                                             │
│  ├─ /auth/*           (Login, Signup, JWT tokens)  │
│  ├─ /routes/tables/*  (CRUD for DB tables)         │
│  ├─ /routes/views/*   (Aggregated price views)     │
│  ├─ /routes/offers/*  (Price observations)         │
│  ├─ /routes/admin/*   (Admin operations)           │
│  ├─ /routes/rpc/*     (RPC calls)                  │
│  └─ /health           (Status checks)              │
│                                                      │
│  Background Jobs:                                    │
│  ├─ seedCrawlFrontier (Discover URLs via sitemaps) │
│  ├─ ingestProductPages (Extract product data)      │
│  ├─ discoverProductApis (Find product data APIs)   │
│  ├─ recrawlProductImages (Fetch/cache images)      │
│  ├─ discoverSources (Auto-discover new sources)    │
│  ├─ validateCandidateSources (Validate sources)    │
│  ├─ activateCandidateSources (Enable validated)    │
│  └─ Many more for data cleanup/repair              │
└─────────────┬────────────────────────────────────────┘
              │ SQL Queries / Transactions
              ▼
┌─────────────────────────────────────────────────────┐
│        PostgreSQL Database                           │
│   Tables:                                            │
│   ├─ auth.users (Supabase-compatible auth)         │
│   ├─ profiles (User profiles + preferences)        │
│   ├─ products (Product catalog - Arabic/English)   │
│   ├─ product_aliases (Name variants per language)  │
│   ├─ price_sources (Crawled e-commerce sites)      │
│   ├─ source_price_observations (Extracted prices)  │
│   ├─ price_reports (User-submitted prices)         │
│   ├─ report_votes (Crowd trust signals)            │
│   ├─ alerts (User price subscriptions)             │
│   ├─ moderation_actions (Review decisions)         │
│   ├─ crawl_frontier (URL queue for discovery)      │
│   ├─ regions (Iraqi governorates/cities)           │
│   └─ Many more for tracking/events                 │
│                                                      │
│   Views:                                             │
│   ├─ v_product_all_offers (Price aggregation)      │
│   ├─ v_offer_reports_agg (Crowd signals summary)   │
│   ├─ v_best_offers (Most trusted prices)          │
│   └─ More for analytics/reporting                  │
│                                                      │
│   Row-Level Security (RLS):                         │
│   - Every table protected by RLS policies           │
│   - Auth via auth.uid() (set by app)                │
│   - Roles: user, moderator, admin                   │
└──────────────────────────────────────────────────────┘

   External Systems (Optional):
   ├─ SearxNG (Meta-search for auto-discovery)
   └─ Docker (Local development & deployment)
```

---

## Technology Stack

### Frontend
| Category | Technology |
|----------|------------|
| **Framework** | React 18+ with TypeScript |
| **Build Tool** | Vite |
| **CSS Framework** | Tailwind CSS with shadcn/ui components |
| **Routing** | React Router v6 |
| **State Management** | React Query (TanStack Query) for async state |
| **UI Components** | Radix UI (accessible primitives) |
| **Internationalization** | RTL (Arabic-first) with Theme Provider |
| **Forms** | React Hook Form + Zod validation |
| **Barcode Scanner** | ZXing (JavaScript barcode library) |
| **Styling** | Tailwind CSS + CSS Modules |

### Backend
| Category | Technology |
|----------|------------|
| **Runtime** | Node.js 18+ with TypeScript |
| **Web Framework** | Hono.js (lightweight edge-ready) |
| **Database Driver** | Drizzle ORM (type-safe) |
| **Database** | PostgreSQL 12+ |
| **Authentication** | JWT-based with custom implementation |
| **Validation** | Zod |
| **Logging** | Console + structured logging |
| **Task Queue** | pg_cron (PostgreSQL native) |

### Infrastructure  
| Category | Technology |
|----------|------------|
| **Development** | Docker Desktop with Docker Compose |
| **Database Server** | PostgreSQL official Docker image |
| **Package Manager** | npm / Bun |
| **CI/CD** | Git + GitHub (for deployment) |
| **Optional Search** | SearxNG (Meta-search engine) |

### Configuration Files
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript compiler options
- `tailwind.config.ts` - Tailwind CSS customization
- `eslint.config.js` - Linting rules
- `package.json` - Root project dependencies
- `api/package.json` - API server dependencies
- `.env` - Environment configuration (not in git)

---

## Core Components

### Frontend Structure (src/)

#### Pages
1. **Index.tsx** - Landing page (public)
2. **Dashboard.tsx** - User dashboard (protected)
3. **Prices.tsx** - Browse all prices (public)
4. **ProductDetails.tsx** - Single product page (public)
5. **ProductOffers.tsx** - Price offers for a product (public)
6. **ProductCompare.tsx** - Price comparison UI (public)
7. **Explore.tsx** - Browse & filter products (public)
8. **ReportPrice.tsx** - Submit new price report (protected)
9. **Scan.tsx** - QR barcode scanner (public)
10. **Watchlist.tsx** - User's bookmarked products (protected)
11. **Notifications.tsx** - Price alerts triggered (protected)
12. **Settings.tsx** - User preferences (protected)
13. **SignIn.tsx** - Authentication form (guest-only)
14. **SignUp.tsx** - Registration form (guest-only)
15. **AdminPage.tsx** - Admin dashboard (admin-only)
16. **NotFound.tsx** - 404 error

#### Components
- **AppNavbar.tsx** - Top navigation bar
- **PriceCardView.tsx** - Display individual price
- **PriceAlertsPanel.tsx** - Alert settings
- **ProductComparisonPanel.tsx** - Side-by-side prices
- **TrustedPriceSummaryCard.tsx** - Aggregate price data
- **ExchangeRateWidget.tsx** - USD/IQD converter
- **PricesOverviewChart.tsx** - Price trend chart
- **Forms/** - Reusable form components
- **Layout/** - Common layout wrappers
- **Offers/** - Offer-related components
- **UI/** - shadcn/ui component library

#### Hooks & Utilities
- **lib/auth.tsx** - Authentication context & hooks
- **lib/telemetry.tsx** - Analytics & tracking
- **lib/seo/** - SEO meta tags
- **integrations/** - External API integrations
- **test/** - Vitest unit & e2e tests

### Backend Structure (api/src/)

#### Routes
1. **auth.ts** - Authentication endpoints
   - POST `/auth/sign-in` - Email/password login
   - POST `/auth/sign-up` - User registration
   - POST `/auth/refresh` - JWT refresh
   - GET `/auth/profile` - Current user info

2. **tables.ts** - CRUD operations on DB tables
   - GET/POST for all public tables
   - Filter, search, pagination support

3. **views.ts** - Pre-computed aggregated data
   - GET `/views/best-offers` - Top trusted prices
   - GET `/views/product-aggregates` - Price stats
   - GET `/views/region-trends` - Regional patterns

4. **offers.ts** - Price observation management
   - POST `/offers/report` - Submit crowd signal
   - GET `/offers/summary` - Aggregated crowd trust

5. **admin.ts** - Administrative operations
   - POST `/admin/jobs/{jobName}` - Trigger background jobs
   - GET `/admin/dashboard` - System metrics
   - GET `/admin/app_report` - Full app report

6. **rpc.ts** - RPC-style function calls
   - `search_products()` - Full-text search
   - `filter_offers()` - Complex price filtering
   - `get_user_watchlist()` - User bookmarks

#### Database Layer (db.ts)
- PostgreSQL connection pooling
- Drizzle ORM setup
- Type-safe query builder
- Environment configuration

#### Authentication (auth/)
- **jwt.ts** - JWT token generation/validation
- **appUser.ts** - User entity management

#### Ingestion (ingestion/)
- **productExtract.ts** - HTML parsing (JSON-LD, OG tags)
- **taxonomyV2.ts** - Category classification
- **priceAnomalyQuarantine.ts** - Outlier detection
- **sanity.ts** - Data quality checks

#### Jobs (jobs/)
- **seedCrawlFrontier.ts** - Discover URLs from sitemaps
- **ingestProductPages.ts** - Extract product info
- **discoverProductApis.ts** - Find API endpoints
- **recrawlProductImages.ts** - Cache product images
- **validateCandidateSources.ts** - Validate new sources
- **activateCandidateSources.ts** - Enable validated sources
- And 30+ more maintenance jobs

#### Libraries (lib/)
- **appSettings.ts** - Configuration storage
- **renderPriority.ts** - Price sorting logic

---

## Data Flow & Models

### User Journey: Reporting a Price

```
1. User (Consumer) → Navigates to /report-price
   ↓
2. Frontend → Displays ReportPrice.tsx form
   ↓
3. User → Fills: Product, Store, Price, Region, Date
   ↓
4. Frontend → POST /api/routes/tables (creates price_reports row)
   {
     "product_id": "uuid",
     "store_id": "uuid",
     "price": 50000,
     "currency": "IQD",
     "reported_by_user_id": "uuid",
     "region_id": "uuid",
     "status": "pending"
   }
   ↓
5. Backend → INSERT into price_reports with RLS check
   ↓
6. DB Trigger → Creates audit_log entry
   ↓
7. Frontend → Shows success notification
   ↓
8. Admin → Sees report in /admin/moderation-queue
   ↓
9. Admin → Reviews, votes approve/reject
   ↓
10. DB → Updates price_reports.status = "approved"
   ↓
11. View → price_agg is recalculated (MaterializedView)
   ↓
12. Consumer → Sees price in /prices feed
   ↓
13. Alert System → Checks user alerts
   ↓
14. If price matches alert → Sends notification
```

### Product Ingestion Flow

```
1. Admin → Activates source (e.g., "amazon.com.iq")
   ↓
2. Job: seedCrawlFrontier() runs
   ├─ Fetches robots.txt → Extract allowed paths
   ├─ Fetches sitemap.xml → Get all product URLs
   ├─ Classifies URLs (product vs category vs unknown)
   ├─ Inserts into crawl_frontier table
   └─ Stores ~1000 URLs per run
   ↓
3. For each URL in frontier:
   ├─ Fetch HTML page
   ├─ Extract via JSON-LD / __NEXT_DATA__ / OG meta
   ├─ Parse: name, price, image, category
   ├─ Normalize to internal product
   └─ INSERT into source_price_observations
   ↓
4. Data Validation:
   ├─ Price anomaly detection (statistical outliers)
   ├─ Store in quarantine if suspicious
   ├─ Mark with confidence score
   └─ Flag for admin review if needed
   ↓
5. Crowd Validation:
   └─ Users vote on prices
   └─ Crowd signals increase/decrease confidence
   └─ Bad prices get penalized
   ↓
6. Consumer View:
   └─ See best prices aggregated across sources
   └─ See which users voted on each price
```

### Data Models

#### Key Tables

##### profiles
```sql
- id: UUID (primary key)
- user_id: UUID (foreign key → auth.users)
- display_name: TEXT
- email: TEXT
- avatar_url: TEXT
- preferred_region_id: UUID
- language: 'ar' | 'en'
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

##### products
```sql
- id: UUID
- name_ar: TEXT (primary name)
- name_en: TEXT (English translation)
- category: TEXT (e.g., 'groceries', 'electronics')
- subcategory: TEXT (nested category)
- unit: TEXT (e.g., 'kg', 'piece', 'liter')
- description_ar: TEXT
- image_url: TEXT (external URL)
- is_active: BOOLEAN
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

##### product_aliases
```sql
- id: UUID
- product_id: UUID (foreign key)
- alias_name: TEXT (variant name, e.g., "tomato" vs "tamata")
- language: 'ar' | 'en'
- unique(product_id, alias_name)
```

##### price_sources (e-commerce sites)
```sql
- id: UUID
- domain: TEXT (e.g., 'amazon.com.iq')
- name_ar: TEXT (display name)
- is_active: BOOLEAN
- category: TEXT
- lifecycle_status: 'active' | 'paused' | 'deprecated'
- validation_score: NUMERIC(4,3) (0.000 - 1.000)
- last_probe_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

##### source_price_observations (scraped prices)
```sql
- id: UUID
- product_id: UUID (foreign key)
- source_id: UUID (foreign key → price_sources)
- source_url: TEXT (where we extracted it)
- price: NUMERIC
- currency: TEXT ('IQD', 'USD')
- discount_price: NUMERIC (optional)
- raw_price_text: TEXT (original text)
- is_price_anomaly: BOOLEAN (flagged?)
- anomaly_reason: TEXT ('statistical_outlier', 'crowd_wrong_price', etc)
- price_confidence: NUMERIC(3,2) (0.00 - 1.00)
- in_stock: BOOLEAN
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

##### price_reports (user submissions)
```sql
- id: UUID
- product_id: UUID
- user_id: UUID (who reported)
- store_id: UUID (where they saw it)
- price: NUMERIC
- currency: TEXT
- region_id: UUID
- status: 'pending' | 'approved' | 'rejected'
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

##### report_votes (crowd validation)
```sql
- id: UUID
- report_id: UUID (foreign key → price_reports)
- user_id: UUID (who voted)
- vote_type: 'helpful' | 'not_helpful' | 'wrong_price'
- created_at: TIMESTAMPTZ
- unique(report_id, user_id, vote_type)
```

##### alerts (user notifications)
```sql
- id: UUID
- user_id: UUID
- product_id: UUID
- target_price: NUMERIC (alert when price ≤ this)
- region_id: UUID (optional - only alert in region)
- is_active: BOOLEAN
- created_at: TIMESTAMPTZ
```

##### moderation_actions (admin decisions)
```sql
- id: UUID
- moderator_id: UUID (who took action)
- target_type: 'report' | 'user' | 'source'
- target_id: UUID
- action: 'approve' | 'reject' | 'quarantine'
- reason: TEXT
- created_at: TIMESTAMPTZ
```

---

## Frontend Implementation

### Authentication Flow

```typescript
// lib/auth.tsx - AuthProvider component
├─ useState(user, profile, isLoading)
├─ useEffect() → Check JWT in localStorage on mount
├─ Verify JWT against auth API
├─ Load user profile from /api/auth/profile
├─ Wrap app with context: <AuthContext.Provider>
└─ Provide hooks: useAuth()
   ├─ user: { id, email }
   ├─ profile: { displayName, avatarUrl }
   ├─ signIn(email, password)
   ├─ signUp(email, password, displayName)
   ├─ signOut()
   └─ isAuthenticated: boolean
```

### Protected Routes

```typescript
// lib/auth.tsx - Route guards
├─ <ProtectedRoute>
│  └─ Redirect to /sign-in if not authenticated
├─ <GuestRoute>
│  └─ Redirect to /dashboard if already authenticated
└─ <AdminRoute>
   └─ Check admin role, redirect if not authorized
```

### Price Browsing (Main Feature)

```typescript
// pages/Explore.tsx
- Show product catalog with filters:
  ├─ Category filter (dropdown)
  ├─ Region filter (multiselect)
  ├─ Price range slider
  ├─ Search bar (fuzzy search)
  └─ Sort order (price asc/desc, newest, votes)

// Component hierarchy:
<Explore>
  ├─ <ProductGrid>
  │  └─ Map over products
  │     └─ <ProductCard>
  │        ├─ Product image (from external URL)
  │        ├─ Name (Arabic/English bilingual)
  │        ├─ Best price + currency
  │        ├─ Number of votes
  │        └─ "View Offers" button
  ├─ <PriceFilterPanel>
  │  └─ Sidebar with filters
  └─ <Pagination>
      └─ Load next/prev pages
```

### Product Comparison

```typescript
// pages/ProductCompare.tsx
- Allow users to add products to comparison
- Display side-by-side:
  ├─ Product images
  ├─ Names (AR/EN)
  ├─ Prices from different sources
  ├─ Best price highlighted
  ├─ Price trends (if available)
  └─ "View Full Details" link

// Storage:
- useLocalStorage('compare_products') for session persistence
- Max 5 products at once
```

### QR/Barcode Scanning

```typescript
// pages/Scan.tsx
- Use @zxing/browser library
- Activate device camera
- Scan barcode/QR code
- Decode to: product ID or barcode
- On successful scan:
  ├─ Look up product by barcode
  ├─ Redirect to /products/{productId}
  └─ Show price from sources
```

### User Dashboard

```typescript
// pages/Dashboard.tsx
- Show welcome message
- Display user stats:
  ├─ Total reports submitted
  ├─ Total votes on community
  ├─ Price alerts active
  └─ Region preference

// Components:
- <TrustedPriceSummaryCard>
  └─ Display favorite products + latest prices
```

### Theme & Internationalization

```typescript
// App.tsx
<ThemeProvider attribute="class" defaultTheme="light" enableSystem>
  ├─ Light mode (white background, dark text)
  ├─ Dark mode (dark background, light text)
  └─ System preference (auto-detect)

// RTL Support:
- Tailwind config: direction: rtl
- Components automatically flip layouts
- Arabic-first: RTL is default, English falls back to LTR
```

---

## Backend Implementation

### Server Startup (api/src/server.ts)

```typescript
1. Load environment variables from .env
   ├─ DATABASE_URL (required)
   ├─ APP_JWT_SECRET (required)
   ├─ INTERNAL_JOB_SECRET (optional, for cron jobs)
   └─ DEV_LOGIN_SECRET (optional, for dev shortcuts)

2. Initialize Hono app
   └─ Register route handlers

3. Create connection pool to PostgreSQL
   └─ Max 20 connections (configurable)

4. Run schema compatibility patches
   └─ Non-destructive migrations for old volumes

5. Start HTTP server
   └─ Listen on port 8787 (or API_PORT env var)

6. (Optional) Start local scheduler
   └─ If ENABLE_LOCAL_SCHEDULER != '0'
   └─ Run price alert dispatches every N minutes
```

### Authentication (api/src/auth/)

#### JWT Implementation
```typescript
// auth/jwt.ts
- Create JWT token:
  ├─ Header: { alg: 'HS256', typ: 'JWT' }
  ├─ Payload: { 
  │    sub: userId,
  │    email: userEmail,
  │    role: 'user' | 'moderator' | 'admin',
  │    iat: issuedAt,
  │    exp: expiration (7 days default)
  │  }
  └─ Sign with APP_JWT_SECRET

- Verify JWT:
  ├─ Check signature with APP_JWT_SECRET
  ├─ Check expiration
  └─ Extract user info
```

#### User Management
```typescript
// auth/appUser.ts - ensureAuthUser()
- Called on first login/signup
- Creates auth.users row in PostgreSQL
- Creates profiles row with defaults
- Assigns 'user' role
- On conflict, merge metadata
```

### API Routes

#### Auth Routes (routes/auth.ts)

```typescript
POST /auth/sign-in
  Body: { email: string, password: string }
  Returns: { token: JWT, user: { id, email }, profile: {...} }
  Flow:
  ├─ Verify credentials (compare with password hash)
  ├─ Generate JWT
  ├─ Return token + user data
  └─ Client stores JWT in localStorage

POST /auth/sign-up
  Body: { email, password, displayName }
  Returns: { token, user, profile }
  Flow:
  ├─ Check email not taken
  ├─ Create auth.users + profiles
  ├─ Generate JWT
  └─ Auto-login user

GET /auth/profile
  Headers: { Authorization: 'Bearer <jwt>' }
  Returns: { user, profile, roles }
  Flow:
  ├─ Verify JWT
  ├─ Load from profiles table
  └─ Load roles from user_roles table

POST /auth/refresh
  Body: { token: expired_jwt }
  Returns: { token: new_jwt }
  Flow:
  ├─ Ignore token expiration, verify signature only
  ├─ Generate new token with longer expiry
```

#### Price Observation Routes (routes/offers.ts)

```typescript
POST /offers/report
  Body: {
    offer_id: UUID,
    report_type: 'wrong_price' | 'unavailable' | 'duplicate' | 'other',
    severity: 1-5,
    note: string
  }
  Flow:
  ├─ Verify offer exists
  ├─ Save offer_reports row
  ├─ Aggregate crowd signals (count by report_type)
  ├─ Apply penalty to price_confidence
  ├─ If 3+ "wrong_price" votes:
  │  ├─ Flag is_price_anomaly = true
  │  ├─ Enqueue to price_anomaly_quarantine
  │  └─ Admin sees in quarantine review
  └─ Return: { ok: true, offer_id, agg: {...} }

GET /offers/summary?product_id=...
  Returns: Array of offers for product with crowd signals
  - Each offer includes: reports_total, wrong_price, unavailable, etc
  - Used by UI to show crowd trust indicators
```

#### Admin Routes (routes/admin.ts)

```typescript
GET /admin/dashboard
  Returns: System metrics (product count, source health, etc)

GET /admin/app_report?hours=24
  Returns: Detailed app report
  - Product statistics (total, active, categorized)
  - Source statistics (health, errors)
  - Ingestion metrics
  - Price observations count
  - User activity

POST /admin/jobs/seedCrawlFrontier
  Headers: { x-job-secret: INTERNAL_JOB_SECRET }
  Triggers: Discover URLs from sitemaps
  - Max 10,000 URLs per run

POST /admin/jobs/ingestProductPages
  Triggers: Extract product data from URLs

POST /admin/jobs/validateCandidateSources
  Triggers: Check if sources are valid/healthy

POST /admin/jobs/activateCandidateSources
  Triggers: Enable validated sources for ingestion

... (40+ more job endpoints)
```

### Database Access with Drizzle ORM

```typescript
// Typical query pattern:
const db = getDb(env);

// Simple SELECT
const result = await db.execute(sql`
  SELECT * FROM products WHERE is_active = true LIMIT 10
`);

// With parameters
const result = await db.execute(sql`
  SELECT * FROM products 
  WHERE category = ${category} AND is_active = true
`);

// INSERT with conflict handling
await db.execute(sql`
  INSERT INTO price_reports (product_id, user_id, price)
  VALUES (${productId}, ${userId}, ${price})
  ON CONFLICT (product_id, user_id) DO UPDATE SET
    price = excluded.price,
    updated_at = now()
`);

// All queries protected by RLS
// User context set before query:
await db.execute(sql`SET LOCAL app.user_id = ${userId}::uuid`);
```

### Background Jobs (api/src/jobs/)

#### seedCrawlFrontier.ts
```typescript
Purpose: Discover product URLs from target e-commerce sites

Algorithm:
1. For each active price_source:
   ├─ Fetch robots.txt (extract allowed paths)
   ├─ Parse sitemap.xml (discover all URLs)
   ├─ Classify URLs (product vs category vs unknown)
   ├─ Filter to only product/category URLs
   └─ Insert into crawl_frontier table

2. For each source_entrypoints (manual bootstrap URLs):
   ├─ Fetch HTML page
   ├─ Extract links (via regex/DOM parsing)
   ├─ Classify extracted links
   └─ Insert into crawl_frontier

3. Shuffle to randomize
   └─ Ensures each run covers different slice of URLs

4. Return summary:
   - seededByDomain: { 'amazon.com.iq': 450, 'noon.com': 320 }
   - totalInserted: 770
   - skippedDuplicates: 50
```

#### ingestProductPages.ts
```typescript
Purpose: Extract product info from HTML pages

Data Extraction:
1. For each URL in crawl_frontier:
   ├─ Fetch HTML page
   ├─ Try multiple extraction methods (in order):
   │  ├─ JSON-LD (structured data in <script>)
   │  ├─ __NEXT_DATA__ (Next.js initial props)
   │  ├─ OG meta tags (title, image, price)
   │  └─ Regex/DOM parsing (fallback)
   └─ Extract fields: name, price, image URL, category

2. Data normalization:
   ├─ Clean price (remove currency symbol, convert to IQD)
   ├─ Detect currency (IQD vs USD)
   ├─ Validate price range (reject outliers)
   ├─ Normalize product name (remove duplicates)
   └─ Parse category from page

3. Product matching:
   ├─ Search for existing product by name + category
   ├─ If found: update aliases
   ├─ If new: create product

4. Store observation:
   ├─ INSERT into source_price_observations
   ├─ Calculate confidence score
   ├─ Check for anomalies
   └─ Mark status and timestamps

5. Return stats:
   - productsProcessed: 500
   - pricesExtracted: 450
   - anomaliesDetected: 12
   - newProductsCreated: 35
```

#### Price Anomaly Detection
```typescript
// From priceAnomalyQuarantine.ts

1. Statistical detection:
   ├─ For each product category
   ├─ Calculate mean and std dev of prices
   ├─ Flag if price < (mean - 3σ) or > (mean + 3σ)
   └─ Store flagged price in quarantine table

2. Crowd validation:
   ├─ If 3+ users report "wrong_price" on same offer
   ├─ Automatically enqueue to quarantine
   └─ Mark as "crowd_wrong_price"

3. Admin review:
   ├─ Admin views /admin/quarantine-queue
   ├─ Can approve (restore to normal)
   ├─ Can reject (delete/archive)
   ├─ Decision recorded in moderation_actions
   └─ System learns from decisions
```

---

## Database Architecture

### Schema Overview

#### Authentication & Authorization
```sql
auth.users
├─ Supabase-compatible auth table
└─ Minimal fields: id, email, raw_user_meta_data, created_at

user_roles
├─ Enum app_role: 'user' | 'moderator' | 'admin'
├─ Many-to-many: user_id → role
└─ RLS: Users see own roles, admins can update all
```

#### Products & Catalog
```sql
products
├─ Primary catalog table (bilingual: name_ar, name_en)
├─ Categories & subcategories
├─ Images (external URLs only, no storage)
└─ Active flag for soft deletes

product_aliases
├─ Alternative names for products
├─ Language-specific variants
└─ Regex-based search support
```

#### Prices (Multiple Sources)
```sql
price_sources
├─ Registry of e-commerce sites crawled
├─ Validation score & health metrics
├─ Discovery tags (auto/manual)
└─ Lifecycle tracking (active/paused)

source_price_observations
├─ Extracted prices from price_sources
├─ Link to product (via product.id)
├─ Anomaly detection & confidence scores
├─ Stock status & raw text
└─ Indexed heavily for aggregation queries
```

#### User Contributions
```sql
price_reports
├─ User-submitted price observations
├─ Status (pending/approved/rejected)
└─ Region-specific

report_votes
├─ Community votes on price_reports
// Crowd signals for trust
└─ Vote types: helpful, not_helpful, wrong_price

offer_reports
├─ Crowd signals on price observations
├─ Report types: wrong_price, unavailable, duplicate, other
└─ Aggregated for confidence penalty
```

#### Notifications & Alerts
```sql
alerts
├─ User price subscriptions
├─ Trigger when price ≤ threshold
├─ Region-specific (optional)
└─ Active flag

notifications
├─ Sent notifications log
├─ Type: price_alert, moderation, system
└─ Read/unread flags
```

#### Moderation & Audit
```sql
moderation_actions
├─ Admin/moderator decisions
├─ Actions: approve, reject, quarantine
├─ Audit trail with reasons
└─ Timestamp tracking

audit_logs
├─ Append-only log of all changes
├─ Triggers on tables
├─ User ID + action type
└─ Full before/after snapshots (JSONB)

price_anomaly_quarantine
├─ Prices flagged for review
├─ Reason codes: statistical_outlier, crowd_wrong_price
├─ Status: pending, approved, rejected
└─ Admin review queue
```

#### Data Ingestion
```sql
crawl_frontier
├─ Queue of URLs to process
├─ Status: pending, processing, done, failed
├─ Classification: product, category, unknown
└─ Depth tracking (BFS-like)

domain_probe_queue
├─ Queue for checking domain health
├─ Last probe time tracking
└─ Error counts

ingestion_error_events
├─ Log of failures during ingestion
├─ HTTP status, blocked reasons
├─ Indexed for diagnostics
```

#### Configuration
```sql
app_settings
├─ System configuration key-value store
├─ Examples: min_confidence_score, max_price_threshold
├─ Admin-writable
└─ Application-readable
```

### Views (Materialized & Real-time)

```sql
v_product_all_offers
├─ All prices for a product across sources
├─ Aggregated from source_price_observations
├─ Includes confidence scores
└─ Indexed for fast queries

v_best_offers
├─ Top-ranked prices per product
├─ Sorted by: confidence, recency, votes
└─ Used by browsing UI

v_offer_reports_agg
├─ Aggregated crowd signals per offer
├─ Counts by report_type
├─ Total severity score
└─ Last report timestamp

v_trusted_prices_by_region
├─ Prices trusted in specific regions
├─ Filtered by user votes
└─ Region aggregation
```

### Row-Level Security (RLS)

```sql
Every table has RLS enabled with policies:

profiles:
├─ SELECT: Public (anyone can view profiles)
├─ UPDATE: Own profile only (user_id = auth.uid())
└─ INSERT: Self-registration only

products:
├─ SELECT: Public
└─ INSERT/UPDATE/DELETE: Admin only (has_role(auth.uid(), 'admin'))

price_reports:
├─ SELECT: Public + owner-specific fields hidden
├─ INSERT: Authenticated users only
├─ UPDATE: Own reports + admins
└─ DELETE: Admins only

alerts:
├─ SELECT: Own alerts only
├─ INSERT/UPDATE/DELETE: Own alerts only

moderation_actions:
├─ SELECT: Moderators + admins (via has_role())
├─ INSERT: Moderators + admins
└─ DELETE: Admins only
```

### Indexes for Performance

```sql
-- High-cardinality columns
CREATE INDEX idx_source_price_observations_product_id
  ON source_price_observations(product_id);

CREATE INDEX idx_price_reports_user_id
  ON price_reports(user_id);

-- Time-based queries
CREATE INDEX idx_source_price_observations_created_at
  ON source_price_observations(created_at DESC);

-- Composite for aggregation
CREATE INDEX idx_spo_product_source_created
  ON source_price_observations(product_id, source_id, created_at DESC);

-- Foreign key integrity
CREATE INDEX idx_product_aliases_product_id
  ON product_aliases(product_id);

-- Full-text search
CREATE INDEX idx_products_name_gin
  ON products USING gin(to_tsvector('arabic', name_ar));
```

---

## Ingestion Pipeline

### How Data Enters the System

#### Path 1: Automated Web Crawling
```
1. Admin activates e-commerce source (e.g., amazon.com.iq)
   ├─ Source added to price_sources table
   └─ is_active set to true

2. seedCrawlFrontier job runs (daily or on-demand):
   ├─ Fetches robots.txt + sitemap.xml
   ├─ Discovers ~1000 product URLs per source
   ├─ Inserts URLs into crawl_frontier
   └─ Shuffles to randomize

3. ingestProductPages job runs:
   ├─ Pops URLs from crawl_frontier
   ├─ Fetches HTML
   ├─ Extracts via JSON-LD / OG / Regex
   ├─ Creates/updates products
   └─ Stores observations in source_price_observations

4. Data enrichment:
   ├─ Images: Fetches and caches external URLs
   ├─ Categories: Classifies via taxonomy
   ├─ Prices: Normalizes currency & units
   └─ Confidence: Scores based on extraction method

5. Quality assurance:
   ├─ Anomaly detection: Flags suspicious prices
   ├─ Quarantine: Stores flagged prices for review
   ├─ Statistics: Creates rollups for analytics
   └─ Alerts: Dispatches price alerts if matched
```

#### Path 2: Community Reporting
```
1. User navigates to /report-price
   └─ Fills form: Product, Store, Price, Region, Date

2. User submits → POST /api/offers/report
   ├─ Backend validates input
   ├─ RLS checks user authentication
   ├─ Inserts into price_reports table
   └─ Auto-creates audit_log entry

3. Report visible immediately:
   ├─ Appears in product's price list
   ├─ Shows reporter's username (if public)
   ├─ Shows upvote/downvote buttons
   └─ Shows date and region

4. Community evaluates:
   ├─ Users vote helpful/not_helpful/wrong_price
   ├─ Votes stored in report_votes table
   ├─ Votes aggregated for trust score
   └─ Wrong_price votes can trigger quarantine

5. Moderator review (if many wrong votes):
   ├─ Report appears in /admin/moderation-queue
   ├─ Moderator reviews context
   ├─ Approves (keeps report) or rejects (hides report)
   └─ Decision recorded in moderation_actions
```

#### Path 3: API Ingestion (Merchants)
```
1. Some e-commerce sites provide product APIs
   ├─ discoverProductApis job finds them
   ├─ Fetches data directly via API
   └─ Bypasses HTML scraping

2. Data validation same as Path 1
   └─ Goes through quality checks, anomaly detection

3. Advantage: More reliable, structured data
```

### Data Quality & Cleanup

#### Anomaly Detection
```typescript
// Statistical outlier detection
For each product:
  ├─ Calculate mean and std dev of all prices
  ├─ If price < mean - 3σ or > mean + 3σ
  ├─ Mark is_price_anomaly = true
  ├─ Store reason: 'statistical_outlier'
  └─ Add to quarantine queue for admin review

// Crowd-sourced detection
- If 3+ users report "wrong_price" on same offer
├─ Auto-enqueue to quarantine
└─ Mark reason: 'crowd_wrong_price'
```

#### Quarantine & Review
```typescript
// Admin workflow
1. Admin views: GET /admin/quarantine-queue
   ├─ Lists all flagged prices
   ├─ Shows reason
   ├─ Shows original extraction method
   └─ Shows audit history

2. Admin action:
   ├─ APPROVE: Remove ~is_price_anomaly flag, restore to normal
   ├─ REJECT: Set status='deleted', hide from results
   └─ COMMENT: Add note for system learning

3. Decision recorded:
   ├─ moderation_actions table
   ├─ audit_logs table
   └─ System can learn patterns
```

#### Background Repair Jobs
```typescript
// Various jobs for data cleanup:
- fixLowPriceOutliers() - Fix prices < $1 USD
- repairSmiledUsdPrices() - Handle smile markup (1,000 vs 1.000)
- reclassifyCategoriesSmart() - Reclassify products
- backfillGrocerySubcategories() - Add missing subcategories
- applyCategoryOverrides() - Apply manual category fixes
- rollupAndRetainObservations() - Maintain observation summaries

All can be triggered via /admin/jobs/{jobName}
```

---

## Security & Authentication

### Authentication Architecture

#### JWT-Based (not Supabase Auth)
```typescript
// Token Structure
{
  header: {
    alg: 'HS256',
    typ: 'JWT'
  },
  payload: {
    sub: '<user_id>',        // Subject (user ID)
    email: '<user@email>',
    role: 'user|moderator|admin',
    iat: <timestamp>,        // Issued at
    exp: <timestamp + 7d>,   // Expires (7 days)
  },
  signature: HMAC-SHA256(header.payload, SECRET)
}

Storage:
- Frontend: localStorage as 'auth_token'
- Server: Stored in auth.users table (hashed)
```

#### Login Flow
```typescript
1. User enters email + password on SignIn page
   └─ Sent to POST /auth/sign-in

2. Backend:
   ├─ Look up user by email
   ├─ Compare password (bcrypt or similar)
   ├─ If match: Generate JWT
   ├─ If no match: Return 401 Unauthorized
   └─ Return { token, user, profile }

3. Frontend:
   ├─ Receive token
   ├─ Store in localStorage
   ├─ Set Authorization header on all API calls
   └─ Update AuthContext state

4. Future API calls:
   ├─ Include: Authorization: Bearer <token>
   ├─ Backend verifies signature
   ├─ Extracts user_id and role
   ├─ Sets `app.user_id` context for RLS
   └─ Process request with user permissions
```

### Row-Level Security (RLS) in PostgreSQL

```sql
-- Every table protected by policies

-- Example: price_reports table
1. SELECT policy (public browsing):
   CREATE POLICY "Anyone can view approved reports"
     ON price_reports FOR SELECT
     USING (status = 'approved' OR user_id = auth.uid());

2. INSERT policy (user submission):
   CREATE POLICY "Users can submit own reports"
     ON price_reports FOR INSERT
     TO authenticated
     WITH CHECK (user_id = auth.uid());

3. UPDATE policy (own reports + mod):
   CREATE POLICY "Users/admins can update reports"
     ON price_reports FOR UPDATE
     TO authenticated
     USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
     WITH CHECK (...);

-- Setting user context:
// In API before query:
await db.execute(
  sql`SET LOCAL app.user_id = ${userId}::uuid`
);
// Now all subsequent queries in transaction run as that user
```

### Authorization Levels

#### User Role
- Browse products, prices, reviews
- Submit price reports
- Vote on reports
- Set price alerts
- View own profile

#### Moderator Role
- All user permissions
- View moderation queue
- Approve/reject flagged reports
- Add moderation notes
- View moderation audit logs

#### Admin Role
- All moderator permissions
- Manage price sources
- Trigger background jobs
- View system metrics
- Manage user roles
- Configure app settings
- Review data quality metrics

### CSRF Protection

- Not explicitly mentioned in current code
- Frontend uses credentials: 'include' (cookies if needed)
- JWT in header (not cookie) is CSRF-safe
- Consider adding CSRF tokens if using cookies

### Input Validation

```typescript
// All inputs validated with Zod schemas
// Examples from code:

const createOfferReportSchema = z.object({
  offer_id: z.string().uuid(),
  report_type: z.enum(['wrong_price', 'unavailable', 'duplicate', 'other']),
  severity: z.number().int().min(1).max(5).optional(),
  note: z.string().max(500).optional().nullable(),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Backend rejects invalid requests immediately
```

### SQL Injection Prevention

- Uses parameterized queries (Drizzle ORM)
- All user inputs bound with ${...} placeholders
- PostgreSQL prevents SQL injection at protocol level

---

## Admin Dashboard

### Features Available

#### System Metrics (GET /admin/dashboard)
```typescript
{
  products: {
    total: 12500,
    active: 12300,
    categorized: 11800,
    general: 500
  },
  categories: [
    { category: 'groceries', count: 5000 },
    { category: 'electronics', count: 3200 },
    ...
  ],
  sources: {
    total: 45,
    active: 38,
    health_average: 0.87
  },
  ingestion: {
    last_run: '2024-04-03T10:15:00Z',
    last_frontier_seed: '2024-04-02T18:30:00Z',
    urls_pending: 2345,
    errors_last_24h: 12
  },
  prices: {
    total_observations: 145000,
    avg_confidence: 0.75,
    anomalies_pending_review: 23
  }
}
```

#### App Report (GET /admin/app_report?hours=24)
```typescript
More detailed breakdown:
- Product statistics
- Source health by domain
- Ingestion errors
- Price observation trends
- User activity
- Alerts dispatched
- Moderation queue size
```

#### Job Triggers (POST /admin/jobs/...)
```
Available jobs to manually trigger:
1. seedCrawlFrontier - Discover URLs
2. ingestProductPages - Extract products
3. validateCandidateSources - Test sources
4. activateCandidateSources - Enable sources
5. recrawlProductImages - Update images
6. discoverSources - Find new sources
7. fxUpdateDaily - Update FX rates
8. rollupSourceHealth - Calculate health
9. And 30+ more...

Usage:
POST /admin/jobs/seedCrawlFrontier
Headers: { x-job-secret: INTERNAL_JOB_SECRET }
Body: { maxUrls: 10000 }
Response: { ok: true, result: {...} }
```

#### Moderation Queue
```
- View flagged price_reports
- Sort by: date, votes, severity
- Bulk actions: approve, reject, quarantine
- Add moderator notes
- View vote history per report
```

#### Source Management
```
- View all price_sources
- Health metrics (last probe, error rate)
- Activation status
- Add/edit source entry points
- View crawl frontier for each source
- Manual validation
- Auto-disable unhealthy sources
```

#### Data Quality Monitors
```
- Anomaly detection statistics
- Quarantine queue length
- Error logs (ingestion_error_events)
- Price distribution by category
- Missing products in categories
- Image indexing status
```

---

## Current Status

### ✅ COMPLETED Features

#### Core Infrastructure
- [x] PostgreSQL database with schema
- [x] Hono.js API server
- [x] React + Vite frontend
- [x] Authentication system (JWT)
- [x] Role-based authorization
- [x] Row-level security (RLS) policies

#### Frontend Pages
- [x] Landing page (/)
- [x] User authentication (Sign In / Sign Up)
- [x] Price browsing & filtering
- [x] Product details
- [x] Price comparison interface
- [x] QR/Barcode scanner
- [x] User dashboard
- [x] Watchlist
- [x] Notifications
- [x] Settings
- [x] Admin dashboard

#### Backend Routes
- [x] Authentication endpoints
- [x] CRUD operations on products/prices
- [x] Offer reporting (crowd signals)
- [x] Admin job triggers
- [x] Dashboard metrics
- [x] App report generation

#### Data Ingestion
- [x] Sitemap discovery
- [x] HTML parsing (JSON-LD, OG tags)
- [x] Product extraction
- [x] Price normalization
- [x] Category classification
- [x] Image fetching & URL storage

#### Quality Assurance
- [x] Anomaly detection (statistical)
- [x] Quarantine system
- [x] Admin review workflow
- [x] Crowd voting validation
- [x] Confidence scoring

#### Configuration & Deployment
- [x] Docker Compose setup
- [x] Environment variable management
- [x] Database migrations
- [x] Validation scripts

### ⚠️ PARTIALLY COMPLETED Features

#### Admin Features
- [x] Dashboard view
- [x] Job triggers
- [x] Source management UI
- [ ] Bulk moderation actions
- [ ] Advanced filtering/search in admin

#### Data Stability
- [x] Basic anomaly detection
- [ ] ML-based outlier detection
- [x] Manual quarantine review
- [ ] Automated weekly data cleanup

#### Frontend Polish
- [x] RTL (Arabic) support
- [x] Dark/Light theme
- [ ] Accessibility (a11y) audit
- [ ] Mobile responsiveness (partial)
- [ ] Offline mode

#### Metrics & Analytics
- [x] Basic metrics collection
- [ ] Advanced analytics dashboard
- [ ] User behavior tracking
- [ ] Price trend charts (partial)

### ❌ NOT COMPLETED / Needs Work

#### High Priority

1. **Real-time Price Notifications**
   - Alert dispatch system needs testing at scale
   - WebSocket support for live updates
   - Push notifications integration

2. **Mobile App**
   - Currently web-only
   - Need React Native or Flutter version
   - Camera access for QR scanning

3. **Multi-Language Support**
   - Arabic ✅, English ✅ 
   - Kurdish dialects - Not started
   - Keyboard input for Arabic - Partial

4. **Search Optimization**
   - Full-text search on products - Partial
   - Fuzzy matching - Not implemented
   - Spell correction - Not implemented

5. **Performance at Scale**
   - Database query optimization incomplete
   - Caching strategy not implemented
   - API rate limiting - Basic only
   - Pagination needs cursor-based improvement

6. **Reporting Features**
   - User-submitted reports ✅
   - Admin moderation ✅
   - Automated quarantine rules - Partial
   - Report export/analytics - Not started

#### Medium Priority

7. **Merchant Integration**
   - API for merchants to upload prices directly - Not started
   - Batch import format - Not defined
   - Webhook for price updates - Not implemented

8. **Data Export**
   - User data export (GDPR) - Not started
   - Price history export - Not started
   - Report generation - Partial

9. **Advanced Filtering**
   - Date range selection - Partial
   - Multi-filter UI - Basic
   - Saved filters/searches - Not implemented

10. **Content Moderation**
    - Spam detection - Not implemented
    - Profanity filter - Not implemented
    - User banning system - Not started

#### Lower Priority

11. **AI/ML Features**
    - Price prediction - Not started
    - Fraud detection - Not started
    - Category auto-tagging - Basic heuristics only
    - Recommendation system - Not started

12. **Integration**
    - Payment system (if monetizing) - Not started
    - Social sharing - Not started
    - Email marketing - Not started
    - SMS notifications - Not started

13. **Operations**
    - Automated backups - Not configured
    - Disaster recovery - Not documented
    - Monitoring & alerting - Basic only
    - Scaling strategy - Not documented

---

## Required Functionality Gaps

### Critical Gaps for Production

#### 1. **Database Backup & Recovery**
- Current state: No automated backups mentioned
- Required for: Data persistence, disaster recovery
- Action items:
  ```bash
  - Set up PostgreSQL pg_dump daily backups
  - Store backups in S3-like storage (AWS/Backblaze)
  - Document restore procedure
  - Test recovery monthly
  - Implement PITR (Point-in-Time Recovery) if possible
  ```

#### 2. **Monitoring & Alerting**
- Current state: Basic logging, no alerting
- Required for: Detecting failures, performance issues
- Action items:
  ```bash
  - Set up error tracking (Sentry/Rollbar)
  - Add APM (New Relic/DataDog)
  - Configure database monitoring
  - Set up log aggregation (ELK stack / Datadog logs)
  - Create alerts for:
    * API response time > 1s
    * Error rate > 1%
    * Database connection pool exhausted
    * Disk space low
    * Memory usage > 80%
  ```

#### 3. **API Rate Limiting**
- Current state: No rate limiting visible
- Required for: Preventing abuse, fair usage
- Action items:
  ```typescript
  - Add middleware for rate limiting (per IP, per user)
  - Implement token bucket algorithm
  - Set limits:
    * 100 req/min per public IP
    * 1000 req/min per authenticated user
    * 10 req/min for admin jobs
  - Return 429 Too Many Requests
  - Track and report rate limit violations
  ```

#### 4. **Input Sanitization for XSS**
- Current state: Zod validation, unclear if output sanitized
- Required for: Security
- Action items:
  ```typescript
  - Sanitize all user-submitted text
  - Use DOMPurify on frontend for HTML content
  - Escape all text in SQL queries (already done with parameterization)
  - Add CSP headers to prevent inline scripts
  ```

#### 5. **Documentation**
- Current state: Partial documentation
- Required for: Maintenance, onboarding
- Action items:
  - Complete API documentation (OpenAPI/Swagger)
  - Database schema documentation
  - Deployment guide
  - Troubleshooting guide
  - Architecture decision records (ADR)

#### 6. **Testing**
- Current state: Some tests exist (vitest)
- Required for: Preventing regressions
- Action items:
  - Unit tests: 70%+ coverage
  - Integration tests for API routes
  - E2E tests for critical user flows
  - Load testing for performance
  - Security testing (OWASP Top 10)

#### 7. **Error Handling & Recovery**
- Current state: Basic try/catch blocks
- Required for: Resilience
- Action items:
  ```typescript
  - Implement circuit breaker pattern
  - Add exponential backoff for retries
  - Create custom error classes
  - Add error context (stack traces, user info)
  - Implement graceful degradation
  ```

#### 8. **Distributed Tracing**
- Current state: None visible
- Required for: Debugging in production
- Action items:
  - Add OpenTelemetry instrumentation
  - Trace requests across services
  - Track slow queries
  - Monitor job execution

### Important Functional Gaps

#### 9. **Image Hosting Strategy**
- Current state: Stores URLs, fetches externally
- Issues:
  - Dependent on source site availability
  - Images can disappear
  - Privacy concerns (referrer leaks)
- Action items:
  - Set up CDN (Cloudflare/AWS CloudFront)
  - Proxy images through CDN
  - Cache images locally (AWS S3/MinIO)
  - Implement image optimization pipeline

#### 10. **Search Functionality**
- Current state: Basic filtering
- Required: Full-text search with ranking
- Action items:
  ```sql
  - Create GIN index on product names
  - Implement `to_tsvector` for Arabic search
  - Add fuzzy string matching (pg_trgm)
  - Implement Elasticsearch or similar for advanced search
  - Add autocomplete/suggestions
  ```

#### 11. **Notification System**
- Current state: UI infrastructure exists, dispatch unclear
- Required: Reliable delivery
- Action items:
  ```typescript
  - Implement notification queue (Redis/RabbitMQ)
  - Send email for price alerts
  - Add push notifications (OneSignal/Firebase)
  - SMS alerts (Twilio)
  - In-app notifications with persistence
  - Digest emails (daily/weekly)
  ```

#### 12. **Caching Strategy**
- Current state: No explicit caching
- Required to: Reduce database load
- Action items:
  ```typescript
  - Add Redis for session store
  - Cache product listings (5 min TTL)
  - Cache best prices (1 min TTL)
  - Cache user profiles (10 min TTL)
  - Implement cache invalidation strategy
  - Add ETags for HTTP caching
  ```

#### 13. **Analytics & Reporting**
- Current state: Basic metrics collection
- Required: User insights, business intelligence
- Action items:
  - Track user behavior (page views, clicks)
  - Monitor source health trends
  - Generate reports:
    * Daily ingestion summary
    * Weekly price trends
    * Monthly user activity
  - Create admin dashboard with charts
  - Export data for analysis

#### 14. **Content Moderation at Scale**
- Current state: Manual moderation
- Required: Automated spam/abuse detection
- Action items:
  ```typescript
  - Implement spam filter (ML or rule-based)
  - Detect duplicate prices from same user
  - Detect price bombing (too many submissions)
  - Profanity filter
  - Auto-flag suspicious patterns
  - Community flagging (already partially implemented)
  ```

#### 15. **Internationalization (i18n)**
- Current state: Arabic + English, hardcoded strings
- Required: Full i18n support
- Action items:
  - Extract all strings to i18n JSON files
  - Add language selector
  - Support right-to-left (RTL) fully
  - Add number/date formatting per locale
  - Add Kurdish language support
  - Create translation workflow

---

## Deployment & Running

### Local Development (Standalone - No Supabase Required)

#### Prerequisites
```bash
# Required
Node.js 18+ or Bun
Docker Desktop (for PostgreSQL)
npm or bun

# Verify
node -v      # >= 18
npm -v       # >= 8
docker -v    # >= 20
```

#### Step 1: Prepare Environment
```bash
# In project root
cp .env.example .env

# Edit .env with:
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54321/price_tracker_iraq
APP_JWT_SECRET=dev-secret-key-change-in-production
INTERNAL_JOB_SECRET=internal-job-secret
DEV_LOGIN_SECRET=dev-login-secret
API_PORT=8787
VITE_API_BASE_URL=http://localhost:8787
```

#### Step 2: Start Database
```bash
# Using Docker Compose (simplest)
docker compose -f docker-compose.full.yml up -d db

# Wait for Postgres to be ready
sleep 10

# Or if running Postgres locally natively (not shown)
```

#### Step 3: Initialize Database
```bash
# The init scripts run automatically in Docker
# Or manually apply schema:
docker compose exec db psql -U postgres -d price_tracker_iraq -f /docker-entrypoint-initdb.d/00_schema.sql
```

#### Step 4: Install Dependencies
```bash
# Root dependencies
npm install
# or
bun install

# API dependencies
cd api && npm install && cd ..
# or
cd api && bun install && cd ..
```

#### Step 5: Start Services
```bash
# Option A: All in parallel (simplest)
npm run dev:all

# Option B: Separate terminals
# Terminal 1: API
npm run dev:api

# Terminal 2: Frontend
npm run dev:host
```

#### Step 6: Verify Setup
```bash
# API health check
curl http://localhost:8787/health

# Frontend
open http://localhost:5173

# Admin access (if seed data included)
- Email: admin@local
- Password: admin123
```

### Docker Deployment

#### Using Docker Compose
```bash
# Build and run all services
docker compose -f docker-compose.full.yml up -d --build

# Includes: PostgreSQL, API, Frontend, SearxNG (optional)

# Check services
docker compose -f docker-compose.full.yml ps

# View logs
docker compose -f docker-compose.full.yml logs -f api
docker compose -f docker-compose.full.yml logs -f web

# Stop all
docker compose -f docker-compose.full.yml down
```

### Production Deployment

#### Database Setup
```bash
# Use managed PostgreSQL (AWS RDS, Supabase, Neon, Railway)
# Or self-hosted PostgreSQL 12+

# Apply schema + migrations
psql $DATABASE_URL < db/init/00_schema.sql
psql $DATABASE_URL < db/migrations/0001_app_users.sql
# ... apply all migrations in order
```

#### Environment Variables
```bash
# .env for production
DATABASE_URL=postgres://user:pass@prod-db.host:5432/price_tracker
APP_JWT_SECRET=<generate-random-secure-key>
INTERNAL_JOB_SECRET=<generate-random-secure-key>
DEV_LOGIN_SECRET=  # Leave empty in production
API_PORT=8787
VITE_API_BASE_URL=https://api.example.com
NODE_ENV=production
LOG_LEVEL=info
```

#### API Deployment
```bash
# Build
npm run build

# Start
npm start

# Or use process manager (PM2)
pm2 start api/src/server.ts --name price-tracker-api

# Or Docker
docker build -f api/Dockerfile -t price-tracker-api:latest .
docker run -e DATABASE_URL=$DATABASE_URL -p 8787:8787 price-tracker-api
```

#### Frontend Deployment
```bash
# Build static
npm run build
# Output: dist/

# Deploy to static host (Vercel, Netlify, AWS S3 + CloudFront, etc.)
# Example with GitHub Pages:
git add dist/
git commit -m "Deploy frontend"
git push origin main
```

#### Domain & HTTPS
```bash
# Point domain to API
api.example.com → [API server IP:8787]

# Point domain to Frontend
example.com → [Frontend CDN/server]

# Enable HTTPS with Let's Encrypt
certbot certonly -d example.com -d api.example.com
# Renew automatically
```

#### Scheduled Jobs
```bash
# Option 1: PostgreSQL pg_cron (built-in)
SELECT cron.schedule('seed_frontier_daily', '0 2 * * *', 'SELECT seed_crawl_frontier()');

# Option 2: External job service
# Set up GitHub Actions / GitLab CI to call /admin/jobs/* endpoint periodically

# Option 3: Kubernetes CronJob (if using K8s)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: seed-frontier
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: api
            image: price-tracker-api:latest
            command: ["curl", "http://api:8787/admin/jobs/seedCrawlFrontier",
                      "-H", "x-job-secret=$INTERNAL_JOB_SECRET"]
          restartPolicy: OnFailure
```

### Monitoring & Operations

#### Health Checks
```bash
# API health
curl http://localhost:8787/health

# Database connection
psql $DATABASE_URL -c "SELECT 1;"

# Frontend
curl http://localhost:5173/
```

#### Logs
```bash
# Docker logs
docker compose -f docker-compose.full.yml logs -f api

# App logs (if using structured logging)
tail -f logs/app.log | jq '.'  # JSON formatted

# Database logs (PostgreSQL)
docker compose -f docker-compose.full.yml logs db
```

#### Performance Testing
```bash
# Load test API
ab -n 1000 -c 10 http://localhost:8787/health

# Or with wrk
wrk -t4 -c100 -d30s http://localhost:8787/health
```

---

## Summary: What's Working vs What's Needed

### What Works ✅

1. **Core Functionality**
   - User registration & authentication
   - Product browsing & price viewing
   - Price reporting (community crowdsourced)
   - Admin dashboard & job management
   - Database with RLS security
   - API with proper authorization

2. **Tech Stack**
   - Modern React + TypeScript frontend
   - Efficient Hono.js backend
   - PostgreSQL with advanced features
   - Docker for easy setup
   - Comprehensive schema design

3. **Features**
   - QR/Barcode scanning
   - Price comparison
   - Watchlists
   - Alert system (framework)
   - Admin moderation
   - Data ingestion pipeline

### What Needs Work ⚠️

**Critical for Production:**
- Backup & disaster recovery
- Monitoring & alerting systems
- API rate limiting & abuse prevention
- Performance optimization at scale
- Complete test coverage
- Production deployment guide

**Important for Functionality:**
- Real-time notifications (currently one-way)
- Search optimization
- Image hosting strategy
- Analytics dashboards
- Content moderation automation
- Caching layer (Redis)
- Complete i18n support

**Future Enhancements:**
- Mobile app
- ML-based price prediction
- Merchant API
- Advanced reporting
- SMS notifications
- Payment integration

### Time Estimate to Production

| Phase | Components | Time |
|-------|-----------|------|
| **Phase 1** | Testing, monitoring, deployment | 2-4 weeks |
| **Phase 2** | Performance optimization, caching | 2-3 weeks |
| **Phase 3** | Notifications, alerts at scale | 2-3 weeks |
| **Phase 4** | Analytics, advanced features | 2-3 weeks |
| **Phase 5** | Documentation, training | 1-2 weeks |
| **Total** | | **10-15 weeks** |

---

## Conclusion

**Price Tracker Iraq** is a well-architected, comprehensive platform for fair-price intelligence. The codebase demonstrates solid engineering practices with:
- Type-safe TypeScript throughout
- Secure authentication & authorization
- Scalable data ingestion pipeline
- Community-driven validation via crowd voting
- Admin tools for moderation & content management

The project is **at 60-70% completion** for a production MVP. The core features work, but additional work is needed around operational aspects (monitoring, backups), performance optimization, and advanced features (notifications, search, analytics).

With 10-15 weeks of focused development, this can be deployed as a production system serving hundreds of thousands of users across Iraq.

---

**Document Generated:** April 3, 2026
**Codebase Version:** Final Hotfix 4
**Total Lines of Code:** ~25,000 (Frontend: 8,000 | Backend: 12,000 | Database: 2,000 | Config/Scripts: 3,000)

# Iraq Trusted Core v1 Pilot Runbook

This runbook is the canonical execution path for the first governed pilot of the curated pack:

- `iraq-trusted-core-v1`

The goal is not "install many sources". The goal is to prove a clean, controlled Iraqi source rollout:

1. install the trusted pack
2. validate only the chosen pack scope
3. activate only validated sources
4. dry-run certification before public influence
5. seed and ingest only the chosen scope
6. review health, condition quarantine, taxonomy quarantine, and adapter execution priority
7. decide `continue` or `stop`

## Preconditions

- Deployed branch: `prod-ready`
- API is healthy
- schema patch jobs from earlier sprints are already available
- admin access works
- internal job secret is configured if you use job endpoints directly

## Pilot 01 Scope

Use one of these scopes:

- preferred: `pack=iraq-trusted-core-v1`
- optional: `domains=iraq.talabat.com,totersapp.com,...`
- both may be combined, but keep the first pilot tight

Recommended first pilot behavior:

- API-capable sources first
- then HTML-ready sources
- then mobile/render backlog
- postpone unstable or noisy sources

## Step 1: Install the trusted pack

From `/admin`:

1. open `البلجنات`
2. install `حزمة العراق الموثوقة الأساسية v1`

Expected result:

- sources are imported into governed source management
- mixed sources keep section governance
- sources do not become public influence automatically

Stop if:

- important sources fail import
- mixed-source governance is missing after import

## Step 2: Select the pilot scope

From `/admin` in `Shadow Mode`:

1. set `Pack pilot scope` to `iraq-trusted-core-v1`
2. optionally add `Domains pilot scope` for a narrower first wave

Recommended first wave:

- `iraq.talabat.com`
- `totersapp.com`
- `lezzoo.com`
- `gini.iq`
- `simma.io`

## Step 3: Validate Candidates

Run:

- `Validate Candidates`

Continue if:

- trusted sources pass validation in a believable way
- obvious anchor sources are not failing structurally

Stop if:

- pass rate is weak for strong sources
- failures indicate broken base URLs, blocked access, or wrong source type assumptions

## Step 4: Activate Passed

Run:

- `Activate Passed`

Expected result:

- sources become `observed`
- `catalog_publish_enabled` still stays controlled

Stop if:

- mixed marketplace sources behave like clean retail sources
- weak or suspicious sources move forward without justification

## Step 5: Certification Dry-Run

Run:

- `Certification Dry-Run`

Review:

- source tier
- quality score
- certification reason
- whether strong sources are being promoted logically

Continue if:

- no absurd promotions
- mixed sources remain contained

Stop if:

- low-trust or unstable sources look ready for publication
- certification output looks random or uncalibrated

## Step 6: Seed Scoped Pilot

Run:

- `Seed Scoped Pilot`

This should be scoped only to the selected pack/domains.

Continue if:

- frontier growth is visible for the chosen sources
- seed does not leak into unrelated source pools

Stop if:

- unexpected domains enter the frontier
- scoped seed produces obviously irrelevant frontier URLs

## Step 7: Ingest Scoped Pilot

Run:

- `Ingest Scoped Pilot`

Expected result:

- only the selected pack scope is ingested
- publication gate, canonical identity, taxonomy governance, and condition governance all stay active

Stop if:

- unrelated domains are touched
- low-confidence items publish directly
- used/open-box listings leak through

## Step 8: Review the 4 control surfaces

After pilot ingest, review these in `/admin`:

1. `Pack Certification Review`
2. `Adapter Readiness Dashboard`
3. `Adapter Execution Queue`
4. `حوكمة المنتجات الجديدة فقط` + taxonomy views

### What good looks like

- source health is understandable, not chaotic
- used/refurbished/open-box listings are blocked
- mixed sources without allowlists are blocked
- taxonomy quarantine exists but is not exploding
- execution queue shows a rational order:
  - API first
  - HTML second
  - mobile/render after that
  - weak sources on hold

### What bad looks like

- condition quarantine is full of supposedly new-only retailers
- taxonomy conflicts spike immediately for a source branch
- adapter queue pushes noisy or unhealthy sources to the top
- source health shows broad instability

## Step 9: Use Adapter Execution Queue as the daily operating list

Use `Adapter Execution Queue` as the operational truth for the current pack.

Work order:

1. `Today First`
2. `API Queue`
3. `HTML Queue`
4. `Mobile Queue`
5. `Render Queue`
6. `Hold Queue`

Action policy:

- `ابدأ` when the source is the next chosen item for work
- `تم` only when the assigned adapter path is genuinely ready
- `أجّله` when the source is noisy, blocked, or not worth pilot time yet

## Continue / Stop Decision

### Continue to Pilot 02 only if all are true

- trusted pack import is clean
- validation and activation are believable
- certification dry-run is sane
- scoped seed and ingest stay inside scope
- used or mixed leakage is blocked
- taxonomy is under control
- execution queue clearly prioritizes strong sources

### Stop and stabilize if any are true

- mixed sources need stronger section governance
- a source category branch is polluting the catalog
- a supposed retailer behaves like a weak marketplace
- source health is unstable
- execution queue top items are mostly weak or blocked

## Pilot 02 Expansion Rule

Do not expand by "more websites".

Expand by:

1. keeping the same governance
2. promoting only clean winners
3. adding the next strongest Iraqi sources by sector
4. preserving new-only enforcement and certification discipline

The product wins when Iraqi source growth increases trust, not entropy.

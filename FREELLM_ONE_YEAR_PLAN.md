# freellm -- One-Year Operating Plan (Ads/Affiliate/Sponsorship Only)

**Version:** 1.0  
**Date:** 2026-11-03  
**Model:** Zero-payment, community-owned, ad/affiliate/sponsorship funded  
**Target:**  MRR by Month 12 ->  ARR run rate

---

## Executive Summary

freellm is a **community-owned AI model arena** with two entry points:
- **Door 1 (BYOK):** Bring your own key -> chat free forever
- **Door 2 (The Pool):** Spend earned credits on community-funded models (1 credit = 1 token)

**Revenue Model:** 100% ads/affiliate/sponsorship -- no user payments, no credit sales, no subscriptions.

**North Star Metric:** *Weekly Active Chatters (WAC)* -- users who send >=1 chat message/week via either door.

---

## Domain Architecture & Leadership

\+-----------------------------------------------------------------------+
|                              CEO / Founder                             |
|                    (Strategy, Capital, Board, Vision)                 |
+-----------------------------------------------------------------------+
                                      |
        +-----------------+-----------------+-----------------+-----------------+
        v                 v                 v                 v                 v
   +---------+      +------------+      +------------+      +------------+      +--------------+
   |   CTO   |      |   CPO      |      |   CMO      |      |   CFO      |      |   COO        |
   | Eng/Infra|      | Product    |      | Growth/    |      | Finance/   |      | Operations   |
   |         |      |            |      | Ads/Aff/   |      | Legal      |      | Support      |
   |         |      |            |      | Sponsor    |      |            |      |              |
   +----+----+      +-----+------+      +-----+------+      +----+------+      +------+-------+
        |                   |                  |                  |                  |
   +----+----+      +------+------+      +------+------+      +----+------+      +------+--------+
   |Platform |      |  Core UX   |      | Acquisition|      | Rev Ops   |      | Community     |
   |  API    |      |  Features  |      |  SEO/SEM   |      | Attrib.   |      |  Support      |
   |Infra    |      |  Pool/BYOK |      |  Affiliate |      | Forecast  |      | Moderation    |
   |Scaling  |      |  Arcade    |      |  Sponsor   |      | Compliance|      |  Ops          |
   +---------+      +------------+      +------------+      +-----------+      +---------------+
        |                   |                  |                  |                  |
   +----+----+      +------+------+      +------+------+      +----+------+      +------+--------+
   |Design/  |      | Analytics  |      | Partnerships|      | Legal/    |      | Trust &       |
   |Brand    |      |  Data      |      |  Sales      |      | Compliance|      | Safety        |
   +---------+      +------------+      +------------+      +-----------+      +---------------+
\
### Leadership Roles (Fractional/Advisor Model -- No Full-Time Hires Year 1)

| Role | Persona | Time Commitment | Key Accountability |
|------|---------|-----------------|-------------------|
| **CEO** | Founder | 100% | Vision, capital allocation, board, key partnerships |
| **CTO** | Founder (technical) | 60% | Architecture, infra, security, scaling |
| **CPO** | Founder (product) | 40% | Roadmap, UX, feature prioritization |
| **CMO** | Advisor + Contractor | 20% | Growth strategy, ad/affiliate/sponsor programs |
| **CFO** | Fractional (monthly) | 5% | Revenue recognition, forecasting, compliance |
| **COO** | Contractor (ops) | 10% | Support, legal, vendor mgmt, Trust & Safety |
| **Head of Design** | Contractor | 15% | Brand, UI/UX, marketing assets |
| **Head of Partnerships** | Contractor | 20% | Sponsorship sales, affiliate recruitment |
| **Community Lead** | Power user (paid) | 20h/wk | Discord, support, moderation, feedback loops |

---

## Org Structure: Domains -> Sections -> Squads

### 1. ENGINEERING (CTO Domain)

\Engineering
|-- Platform Squad (3-4 eng)
|   |-- API Gateway / Chat Core
|   |-- Metering & Credit Ledger
|   |-- Provider Routing & Failover
|   |-- OpenAI-compatible /v1 Surface
|-- Infrastructure Squad (2 eng)
|   |-- Cloudflare Pages/D1/KV Ops
|   |-- CI/CD, Observability, Secrets
|   |-- Cost Optimization (CF Workers)
|   |-- Disaster Recovery / Backups
|-- Growth Engineering (1-2 eng)
|   |-- SEO/Technical SEO
|   |-- Attribution & Tracking
|   |-- A/B Test Framework
|   |-- Referral/Viral Mechanics
|-- Data/Analytics (1 eng + analyst)
    |-- Event Pipeline (PostHog/Plausible)
    |-- Revenue Attribution Model
    |-- Cohort & Retention Dashboards
    |-- ML: Churn Prediction, LTV
\
**Year 1 Hiring:** 0 full-time -> 2 contract engineers (Platform + Infra) by Q3

---

### 2. PRODUCT (CPO Domain)

\Product
|-- Core Experience Squad
|   |-- BYOK Vault (keys, OAuth, validation)
|   |-- The Pool (catalog, routing, tiers)
|   |-- Chat Interface (streaming, battles, history)
|   |-- Dashboard (usage, credits, referrals)
|-- Retention & Economy Squad
|   |-- Daily Check-in & Streaks
|   |-- Arcade Games (typing, memory, future)
|   |-- Weekly Quests & Seasonal Events
|   |-- Referral Program & Milestones
|   |-- Promo Codes & Admin Grants
|-- Developer Platform Squad
|   |-- /v1 API & SDKs (Python/TS/Go)
|   |-- API Docs & Playground
|   |-- Webhooks & Usage Alerts
|   |-- Personal API Tokens (fl_...)
|-- Discovery & Trust Squad
    |-- Provider Directory (/providers)
    |-- Model Benchmarks & Comparisons
    |-- Community Reviews & Ratings
    |-- Safety/Moderation Tooling
\
---

### 3. GROWTH / REVENUE (CMO Domain) -- **Revenue Engine**

\Growth & Revenue
|-- Affiliate Program Squad
|   |-- Provider Partnerships (OpenRouter, Together, Groq, etc.)
|   |-- Commission Negotiation & Tracking
|   |-- Creative Assets & Landing Pages
|   |-- Performance Marketing (UTM, Attribution)
|-- Sponsorship Sales Squad
|   |-- Model of the Week Sponsorships
|   |-- Newsletter Sponsorships (weekly digest)
|   |-- Arcade/Event Sponsorships
|   |-- Enterprise Bring Your Model Packages
|   |-- White-label / Co-branded Pages
|-- Display & Native Ads Squad
|   |-- Ethical Ad Network (Carbon, EthicalAds)
|   |-- Contextual Placement (chat sidebar, dashboard)
|   |-- Frequency Capping & UX Guardrails
|   |-- Revenue per 1K Impressions (RPM) Optimization
|-- SEO & Content Squad
|   |-- Technical SEO (sitemap, schema, speed)
|   |-- Programmatic Pages (model comparisons)
|   |-- Blog/Guides (LLM routing, cost optimization)
|   |-- YouTube/Shorts/TikTok (dev education)
|   |-- Link Building (resource pages, directories)
|-- Lifecycle & Retention Squad
    |-- Email/Discord Onboarding Flow
    |-- Win-back Campaigns (dormant users)
    |-- Power User Program (advocates, beta)
    |-- Community Events (AMAs, hackathons)
\
---

### 4. FINANCE & LEGAL (CFO Domain)

\Finance & Legal
|-- Revenue Operations
|   |-- Affiliate Commission Tracking (per provider)
|   |-- Sponsorship Invoicing & Collection
|   |-- Ad Revenue Reconciliation
|   |-- Monthly P&L & Cash Flow Forecast
|   |-- Unit Economics: CAC, LTV, Payback
|-- Compliance & Legal
|   |-- Terms of Service / Privacy Policy (GDPR/CCPA)
|   |-- Affiliate Disclosure (FTC)
|   |-- Data Processing Agreements (DPA)
|   |-- Cookie Consent & Analytics Opt-out
|   |-- AGPL-3.0 Compliance (network distribution)
|-- Banking & Admin
    |-- Stripe/Payouts for Contractors
    |-- Expense Management (Ramp/Brex)
    |-- Tax Filing (Delaware C-Corp or LLC)
    |-- Cap Table / Equity Management
\
---

### 5. OPERATIONS & COMMUNITY (COO Domain)

\Operations & Community
|-- Community & Support
|   |-- Discord Moderation (volunteers + lead)
|   |-- Email Support (help@freellm.hasit.in)
|   |-- FAQ/Knowledge Base (Notion/GitBook)
|   |-- Bug Triage & Feature Request Routing
|   |-- Power User / Ambassador Program
|-- Trust & Safety
|   |-- Content Moderation Policy
|   |-- Abuse Detection (credit farming, key scraping)
|   |-- Spam/Bot Prevention (CAPTCHA, rate limits)
|   |-- Incident Response Playbook
|   |-- Transparency Report (quarterly)
|-- Vendor & Infra Management
|   |-- Cloudflare Account & Billing
|   |-- Upstream Provider Contracts
|   |-- Analytics/Monitoring Tools (Sentry, PostHog)
|   |-- Domain/DNS/SSL Management
|-- People Operations
    |-- Contractor Onboarding/Offboarding
    |-- Advisor Agreements & Equity Grants
    |-- Performance Reviews (quarterly)
    |-- Culture & Values Documentation
\
---

### 6. DESIGN & BRAND (Design Domain)

\Design & Brand
|-- Product Design
|   |-- Chat UX (streaming, mobile, accessibility)
|   |-- Dashboard & Analytics Views
|   |-- Arcade Game UI/UX
|   |-- Admin Console Usability
|-- Marketing Design
|   |-- Landing Pages (providers, models, features)
|   |-- Sponsorship Assets (media kits, one-pagers)
|   |-- Social Media Templates (Twitter, LinkedIn)
|   |-- Email Newsletter Templates
|   |-- Merch/Swag (stickers, shirts for events)
|-- Brand System
    |-- Design Tokens (colors, spacing, typography)
    |-- Component Library (Storybook)
    |-- Illustration Style (The Pool, Arcade, etc.)
    |-- Voice & Tone Guidelines
\
---

## One-Year Roadmap: Quarters & Milestones

### Q1 2027 (Jan-Mar): Foundation & Revenue Infrastructure

| Week | Engineering | Product | Growth/Revenue | Operations |
|------|-------------|---------|----------------|------------|
| 1-2 | Stripe Connect for affiliate payouts | Provider Directory v2 (filters, compare) | Sign 5 affiliate agreements (OpenRouter, Together, Groq, Fireworks, DeepInfra) | Legal: TOS, Privacy, FTC disclosure |
| 3-4 | Attribution pipeline (UTM -> DB -> Dashboard) | Model benchmarking framework (lmspeed integration) | Launch Model of the Week sponsorship package (-2K/week) | Discord moderation team (3 volunteers) |
| 5-6 | Ad server integration (EthicalAds/Carbon) | Arcade: Add 3rd game (trivia/puzzle) | SEO: 20 programmatic comparison pages | Support: FAQ + canned responses |
| 7-8 | /v1 SDK: Python (pip install freellm) | BYOK: Bulk key import (CSV) | Content: 4 pillar guides (routing, costs, local, privacy) | Vendor contracts: CF, analytics, monitoring |
| 9-10 | Webhook system for usage alerts | Admin: Bulk user actions, audit log | Email onboarding flow (5-part sequence) | Transparency Report #1 |
| 11-12 | Cost optimization: KV->D1 migration | Referral: Social share cards (OG images) | YouTube: 2 videos/week (shorts + long) | Contractor agreements standardized |

**Q1 Exit Criteria:**
- 10 active affiliate partners, /mo affiliate revenue
- 2 sponsorship deals closed (/mo)
- Ad RPM > .50, < 2 ads/session
- WAC: 500 -> 1,500
- Technical SEO score > 90

---

### Q2 2027 (Apr-Jun): Scale Acquisition & Deepen Monetization

| Week | Engineering | Product | Growth/Revenue | Operations |
|------|-------------|---------|----------------|------------|
| 13-14 | Multi-region CF Workers (EU/APAC) | Model reviews & ratings (community) | Sponsorship tiers: Bronze/Silver/Gold (-10K/mo) | Hire Community Lead (20h/wk) |
| 15-16 | Real-time analytics dashboard | Battle Arena v2 (tournaments, prizes) | Affiliate: Recruit 15 more providers (direct + gateways) | Trust & Safety: Automated abuse detection |
| 17-18 | /v1 SDK: TypeScript + Go | Team workspaces (invite, shared credits) | Programmatic SEO: 100 model comparison pages | Incident response drill |
| 19-20 | Credit ledger v2 (double-entry) | Seasonal event framework (quarterly) | Newsletter: 5K subs, /issue sponsorship | Quarterly board deck |
| 21-22 | A/B test framework (feature flags) | Mobile PWA (offline queue, push) | YouTube: 10K subs, course series | Fractional CFO engaged |
| 23-24 | Load test: 10K concurrent chats | Developer playground (try /v1 in browser) | Retargeting: Meta/Google (privacy-safe) | Salary benchmark for first FTE |

**Q2 Exit Criteria:**
- 25 affiliate partners, /mo affiliate revenue
- 5 sponsorship deals, /mo sponsorship revenue
- Ad revenue /mo
- WAC: 1,500 -> 5,000
- Newsletter: 5K subs, 35% open rate
- First enterprise inquiry (white-label)

---

### Q3 2027 (Jul-Sep): Product-Market Fit & Enterprise Motion

| Week | Engineering | Product | Growth/Revenue | Operations |
|------|-------------|---------|----------------|------------|
| 25-26 | SSO (SAML/OIDC) for teams | Team workspaces v2 (roles, budgets) | Enterprise pilot: 3 design partners | Hire 1 Platform Engineer (contract) |
| 27-28 | Custom model deployment (BYOM) | Admin: Revenue analytics per provider | Sponsorship: Annual contracts (discount) | SOC2 Type I readiness |
| 29-30 | Usage export (CSV/JSON/Parquet) | White-label /v1 for partners | Affiliate: Negotiate revenue share > 20% | Legal: Enterprise MSA template |
| 31-32 | GraphQL API (flexible queries) | Model benchmarking: User submissions | Content: Case studies (3 enterprise) | Quarterly transparency report |
| 33-34 | Automated failover testing | Arcade: League/season system | YouTube: 25K subs, sponsorships | First FTE offer (Platform Eng) |
| 35-36 | Disaster recovery drill | Plugin system (community extensions) | Retargeting: LinkedIn (dev audience) | Compensation philosophy doc |

**Q3 Exit Criteria:**
- 3 enterprise pilots, /mo pipeline
- 40 affiliate partners, /mo affiliate revenue
- 8 sponsorship deals, /mo sponsorship revenue
- Ad revenue /mo
- WAC: 5,000 -> 15,000
- First full-time engineer hired

---

### Q4 2027 (Oct-Dec): Profitability & 2028 Planning

| Week | Engineering | Product | Growth/Revenue | Operations |
|------|-------------|---------|----------------|------------|
| 37-38 | Cost per 1M tokens < .50 | 2028 Roadmap: AI Agent Marketplace | Sponsorship: Marketplace placement fees | Year-end financial audit |
| 39-40 | Auto-scaling provider pools | Community model hosting (HuggingFace) | Affiliate: Sub-affiliate network | 2028 Budget & OKRs |
| 41-42 | ML: Smart routing (cost/latency) | Freemium: Pro tier (analytics, API) | Ad network: Direct sales (no middleman) | Board review + strategy offsite |
| 43-44 | Multi-language support (i18n) | Mobile app (React Native/Expo) | YouTube: 50K subs, course revenue | Team retreat |
| 45-46 | Plugin marketplace (revenue share) | API: Batch / async endpoints | Enterprise: 5 closed deals | Promote contractor -> FTE |
| 47-48 | Year-end reliability freeze | Community governance (token vote?) | Holiday campaign (swag, credits) | 2027 Transparency Report |

**Q4 Exit Criteria (Year-End Targets):**
- **Total Revenue:  MRR** ( ARR run rate)
  - Affiliate: /mo
  - Sponsorship: /mo
  - Ads: /mo
- **WAC: 25,000** (5x Q1)
- **Team: 3 FTE + 5 contractors + advisors**
- **Cash Flow Positive** (ops cost < /mo on CF)
- **Enterprise Pipeline: + ARR committed**

---

## Revenue Model Deep-Dive

### Revenue Streams (Priority Order)

| Stream | Mechanism | Target CPM/CPC/RevShare | Year 1 Target |
|--------|-----------|-------------------------|---------------|
| **Affiliate Commissions** | ?ref=freellm on provider signup + usage | 15-30% rev share / -50 CPA |  ARR |
| **Sponsorships** | Model/Week, Newsletter, Arcade, Events | -10K/placement |  ARR |
| **Display/Native Ads** | EthicalAds, Carbon, Direct | .50-3.00 RPM |  ARR |
| **Enterprise/White-label** | Custom /v1, dedicated models, SSO | -20K/mo |  ARR (pipeline) |
| **Data/Insights (Yr2+)** | Anonymized benchmarking API | -5K/mo | -- |

### Attribution & Tracking Stack

\User Click -> UTM Parameters -> Cloudflare Workers -> D1 (attribution_events)
                                                              |
                                        Affiliate Dashboard (per provider)
                                                              |
                                        Monthly Reconciliation -> Invoicing
                                                              |
                                        Revenue Recognition (CFO)
\
**Key Metrics:**
- **Affiliate EPC** (Earnings Per Click) by provider
- **Sponsorship Fill Rate** (booked vs available slots)
- **Ad RPM** by placement (chat, dashboard, providers page)
- **LTV:CAC** by channel (organic, referral, paid, sponsorship)

---

## Budget: Year 1 Operating Costs

| Category | Monthly | Annual | Notes |
|----------|---------|--------|-------|
| **Cloudflare (Pages, D1, KV, Workers)** |  | ,400 | Scales with usage; generous free tier |
| **Upstream API Costs (Pool models)** |  | ,000 | Covered by contributed keys; minimal |
| **Analytics (PostHog, Sentry, Plausible)** |  | ,800 | Self-hosted options available |
| **Contractors (Eng x2, Design, Partnerships, Community)** | ,000 | ,000 | -4K/mo each; fractional |
| **Advisors (CMO, CFO, Legal)** | ,000 | ,000 | Equity + cash |
| **Tools (Linear, Notion, Discord, Email, Domain)** |  | ,600 | |
| **Legal/Compliance (TOS, Privacy, AGPL audit)** |  | ,000 | Fractional counsel |
| **Marketing (Content, Video, SEO tools)** | ,000 | ,000 | Ahrefs, Descript, stock assets |
| **Events/Community (Swag, Hackathons, AMAs)** |  | ,000 | |
| **Buffer (15%)** | ,973 | ,670 | |
| **TOTAL** | **,123** | **,470** | |

**Break-even:** Month 6 ( revenue)  
**Profitability:** Month 9 ( revenue vs  cost)  
**Year-End Net:** ~ revenue -  cost = ** surplus** -> reinvest in team

---

## Risk Register & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Affiliate programs change terms / shut down | Medium | High | Diversify: 25+ providers; own the relationship |
| Ad blockers kill display revenue | High | Medium | Native sponsorships > programmatic; ethical ads |
| Cloudflare pricing changes | Low | High | Multi-cloud readiness (Vercel, Netlify); own infra Yr2 |
| Key contributors burn out (volunteer mods) | Medium | Medium | Paid Community Lead; rotation; recognition |
| AGPL enforcement / license risk | Low | High | Legal review; clear contribution guidelines |
| Upstream provider bans our IPs | Medium | High | Rotating proxies; multiple providers per model |
| SEO algorithm update tanks traffic | Medium | High | Brand + direct traffic; email list; Discord |
| Credit farming / abuse at scale | Medium | High | ML detection; phone verification for high-value |

---

## Success Metrics Dashboard (Monthly Review)

| Metric | Q1 Target | Q2 Target | Q3 Target | Q4 Target |
|--------|-----------|-----------|-----------|-----------|
| **Weekly Active Chatters (WAC)** | 1,500 | 5,000 | 15,000 | 25,000 |
| **Monthly Revenue** |  |  |  |  |
| **Affiliate Partners** | 10 | 25 | 40 | 50 |
| **Sponsorship Deals** | 2 | 5 | 8 | 12 |
| **Newsletter Subscribers** | 1,000 | 5,000 | 15,000 | 30,000 |
| **YouTube Subscribers** | 1,000 | 10,000 | 25,000 | 50,000 |
| **Discord Members** | 2,000 | 8,000 | 20,000 | 40,000 |
| **Cost per WAC** |  | .60 | .40 | .40 |
| **Revenue per WAC** | .33 | .60 | .40 | .00 |

---

## Governance & Cadence

| Meeting | Frequency | Attendees | Output |
|---------|-----------|-----------|--------|
| **Daily Standup** | Daily (async) | Eng + Product | Blocker flag, deploy status |
| **Weekly Revenue Sync** | Monday 9am | CEO, CMO, CFO, Partnerships | Pipeline, closures, forecast |
| **Bi-weekly Sprint Review** | Friday | Eng, Product, Design | Demo, retro, next sprint |
| **Monthly All-Hands** | 1st Friday | Everyone + Advisors | Metrics, wins, strategy |
| **Quarterly Board Review** | End of Quarter | CEO, Board, Advisors | OKR score, budget, risks |
| **Annual Strategy Offsite** | Q4 | Core Team | 2028 Plan, Team Health |

---

## 2028 Preview (Post-Year 1)

1. **AI Agent Marketplace** -- Users deploy agents that earn credits autonomously
2. **Model Hosting Co-op** -- Community GPU pool (vast.ai + RunPod integration)
3. **Freellm Protocol** -- Open standard for credit-portable AI access
4. **Enterprise SaaS** -- Private cloud deployment, SLA, dedicated support
5. **Tokenized Governance** --  token for protocol fees + governance (if legal)

---

## Appendix: Key Contracts & Templates Needed

- [ ] Affiliate Partnership Agreement (standardized)
- [ ] Sponsorship Insertion Order (IO) template
- [ ] Enterprise MSA + SLA
- [ ] Contractor/Consultant Agreement (IP assignment)
- [ ] Advisor Agreement (equity + time)
- [ ] Volunteer Moderator Agreement
- [ ] Data Processing Addendum (DPA)
- [ ] AGPL-3.0 Compliance Checklist
- [ ] Brand Usage Guidelines (for partners)
- [ ] Crisis Communication Plan

---

*Document Owner: CEO*  
*Review Cadence: Monthly (metrics), Quarterly (strategy)*  
*Next Review: 2027-01-31

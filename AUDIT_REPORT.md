# freellm Core Product Flows — Senior Product Design Audit

**Date:** 2026-11-03  
**Auditor:** Senior Product Designer (AI)  
**Scope:** 6 core pages + 10 supporting components  
**Inspiration Target:** opencode.ai/data — rich charts, high-density tables, chip filters, export, progressive disclosure

---

## Executive Summary

The freellm product has **strong functional bones** but suffers from **design system fragmentation**, **inconsistent information hierarchy**, **missing visualization primitives**, and **mobile UX gaps**. The architecture supports the "Two Doors" metaphor well (Pool vs BYOK), but the UI doesn't consistently reinforce it.

**Top 3 Strategic Gaps:**
1. **No chart library** — Usage page uses hand-rolled bars; Earn/Leaderboards need Recharts
2. **Inconsistent empty/loading/error states** — each page reinvents them
3. **Mobile-first not practiced** — thumb reach, swipe gestures, keyboard handling are afterthoughts

**Opportunity:** A focused component library investment (Sparkline → Recharts, Card → structured variants, Select → combobox with chips) unlocks cohesive, data-dense UIs across all pages.

---

## Per-Page Audit & Redesign Specs

---

### 1. Dashboard (`/dashboard`) — Command Center

#### Current State
- **Balance card:** Prominent, but no scoped/global breakdown, no real-time feel
- **Streak card:** Number + static ring (animated in TodayCard but not here), no milestone preview
- **Quick actions:** 4 buttons, not thumb-optimized (too many, wrong order)
- **Activity feed:** 8 rows, good density, but no grouping, no infinite scroll
- **Checklist:** Good progressive disclosure, but visually buried

#### Redesign Spec

| Element | Current | Target |
|---------|---------|--------|
| **Balance** | Single number | **Hero metric**: Global + Scoped split, sparkline (7d), "≈X messages" translation |
| **Streak** | Number + static text | **Ring + milestone chips**: Day 7 (500k), Day 30 (2M), freeze count badge |
| **Quick Actions** | 4 equal buttons | **FAB cluster** (mobile) / **Primary row** (desktop): Chat (primary), Check-in (secondary if not done), Add Key (ghost), Models (ghost) |
| **Activity Feed** | Flat list | **Grouped by day**, expandable, "Load more" pagination, filter chips (Earned/Spent/Referral) |
| **Empty State** | Text only | **Illustrated + CTA**: "Start your streak → Check in" with pulse animation |

#### Component Gaps
- `MetricCard` — structured variant for balance/streak/referrals with sparkline slot
- `ActivityFeed` — virtualized, grouped, filterable
- `QuickActionBar` — responsive FAB/row switch
- `StreakRing` — reusable animated SVG (extract from TodayCard)

#### Mobile Adaptations
- Quick actions → bottom FAB cluster (3 max visible, "More" sheet)
- Activity feed → cards with swipe-to-expand details
- Balance card → full-width hero, tap to expand breakdown

---

### 2. Earn (`/earn`) — Growth Engine

#### Current State
- **Onboarding:** Modal, 3 steps, localStorage gate — good but not progressive (shows all at once)
- **TodayCard:** Hero, streak ring, progress segments, CTA — **strongest component**, but duplicated logic on Dashboard
- **Tiles (Arcade, Referral, Tasks, Quests, Leaderboards, Badges, Friends, Seasonal):** Expandable cards, inconsistent status semantics
- **Games:** ArcadePanel with Typing/Memory — functional but no replay value visualization
- **Leaderboards:** Tabs, weekly only, no user rank highlight
- **Badges:** Grid, rarity tiers (T1/T2), progress to next missing
- **Weekly Quests:** Progress bars, claim flow — good density
- **Seasonal Events:** Countdown, cosmetics equip — rich but hidden behind click

#### Redesign Spec

| Section | Current | Target |
|---------|---------|--------|
| **Onboarding** | Modal, 3 steps | **Inline progressive** — step 1 on first visit, step 2 after check-in, step 3 after first arcade play. Dismissible per-step. |
| **TodayCard** | Hero | **Unify with Dashboard** — single `StreakHero` component used on both pages. Add milestone preview chips (Day 7/30/60). |
| **Check-in** | Button in TodayCard | **Ring animation + reward pulse** (already in CSS), timezone-aware (UTC), freeze indicator inline |
| **Referral Tile** | Code + list | **QR code + share sheet**, milestone tracker (visual: 0→1→3→5 friends), referrer earnings sparkline |
| **Tasks** | Card grid | **Kanban columns**: Available / In Progress / Done. External links open in new tab with confirmation toast. |
| **Arcade** | Panel + stats | **Game cards** with: token cost badge, personal best sparkline, "Play again" CTA, weekly leaderboard entry link |
| **Leaderboards** | Tabs, 50 rows | **Time windows** (Week/Month/All), **user rank highlight** (sticky row), infinite scroll, "My rank: #X" badge |
| **Badges** | Grid, 12 items | **Gallery view**: rarity border glow, progress ring to next tier, shareable card (OG image), "XP to next" |
| **Weekly Quests** | List | **Card stack** with deadline urgency badge (🔴 <24h, 🟡 <3d), claim animation, auto-claim setting |
| **Seasonal Events** | Collapsed | **Hero banner** when active (countdown, exclusive reward preview), participate CTA above fold |

#### Component Gaps
- `StreakHero` — unified TodayCard/Dashboard streak visualization
- `EarnTile` → `EarnModule` — structured: header (icon, title, status, reward), body (progress, actions), footer (meta)
- `LeaderboardTable` — virtualized, sticky header, user-row highlight, time-window chips
- `BadgeGallery` — grid with rarity variants, progress rings, share action
- `QuestCard` — deadline urgency, progress ring, claim animation
- `SeasonalHero` — countdown timer, reward carousel, participate flow
- `QRCode` — referral link, share sheet integration

#### Mobile Adaptations
- Tile grid → single column, expandable accordion
- Leaderboards → horizontal scroll cards (top 3) + "View all"
- Arcade games → full-screen modals, landscape lock for typing
- Seasonal events → bottom sheet detail

---

### 3. Chat (`/chat`) — Core Product

#### Current State
- **Model Selector:** Select dropdown, status dot, tier badge, vision chip — no latency preview, no cost estimate inline
- **Streaming:** Token-by-token, cancel, regenerate (retry), no branching
- **Token Counter:** Live input/output/total in message footer — no pre-flight cost preview
- **History:** Sidebar missing — only localStorage persistence, no search/export/share/fork
- **Empty State:** 4 prompt buttons, model recommendation text — no categorized suggestions
- **Mobile:** Sticky input, but keyboard handling basic, no swipe history

#### Redesign Spec

| Element | Current | Target |
|---------|---------|--------|
| **Model Selector** | Native `<select>` | **Combobox with chips**: Tier filter chips (Free/Pro/Enterprise), provider health sparkline, latency preview (p50/p95), cost estimate per 1k tokens, "Try now" deep link |
| **Streaming** | Delta append | **Streaming controls**: Cancel, Regenerate (fork), Branch (new conversation from here), Copy markdown |
| **Cost Preview** | Post-hoc only | **Pre-flight estimator**: Input tokens (est.), selected model flat rate, "Will cost ~X cr" badge in composer |
| **Token Counter** | Message footer | **Live counter bar** (top of composer): Input est. / Output est. / Total est. / Cost cr — updates as you type |
| **History** | localStorage only | **Sidebar panel**: Search (cmd+K), Export (JSON/MD), Share (link), Fork (new chat from msg), Pin, Delete |
| **Empty State** | 4 buttons | **Categorized prompts**: Coding, Writing, Analysis, Creative — model-aware (vision models show image prompts) |
| **Mobile** | Sticky input | **Swipe from left** → history drawer, **Swipe right on msg** → actions (copy, fork, delete), **Keyboard toolbar** (attach, send) |

#### Component Gaps
- `ModelCombobox` — searchable, chip filters, health sparkline, cost preview
- `StreamingControls` — cancel, regenerate, branch, copy
- `CostEstimator` — tokenizer integration (rough), model flat rate, credit display
- `ChatHistorySidebar` — virtualized, search, actions menu
- `PromptLibrary` — categorized, model-aware, searchable
- `MessageActions` — hover/touch menu: copy, fork, share, delete, regenerate

#### Mobile Adaptations
- Model selector → bottom sheet
- History → slide-over panel (swipe from left)
- Composer → keyboard-aware sticky, toolbar with attach/send
- Messages → swipe actions, long-press menu

---

### 4. Keys / BYOK Vault (`/keys`) — Door 1

#### Current State
- **Provider Cards:** OAuth buttons + manual form — good separation
- **Key Cards:** Swipe gestures (delete/use), expandable details, status dot, latency — **strong mobile UX**
- **Add Key:** OAuth vs manual, validation, test flow, encryption notice — good but no "test before save"
- **Key Health:** Live/slow/down, latency number, error tooltip — **no sparkline**
- **Contribution:** Pool toggle missing — only BYOK, no "contribute this key to pool" flow
- **Empty State:** Text only — no provider logo grid

#### Redesign Spec

| Element | Current | Target |
|---------|---------|--------|
| **Provider Cards** | Buttons | **Logo grid** with status badges (Connected/Available), key count per provider |
| **Key Card** | Swipe + expand | **Keep swipe**, add: **latency sparkline** (7d), health trend (improving/degrading), "Contribute to Pool" toggle with reward estimate |
| **Add Key Flow** | Form + test after | **Wizard**: Provider → Auth (OAuth/Manual) → **Test connection** → Save. Show latency + cost estimate before save. |
| **Key Health** | Static status | **Live dashboard**: Sparkline (latency), uptime % (7d/30d), error rate, last 3 errors expandable |
| **Contribution** | Missing | **Pool toggle** per key: "Earn X cr/day estimated", revocation warning modal, earnings ledger link |
| **Empty State** | Text | **Provider logo grid** (OpenAI, Anthropic, Google, Codex, Custom), "Connect your first key" CTA |

#### Component Gaps
- `ProviderLogoGrid` — branded, status-aware, key count badges
- `KeyHealthSparkline` — 7d/30d latency, uptime %, error rate
- `AddKeyWizard` — stepped, test-before-save, cost estimate
- `ContributionToggle` — reward estimator, revocation warning, earnings link
- `KeyCard` → enhance with sparkline slot, contribution toggle

#### Mobile Adaptations
- Swipe gestures already excellent
- Add key wizard → full-screen steps
- Health detail → bottom sheet
- Provider grid → horizontal scroll

---

### 5. Models (`/models`) — Catalog

#### Current State
- **Grid cards** with status dot, tier badge, capability chips — good density
- **Filters:** Search + sort dropdown only — no chip filters, no URL sync
- **Provider Health:** Provider count only — no latency, no key count
- **"Try now":** Deep link to chat with model pre-selected — works
- **Comparison:** Missing

#### Redesign Spec

| Element | Current | Target |
|---------|---------|--------|
| **Layout** | Grid only | **Toggle**: Grid / List / Table (dense). Table: sortable columns (Status, Tier, Context, Max Output, Routing, Provider Count) |
| **Filters** | Search + sort | **Chip filter bar** (URL-synced): Tier [Free/Pro/Ent], Capability [Vision/Tools/JSON], Provider [OpenAI/Anthropic/...], Status [Live/Slow/Down], Scoped-only [Yes/No] |
| **Provider Health** | Count only | **Per-model health row**: Latency sparkline (p50), status dot, key count, "X providers live" |
| **"Try Now"** | Link | **CTA button** with cost preview tooltip: "~X cr/1k tokens", opens chat with model pre-selected |
| **Comparison** | Missing | **Compare modal**: Select 2-4 models → side-by-side table (tier, context, max out, capabilities, flat rate, routing, provider health) |

#### Component Gaps
- `ModelTable` — virtualized, sortable, column visibility, row selection for compare
- `FilterChipBar` — multi-select chips, URL sync, clear all, save preset
- `ModelHealthRow` — sparkline, status, key count, provider logos
- `CompareModal` — side-by-side, shareable URL, "Chat with winner" CTA
- `ModelCard` → enhance with health row, compare checkbox

#### Mobile Adaptations
- Table → card stack with progressive disclosure
- Filter chips → bottom sheet drawer
- Compare → full-screen modal

---

### 6. Usage (`/usage`) — Analytics (opencode.ai/data Target)

#### Current State
- **Time-series:** Hand-rolled bars (14 days) — no Recharts, no area chart, no daily/weekly/monthly toggle
- **Breakdowns:** By model only — missing: by provider, by tier, by key mode (pool/BYOK)
- **Cost Trends:** Burn rate only — missing: credits/day, rolling 7/30, projections
- **Export:** None
- **Empty/Loading:** Basic text — no skeletons

#### Redesign Spec

| Element | Current | Target |
|---------|---------|--------|
| **Time-Series** | 14-day bars | **Recharts AreaChart**: Daily/Weekly/Monthly toggle, brush zoom, hover tooltip (credits, messages, tokens), "Compare to previous period" overlay |
| **Breakdowns** | By model | **Tabbed breakdowns**: By Model / By Provider / By Tier / By Key Mode (Pool vs BYOK). Each: sortable table + donut chart |
| **Cost Trends** | Burn rate | **Metric row**: Credits/day (7d avg), Rolling 7d/30d, Projection (days remaining at current burn), "Break-even" date |
| **Export** | None | **Export dropdown**: CSV (raw), PNG (chart), Shareable link (signed URL, 7d expiry), "Copy JSON" |
| **Empty/Loading** | Text | **Skeleton charts** (shimmer areas), progressive reveal (summary cards → charts → tables) |
| **Recent Requests** | Table | **Virtualized table**: sortable, filterable (model, status, date), expandable row (full request/response), "Replay in chat" |

#### Component Gaps (HIGH PRIORITY)
- `UsageAreaChart` — Recharts, brush zoom, period toggle, comparison overlay
- `BreakdownTabs` — Model/Provider/Tier/KeyMode, each with table + donut
- `CostTrendMetrics` — 7d/30d avg, projection, break-even
- `ExportDropdown` — CSV/PNG/Link/JSON
- `SkeletonChart` — shimmer area/bar/line variants
- `RequestTable` — virtualized, expandable, replay action

#### Mobile Adaptations
- Charts → horizontal scroll, simplified tooltips
- Tables → card stack, tap to expand
- Export → share sheet

---

## Component Library Gaps (Prioritized)

| Priority | Component | Used By | Effort | Notes |
|----------|-----------|---------|--------|-------|
| **P0** | `RechartsProvider` + `AreaChart`/`BarChart`/`DonutChart` | Usage, Earn, Dashboard, Models | 3d | Wrap Recharts, consistent theming, responsive |
| **P0** | `Sparkline` (enhanced) | Dashboard, Keys, Models, Earn | 1d | Already exists → add area variant, tooltip, gradient |
| **P0** | `MetricCard` | Dashboard, Usage, Keys, Earn | 1d | Hero + sparkline + breakdown slot |
| **P0** | `FilterChipBar` | Models, Usage, Earn, Dashboard | 2d | Multi-select, URL sync, save preset |
| **P0** | `VirtualizedTable` | Usage, Models, Earn, Chat History | 2d | @tanstack/react-virtual, sortable, expandable |
| **P1** | `StreakHero` | Dashboard, Earn | 1d | Unify TodayCard ring + milestone chips |
| **P1** | `ModelCombobox` | Chat, Models | 2d | Search, chips, health sparkline, cost preview |
| **P1** | `ChatHistorySidebar` | Chat | 2d | Search, export, share, fork, pin |
| **P1** | `LeaderboardTable` | Earn | 1d | Time windows, user highlight, infinite scroll |
| **P1** | `BadgeGallery` | Earn | 1d | Rarity variants, progress rings, share |
| **P1** | `QuestCard` | Earn | 1d | Deadline urgency, claim animation |
| **P1** | `SeasonalHero` | Earn | 1d | Countdown, reward carousel |
| **P1** | `AddKeyWizard` | Keys | 2d | Stepped, test-before-save, cost estimate |
| **P1** | `KeyHealthSparkline` | Keys | 1d | 7d/30d latency, uptime, error rate |
| **P1** | `CompareModal` | Models | 2d | Side-by-side, shareable URL |
| **P2** | `PromptLibrary` | Chat | 1d | Categorized, model-aware |
| **P2** | `QRCode` | Earn (Referral) | 0.5d | Share sheet integration |
| **P2** | `StreamingControls` | Chat | 1d | Cancel, regenerate, branch, copy |
| **P2** | `CostEstimator` | Chat, Models | 1d | Tokenizer integration (rough) |
| **P2** | `SkeletonChart` | Usage, Dashboard | 0.5d | Shimmer area/bar/line |
| **P2** | `ExportDropdown` | Usage, Earn, Models | 0.5d | CSV/PNG/Link/JSON |

---

## Chart Specifications (Recharts)

### Theme Configuration
```typescript
// src/lib/charts/theme.ts
export const chartTheme = {
  colors: {
    primary: 'var(--accent)',
    gain: 'var(--gain)',
    loss: 'var(--loss)',
    warn: 'var(--warn)',
    muted: 'var(--muted)',
    surface: 'var(--surface)',
    line: 'var(--line)',
    grid: 'var(--border)',
    text: 'var(--content)',
    textMuted: 'var(--muted)',
  },
  gradients: {
    areaPrimary: 'linear-gradient(180deg, var(--accent)/0.3, var(--accent)/0)',
    areaGain: 'linear-gradient(180deg, var(--gain)/0.3, var(--gain)/0)',
  },
  radius: 4,
  fontSize: 11,
  tooltip: {
    background: 'var(--surface)',
    border: 'var(--line)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  },
};
```

### Chart Components

| Component | Props | Features |
|-----------|-------|----------|
| `AreaChart` | `data`, `xKey`, `yKey`, `period` (d/w/m), `comparisonData?`, `brush?` | Gradient fill, brush zoom, period toggle, comparison overlay, responsive |
| `BarChart` | `data`, `xKey`, `yKey`, `grouped?`, `stacked?` | Rounded bars, value labels, grouped/stacked, horizontal variant |
| `DonutChart` | `data`, `innerRadius`, `showTotal?` | Animated entry, center total, legend, tooltip |
| `Sparkline` | `data`, `variant` (line/area), `showTooltip?` | Mini, no axes, gradient area option, peak marker |

### Data Shapes
```typescript
// Time-series point
interface SeriesPoint {
  date: string; // ISO date
  credits: number;
  messages: number;
  tokens: number;
  poolCredits: number;
  byokCredits: number;
}

// Breakdown row
interface BreakdownRow {
  key: string; // model/provider/tier/keyMode
  label: string;
  credits: number;
  messages: number;
  tokens: number;
  pct: number;
}
```

---

## Mobile Adaptation Patterns

### Breakpoint Strategy
```css
/* Tailwind breakpoints in use */
sm: 640px   /* Tile grid → 2 col */
md: 768px   /* Tables → horizontal scroll */
lg: 1024px  /* Grid → 3-4 col, sidebars visible */
xl: 1280px  /* Dense tables, 4-col grids */
```

### Touch-First Patterns

| Pattern | Implementation |
|---------|----------------|
| **Swipe Actions** | `react-swipeable` or custom pointer events (KeyCard pattern) |
| **Bottom Sheets** | `@radix-ui/react-dialog` + mobile detection, swipe-down dismiss |
| **FAB Clusters** | Fixed bottom-right, 3 actions max, "More" → action sheet |
| **Drawer Navigation** | Swipe from left (history), right (actions) |
| **Keyboard Toolbar** | `inputmode`, `enterkeyhint`, custom toolbar above keyboard |
| **Pull to Refresh** | `PullToRefresh` component (already in Keys) |
| **Haptic Feedback** | `useHaptics` (already exists) — use on all primary actions |

### Responsive Component Variants

| Component | Mobile (<640) | Tablet (640-1024) | Desktop (>1024) |
|-----------|---------------|-------------------|-----------------|
| `MetricCard` | Full-width hero, tap expand | 2-col grid | 3-5 col grid |
| `EarnModule` | Accordion (single) | 2-col grid, expand inline | 4-col grid, expand inline |
| `ModelCard` | Card stack, progressive | 2-col grid | 3-4 col grid / Table |
| `LeaderboardTable` | Top 3 cards + "View all" | Horizontal scroll cards | Full table, sticky user row |
| `ChatHistorySidebar` | Slide-over drawer | Resizable panel | Persistent sidebar |
| `FilterChipBar` | Bottom sheet drawer | Chip row (scrollable) | Chip row + "More" popover |
| `AreaChart` | Simplified, no brush | Brush enabled | Full brush + comparison |

---

## Implementation Order (Phased)

### Phase 1: Foundation (Week 1-2) — Unblock Everything
| Task | Owner | Days | Dependencies |
|------|-------|------|--------------|
| Install Recharts + configure theme | FE | 1 | — |
| Create `MetricCard`, `Sparkline` (enhanced), `SkeletonChart` | FE | 2 | Recharts |
| Create `FilterChipBar` with URL sync | FE | 2 | — |
| Create `VirtualizedTable` wrapper | FE | 2 | @tanstack/react-virtual |
| Unify `StreakHero` (Dashboard + Earn) | FE | 1 | — |
| Design system audit: consolidate `ui.tsx` variants | FE | 1 | — |

### Phase 2: Usage & Dashboard (Week 2-3) — Highest Impact
| Task | Owner | Days | Dependencies |
|------|-------|------|--------------|
| `UsageAreaChart` with period toggle + comparison | FE | 2 | Phase 1 |
| `BreakdownTabs` (Model/Provider/Tier/KeyMode) | FE | 2 | Phase 1 |
| `CostTrendMetrics` + `ExportDropdown` | FE | 1 | Phase 1 |
| `RequestTable` virtualized + expandable + replay | FE | 2 | Phase 1 |
| Dashboard: Hero balance + sparkline breakdown | FE | 1 | Phase 1 |
| Dashboard: `ActivityFeed` grouped + filterable | FE | 2 | Phase 1 |
| Dashboard: `QuickActionBar` responsive FAB/row | FE | 1 | — |

### Phase 3: Earn & Models (Week 3-4) — Engagement Core
| Task | Owner | Days | Dependencies |
|------|-------|------|--------------|
| `EarnModule` (replace EarnTile) with structured slots | FE | 2 | Phase 1 |
| `LeaderboardTable` with time windows + user highlight | FE | 1 | Phase 1 |
| `BadgeGallery` with rarity + progress + share | FE | 1 | Phase 1 |
| `QuestCard` with urgency + claim animation | FE | 1 | — |
| `SeasonalHero` with countdown + reward carousel | FE | 1 | — |
| `ModelCombobox` with chips + health + cost preview | FE | 2 | Phase 1 |
| `ModelTable` with compare checkbox + density toggle | FE | 2 | Phase 1 |
| `CompareModal` side-by-side + shareable URL | FE | 2 | Phase 1 |
| `ModelHealthRow` sparkline + key count | FE | 1 | Phase 1 |

### Phase 4: Chat & Keys (Week 4-5) — Core Product
| Task | Owner | Days | Dependencies |
|------|-------|------|--------------|
| `ChatHistorySidebar` search/export/share/fork | FE | 2 | Phase 1 |
| `StreamingControls` cancel/regenerate/branch | FE | 1 | — |
| `CostEstimator` + `PromptLibrary` | FE | 2 | Tokenizer lib |
| `AddKeyWizard` stepped + test-before-save | FE | 2 | — |
| `KeyHealthSparkline` 7d/30d + uptime | FE | 1 | Phase 1 |
| `ContributionToggle` + reward estimator | FE | 1 | Backend API |
| `ProviderLogoGrid` empty state | FE | 0.5 | — |

### Phase 5: Polish & Mobile (Week 5-6)
| Task | Owner | Days | Dependencies |
|------|-------|------|--------------|
| Mobile: FAB clusters, bottom sheets, swipe actions | FE | 3 | All phases |
| Mobile: Keyboard toolbar, drawer navigation | FE | 2 | — |
| Accessibility audit: ARIA, focus management, contrast | FE | 2 | — |
| Performance: Virtualization, code splitting, memo | FE | 2 | — |
| Documentation: Component storybook, usage guide | FE | 1 | — |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Recharts bundle size | Medium | High | Tree-shake, lazy load chart components, consider `uPlot` for sparklines |
| Backend API gaps (key health history, comparison data) | High | Medium | Mock data for UI dev, parallel backend work |
| Mobile gesture conflicts (swipe vs scroll) | Medium | Medium | Test on real devices, use `touch-action` CSS |
| Tokenizer for cost estimation | Low | Medium | Rough heuristic (chars/4), refine later |
| Design system drift | High | High | Storybook + visual regression tests |

---

## Appendix: File Map for Implementation

```
src/
├── components/
│   ├── charts/                 # NEW
│   │   ├── AreaChart.tsx
│   │   ├── BarChart.tsx
│   │   ├── DonutChart.tsx
│   │   ├── Sparkline.tsx       # enhance existing
│   │   ├── SkeletonChart.tsx
│   │   └── theme.ts
│   ├── dashboard/
│   │   ├── MetricCard.tsx      # NEW
│   │   ├── ActivityFeed.tsx    # NEW
│   │   ├── QuickActionBar.tsx  # NEW
│   │   └── StreakHero.tsx      # NEW (unify)
│   ├── earn/
│   │   ├── EarnModule.tsx      # replaces EarnTile
│   │   ├── LeaderboardTable.tsx
│   │   ├── BadgeGallery.tsx
│   │   ├── QuestCard.tsx
│   │   ├── SeasonalHero.tsx
│   │   └── QRCode.tsx
│   ├── chat/
│   │   ├── ModelCombobox.tsx
│   │   ├── StreamingControls.tsx
│   │   ├── CostEstimator.tsx
│   │   ├── ChatHistorySidebar.tsx
│   │   ├── PromptLibrary.tsx
│   │   └── MessageActions.tsx
│   ├── keys/
│   │   ├── AddKeyWizard.tsx
│   │   ├── KeyHealthSparkline.tsx
│   │   ├── ContributionToggle.tsx
│   │   └── ProviderLogoGrid.tsx
│   ├── models/
│   │   ├── ModelTable.tsx
│   │   ├── FilterChipBar.tsx
│   │   ├── ModelHealthRow.tsx
│   │   └── CompareModal.tsx
│   ├── usage/
│   │   ├── UsageAreaChart.tsx
│   │   ├── BreakdownTabs.tsx
│   │   ├── CostTrendMetrics.tsx
│   │   ├── ExportDropdown.tsx
│   │   └── RequestTable.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Select.tsx          # enhance → Combobox
│       ├── Tabs.tsx
│       ├── StatusBadge.tsx
│       ├── Credits.tsx
│       └── LoadingState.tsx
├── lib/
│   ├── charts/
│   │   └── theme.ts
│   ├── format.ts
│   └── useHaptics.ts
└── pages/
    ├── Dashboard.tsx   → refactor
    ├── Earn.tsx        → refactor
    ├── Chat.tsx        → refactor
    ├── Keys.tsx        → refactor
    ├── Models.tsx      → refactor
    └── Usage.tsx       → refactor
```

---

## Sign-Off

This audit provides a **complete, prioritized roadmap** to bring freellm's core flows to parity with opencode.ai/data's data-density and interaction quality. The phased approach ensures early wins (Usage, Dashboard) while building reusable primitives that compound across all pages.

**Next Step:** Assign Phase 1 tasks, set up Recharts + Storybook, begin `MetricCard` and `Sparkline` enhancement.
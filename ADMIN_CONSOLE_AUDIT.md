# freellm Admin Console — Senior B2B/Enterprise Design Audit

**Audited:** 2026-11-03  
**Scope:** 9 tabs, 11 files, cross-cutting patterns  
**Inspiration Baseline:** opencode.ai/data — clean tables, inline charts, chip filters, export, high density, keyboard-first

---

## Executive Summary

The admin console is **functional but not yet enterprise-grade**. It has solid backend integration, optimistic updates, and sensible information architecture. However, it lacks the density, keyboard efficiency, data visualization depth, and mobile adaptations expected in a B2B SaaS admin surface. The "just fixed" Users tab is the strongest; Audit Log and Email Blocks are the weakest.

**Top 3 Strategic Gaps**
1. **No shared DataTable primitive** — every tab reinvents sorting, filtering, empty states, density
2. **No keyboard-first interaction model** — tab navigation, row actions, bulk operations all mouse-only
3. **Data visualization stops at sparklines** — no latency heatmaps, key rotation timelines, usage area charts

---

## 1. Per-Tab Redesign Specs

### 1.1 Tab Navigation & Layout (`Admin.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Tabs** | 8 horizontal, `overflow-x-auto` | 8 tabs, horizontal scroll on mobile; **tab drawer (< 640px)** with `role="dialog"` |
| **Keyboard** | None | `←/→` switch tabs, `Home/End` first/last, `Enter/Space` activate, `Tab` into panel |
| **Focus Visible** | Browser default only | **Custom `:focus-visible` ring** (2px accent, 2px offset) on `TabButton` |
| **URL Sync** | `?tab=users` ✓ | Keep; add **`#tab=models` hash fallback** for deep links without reload |
| **Active State** | Bottom border + color | Bottom border **+ bold label + accent underline** |
| **ARIA** | `role="tablist"` ✓ | Add `aria-controls`, `id` on panels, `aria-labelledby` |

**Mobile Drawer Spec**
```tsx
// <640px: hamburger → drawer with checkbox list
// >640px: inline tabs (current behavior)
<TabsDrawer tabs={TABS} active={tab} onChange={setTab} />
```

---

### 1.2 Users Tab (`AdminUsers.tsx`) — **Just Fixed**

| Aspect | Current | Target |
|--------|---------|--------|
| **Table Density** | 7 cols + sparkline + tier select + grant btn | **DataTable**: 7 cols, sticky header, col resize, row hover, density toggle (comfortable/condensed) |
| **Inline Tier Grant** | `<select>` + confirm modal | **ActionMenu** per row: "Grant tier → Pro/Enterprise" with toast confirmation |
| **Grant Panel** | Slide-down inline | **Side-drawer modal** (right, 480px) — preserves table context, focus trap, ESC closes |
| **Sparkline Utility** | 14-day daily credits | **Actionable**: hover tooltip with exact value/date; click → opens usage detail drawer |
| **Search/Filter** | Instant, no debounce, no URL sync | **Debounced 300ms**, URL-synced `?q=`, **FilterBar** with chips (tier, role, verified), clear button |
| **Sort** | 4 options, URL-synced ✓ | Keep; add **multi-sort** (Shift+click), sort direction indicator in header |
| **Empty/Loading/Error** | Basic cards | **Illustrated empty states**: "No users match" → "Adjust filters" + link to create user (if applicable) |
| **Mobile** | Horizontal scroll only | **Stacked cards** (< 640px): each row → card with primary metrics, tier badge, grant FAB |
| **Bulk Ops** | None | **Checkbox column** → bulk tier grant, bulk credit grant, export CSV |

**Grant Panel Redesign**
- Move to `ConfirmModal` with `size="lg"` (480px)
- Presets as **chips**: `24h` `7d` `30d` `Custom`
- Custom expiry → inline datetime picker (flatpickr-style)
- Note field: `maxLength={300}`, char counter
- **Optimistic update** with rollback toast on failure

---

### 1.3 Models Tab (`AdminModels.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Alias List** | Cards, no drag-drop | **DataTable** with `sort_order` drag handle (dnd-kit), inline active toggle, inline routing badge |
| **Provider Configs** | Expandable rows per alias | **Nested DataTable** or **accordion rows**; show priority, health, `messages_served`, latency sparkline |
| **Inline Editing** | Edit alias modal, edit provider inline | **Inline cell editing** (double-click → input/select), save on blur/Enter, ESC reverts |
| **Create Alias Modal** | Form in card | **Full-screen drawer** (mobile) / **centered modal** (desktop); slug auto-gen from label, validation toast |
| **Provider Health** | Status dot, avg latency, cooldown | **HealthBadge** component: `live/slow/down/unknown/disabled` + latency sparkline (7d) + key count |
| **Copy Provider Config** | N/A (in Upstream tab) | **ActionMenu** → "Copy config from…" → provider picker modal |
| **Metrics** | Aggregate + 14d sparkline | **LatencyHeatmap** (hour×day) + **UsageAreaChart** (stacked: requests/tokens) |

**Sort Order Drag-Drop**
```tsx
// Each AliasCard gets a drag handle (grip icon)
// On drop: PATCH /admin/models/{id} { sort_order }
// Optimistic reorder, toast on failure
```

---

### 1.4 Upstream Providers Tab (`AdminUpstreamProviders.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Provider Cards** | Card per provider, inline actions | **DataTable** (desktop) / **Stacked cards** (mobile); cols: label, base_url, status, key pool, models, avg latency, cooldown |
| **Key Pool Management** | Add/reveal/test/delete inline | **KeyPoolDrawer** per provider: list keys with status, last used, `messages_served`; bulk add (paste multiple), bulk revoke |
| **Key Reveal** | Confirm only | **Justification required** (textarea, min 10 chars) → audit log entry → reveal in **ConfirmModal** with copy button, auto-hide after 30s |
| **Health** | Probe button, EWMA, cooldown | **HealthBadge** + **LatencyHeatmap** (7d×24h) + **CooldownTimeline** (visual exponential backoff) |
| **Copy Models** | Button per provider ✓ | Keep; add **bulk copy** (checkbox multiple source providers) |
| **Model Catalog** | Inline per provider | **Separate tab panel** or **drawer** — decouple from provider card |

**Key Reveal Flow**
```tsx
<ConfirmModal
  title="Reveal bearer keys"
  description="Keys decrypt on demand. This action is logged."
  requireJustification
  justificationPlaceholder="Reason for access (e.g., incident IN-2341, key rotation)"
  onConfirm={revealKeys}
/>
```

---

### 1.5 Proxies Tab (`AdminProxies.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Proxy List** | HTML table | **DataTable** with sticky header, col resize; cols: label, URL, auth, status, health, cooldown, enabled |
| **Test via Proxy** | Button → toast latency | **TestDrawer**: run 3 probes, show p50/p95/p99, success rate, error breakdown |
| **Reveal Password** | Confirm only | **Justification + audit** (same as keys) |
| **Pool Status** | Implicit in table | **Summary chips** above table: `Available: 3` `Cooldown: 1` `Down: 0` — click to filter |
| **Bulk Actions** | None | Enable/disable/delete selected |

---

### 1.6 Promos Tab (`AdminPromos.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Promo List** | Cards with expandable redemptions | **DataTable**: code, credits, expiry, max uses, used, tier scope, active; expand row → redemption list (virtualized) |
| **Create/Edit** | Form in card | **PromoModal** with validation: code format, credits range, expiry presets (chips), tier scoping (multi-select aliases) |
| **Bulk Actions** | None | **Bulk expire**, **Bulk delete** (with confirmation modal showing affected codes) |
| **Export** | None | **CSV export** (filtered set or all) |
| **Redemption Analytics** | List only | **Sparkline per promo**: redemptions/day (14d) |

---

### 1.7 Vault Tab (`AdminVault.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Contributed Keys** | Cards, reveal modal | **DataTable**: user, provider, status, messages served, rewards paid, added; inline status badge |
| **Key Upkeep** | Messages served only | **Rewards column**: auto-calculated (configurable rate × messages); **KeyRotationTimeline** (Gantt: added → last used → rotated) |
| **Filters** | None | **FilterBar**: provider (multi), status (multi), contributor search, date range |
| **Bulk Actions** | None | Revoke selected, export CSV |
| **Reveal** | Modal with copy | **Justification + audit** (consistent with Upstream keys) |

---

### 1.8 Email Blocks Tab (`AdminEmailBlocks.tsx`)

| Aspect | Current | Target |
|--------|---------|--------|
| **Pattern List** | Cards, regex only | **DataTable**: pattern, type (block/allow), active, created, test result; inline toggle active |
| **Test Pattern** | None | **TestPatternModal**: paste email list → live validation (green/red chips), regex explanation (regexper-style) |
| **Max Rules** | None | **Enforce max 50** (configurable); warning at 45, block at 50 |
| **Type Support** | Block only | **Add "allow" type** — allowlist overrides blocklist; UI: badge `block`/`allow`, toggle per row |
| **Order** | First match wins | **Drag-drop reorder** (dnd-kit); persist `sort_order` |

---

### 1.9 Audit Log Tab (`AdminAudit.tsx`) — **Weakest Tab**

| Aspect | Current | Target |
|--------|---------|--------|
| **Log Table** | Basic HTML table, 200 rows | **Virtualized DataTable** (react-window): timestamp, admin, action, target, justification, IP, user agent |
| **Filters** | None | **FilterBar**: date range (presets: 1h/24h/7d/30d), admin (multi), action type (multi), target type (multi), IP search |
| **Export** | None | **CSV export** (filtered, max 10k rows); **JSON export** for SIEM |
| **Pagination** | None (limit=200) | **Cursor-based infinite scroll** (load more button) + **page size selector** (50/100/200) |
| **Detail View** | Metadata truncated | **Row click → DetailDrawer**: full metadata JSON (formatted), actor context, before/after diff if available |
| **Real-time** | None | **SSE/WebSocket** → live prepend new entries (pause on scroll) |

---

## 2. Admin Component Library Gaps

### 2.1 Missing Primitives (Build First)

| Component | Purpose | Priority |
|-----------|---------|----------|
| **`DataTable`** | Sortable, filterable, selectable, virtualized table with sticky header, col resize, density toggle, row actions, empty/loading/error states | **P0** |
| **`FilterBar`** | Chip-based filters with URL sync, clear all, save preset, debounced search input | **P0** |
| **`ActionMenu`** | Dropdown per row: primary action + danger zone, keyboard navigable, portal-rendered | **P0** |
| **`ConfirmModal`** | Focus trap, ESC close, scroll lock, size variants (sm/md/lg/full), justification field, async submit with loading | **P0** |
| **`HealthBadge`** | Status dot + label + tooltip (latency, last check, key count); variants: dot, pill, inline | **P0** |
| **`LatencyHeatmap`** | 7d×24h grid, color scale, hover tooltip, click → drill-down | **P1** |
| **`KeyRotationTimeline`** | Gantt-style: key added → last used → rotated → revoked; tooltips with actor/action | **P1** |
| **`UsageAreaChart`** | Stacked area: requests, input tokens, output tokens; brush zoom, legend toggle | **P1** |
| **`Toast`** | Global portal, auto-dismiss, action button, persist on hover, type: success/warning/error/info | **P0** |
| **`TabsDrawer`** | Mobile drawer for tab navigation, keyboard accessible | **P0** |
| **`DensityToggle`** | Comfortable/condensed/compact; persists in localStorage | **P1** |

### 2.2 Existing Components to Harden

| Component | Current | Needed |
|-----------|---------|--------|
| `Button` | Basic variants | `loading` prop (spinner + disabled), `iconOnly` size, `destructive` variant |
| `Input` | Basic | `error` state, `clearable`, `prefix`/`suffix` slots, `debounced` hook |
| `Select` | Basic | `searchable`, `multi`, `creatable`, `grouped` options |
| `Card` | Basic | `CardHeader`, `CardContent`, `CardFooter` sub-components |
| `Tabs` | Context-based | `TabsDrawer` integration, keyboard navigation, lazy mount |
| `Sparkline` | Custom SVG | **Migrate to Recharts** (see §3); keep SVG fallback for zero-dep |

---

## 3. Data Visualization Specs (Recharts Integration)

### 3.1 Why Recharts?
- Tree-shakable, React-native, TypeScript-first
- ResponsiveContainer, Tooltip, Brush, Legend, ReferenceLine built-in
- ~45kB gzipped (vs 0 for custom SVG but 10× dev velocity)

### 3.2 Chart Specs

| Chart | Component | Data Shape | Interactions |
|-------|-----------|------------|--------------|
| **Latency Heatmap** | `LatencyHeatmap` | `{hour: 0-23, day: 0-6, p50: number, p95: number, count: number}[]` | Hover → tooltip (exact ms, count); Click → drill-down to requests table |
| **Usage Area Chart** | `UsageAreaChart` | `{day: string, requests: number, inputTokens: number, outputTokens: number}[]` | Brush zoom; Legend toggle series; Hover → crosshair + values |
| **Key Rotation Timeline** | `KeyRotationTimeline` | `{keyId, label, addedAt, lastUsedAt, rotatedAt, revokedAt, status}[]` | Horizontal scroll; Hover → detail; Click → key detail drawer |
| **Sparkline (Recharts)** | `Sparkline` | `{day: string, value: number}[]` | Same as current + hover tooltip; ResponsiveContainer |
| **Redemption Funnel** | `RedemptionFunnel` | `{stage: 'issued'|'redeemed'|'used'|'expired', count: number}[]` | Click stage → filtered redemption list |

### 3.3 Implementation Pattern
```tsx
// src/components/charts/LatencyHeatmap.tsx
import { ResponsiveContainer, Heatmap, Tooltip, Cell } from 'recharts'

export function LatencyHeatmap({ data, colorScale = ['#22c55e', '#eab308', '#ef4444'] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <Heatmap data={data} dataKey="p50" x="hour" y="day">
        <Tooltip formatter={(v) => [`${v}ms p50`, 'Latency']} />
        <Cell fill={(cell) => interpolateColor(cell.value, colorScale)} />
      </Heatmap>
    </ResponsiveContainer>
  )
}
```

### 3.4 Theme Integration
```css
/* CSS variables for Recharts theming */
:root {
  --chart-grid: var(--border);
  --chart-text: var(--muted);
  --chart-tooltip-bg: var(--surface-2);
  --chart-tooltip-border: var(--border);
  --chart-axis: var(--muted);
}
```

---

## 4. Keyboard Shortcuts Map

### 4.1 Global (Any Tab)
| Shortcut | Action |
|----------|--------|
| `G T` | Go to tab (typeahead: models, providers, proxies, promos, vault, users, blocks, audit) |
| `?` | Show keyboard shortcuts help modal |
| `/` | Focus search/filter input (current tab) |
| `Esc` | Close modal/drawer, clear selection, exit edit mode |

### 4.2 Tab Navigation
| Shortcut | Action |
|----------|--------|
| `←` / `→` | Previous/next tab |
| `Home` / `End` | First/last tab |
| `1`–`8` | Direct tab (1=models, 2=providers, etc.) |

### 4.3 Table/DataGrid (All Tabs)
| Shortcut | Action |
|----------|--------|
| `J` / `K` | Next/previous row |
| `Enter` | Open row detail / expand |
| `Space` | Toggle row selection |
| `Shift+Space` | Select range |
| `Ctrl/Cmd+A` | Select all visible |
| `S` | Focus sort menu (column header) |
| `F` | Focus filter bar |
| `E` | Export CSV (filtered) |
| `R` | Refresh/reload |

### 4.4 Row Actions (Contextual)
| Shortcut | Action | Context |
|----------|--------|---------|
| `G` | Grant credits/tier | Users, Vault |
| `T` | Test health | Models, Providers, Proxies |
| `R` | Reveal secret (with justification) | Providers, Proxies, Vault |
| `D` | Delete (with confirm) | All |
| `E` | Edit inline | All |
| `C` | Copy row data (JSON) | All |

### 4.5 Forms/Modals
| Shortcut | Action |
|----------|--------|
| `Tab` / `Shift+Tab` | Next/previous field |
| `Enter` | Submit (primary action) |
| `Esc` | Cancel/close |
| `Ctrl/Cmd+Enter` | Submit from any field |
| `Alt+↑/↓` | Increment/decrement number inputs |

---

## 5. Mobile Admin Adaptations

### 5.1 Breakpoints
| Breakpoint | Behavior |
|------------|----------|
| `< 480px` | **Phone**: stacked cards, FAB primary actions, bottom sheet modals |
| `480–768px` | **Tablet**: condensed DataTable (horizontal scroll), side-drawer filters |
| `768–1024px` | **Small desktop**: full DataTable, density toggle default "comfortable" |
| `> 1024px` | **Desktop**: full DataTable, density toggle default "condensed" |

### 5.2 Per-Tab Mobile Patterns

| Tab | < 640px Pattern |
|-----|-----------------|
| **Navigation** | Hamburger → `TabsDrawer` (full-screen, checkbox list) |
| **Users** | Stacked cards: avatar/email, balance badge, tier pill, grant FAB → bottom sheet |
| **Models** | Accordion per alias: header = label + slug + tier; expand → provider configs as cards |
| **Providers** | Stacked cards: label + status pill + key count; tap → provider detail drawer |
| **Proxies** | Stacked cards: label + URL + status; test/reveal in bottom sheet |
| **Promos** | Stacked cards: code (copy btn) + credits + scope; expand → redemptions list |
| **Vault** | Stacked cards: label + owner + status; reveal in bottom sheet with copy |
| **Email Blocks** | Stacked cards: pattern code + date; test in modal; delete swipe action |
| **Audit** | Virtualized list cards: time + action + actor; tap → detail drawer |

### 5.3 Touch Targets
- **Minimum 44×44px** for all interactive elements
- **8px spacing** between adjacent touch targets
- **Swipe actions** on cards: left-swipe → delete/archive, right-swipe → edit

### 5.4 Performance
- **Code-split per tab**: `React.lazy(() => import('./AdminModels'))` + `Suspense`
- **Virtualize** all lists > 50 items (react-window)
- **Prefetch** adjacent tab on hover/focus of tab button

---

## 6. Implementation Priority (ICE Scored)

**ICE = Impact × Confidence × Ease (1–10 each, max 1000)**

| # | Initiative | Impact | Confidence | Ease | ICE | Phase |
|---|------------|--------|------------|------|-----|-------|
| 1 | **Build `DataTable` primitive** (sort, filter, select, virtualize, density) | 10 | 9 | 6 | **540** | 1 |
| 2 | **Build `ConfirmModal`** (focus trap, justification, sizes, async) | 9 | 9 | 7 | **567** | 1 |
| 3 | **Build `FilterBar`** (chips, URL sync, presets, debounced search) | 9 | 8 | 7 | **504** | 1 |
| 4 | **Build `ActionMenu`** (keyboard, portal, danger zone) | 8 | 9 | 7 | **504** | 1 |
| 5 | **Build `HealthBadge`** (dot/pill/inline, tooltip, latency sparkline) | 8 | 9 | 8 | **576** | 1 |
| 6 | **Build `Toast` system** (portal, auto-dismiss, actions) | 8 | 9 | 8 | **576** | 1 |
| 7 | **Build `TabsDrawer`** (mobile tab navigation) | 7 | 9 | 8 | **504** | 1 |
| 8 | **Migrate Users tab to `DataTable` + `FilterBar` + `ActionMenu`** | 9 | 8 | 5 | **360** | 2 |
| 9 | **Migrate Models tab to `DataTable` + drag-drop sort_order** | 8 | 7 | 5 | **280** | 2 |
| 10 | **Migrate Upstream Providers to `DataTable` + `KeyPoolDrawer`** | 8 | 7 | 5 | **280** | 2 |
| 11 | **Add justification + audit to all secret reveals** (Providers, Proxies, Vault) | 9 | 9 | 6 | **486** | 2 |
| 12 | **Build `LatencyHeatmap` (Recharts)** | 7 | 8 | 5 | **280** | 2 |
| 13 | **Build `KeyRotationTimeline` (Recharts)** | 6 | 7 | 5 | **210** | 3 |
| 14 | **Build `UsageAreaChart` (Recharts)** | 6 | 7 | 5 | **210** | 3 |
| 15 | **Migrate Proxies, Promos, Vault, Email Blocks to `DataTable`** | 7 | 8 | 4 | **224** | 3 |
| 16 | **Overhaul Audit Log: virtualized table, filters, export, infinite scroll, detail drawer** | 9 | 7 | 4 | **252** | 3 |
| 17 | **Keyboard shortcuts global registry + help modal** | 6 | 8 | 6 | **288** | 3 |
| 18 | **Mobile stacked cards for all tabs** | 7 | 8 | 5 | **280** | 3 |
| 19 | **Real-time audit log (SSE)** | 5 | 6 | 4 | **120** | 4 |
| 20 | **Saved filter presets per user** | 4 | 7 | 5 | **140** | 4 |

### Phase Definitions
- **Phase 1 (Weeks 1–2):** Primitives — unblock all tab migrations
- **Phase 2 (Weeks 3–5):** High-value tab migrations (Users, Models, Providers) + security hardening
- **Phase 3 (Weeks 6–9):** Remaining tabs + data viz + keyboard + mobile
- **Phase 4 (Week 10+):** Polish, real-time, saved presets

---

## 7. Quick Wins (Do This Week)

1. **Add `:focus-visible` to `TabButton`** — 5 lines CSS, huge a11y win
2. **Debounce search inputs** (300ms) — one `useDeferredValue` or `lodash.debounce`
3. **Add `Toast` context** — replace all `alert()`/`confirm()` with `ConfirmModal` + `Toast`
4. **URL-sync Users tab search/sort** — already has sort, add `?q=` and `?sort=`
5. **Add justification to key/password reveals** — one `ConfirmModal` prop
6. **Max 50 email blocks enforcement** — client + server validation
7. **Add `role="status"` to all loading spinners** — a11y

---

## 8. Architecture Decision Records (ADRs)

### ADR-001: DataTable Primitive Ownership
**Decision:** Build in-house `DataTable` (not TanStack Table v8)  
**Rationale:** TanStack adds 15kB + learning curve; our needs (virtualization, density, URL sync) are specific. Build a focused wrapper around `@tanstack/react-virtual` + custom sort/filter.

### ADR-002: Recharts vs Custom SVG
**Decision:** Migrate to Recharts for all charts except `Sparkline` (keep SVG for zero-dep)  
**Rationale:** Heatmap, Area, Timeline need tooltips, brush, legend, responsiveness — Recharts wins on velocity.

### ADR-003: Modal vs Drawer for Forms
**Decision:** Desktop = centered modal (`ConfirmModal`), Mobile = bottom sheet (`BottomSheet` primitive)  
**Rationale:** Matches platform conventions; `ConfirmModal` handles both via `size="full"` on mobile.

### ADR-004: Keyboard Shortcut Registry
**Decision:** Global `useHotkeys` hook + `<ShortcutsHelp>` modal; each tab registers context shortcuts  
**Rationale:** Avoids prop drilling; enables `?` help anywhere.

---

## 9. Accessibility Checklist (WCAG 2.1 AA)

| Criterion | Status | Action |
|-----------|--------|--------|
| 1.3.1 Info & Relationships | ⚠️ Partial | Add `aria-sort` to column headers, `aria-controls` on tabs |
| 1.4.3 Contrast (Minimum) | ✅ | CSS variables meet 4.5:1 |
| 2.1.1 Keyboard | ❌ | Implement §4 shortcuts, tab navigation |
| 2.1.2 No Keyboard Trap | ✅ | Modals trap focus |
| 2.4.3 Focus Order | ⚠️ | Verify modal → first field, drawer → close button |
| 2.4.7 Focus Visible | ❌ | Add custom `:focus-visible` to all interactive |
| 3.2.2 On Input | ✅ | No unexpected submissions |
| 4.1.2 Name, Role, Value | ⚠️ | Add `aria-label` to icon-only buttons (copy, reveal, delete) |

---

## 10. File-to-Component Migration Map

| Current File | New Components Used |
|--------------|---------------------|
| `Admin.tsx` | `TabsDrawer`, `TabButton` (enhanced) |
| `AdminUsers.tsx` | `DataTable`, `FilterBar`, `ActionMenu`, `ConfirmModal`, `GrantDrawer`, `Sparkline` (Recharts) |
| `AdminModels.tsx` | `DataTable`, `DragDropSort`, `HealthBadge`, `LatencyHeatmap`, `UsageAreaChart`, `ConfirmModal` |
| `AdminUpstreamProviders.tsx` | `DataTable`, `FilterBar`, `HealthBadge`, `KeyPoolDrawer`, `ConfirmModal` (justification), `LatencyHeatmap` |
| `AdminProxies.tsx` | `DataTable`, `FilterBar`, `ConfirmModal` (justification), `TestDrawer` |
| `AdminPromos.tsx` | `DataTable`, `FilterBar`, `ConfirmModal`, `PromoModal`, `RedemptionSparkline` |
| `AdminVault.tsx` | `DataTable`, `FilterBar`, `ConfirmModal` (justification), `KeyRotationTimeline`, `RewardsColumn` |
| `AdminEmailBlocks.tsx` | `DataTable`, `FilterBar`, `ConfirmModal`, `TestPatternModal`, `DragDropSort` |
| `AdminAudit.tsx` | `VirtualizedDataTable`, `FilterBar`, `ExportButton`, `InfiniteScroll`, `DetailDrawer` |

---

## Appendix: Component API Sketches

### DataTable
```tsx
interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  getKey: (row: T) => string
  // Features
  sortable?: boolean
  filterable?: boolean
  selectable?: boolean
  virtualized?: boolean
  density?: 'comfortable' | 'condensed' | 'compact'
  // Callbacks
  onSort?: (key: string, dir: 'asc' | 'desc') => void
  onFilter?: (filters: Record<string, unknown>) => void
  onSelectionChange?: (keys: string[]) => void
  onRowAction?: (action: string, row: T) => void
  // Empty/Loading/Error
  emptyState?: ReactNode
  loading?: boolean
  error?: string
}
```

### ConfirmModal
```tsx
interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (justification?: string) => Promise<void>
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'full'
  requireJustification?: boolean
  justificationPlaceholder?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  loading?: boolean
}
```

### FilterBar
```tsx
interface FilterBarProps {
  filters: FilterDef[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  onClear: () => void
  presets?: FilterPreset[]
  searchPlaceholder?: string
  debounceMs?: number
}
```

### HealthBadge
```tsx
interface HealthBadgeProps {
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  variant?: 'dot' | 'pill' | 'inline'
  latencyMs?: number
  lastCheckedAt?: number
  keyCount?: number
  onClick?: () => void
}
```

---

*End of Audit Report*  
*Next: Begin Phase 1 — Primitives (`DataTable`, `ConfirmModal`, `FilterBar`, `ActionMenu`, `HealthBadge`, `Toast`, `TabsDrawer`)*
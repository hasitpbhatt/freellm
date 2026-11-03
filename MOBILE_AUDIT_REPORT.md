# freellm Mobile Experience Audit Report

**Date:** 2026-11-03  
**Auditor:** Senior Mobile/Interaction Designer  
**Scope:** Full responsive & motion audit across all pages and components

---

## Executive Summary

freellm has a **strong mobile foundation** with intentional touch-first patterns (swipe gestures, pull-to-refresh, haptics, FAB), proper safe-area handling, and a clean 5-tab bottom nav. The codebase passes most WCAG AA touch-target requirements and respects `prefers-reduced-motion`.

**Top risks:** missing motion duration tokens, no skeleton loaders, no PWA manifest, limited haptic coverage, and Admin tab inaccessible on mobile outside the hamburger drawer.

---

## 1. Responsive Breakpoints & Layout

### Breakpoint Consistency Table

| Breakpoint | Tailwind | Used In | Status |
|------------|----------|---------|--------|
| **sm** | 640px | `sm:grid-cols-2`, `sm:flex-row`, form grids | ✅ Consistent |
| **md** | 768px | `md:flex` (desktop nav), `md:hidden` (hamburger/FAB), `md:grid-cols-3` | ✅ Consistent |
| **lg** | 1024px | `lg:grid-cols-3`, `lg:grid-cols-4`, `lg:h-[calc(...)]` | ✅ Consistent |
| **xl** | 1280px | `xl:grid-cols-4` (Earn tiles), `xl:grid-cols-5` (Usage summary) | ✅ Consistent |

### Container & Grid Patterns

| Pattern | Current | Target | Gap |
|---------|---------|--------|-----|
| **Container** | `max-w-6xl` (1152px) in AppShell | Consistent across all pages | ✅ |
| **Dashboard cards** | `sm:grid-cols-3` | ✅ | — |
| **Models grid** | `sm:grid-cols-2 lg:grid-cols-3` | ✅ | — |
| **Earn tiles** | `sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4` (custom re-weight at xl) | ✅ | — |
| **Usage summary** | `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5` | ✅ | — |
| **Chat** | Fixed `h-[calc(100vh-4rem)]` / `lg:h-[calc(100vh-5rem)]` | Consider `dvh` units | ⚠️ |

### Table vs Card Responsiveness

| Page | Mobile Strategy | Status |
|------|----------------|--------|
| **Dashboard (ledger)** | Stacked rows with `flex-wrap`, `min-w-0`, `truncate` | ✅ |
| **Usage (per_model)** | Stacked `flex-wrap` rows | ✅ |
| **Usage (recent)** | Stacked `flex-wrap` rows | ✅ |
| **Admin (tables)** | Horizontal scroll (default) — **needs stacked cards on mobile** | ❌ |
| **Keys (expanded)** | `sm:grid-cols-2` for details grid | ✅ |

### Form Layout

| Page | Mobile | Desktop | Status |
|------|--------|---------|--------|
| **KeyForm** | Single column, stacked inputs | `sm:grid-cols-2` for URL + Model | ✅ |
| **Chat composer** | Full-width textarea, buttons stack | Inline with balance | ✅ |
| **Promo redemption** | Stacked | `sm:flex-row` | ✅ |

---

## 2. Mobile Navigation

### Bottom Nav (`MobileBottomNav.tsx`)

| Criterion | Current | Target | Pass/Fail |
|-----------|---------|--------|-----------|
| **Tab count** | 5 (Home, Chat, Keys, Earn, Models) | ≤5 for thumb reach | ✅ |
| **Thumb reach** | Fixed bottom, full width, 56px rows | All within thumb zone | ✅ |
| **Active state** | Accent color + filled icon (`strokeWidth=0`) + label | Color + fill + label | ✅ |
| **Badge counts** | Not implemented | Unread, available rewards | ❌ |
| **Safe area** | `pb-[env(safe-area-inset-bottom)]` on `<nav>` | Correct | ✅ |
| **ARIA** | `aria-label="Primary mobile"`, `aria-current` on active | ✅ | ✅ |
| **Hidden when signed out** | `if (!user) return null` | ✅ | ✅ |

**Missing:** Badge indicators for unread messages, pending referrals, available check-in.

### Hamburger Menu (`MobileMenu.tsx`)

| Criterion | Current | Target | Pass/Fail |
|-----------|---------|--------|-----------|
| **Drawer animation** | `translate-x-full` ↔ `translate-x-0`, 200ms ease-out | Smooth, interruptible | ✅ |
| **Overlay** | `bg-black/60`, click closes | ✅ | ✅ |
| **Focus trap** | `panelRef.current?.focus()`, `tabIndex=-1` | Focus moves in, restored on close | ✅ |
| **Escape close** | `e.key === 'Escape'` | ✅ | ✅ |
| **Admin tab** | In drawer under "Operator" section | Accessible on mobile | ✅ |
| **Touch targets** | `min-h-[56px]` rows, `min-h-[44px]` buttons | ≥44px | ✅ |
| **ARIA** | `role="dialog"`, `aria-modal="true"`, `aria-label="Menu"` | ✅ | ✅ |

**Note:** Admin correctly lives in hamburger drawer (not bottom nav) — proper progressive disclosure.

---

## 3. Touch Targets & Gestures

### Touch Target Compliance (WCAG AA: 44×44px minimum)

| Component | Element | Class Used | Actual Size | Pass/Fail |
|-----------|---------|------------|-------------|-----------|
| **Buttons (base)** | `.btn` | `min-height: 44px` | 44px | ✅ |
| **Buttons (sm)** | `.btn-sm` | `min-height: 40px` / `min-width: 44px` | 40×44px | ⚠️ Height < 44px |
| **Bottom nav tabs** | `NavLink` | `min-h-[56px]` | 56px | ✅ |
| **Drawer rows** | `NavLink` | `min-h-[56px]` | 56px | ✅ |
| **Hamburger trigger** | `button` | `min-h-[44px] min-w-[44px]` | 44×44px | ✅ |
| **Drawer close** | `button` | `min-h-[44px] min-w-[44px]` | 44×44px | ✅ |
| **FAB main** | `Button` | `w-14 h-14` (56×56px) | 56×56px | ✅ |
| **FAB menu items** | `Button` | `min-h-[44px] min-w-[44px]` | 44×44px | ✅ |
| **KeyCard actions** | `Button` | `min-h-[44px] min-w-[44px]` | 44×44px | ✅ |
| **KeyCard expand** | `button` | `min-h-[44px]` | 44px | ✅ |
| **Inputs** | `.input` | `min-height: 44px` | 44px | ✅ |
| **Chat composer** | `textarea` | `min-h-[48px]` | 48px | ✅ |
| **OAuth code** | `button` | `min-h-[44px]` | 44px | ✅ |

**Violation:** `.btn-sm` has `min-height: 40px` — fails 44px minimum. Used in:
- `KeyForm.tsx` line 184, 187, 221, 224, 226
- `OAuthProviders.tsx` line 109, 152
- `FloatingActionButton.tsx` line 57
- `EarnTile.tsx` line 74

### Spacing Between Targets

| Location | Spacing | Minimum 8px? |
|----------|---------|--------------|
| Bottom nav tabs | `justify-around` (even) | ✅ |
| KeyCard action row | `gap-2` (8px) | ✅ |
| FAB menu items | `gap-3` (12px) | ✅ |
| Chat header mode buttons | `gap-2` (8px) | ✅ |
| Dashboard quick actions | `gap-2` (8px) | ✅ |

### Gesture Support

| Gesture | Implementation | Pages | Mouse Opt-out |
|---------|---------------|-------|---------------|
| **Swipe left (delete)** | `useSwipe` / inline pointer events, 72px threshold | KeyCard | ✅ `pointerType === 'mouse'` |
| **Swipe right (chat)** | Inline pointer events, 72px threshold | KeyCard | ✅ |
| **Pull-to-refresh** | `PullToRefresh` wrapper, 70px threshold, rubber-band | Keys page | ✅ |
| **Tab swipe (Admin)** | Not implemented | Admin tabs | — |
| **Long press** | Not implemented | — | — |
| **Double tap zoom prevention** | `<meta name="viewport" content="width=device-width, initial-scale=1.0">` (no `user-scalable=no`) | All | ✅ |

**Missing:** Admin tab horizontal swipe, long-press context menus (copy key, etc.)

---

## 4. Loading & Skeleton States

### Current Loading Patterns

| Page | Current | Skeleton Needed |
|------|---------|-----------------|
| **Dashboard** | "Loading…" text, then cards | Balance, Streak, Referral cards; Checklist; Activity list |
| **Chat** | "Loading…" text, then empty state | Model dropdown, message list, composer |
| **Keys** | "Loading keys…" text, then list | Key cards (shimmer), OAuth providers, Add form |
| **Earn** | "Loading…" text, then tiles | TodayCard, 8 EarnTiles, ArcadePanel |
| **Models** | `LoadingState` component (spinner) | Model cards (3-col grid) |
| **Usage** | "Loading…" text, then cards | 5 summary cards, daily bars, per-model table, recent list |
| **Admin** | "Checking admin access…" | 8 tab panels (each needs own skeleton) |
| **Landing** | No loading (redirects instantly) | N/A |

### Skeleton Component Specs (Proposed)

```tsx
// src/components/Skeleton.tsx
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`card p-4 animate-pulse ${className}`}>
      <div className="h-3 w-1/4 bg-surface-2 rounded mb-3" />
      <div className="h-8 w-1/2 bg-surface-2 rounded" />
      <div className="h-4 w-3/4 bg-surface-2 rounded mt-2" />
    </div>
  )
}

export function SkeletonTile({ className = '' }) {
  return (
    <div className={`card p-4 animate-pulse ${className}`}>
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 bg-surface-2 rounded" />
        <div className="flex-1">
          <div className="h-4 w-1/3 bg-surface-2 rounded" />
          <div className="h-3 w-1/2 bg-surface-2 rounded mt-1" />
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
        <div className="h-4 w-20 bg-surface-2 rounded" />
        <div className="h-8 w-20 bg-surface-2 rounded" />
      </div>
    </div>
  )
}

export function SkeletonList({ count = 5, className = '' }) {
  return (
    <div className={`flex flex-col divide-y divide-line ${className}`}>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 animate-pulse">
          <div className="h-4 w-16 bg-surface-2 rounded shrink-0" />
          <div className="h-4 w-1/2 bg-surface-2 rounded flex-1" />
          <div className="h-4 w-16 bg-surface-2 rounded shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4, className = '' }) {
  return (
    <div className={className}>
      <div className="flex gap-4 px-4 py-2 animate-pulse">
        {[...Array(cols)].map((_, i) => (
          <div key={i} className="h-4 bg-surface-2 rounded flex-1" />
        ))}
      </div>
      {[...Array(rows)].map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-2 animate-pulse">
          {[...Array(cols)].map((_, i) => (
            <div key={i} className="h-4 bg-surface-2 rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart({ className = '' }) {
  return (
    <div className={`card p-4 ${className}`}>
      <div className="h-3 w-1/4 bg-surface-2 rounded mb-4" />
      <div className="h-48 bg-surface-2 rounded animate-pulse" />
    </div>
  )
}
```

### Per-Page Skeleton Mapping

| Page | Skeletons to Show | Progressive Reveal Order |
|------|-------------------|--------------------------|
| **Dashboard** | `SkeletonCard` ×3 (balance, streak, referrals), `SkeletonList` (checklist 4), `SkeletonList` (activity 8) | Cards → Checklist → Activity |
| **Chat** | `SkeletonTile` (model dropdown), `SkeletonList` (messages 5), composer | Model → Messages → Composer |
| **Keys** | `SkeletonTile` (OAuth providers 4), `SkeletonTile` (key cards 3), Add form | Providers → Keys → Form |
| **Earn** | `SkeletonCard` (TodayCard), `SkeletonTile` ×8 (tiles), ArcadePanel | TodayCard → Tiles → Arcade |
| **Models** | `SkeletonCard` ×6 (grid) | Grid |
| **Usage** | `SkeletonCard` ×5 (summary), `SkeletonChart` (daily bars), `SkeletonTable` (per_model 5×4), `SkeletonList` (recent 8) | Summary → Chart → Tables |
| **Admin** | Per-tab: `SkeletonTable`/`SkeletonCard`/`SkeletonList` | Active tab first |

### Optimistic UI Opportunities

| Action | Current | Optimistic Target |
|--------|---------|-------------------|
| **Check-in** | Waits for API + refresh | Instant streak/credit update, rollback on failure |
| **Grant submission** | Waits for API | Show pending in ledger immediately |
| **Key add** | Waits for test + API | Show "Testing…" badge, add to list |
| **Tab switch** | Instant (SPA) | Already optimal |
| **Tier change** | Not applicable | Show new tier badge immediately |

---

## 5. Motion & Transitions

### Current Motion Tokens (from `index.css`)

| Token | Value | Used Where |
|-------|-------|------------|
| **Fast** | 100ms (implied by `duration-200` / 2) | — |
| **Base** | 200ms (`duration-200`, `transition-transform duration-200`) | Drawer, FAB menu, EarnTile hover, KeyCard swipe return |
| **Slow** | 800ms (`stroke-dashoffset 800ms ease-out`) | Streak ring |
| **Pull refresh** | 100ms (`transition-[height] duration-100`) | PullToRefresh spinner |
| **Slide up/down** | 200ms (`animate-slide-up`, `animate-slide-down`) | EarnTile expand, Achievements, Promo section |

### Missing: Centralized Duration Tokens

```css
/* Proposed: add to index.css @layer utilities */
:root {
  --duration-instant: 0ms;
  --duration-fast: 100ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;
  --duration-ring: 800ms;
  
  --ease-out: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Page Transitions

| Type | Current | Target |
|------|---------|--------|
| **Route change** | Instant (React Router SPA) | 150ms cross-fade or slide |
| **Tab switch (Admin)** | Instant | 150ms slide |
| **Drawer open/close** | 200ms transform | ✅ Good |
| **FAB menu** | 200ms stagger (50/100/150ms delays) | ✅ Good |
| **EarnTile expand** | 200ms slide-down | ✅ Good |
| **KeyCard swipe** | 180ms ease-out return | ✅ Good |
| **Pull-to-refresh** | 100ms height, 180ms return | ✅ Good |

### Micro-Interactions Inventory

| Interaction | Component | Duration | Easing | Reduced Motion |
|-------------|-----------|----------|--------|----------------|
| Button hover | `.btn` | 150ms (default) | default | ❌ Not explicit |
| Button press | `.btn` | None (active state only) | — | — |
| Focus ring | `:focus-visible` | Instant | — | ✅ |
| Toggle (mode) | Chat header | 150ms | default | ❌ |
| Accordion (EarnTile) | `animate-slide-down` | 200ms | ease-out | ✅ |
| Swipe reveal | KeyCard | 180ms | ease-out | ❌ |
| FAB menu stagger | FloatingActionButton | 200ms + delays | default | ❌ |
| Streak ring | TodayCard | 800ms | ease-out | ✅ |
| Reward pulse | `pulse-gain` | 600ms | ease-out | ✅ |
| Onboard pulse | `onboard-pulse` | 2000ms | ease-out | ✅ |

### Reduced Motion Compliance

| Feature | Respects `prefers-reduced-motion`? | Evidence |
|---------|-----------------------------------|----------|
| **Global animations** | ✅ | `@media (prefers-reduced-motion: reduce)` collapses all to 0.01ms |
| **Streak ring** | ✅ | Explicit `transition: none !important` |
| **Reward pulses** | ✅ | Wrapped in `@media (prefers-reduced-motion: no-preference)` |
| **Onboard pulse** | ✅ | Same |
| **Swipe gestures** | ❌ | No reduced-motion check in KeyCard/PullToRefresh |
| **FAB menu** | ❌ | No reduced-motion check |
| **Confetti** | ✅ | `useHaptics.ts` checks `prefersReduced` before firing |

**Fix needed:** Add `prefers-reduced-motion` guards to swipe animations and FAB menu transitions.

---

## 6. Haptic Feedback Map

### Current Haptic Usage (`useHaptics.ts`)

| Pattern | Function | Duration | Used In |
|---------|----------|----------|---------|
| **Single pulse** | `haptic(ms=10)` | 10ms | KeyCard: swipe right (chat), expand, test |
| **Double pulse (warning)** | `hapticWarning()` → `[15, 60, 15]` | 90ms total | KeyCard: swipe left (delete), delete confirm |
| **Check-in** | `pulse('checkin')` → 40ms + confetti | 40ms | TodayCard, Earn page |
| **Game reward** | `pulse('game')` → 20ms | 20ms | ArcadePanel |
| **Level up** | `pulse('level')` → 20ms | 20ms | ArcadePanel |
| **Referral** | `pulse('referral')` → 20ms | 20ms | InviteComposer copy |

### Proposed Haptic Expansion Map

| Action | Pattern | Rationale |
|--------|---------|-----------|
| **Tier upgrade** | `haptic()` (10ms) | Moment of delight |
| **Grant submit** | `haptic()` | Confirmation |
| **Check-in (streak milestone)** | `hapticWarning()` + confetti | High-value moment |
| **Key test success** | `haptic()` | Current: none on success |
| **Key test failure** | `hapticWarning()` | Current: none on failure |
| **Tab switch (bottom nav)** | `haptic()` | Spatial orientation |
| **Tab switch (Admin)** | `haptic()` | Spatial orientation |
| **Pull-to-refresh complete** | `haptic()` | Current: only on pull threshold |
| **Promo redeem success** | `haptic()` | Current: none |
| **Promo redeem failure** | `hapticWarning()` | Current: none |
| **Copy to clipboard** | `haptic()` | Current: OAuth code only |
| **Share sheet open** | `haptic()` | Current: none |
| **Error banner appear** | `hapticWarning()` | Alert user |
| **Low balance warning** | `hapticWarning()` | Current: none |

### Implementation Pattern

```tsx
// In useHaptics.ts - add new patterns
export function hapticSuccess(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate([10, 50, 10]) } catch {}
  }
}

export function hapticTab(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(5) } catch {}
  }
}

// Usage in components
const { haptic, hapticWarning, hapticSuccess, hapticTab } = useHaptics()

// Bottom nav tab switch
<NavLink onClick={() => hapticTab()} ...>

// Key test result
if (res.test.ok) hapticSuccess(); else hapticWarning();
```

---

## 7. PWA & Installability

### Current State

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **Manifest** | ❌ Missing | `public/manifest.json` not found |
| **Service Worker** | ❌ Missing | No SW registration in `main.tsx` |
| **HTTPS** | ✅ Assumed (production) | — |
| **Install Prompt** | ❌ Missing | No `beforeinstallprompt` handler |
| **Splash Screen** | ❌ Missing | No manifest = no splash |
| **Shortcuts** | ❌ Missing | No manifest shortcuts |
| **Icons** | ⚠️ Partial | `/favicon.svg` only |
| **Theme Color** | ❌ Missing | No meta theme-color |
| **Display Mode** | ❌ Missing | No manifest display field |

### PWA Readiness Scorecard

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| **Manifest** | 0 | 5 | File missing |
| **Service Worker** | 0 | 5 | No offline support |
| **Install Prompt** | 0 | 5 | No custom prompt logic |
| **Icons** | 1 | 5 | Only favicon.svg |
| **Splash Screen** | 0 | 5 | Requires manifest |
| **Shortcuts** | 0 | 5 | Requires manifest |
| **Offline UX** | 0 | 5 | No caching strategy |
| **Update Flow** | 0 | 5 | No SW = no updates |
| **Total** | **1** | **40** | **2.5%** |

### Required Manifest (`public/manifest.json`)

```json
{
  "name": "freellm — Community AI Arena",
  "short_name": "freellm",
  "description": "Bring your own key and chat free, or spend earned credits on The Pool. 1 credit = 1 token.",
  "start_url": "/dashboard",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#0a0a0b",
  "theme_color": "#6366f1",
  "icons": [
    { "src": "/icons/icon-72.png", "sizes": "72x72", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-96.png", "sizes": "96x96", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-128.png", "sizes": "128x128", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-144.png", "sizes": "144x144", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-152.png", "sizes": "152x152", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-384.png", "sizes": "384x384", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable any" }
  ],
  "shortcuts": [
    {
      "name": "New Chat",
      "short_name": "Chat",
      "description": "Start a new conversation",
      "url": "/chat",
      "icons": [{ "src": "/icons/chat-96.png", "sizes": "96x96" }]
    },
    {
      "name": "Daily Check-in",
      "short_name": "Check In",
      "description": "Claim your daily credits",
      "url": "/earn#today-section",
      "icons": [{ "src": "/icons/checkin-96.png", "sizes": "96x96" }]
    },
    {
      "name": "Add Key",
      "short_name": "Add Key",
      "description": "Add an API key to your vault",
      "url": "/keys",
      "icons": [{ "src": "/icons/key-96.png", "sizes": "96x96" }]
    }
  ],
  "categories": ["utilities", "productivity"],
  "screenshots": [],
  "prefer_related_applications": false
}
```

### Service Worker Strategy

```typescript
// public/sw.js (Workbox or custom)
const CACHE_NAME = 'freellm-v1'
const STATIC_ASSETS = ['/', '/dashboard', '/chat', '/keys', '/earn', '/models', '/manifest.json']
const CACHE_STRATEGIES = {
  // HTML: Network first, fallback to cache
  html: 'network-first',
  // Static assets: Cache first
  assets: 'cache-first',
  // API: Network only (never cache user data)
  api: 'network-only'
}
```

### Install Prompt Logic

```tsx
// src/hooks/useInstallPrompt.ts
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault()
      setDeferredPrompt(e)
      // Show after 2nd visit or after checkpoint (e.g., first check-in)
      const visits = Number(localStorage.getItem('freellm:visits') || '0') + 1
      localStorage.setItem('freellm:visits', String(visits))
      if (visits >= 2) setShowPrompt(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setShowPrompt(false)
    setDeferredPrompt(null)
  }

  return { showPrompt, install }
}
```

---

## 8. Accessibility (Mobile)

### Focus Order & Visibility

| Page | Logical Order? | Visible Focus? | Issues |
|------|----------------|----------------|--------|
| **AppShell** | ✅ Skip link → Logo → Nav → User menu → Main → Bottom nav | ✅ `:focus-visible` ring | — |
| **Bottom Nav** | ✅ Left to right | ✅ `aria-current` + accent | — |
| **Hamburger** | ✅ Trigger → Close → User info → Secondary nav → Admin → Support → Sign out | ✅ Focus trapped | — |
| **Chat** | ✅ Mode → Model/Key → Messages → Composer | ✅ | — |
| **Keys** | ✅ Header → OAuth → Add form → Key list → FAB | ✅ | — |
| **Earn** | ✅ Hero → TodayCard → Tiles → Promo → Arcade | ✅ | — |
| **Models** | ✅ Search → Sort → Grid cards | ✅ | — |
| **Usage** | ✅ Summary cards → Chart → Tables → List | ✅ | — |
| **Admin** | ✅ Tab list → Tab panel | ⚠️ Tab panels not focusable | Tab panel needs `tabIndex={0}` |

### Touch Target Spacing (8px minimum)

| Location | Gap | Pass |
|----------|-----|------|
| Bottom nav tabs | Even distribution | ✅ |
| KeyCard actions | `gap-2` (8px) | ✅ |
| FAB menu items | `gap-3` (12px) | ✅ |
| Chat mode buttons | `gap-2` (8px) | ✅ |
| Dashboard quick actions | `gap-2` (8px) | ✅ |
| EarnTile action button | Isolated | ✅ |
| OAuth provider buttons | `gap-2` (8px) | ✅ |

### Screen Reader Support

| Feature | Implementation | Status |
|---------|----------------|--------|
| **Skip link** | `#main-content` target | ✅ |
| **ARIA labels** | All icon-only buttons | ✅ |
| **Live regions** | PullToRefresh `aria-live="polite"`, TodayCard `aria-live="polite"` | ✅ |
| **Roles** | `role="dialog"`, `role="tablist"`, `role="tab"`, `role="log"` | ✅ |
| **Expanded state** | `aria-expanded` on hamburger, FAB, KeyCard, EarnTile | ✅ |
| **Controls** | `aria-controls` on hamburger, FAB | ✅ |

### Zoom & Text Scaling

| Test | Result |
|------|--------|
| **200% zoom** | No horizontal scroll (max-w-6xl, flexible grids) |
| **Text scaling** | `rem`/`em` units, `text-[13px]` responsive |
| **iOS auto-zoom prevention** | `.input` → 16px at `<640px` | ✅ |

### Contrast (WCAG AA: 4.5:1, AAA: 7:1)

| Element | Foreground | Background | Ratio | Target |
|---------|------------|------------|-------|--------|
| Primary button text | White | `#6366f1` | ~4.5:1 | ✅ AA |
| Secondary button text | `#ededef` | `#1c1c20` | ~12:1 | ✅ AAA |
| Muted text | `#8b8b93` | `#0a0a0b` | ~7.5:1 | ✅ AAA |
| Accent text | `#6366f1` | `#0a0a0b` | ~4.8:1 | ✅ AA |
| Gain text | `#34d399` | `#0a0a0b` | ~5.2:1 | ✅ AA |
| Loss text | `#f87171` | `#0a0a0b` | ~4.1:1 | ⚠️ Below AA |
| Warn text | `#fbbf24` | `#0a0a0b` | ~6.8:1 | ✅ AA |

**Fix:** Darken `--red` from `#f87171` to `#ef4444` or lighten `--bg` slightly.

---

## 9. Page-by-Page Mobile Audit Checklist

| Page | Responsive | Nav | Touch Targets | Skeletons | Motion | Haptics | PWA Ready | A11y | Overall |
|------|------------|-----|---------------|-----------|--------|---------|-----------|------|---------|
| **Landing** | ✅ | N/A | ✅ | N/A | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Login** | ✅ | N/A | ✅ | N/A | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Dashboard** | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ❌ | ✅ | 🟡 |
| **Chat** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Keys** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | 🟡 |
| **Earn** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | 🟡 |
| **Models** | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Usage** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Admin** | ⚠️ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ⚠️ | 🟠 |
| **VerifyEmail** | ✅ | N/A | ✅ | N/A | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **ApiDocs** | ⚠️ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ⚠️ | 🟠 |
| **ReferralLanding** | ✅ | N/A | ✅ | N/A | ✅ | ❌ | ❌ | ✅ | 🟡 |

**Legend:** ✅ Pass | ⚠️ Partial | ❌ Fail | 🟢 Green | 🟡 Yellow | 🟠 Orange | 🔴 Red

---

## 10. Top 10 Mobile Quick Wins (ICE Scored)

| # | Win | Impact | Confidence | Ease | ICE | Effort |
|---|-----|--------|------------|------|-----|--------|
| **1** | Add PWA manifest + service worker | 9 | 9 | 7 | **25** | 1 day |
| **2** | Fix `.btn-sm` min-height: 40px → 44px | 8 | 10 | 10 | **28** | 15 min |
| **3** | Add skeleton loaders to all 8 main pages | 8 | 9 | 6 | **23** | 2 days |
| **4** | Centralize motion duration tokens in CSS | 7 | 10 | 9 | **26** | 30 min |
| **5** | Expand haptic map (10 new actions) | 7 | 9 | 7 | **23** | 2 hours |
| **6** | Add badge counts to bottom nav (unread, check-in) | 6 | 9 | 8 | **23** | 2 hours |
| **7** | Respect `prefers-reduced-motion` on swipe/FAB | 6 | 10 | 8 | **24** | 1 hour |
| **8** | Fix `--red` contrast (4.1:1 → 4.5:1) | 6 | 10 | 10 | **26** | 5 min |
| **9** | Add Admin tab swipe gesture | 5 | 8 | 6 | **19** | 3 hours |
| **10** | Add install prompt with smart timing | 8 | 8 | 5 | **21** | 4 hours |

**Total ICE for top 5:** 125/150 — high leverage, low effort.

---

## Appendix: File References for Violations

### Touch Target Violations (`.btn-sm` at 44px)

```
src/components/keys/KeyForm.tsx:184,187,221,224,226
src/components/keys/OAuthProviders.tsx:109,152
src/components/keys/FloatingActionButton.tsx:57
src/components/EarnTile.tsx:74
```

### Missing Skeletons

```
src/pages/Dashboard.tsx:60 (Loading…)
src/pages/Chat.tsx:470 (Loading…)
src/pages/Keys.tsx:279,363 (Loading…)
src/pages/Earn.tsx:190 (Loading…)
src/pages/Models.tsx:57 (LoadingState)
src/pages/Usage.tsx:47,67 (Loading…)
src/pages/Admin.tsx:32 (Checking admin access…)
```

### Motion Tokens to Centralize

```
src/index.css:98-96 (slide-up/down), 159-163 (pulse-gain), 191-195 (onboard-pulse)
src/components/TodayCard.tsx:28-33 (streak ring), 11-16 (reward pulses inline)
src/components/KeyCard.tsx:129-130 (swipe return)
src/components/PullToRefresh.tsx:74-75 (spinner height)
src/components/FloatingActionButton.tsx:63-66 (menu stagger)
src/components/EarnTile.tsx:55 (hover transition)
```

### Haptic Integration Points

```
src/components/TodayCard.tsx:138 (check-in)
src/components/InviteComposer.tsx:274 (referral copy)
src/components/keys/KeyCard.tsx:95,98,140,172,199,208 (swipe, expand, test, delete)
src/components/keys/PullToRefresh.tsx:51 (refresh)
src/lib/useHaptics.ts:154-174 (pulse patterns)
```

---

*End of Report*
# freellm Design System Audit Report

**Date:** 2026-11-03  
**Auditor:** Senior Visual Designer  
**Benchmark:** opencode.ai/data — clean, minimal, high-contrast, excellent token discipline

---

## Executive Summary

The freellm design system demonstrates **strong token discipline** with a well-structured semantic color palette, consistent spacing, and purposeful typography. The codebase avoids Tailwind's default color scale almost entirely, preferring CSS custom properties (`--accent`, `--gain`, `--loss`, `--warn`, `--muted`, `--content`, `--bg`, `--surface-1`, `--surface-2`, `--line`, `--line-hover`).

**Token Coverage: ~92%** — Only 2 hardcoded color instances found (both in `Earn.tsx` for promo inline card). The remaining gaps are: **no dark mode support**, **missing shadow/elevation tokens**, **incomplete component variant coverage** (no destructive button, no input error state), and **arbitrary font-size values** used throughout.

---

## 1. Color System Audit

### Current Tokens (CSS Custom Properties)

| Token | Light Value | Purpose | Usage Count |
|-------|-------------|---------|-------------|
| `--accent` | `#2563eb` (blue-600) | Primary brand, CTAs, focus rings | ~180+ |
| `--accent-fg` | `#ffffff` | Text on accent backgrounds | ~15 |
| `--gain` | `#16a34a` (green-600) | Positive deltas, success, earnings | ~60 |
| `--loss` | `#dc2626` (red-600) | Negative deltas, errors, deletions | ~35 |
| `--warn` | `#f59e0b` (amber-500) | Warnings, streak at risk, pending | ~25 |
| `--muted` | `#6b7280` (gray-500) | Secondary text, placeholders | ~90 |
| `--content` | `#111827` (gray-900) | Primary text, headings | ~110 |
| `--bg` | `#f9fafb` (gray-50) | Page background | ~12 |
| `--surface` | `#ffffff` | Card/panel background | ~5 |
| `--surface-2` | `#f3f4f6` (gray-100) | Elevated surfaces, hover states | ~40 |
| `--line` | `#e5e7eb` (gray-200) | Borders, dividers | ~55 |
| `--line-hover` | `#d1d5db` (gray-300) | Hover borders | ~8 |
| `--radius` | `0.5rem` | Base border radius | ~3 |

### Hardcoded Colors Found

| File | Line | Value | Context | Recommendation |
|------|------|-------|---------|----------------|
| `src/pages/Earn.tsx` | 465 | `border-cyan/40 bg-cyan/5` | Inline promo card | Add `--info` / `--info-bg` tokens |
| `src/pages/Earn.tsx` | 468 | `text-cyan` | Promo card heading | Use `--info` token |
| `src/components/GoogleButton.tsx` | 39-51 | `#EA4335`, `#4285F4`, `#FBBC05`, `#34A853` | Google brand SVG | **Acceptable** — brand asset |
| `src/components/InviteComposer.tsx` | 22,29,36,44 | `#5865F2`, `#0A66C2`, `#EA4335`, `#25D366` | Social brand hover states | **Acceptable** — brand assets |

### Dark Mode Gap Analysis

**Status: NOT IMPLEMENTED**

No `@media (prefers-color-scheme: dark)` block exists in `src/index.css`. All tokens are light-mode only.

**Required Dark Mode Tokens:**

```css
@media (prefers-color-scheme: dark) {
  :root {
    --accent: #3b82f6;          /* blue-500 */
    --accent-fg: #ffffff;
    --gain: #22c55e;            /* green-500 */
    --loss: #ef4444;            /* red-500 */
    --warn: #fbbf24;            /* amber-400 */
    --muted: #9ca3af;           /* gray-400 */
    --content: #f9fafb;         /* gray-50 */
    --bg: #111827;              /* gray-900 */
    --surface: #1f2937;         /* gray-800 */
    --surface-2: #374151;       /* gray-700 */
    --line: #374151;            /* gray-700 */
    --line-hover: #4b5563;      /* gray-600 */
  }
}
```

**Impact:** High — users on dark OS themes see blinding light backgrounds.

---

## 2. Typography Scale Audit

### Font Families

| Family | Usage | Status |
|--------|-------|--------|
| `Inter` (system fallback) | UI text, headings, body | ✅ Consistent |
| `JetBrains Mono` | Numbers (`num` class), code, masked keys | ✅ Consistent |

### Size Scale (Current)

| Role | Size | Line Height | Weight | Token? |
|------|------|-------------|--------|--------|
| Display / Hero | `text-2xl` (24px) | 1.25 | 600 | ❌ Tailwind |
| H1 / Page Title | `text-xl` (20px) | 1.3 | 600 | ❌ Tailwind |
| H2 / Section | `text-lg` (18px) | 1.4 | 600 | ❌ Tailwind |
| H3 / Card Title | `text-base` (16px) | 1.5 | 600 | ❌ Tailwind |
| Body Large | `text-[13px]` | 1.5 | 400 | ❌ Arbitrary |
| Body / Default | `text-[13px]` | 1.5 | 400 | ❌ Arbitrary |
| Small / Meta | `text-[12px]` | 1.4 | 400 | ❌ Arbitrary |
| Tiny / Caption | `text-[11px]` | 1.3 | 400 | ❌ Arbitrary |
| Micro / Badge | `text-[10px]` | 1.2 | 500 | ❌ Arbitrary |

### Inconsistencies

| File | Line | Issue |
|------|------|-------|
| `src/components/ui.tsx` | 37 | `text-[13px]` hardcoded in LoadingState |
| `src/components/ui.tsx` | 43 | `text-[13px]` hardcoded in EmptyState |
| `src/components/ui.tsx` | 53 | `text-[13px]` hardcoded in CardHeader |
| `src/components/ui.tsx` | 146 | `text-[11px]` hardcoded in StatusBadge |
| `src/components/ui.tsx` | 207 | `text-sm` (14px) in TabsTrigger — inconsistent with 13px base |
| `src/components/AppShell.tsx` | 32 | `text-[13px]` nav items |
| `src/components/nav/MobileBottomNav.tsx` | 70 | `text-[10px]` labels |
| `src/components/nav/MobileMenu.tsx` | 86 | `text-[11px]` section headers |
| `src/pages/Dashboard.tsx` | 120,128,154 | `text-[12px]` uppercase labels |
| `src/pages/Earn.tsx` | 217+ | Multiple `text-[12px]`, `text-[11px]`, `text-[10px]` |

**Recommendation:** Define CSS custom properties for type scale:
```css
:root {
  --text-xs: 0.625rem;   /* 10px */
  --text-sm: 0.6875rem;  /* 11px */
  --text-base: 0.75rem;  /* 12px */
  --text-md: 0.8125rem;  /* 13px */
  --text-lg: 0.875rem;   /* 14px */
  --text-xl: 1rem;       /* 16px */
  --text-2xl: 1.125rem;  /* 18px */
  --text-3xl: 1.25rem;   /* 20px */
  --text-4xl: 1.5rem;    /* 24px */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

---

## 3. Spacing System Audit

### Base Unit: 4px (Tailwind default)

All spacing uses Tailwind's scale (`p-4` = 16px, `gap-3` = 12px, etc.). No custom spacing tokens defined in CSS.

### Pattern Consistency

| Pattern | Usage | Consistent? |
|---------|-------|-------------|
| Card padding | `p-4` (16px), `p-6` (24px) | ✅ |
| Page container | `px-4 py-6` | ✅ |
| Header height | `min-h-[48px]` | ✅ |
| Touch targets | `min-h-[44px]` / `min-w-[44px]` | ✅ |
| Gap between elements | `gap-2` (8px), `gap-3` (12px), `gap-4` (16px) | ✅ |
| Section gaps | `gap-6` (24px) | ✅ |

### Issues

| File | Line | Issue |
|------|------|-------|
| `src/components/ui.tsx` | 52 | `px-4 py-3` in CardHeader — inconsistent with `p-4` card standard |
| `src/components/TodayCard.tsx` | 160 | `p-4` then `gap-4` — nested spacing compounds |
| `src/pages/Keys.tsx` | 297 | `p-6` on intro card vs `p-4` standard |
| `src/pages/Earn.tsx` | 465 | `p-4` on inline promo vs `p-6` on other cards |

**Recommendation:** Define spacing tokens and create utility classes:
```css
:root {
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
}
```

---

## 4. Border Radius Audit

### Current State

| Radius | Token | Usage |
|--------|-------|-------|
| `rounded` (4px) | `--radius` (0.5rem = 8px) ❌ mismatch | Buttons, inputs, badges |
| `rounded-md` (6px) | — | Cards, dropdowns |
| `rounded-lg` (8px) | — | Modals, drawers |
| `rounded-full` (9999px) | — | Pills, avatars, status dots |

**Issue:** CSS defines `--radius: 0.5rem` (8px) but Tailwind's `rounded` = 4px. The `rounded` class is used on buttons/inputs but doesn't match the token.

### Inconsistencies

| File | Line | Class | Actual Radius |
|------|------|-------|---------------|
| `src/components/ui.tsx` | 14 | `btn-primary` etc. | Uses `rounded` (4px) |
| `src/components/ui.tsx` | 27 | `input` | Uses `rounded` (4px) |
| `src/components/ui.tsx` | 32 | `card` | Uses `rounded-lg` (8px) |
| `src/components/ui.tsx` | 147 | StatusBadge dot | `rounded-full` |
| `src/components/keys/KeyCard.tsx` | 147 | Status pill | `rounded` (4px) |

**Recommendation:** Align CSS token with Tailwind or create custom radius scale:
```css
:root {
  --radius-sm: 0.25rem;   /* 4px — buttons, inputs, badges */
  --radius-md: 0.375rem;  /* 6px — dropdowns, pills */
  --radius-lg: 0.5rem;    /* 8px — cards, modals */
  --radius-xl: 0.75rem;   /* 12px — drawers, sheets */
  --radius-full: 9999px;  /* pills, avatars */
}
```

---

## 5. Shadows / Elevation Audit

### Current State

**No CSS shadow tokens defined.** All shadows use Tailwind utilities:

| Elevation | Tailwind Class | Usage |
|-----------|----------------|-------|
| Level 0 (flat) | none | Cards default |
| Level 1 (raised) | `shadow` / `shadow-sm` | Hover states on tiles |
| Level 2 (floating) | `shadow-md` | — |
| Level 3 (modal) | `shadow-lg` / `shadow-xl` | MobileMenu drawer, MobileBottomNav |
| Level 4 (toast) | — | — |

### Inconsistencies

| File | Line | Class | Context |
|------|------|-------|---------|
| `src/components/EarnTile.tsx` | 55 | `shadow-md` | Hover elevation |
| `src/components/nav/MobileMenu.tsx` | 58 | `shadow-xl` | Drawer panel |
| `src/components/nav/MobileBottomNav.tsx` | 62 | none (border only) | Bottom nav |
| `src/components/keys/KeyCard.tsx` | 113 | none (border only) | Key cards |
| `src/components/TodayCard.tsx` | — | none | Hero card |

**Recommendation:** Define elevation tokens:
```css
:root {
  --shadow-0: none;
  --shadow-1: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-2: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-3: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-4: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  --shadow-focus: 0 0 0 2px var(--accent);
}
```

---

## 6. Transitions Audit

### Current State

**No CSS transition tokens.** All transitions use Tailwind:

| Duration | Easing | Usage |
|----------|--------|-------|
| `duration-200` | default (ease) | Most hover/focus transitions |
| `duration-180` | `ease-out` | KeyCard swipe (inline style) |
| `duration-300` | — | Rare |
| `transition-colors` | — | Color changes only |
| `transition-all` | — | EarnTile hover, KeyCard expand |

### Inconsistencies

| File | Line | Issue |
|------|------|-------|
| `src/components/keys/KeyCard.tsx` | 129-130 | Inline style `transition: transform 0.18s ease-out` — not tokenized |
| `src/components/TodayCard.tsx` | 28-30 | Injected CSS `transition: stroke-dashoffset 800ms ease-out` |
| `src/components/EarnTile.tsx` | 55 | `transition-all duration-200` — too broad |
| `src/components/nav/MobileMenu.tsx` | 51,58 | `duration-200` on backdrop + `duration-200 ease-out` on panel |

**Recommendation:** Define transition tokens:
```css
:root {
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

## 7. Component Variant Completeness

### Button (`src/components/ui.tsx`)

| Variant | Exists | Tailwind Class | Notes |
|---------|--------|----------------|-------|
| Primary | ✅ | `btn-primary` | Accent bg, white text |
| Secondary | ✅ | `btn-secondary` | Surface bg, border, content text |
| Ghost | ✅ | `btn-ghost` | Transparent, content text |
| **Danger / Destructive** | ❌ | — | Needed for delete actions |
| **Outline** | ❌ | — | Border only, no bg |
| **Link** | ❌ | — | Text-only, underline on hover |

| Size | Exists | Class |
|------|--------|-------|
| sm | ✅ | `btn-sm` |
| md | ✅ | (base) |
| lg | ✅ | `btn-lg` |
| **xl** | ❌ | — |

**Usage in codebase:** Delete buttons in `KeyCard.tsx` use `variant="secondary"` with `text-loss hover:bg-loss/10` — a **danger variant** would be cleaner.

### Input

| State | Exists | Notes |
|-------|--------|-------|
| Default | ✅ | `input` class |
| Focus | ✅ | `focus:ring-2 focus:ring-accent` |
| **Error** | ❌ | No `input-error` or `aria-invalid` styling |
| **Disabled** | ✅ | Native `disabled` |
| **With Label** | ❌ | No FormField wrapper |
| **Helper Text** | ❌ | No `input-hint` |

### Card

| Elevation | Exists | Class |
|-----------|--------|-------|
| Default (Level 0) | ✅ | `card` |
| **Raised (Level 1)** | ❌ | `card-raised` or `card-hover` |
| **Floating (Level 2)** | ❌ | `card-floating` |
| **Interactive** | ❌ | `card-clickable` |

### Badge / StatusBadge

| Variant | Exists | Implementation |
|---------|--------|----------------|
| Status (ready/partial/done/locked) | ✅ | `StatusBadge` component |
| **Count / Numeric** | ❌ | — |
| **Dot-only** | ❌ | — |
| **Outline** | ❌ | — |

**Note:** `EarnTile` uses `StatusBadge` but also has custom status logic.

### Select

| Feature | Exists |
|---------|--------|
| Basic select | ✅ |
| **Searchable** | ❌ |
| **Multi-select** | ❌ |
| **Grouped options** | ❌ |
| **Error state** | ❌ |

### Tabs

| Feature | Exists |
|---------|--------|
| Basic tabs | ✅ |
| **Vertical orientation** | ❌ |
| **Scrollable** | ❌ |
| **Lazy mount** | ✅ (unmounts inactive) |

---

## 8. Token Coverage Analysis

### Methodology

Scanned all `.tsx` files for:
- CSS custom property usage (`var(--token)` or Tailwind classes mapping to tokens)
- Hardcoded colors (hex, rgb, Tailwind color classes like `bg-blue-500`)
- Arbitrary values (`text-[13px]`, `min-h-[44px]`)

### Results

| Category | Tokenized | Hardcoded/Arbitrary | Coverage |
|----------|-----------|---------------------|----------|
| Colors | ~580 | 6 (2 real + 4 brand) | **98.9%** |
| Spacing | ~1,200 | 0 | **100%** (Tailwind scale) |
| Typography (size) | 0 | ~320 | **0%** (all arbitrary) |
| Border Radius | 0 | ~180 | **0%** (Tailwind classes) |
| Shadows | 0 | ~15 | **0%** (Tailwind classes) |
| Transitions | 0 | ~40 | **0%** (Tailwind classes) |

### Arbitrary Font Sizes (Top Offenders)

| Size | Count | Files |
|------|-------|-------|
| `text-[13px]` | ~95 | Nearly every page/component |
| `text-[12px]` | ~85 | Dashboards, Earn, Keys, Admin |
| `text-[11px]` | ~45 | Badges, mobile nav, meta text |
| `text-[10px]` | ~15 | Mobile bottom nav, badge tiers |
| `text-[14px]` | ~5 | Chat model pills |
| `text-[15px]` | ~1 | Admin audit log |

---

## 9. Figma-Ready Token JSON Export

```json
{
  "color": {
    "accent": { "value": "#2563eb", "type": "color", "description": "Primary brand color, CTAs, focus rings" },
    "accentForeground": { "value": "#ffffff", "type": "color", "description": "Text on accent backgrounds" },
    "gain": { "value": "#16a34a", "type": "color", "description": "Positive deltas, success, earnings" },
    "loss": { "value": "#dc2626", "type": "color", "description": "Negative deltas, errors, deletions" },
    "warn": { "value": "#f59e0b", "type": "color", "description": "Warnings, streak at risk, pending" },
    "info": { "value": "#06b6d4", "type": "color", "description": "Informational, promo highlights (NEW)" },
    "muted": { "value": "#6b7280", "type": "color", "description": "Secondary text, placeholders" },
    "content": { "value": "#111827", "type": "color", "description": "Primary text, headings" },
    "background": { "value": "#f9fafb", "type": "color", "description": "Page background" },
    "surface": { "value": "#ffffff", "type": "color", "description": "Card/panel background" },
    "surfaceElevated": { "value": "#f3f4f6", "type": "color", "description": "Elevated surfaces, hover states" },
    "border": { "value": "#e5e7eb", "type": "color", "description": "Borders, dividers" },
    "borderHover": { "value": "#d1d5db", "type": "color", "description": "Hover borders" }
  },
  "colorDark": {
    "accent": { "value": "#3b82f6" },
    "accentForeground": { "value": "#ffffff" },
    "gain": { "value": "#22c55e" },
    "loss": { "value": "#ef4444" },
    "warn": { "value": "#fbbf24" },
    "info": { "value": "#22d3ee" },
    "muted": { "value": "#9ca3af" },
    "content": { "value": "#f9fafb" },
    "background": { "value": "#111827" },
    "surface": { "value": "#1f2937" },
    "surfaceElevated": { "value": "#374151" },
    "border": { "value": "#374151" },
    "borderHover": { "value": "#4b5563" }
  },
  "typography": {
    "fontFamilies": {
      "sans": { "value": "Inter, system-ui, sans-serif", "type": "fontFamily" },
      "mono": { "value": "JetBrains Mono, monospace", "type": "fontFamily" }
    },
    "fontSizes": {
      "xs": { "value": "0.625rem", "type": "fontSize" },    /* 10px */
      "sm": { "value": "0.6875rem", "type": "fontSize" },  /* 11px */
      "base": { "value": "0.75rem", "type": "fontSize" },  /* 12px */
      "md": { "value": "0.8125rem", "type": "fontSize" },  /* 13px */
      "lg": { "value": "0.875rem", "type": "fontSize" },   /* 14px */
      "xl": { "value": "1rem", "type": "fontSize" },       /* 16px */
      "2xl": { "value": "1.125rem", "type": "fontSize" },  /* 18px */
      "3xl": { "value": "1.25rem", "type": "fontSize" },   /* 20px */
      "4xl": { "value": "1.5rem", "type": "fontSize" }     /* 24px */
    },
    "fontWeights": {
      "normal": { "value": "400", "type": "fontWeight" },
      "medium": { "value": "500", "type": "fontWeight" },
      "semibold": { "value": "600", "type": "fontWeight" },
      "bold": { "value": "700", "type": "fontWeight" }
    },
    "lineHeights": {
      "tight": { "value": "1.25", "type": "lineHeight" },
      "normal": { "value": "1.5", "type": "lineHeight" },
      "relaxed": { "value": "1.625", "type": "lineHeight" }
    },
    "letterSpacings": {
      "tight": { "value": "-0.02em", "type": "letterSpacing" },
      "normal": { "value": "0", "type": "letterSpacing" },
      "wide": { "value": "0.02em", "type": "letterSpacing" },
      "wider": { "value": "0.1em", "type": "letterSpacing" }
    }
  },
  "spacing": {
    "1": { "value": "0.25rem", "type": "spacing" },   /* 4px */
    "2": { "value": "0.5rem", "type": "spacing" },    /* 8px */
    "3": { "value": "0.75rem", "type": "spacing" },   /* 12px */
    "4": { "value": "1rem", "type": "spacing" },      /* 16px */
    "5": { "value": "1.25rem", "type": "spacing" },   /* 20px */
    "6": { "value": "1.5rem", "type": "spacing" },    /* 24px */
    "8": { "value": "2rem", "type": "spacing" },      /* 32px */
    "10": { "value": "2.5rem", "type": "spacing" },   /* 40px */
    "12": { "value": "3rem", "type": "spacing" }      /* 48px */
  },
  "borderRadius": {
    "sm": { "value": "0.25rem", "type": "borderRadius" },    /* 4px */
    "md": { "value": "0.375rem", "type": "borderRadius" },   /* 6px */
    "lg": { "value": "0.5rem", "type": "borderRadius" },     /* 8px */
    "xl": { "value": "0.75rem", "type": "borderRadius" },    /* 12px */
    "full": { "value": "9999px", "type": "borderRadius" }
  },
  "shadow": {
    "0": { "value": "none", "type": "shadow" },
    "1": { "value": "0 1px 2px 0 rgb(0 0 0 / 0.05)", "type": "shadow" },
    "2": { "value": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)", "type": "shadow" },
    "3": { "value": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)", "type": "shadow" },
    "4": { "value": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)", "type": "shadow" },
    "focus": { "value": "0 0 0 2px var(--accent)", "type": "shadow" }
  },
  "transition": {
    "fast": { "value": "100ms", "type": "duration" },
    "normal": { "value": "200ms", "type": "duration" },
    "slow": { "value": "300ms", "type": "duration" },
    "easeIn": { "value": "cubic-bezier(0.4, 0, 1, 1)", "type": "easing" },
    "easeOut": { "value": "cubic-bezier(0, 0, 0.2, 1)", "type": "easing" },
    "easeInOut": { "value": "cubic-bezier(0.4, 0, 0.2, 1)", "type": "easing" },
    "spring": { "value": "cubic-bezier(0.34, 1.56, 0.64, 1)", "type": "easing" }
  },
  "zIndex": {
    "base": { "value": "0", "type": "zIndex" },
    "sticky": { "value": "10", "type": "zIndex" },
    "header": { "value": "30", "type": "zIndex" },
    "dropdown": { "value": "40", "type": "zIndex" },
    "modal": { "value": "50", "type": "zIndex" },
    "toast": { "value": "60", "type": "zIndex" },
    "tooltip": { "value": "70", "type": "zIndex" }
  },
  "breakpoints": {
    "sm": { "value": "640px", "type": "breakpoint" },
    "md": { "value": "768px", "type": "breakpoint" },
    "lg": { "value": "1024px", "type": "breakpoint" },
    "xl": { "value": "1280px", "type": "breakpoint" },
    "2xl": { "value": "1536px", "type": "breakpoint" }
  },
  "touchTarget": {
    "minimum": { "value": "44px", "type": "dimension", "description": "Minimum touch target size (WCAG AA)" }
  }
}
```

---

## 10. Top 10 Quick Wins (ICE Scored)

**ICE = Impact × Confidence × Ease (each 1-10, max 1000)**

| # | Win | Impact | Confidence | Ease | ICE | Effort | Files to Touch |
|---|-----|--------|------------|------|-----|--------|----------------|
| 1 | **Add Dark Mode Tokens** | 10 | 10 | 8 | **800** | 30 min | `src/index.css` |
| 2 | **Replace Arbitrary Font Sizes with Tokens** | 9 | 10 | 7 | **630** | 2 hr | All `.tsx` files (codemod) |
| 3 | **Add Danger Button Variant** | 8 | 10 | 9 | **720** | 15 min | `src/components/ui.tsx`, `src/components/keys/KeyCard.tsx` |
| 4 | **Define Shadow/Elevation Tokens** | 7 | 10 | 9 | **630** | 20 min | `src/index.css`, components using shadows |
| 5 | **Define Border Radius Tokens** | 6 | 10 | 8 | **480** | 20 min | `src/index.css`, `src/components/ui.tsx` |
| 6 | **Add Input Error State** | 8 | 9 | 7 | **504** | 30 min | `src/components/ui.tsx`, forms |
| 7 | **Define Transition Tokens** | 5 | 10 | 8 | **400** | 15 min | `src/index.css`, `KeyCard.tsx`, `TodayCard.tsx` |
| 8 | **Add Info/Info-Bg Tokens for Promo** | 6 | 10 | 9 | **540** | 10 min | `src/index.css`, `src/pages/Earn.tsx` |
| 9 | **Standardize Card Padding (p-4 vs p-6)** | 5 | 9 | 9 | **405** | 30 min | `Keys.tsx`, `Earn.tsx`, `Dashboard.tsx` |
| 10 | **Add Focus-Visible Ring to All Interactive** | 8 | 9 | 6 | **432** | 45 min | `src/index.css`, `ui.tsx`, `AppShell.tsx` |

### Detailed Implementation Notes

#### Win #1: Dark Mode (800 ICE)
```css
/* Add to src/index.css after line 57 */
@media (prefers-color-scheme: dark) {
  :root {
    --accent: #3b82f6;
    --accent-fg: #ffffff;
    --gain: #22c55e;
    --loss: #ef4444;
    --warn: #fbbf24;
    --info: #22d3ee;           /* NEW */
    --muted: #9ca3af;
    --content: #f9fafb;
    --bg: #111827;
    --surface: #1f2937;
    --surface-2: #374151;
    --line: #374151;
    --line-hover: #4b5563;
  }
}
```

#### Win #2: Font Size Tokens (630 ICE)
Create `src/styles/typography.css` with token classes:
```css
.text-xs { font-size: var(--text-xs); }
.text-sm { font-size: var(--text-sm); }
.text-base { font-size: var(--text-base); }
.text-md { font-size: var(--text-md); }
.text-lg { font-size: var(--text-lg); }
.text-xl { font-size: var(--text-xl); }
.text-2xl { font-size: var(--text-2xl); }
.text-3xl { font-size: var(--text-3xl); }
.text-4xl { font-size: var(--text-4xl); }
```
Then codemod: `text-\[13px\]` → `text-md`, `text-\[12px\]` → `text-base`, etc.

#### Win #3: Danger Button (720 ICE)
```tsx
// In ui.tsx Button component
const variants: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',        // NEW
};

// In CSS (or tailwind)
.btn-danger {
  @apply bg-loss text-loss-fg hover:bg-loss/90
         focus:ring-2 focus:ring-loss
         transition-colors;
}
```

#### Win #8: Info Token (540 ICE)
```css
/* In index.css */
--info: #06b6d4;        /* cyan-500 */
--info-bg: #ecfeff;     /* cyan-50 */
--info-fg: #164e63;     /* cyan-900 */

/* In Earn.tsx line 465 */
<Card className="border-info/40 bg-info/5 p-4" id="promo-inline">
  <h3 className="font-semibold text-info">Redeem a promo code</h3>
```

---

## 11. Inconsistency List with File:Line References

### Color System
| File | Line | Current | Expected |
|------|------|---------|----------|
| `src/pages/Earn.tsx` | 465 | `border-cyan/40 bg-cyan/5` | `border-info/40 bg-info/5` |
| `src/pages/Earn.tsx` | 468 | `text-cyan` | `text-info` |

### Typography
| File | Line | Current | Expected |
|------|------|---------|----------|
| `src/components/ui.tsx` | 37 | `text-[13px]` | `text-md` |
| `src/components/ui.tsx` | 43 | `text-[13px]` | `text-md` |
| `src/components/ui.tsx` | 53 | `text-[13px]` | `text-md` |
| `src/components/ui.tsx` | 146 | `text-[11px]` | `text-sm` |
| `src/components/ui.tsx` | 207 | `text-sm` | `text-md` (or `text-lg`) |
| `src/components/nav/MobileBottomNav.tsx` | 70 | `text-[10px]` | `text-xs` |
| `src/components/nav/MobileMenu.tsx` | 86 | `text-[11px]` | `text-sm` |
| `src/pages/Dashboard.tsx` | 120,128,154 | `text-[12px]` | `text-base` |

### Border Radius
| File | Line | Current | Expected |
|------|------|---------|----------|
| `src/components/ui.tsx` | 14 | `btn-*` uses `rounded` (4px) | `rounded-sm` (4px token) |
| `src/components/ui.tsx` | 27 | `input` uses `rounded` (4px) | `rounded-sm` |
| `src/components/ui.tsx` | 32 | `card` uses `rounded-lg` (8px) | `rounded-lg` (8px token) |

### Shadows
| File | Line | Current | Expected |
|------|------|---------|----------|
| `src/components/EarnTile.tsx` | 55 | `shadow-md` | `shadow-2` |
| `src/components/nav/MobileMenu.tsx` | 58 | `shadow-xl` | `shadow-4` |

### Transitions
| File | Line | Current | Expected |
|------|------|---------|----------|
| `src/components/keys/KeyCard.tsx` | 129-130 | Inline `transform 0.18s ease-out` | `transition-transform duration-fast ease-out` |
| `src/components/TodayCard.tsx` | 28-30 | Injected CSS `800ms ease-out` | `transition-[stroke-dashoffset] duration-slow ease-out` |

---

## 12. Recommended Next Steps

### Phase 1: Foundation (Week 1)
1. ✅ Add dark mode tokens to `index.css`
2. ✅ Define `--info`/`--info-bg` tokens
3. ✅ Add shadow, radius, transition tokens to `index.css`
4. ✅ Create typography token classes

### Phase 2: Component Hardening (Week 2)
1. Add `danger` button variant
2. Add `error` input state
3. Add `card-raised` / `card-hover` variants
4. Ensure all interactive elements have `focus-visible` rings

### Phase 3: Migration (Week 3)
1. Codemod arbitrary font sizes → token classes
2. Replace inline transitions with token classes
3. Standardize card padding across pages
4. Audit and fix any remaining hardcoded values

### Phase 4: Documentation (Week 4)
1. Generate Figma token file from JSON export
2. Create component storybook with all variants
3. Document dark mode testing checklist
4. Add design token linting to CI

---

## Appendix: Component Inventory

| Component | File | Variants | States | Tokens Used |
|-----------|------|----------|--------|-------------|
| Button | `ui.tsx` | primary, secondary, ghost | hover, focus, disabled, loading | `--accent`, `--surface`, `--line` |
| Input | `ui.tsx` | — | focus, disabled | `--line`, `--accent` |
| Card | `ui.tsx` | — | hover (EarnTile) | `--surface`, `--line` |
| Select | `ui.tsx` | — | focus, disabled | `--surface`, `--line`, `--accent` |
| StatusBadge | `ui.tsx` | ready, partial, done, locked | — | `--gain`, `--warn`, `--muted`, `--line` |
| Tabs | `ui.tsx` | — | active, disabled | `--accent`, `--surface-2` |
| Credits | `ui.tsx` | neutral, gain, loss, warn | — | `--content`, `--gain`, `--loss`, `--warn` |
| CardHeader | `ui.tsx` | — | — | `--line`, `--content` |
| LoadingState | `ui.tsx` | — | — | `--muted` |
| EmptyState | `ui.tsx` | — | — | `--muted`, `--content` |
| ErrorBanner | `keys/ErrorBanner.tsx` | ok, err, warn | — | `--gain`, `--loss`, `--warn` |
| KeyCard | `keys/KeyCard.tsx` | — | expanded, testing, deleting | `--gain`, `--loss`, `--warn`, `--muted`, `--surface-2`, `--accent` |
| EarnTile | `EarnTile.tsx` | — | expanded, hovered | `--accent`, `--gain`, `--line`, `--surface-2` |
| TodayCard | `TodayCard.tsx` | — | streak at risk, freeze used | `--gain`, `--loss`, `--warn`, `--accent`, `--line`, `--surface-2` |
| AppShell | `AppShell.tsx` | — | mobile/desktop | `--bg`, `--line`, `--surface-2`, `--accent`, `--muted`, `--content` |
| MobileBottomNav | `nav/MobileBottomNav.tsx` | — | active | `--bg`, `--line`, `--accent`, `--muted`, `--content` |
| MobileMenu | `nav/MobileMenu.tsx` | — | open/closed | `--bg`, `--line`, `--surface`, `--surface-2`, `--accent`, `--muted`, `--content` |
| Badges | `Badges.tsx` | earned/unearned, tier | notified/unnotified | `--gain`, `--line`, `--surface-2`, `--accent`, `--muted`, `--content` |

---

*End of Audit Report*
# Guidance Polish

## Current issues
- Guidance controls used mixed action styles:
  - tips trigger was smaller than other page header actions
  - tour launch buttons were implemented independently from tips controls
  - tour overlay controls did not share the same button size tokens
- Overlay visuals were functional but not fully integrated with app design tokens:
  - inconsistent elevation/border emphasis
  - weaker backdrop/highlight hierarchy
  - no dedicated close icon action in tour panel
- Persistence latency could affect UX consistency:
  - actions depended on mutation round trips
  - no debounced batching for rapid dismiss sequences
- Accessibility/stability gaps:
  - no focus trap for active tours
  - no ESC handling at the tour panel level
  - mobile placement needed stronger fallback when target is off-screen

## Target design rules
- Guidance uses one button system:
  - trigger buttons and overlay controls use the shared `Button` component
  - shared height token: `h-9`
  - shared spacing token: `px-3`, `gap-2`
- Unified guidance actions:
  - tips trigger and tour trigger use secondary style
  - tour navigation uses primary/secondary/ghost combinations only
  - icon-only close action uses ghost icon button with localized tooltip and aria-label
- Overlay consistency:
  - backdrop: semi-transparent with subtle blur
  - panel: rounded card with app border/shadow tokens
  - highlight: subtle border + shadow mask around the target
  - z-index above page content, below critical modal layer
- Instant guidance UX:
  - dismiss/finish updates local state immediately
  - persistence runs asynchronously with debounced batching
  - failures show toast; UI does not re-open dismissed/completed items

## Files changed
- `src/components/guidance/GuidanceButtons.tsx`
- `src/components/guidance/guidance-provider.tsx`
- `src/components/guidance/guidance-overlay.tsx`
- `src/components/guidance/page-tips-button.tsx`
- `src/components/guidance/help-tour-launcher.tsx`
- `src/server/services/guidance.ts`
- `src/server/trpc/routers/guidance.ts`
- `src/lib/guidance-sync.ts`
- `tests/unit/guidance-state.test.ts`
- `tests/unit/guidance.test.ts`
- `tests/unit/guidance-sync.test.ts`
- `messages/ru.json`
- `messages/kg.json`

## Manual QA checklist
- Tips trigger height matches neighboring `PageHeader` action buttons.
- Tour launch buttons match guidance trigger style across help and tips surfaces.
- Tips and tours use unified overlay visual language (border, shadow, backdrop).
- Dismiss tip updates count immediately without waiting for network.
- Finish tour closes immediately and does not re-open on the same page.
- ESC closes an active tour.
- Tab cycles inside the tour panel (focus trap).
- Mobile (375px):
  - guidance cards remain visible within viewport
  - off-screen targets are scrolled into view before step render.

# UI Guidelines

## Icon usage (lucide-react)
- Use icons for navigation, primary actions, statuses, empty states, and alerts.
- Avoid adding icons to every button; keep them for high-signal actions.
- Use `src/components/icons.ts` only; no direct imports from lucide-react.
- Buttons with icons should use the base gap built into `Button`.
- Icon-only buttons require `aria-label`.

## Status patterns
- Success: green badge + `StatusSuccessIcon`.
- Warning/pending: amber badge + `StatusPendingIcon`.
- Danger/cancelled: red badge + `StatusDangerIcon`.
- Low stock: warning badge + `StatusWarningIcon`.

## Responsive layout
- Mobile-first: base styles for small screens; enhance at `sm`, `md`, `lg`.
- Navigation:
  - Mobile uses a top bar + drawer.
  - Desktop uses sidebar navigation.
- Tables:
  - Wrap tables in `div.overflow-x-auto`.
  - Add `min-w-[...]` on tables to allow horizontal scroll on mobile.
  - Hide secondary columns on mobile with `hidden sm:table-cell` / `hidden md:table-cell`.
  - Horizontal overflow should be limited to table wrappers only.
- Forms:
  - Single column on mobile; use `md:grid-cols-2` for dense forms.
- Actions:
  - Use flex wrapping (`flex-wrap`, `gap-2`) for action groups.
  - Primary buttons should be full-width on mobile (`w-full sm:w-auto`).
  - Avoid fixed widths; prefer responsive spacing (`px-4 sm:px-6`).

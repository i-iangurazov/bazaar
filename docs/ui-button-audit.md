# UI Button Audit

## Sources
- Primary Button component: `src/components/ui/button.tsx`
- Icon button wrapper: `src/components/ui/icon-button.tsx`
- Row actions wrapper: `src/components/row-actions.tsx`
- Ad-hoc buttons: raw `<button>` in `src/components/app-shell.tsx`, `src/components/command-palette.tsx`, `src/components/language-switcher.tsx`, `src/components/ui/modal.tsx`, `src/components/ui/action-menu.tsx`, `src/app/(app)/purchase-orders/new/page.tsx`, `src/app/(app)/purchase-orders/[id]/page.tsx`, `src/app/(app)/products/[id]/page.tsx`.

## Current Variants/Sizes
- Variants: `primary`, `secondary`, `ghost`, `danger` (Button). Icon-only actions use `IconButton` with `ghost` by default.
- Sizes: `default` (h-10 px-4), `sm` (h-8 px-3 text-xs), `icon` (h-10 w-10).
- Inconsistent overrides:
  - `Button` with manual `className="h-8 px-3"` in exports/close pages.
  - `IconButton` hard-coded to `h-8 w-8`.
  - Misc raw `<button>` elements with custom padding/height (top bar, command palette, action menu).

## Inconsistencies
- Button height varies between 32px (h-8), 40px (h-10), and custom overrides.
- Icon-only buttons are sometimes 32px and sometimes 40px.
- Small buttons use `text-xs` while defaults use `text-sm`, leading to inconsistent typography.
- Spacing between icons and labels varies due to per-instance overrides.

## Proposed Standard
- Canonical component: `src/components/ui/button.tsx`.
- Base sizing:
  - Default: `h-9 px-4 text-sm`
  - Small: `h-8 px-3 text-sm`
  - Icon-only: `h-9 w-9`
- Icon sizing: `h-4 w-4` for all button icons.
- Consistent gap: `gap-2`.
- Variants kept as-is (primary/secondary/ghost/danger), apply same base sizing rules.
- Replace manual height/padding overrides with size props.
- `IconButton` should follow the same `size="icon"` base size (no custom height overrides).

## Scope of Patch
- Update `Button` base classes and sizes.
- Update `IconButton` sizing to match the base system.
- Replace `className="h-8 px-3"` with `size="sm"` in:
  - `src/app/(app)/reports/exports/page.tsx`
  - `src/app/(app)/reports/close/page.tsx`
- Leave raw `<button>` elements unchanged for now unless they violate height consistency in primary UI.

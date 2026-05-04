# UI System Audit

## Shared Components Inspected

- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/modal.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/form-layout.tsx`
- `src/components/app-shell.tsx`
- `src/components/guidance/page-tips-button.tsx`
- `src/components/guidance/GuidanceButtons.tsx`
- `src/components/help-link.tsx`
- `src/components/selection-toolbar.tsx`

## Findings

- Radius is hardcoded across shared primitives (`rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`) instead of using a controlled token.
- `tailwind.config.ts` maps `sm/md/lg` to `--radius`, currently `0.75rem`; that conflicts with the sharp UI direction.
- Icon-only buttons have fixed `h-10 w-10`, but the base button does not force `shrink-0` for icon size.
- Help/tips buttons are close to correct but still inherit rounded styling and can be affected by surrounding flex layouts.
- Modal shells and headers encode rounded corners and lack a dedicated footer primitive, though `FormActions` is widely used.
- Cards are rounded and have a relatively decorative `shadow-soft`, which makes nested card layouts feel heavier.
- AppShell nav links and profile shortcut use multiple rounded values.

## System Direction

- Set the shared radius token to `0px`.
- Route shared components through that token rather than local arbitrary radii.
- Keep the current blue/neutral color direction.
- Use square icon buttons with `shrink-0`.
- Keep focus rings visible and consistent.
- Use `FormActions` as the baseline modal/footer action layout: cancel/secondary first, primary on the right, destructive actions visibly separated when present.

## Remaining Audit Risk

Application pages still contain one-off `rounded-*` classes. The first implementation pass focuses on shared primitives and high-frequency shell/help/print surfaces so the system direction is centralized without a risky whole-app visual rewrite.

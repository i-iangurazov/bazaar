# UI Density Rules

Use these patterns to keep forms compact, aligned, and predictable.

- Layout helpers: `FormSection` for grouped blocks, `FormGrid` for a 2‑column grid, `FormRow` for inline input + button, `FormActions` for right‑aligned actions.
- Spacing: prefer `space-y-4` and `gap-4`; avoid larger gaps unless the screen demands it.
- Validation: always render `FormMessage` so errors reserve space and do not shift layout.
- Inputs: keep consistent heights (`h-10`), and avoid oversized textareas.
- Actions: keep action rows compact and aligned; use `FormActions` instead of ad‑hoc flex wrappers.

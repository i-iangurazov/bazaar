# Design System: Soft-Sharp Modern Utilitarian

## Principles
- Keep interfaces clean, practical, and fast to scan.
- Use one accent color for primary actions (`primary` cobalt) and neutral surfaces for layout.
- Keep semantic meaning strict:
  - `success` for positive outcomes
  - `warning` for caution states
  - `danger` / `destructive` for risky or failed states
- Prefer token-driven classes (`bg-card`, `text-muted-foreground`, `border-border`) over hardcoded grays.

## Token Rules
- Base page: `bg-background text-foreground`
- Containers: `bg-card text-card-foreground border-border`
- Menus/popovers/tooltips: `bg-popover text-popover-foreground border-border`
- Inputs/selects/textarea: `border-input bg-background`
- Focus: `ring-ring` with offset from `background`

## Buttons
- Primary action: `variant="primary"` (or `default`) 
- Secondary action: `variant="secondary"`
- Tertiary/icon controls: `variant="ghost"`
- Dangerous action: `variant="danger"` / `variant="destructive"`

Do:
- Keep one primary action per section.
- Keep icon button hit areas consistent (`size="icon"`).

Don't:
- Use status colors for non-status actions.
- Introduce page-specific button palettes.

## Status Colors
- Success: `bg-success text-success-foreground`
- Warning: `bg-warning text-warning-foreground`
- Danger: `bg-danger text-danger-foreground`

## Navigation
- Active item style:
  - subtle accent background (`bg-accent`)
  - 2px primary left indicator (`border-primary`)
- Inactive items use muted foreground and accent hover.

## Tokens (HSL)
### Light
- `--background: 0 0% 100%`
- `--foreground: 240 10% 3.9%`
- `--card: 0 0% 100%`
- `--card-foreground: 240 10% 3.9%`
- `--popover: 0 0% 100%`
- `--popover-foreground: 240 10% 3.9%`
- `--primary: 221 83% 53%`
- `--primary-foreground: 0 0% 98%`
- `--secondary: 240 4.8% 95.9%`
- `--secondary-foreground: 240 5.9% 10%`
- `--muted: 240 4.8% 95.9%`
- `--muted-foreground: 240 3.8% 46.1%`
- `--accent: 240 4.8% 95.9%`
- `--accent-foreground: 240 5.9% 10%`
- `--destructive: 0 84.2% 60.2%`
- `--destructive-foreground: 0 0% 98%`
- `--border: 240 5.9% 90%`
- `--input: 240 5.9% 90%`
- `--ring: 221 83% 53%`
- `--success: 142 76% 36%`
- `--success-foreground: 0 0% 98%`
- `--warning: 38 92% 50%`
- `--warning-foreground: 240 5.9% 10%`
- `--danger: 0 84.2% 60.2%`
- `--danger-foreground: 0 0% 98%`

### Dark
- `--background: 240 10% 3.9%`
- `--foreground: 0 0% 98%`
- `--card: 240 10% 3.9%`
- `--card-foreground: 0 0% 98%`
- `--popover: 240 10% 3.9%`
- `--popover-foreground: 0 0% 98%`
- `--primary: 217 91% 60%`
- `--primary-foreground: 240 5.9% 10%`
- `--secondary: 240 3.7% 15.9%`
- `--secondary-foreground: 0 0% 98%`
- `--muted: 240 3.7% 15.9%`
- `--muted-foreground: 240 5% 64.9%`
- `--accent: 240 3.7% 15.9%`
- `--accent-foreground: 0 0% 98%`
- `--destructive: 0 62.8% 30.6%`
- `--destructive-foreground: 0 0% 98%`
- `--border: 240 3.7% 15.9%`
- `--input: 240 3.7% 15.9%`
- `--ring: 217 91% 60%`
- `--success: 142 70% 45%`
- `--success-foreground: 240 5.9% 10%`
- `--warning: 48 96% 53%`
- `--warning-foreground: 240 5.9% 10%`
- `--danger: 0 72% 51%`
- `--danger-foreground: 240 5.9% 10%`

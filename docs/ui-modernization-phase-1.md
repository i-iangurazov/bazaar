# UI Modernization Phase 1

## Scope

Phase 1 establishes a shadcn-style Bazaar UI foundation, modernizes the navigation foundation, and migrates Product Movement as the pilot page. It does not redesign the whole app and does not touch POS cashier product grid/cart performance paths.

## Registry Audit

The shadcn/ui component registry was checked before implementation. Relevant components and patterns for Bazaar include:

- Sidebar, Breadcrumb, Command, Navigation Menu
- Dialog, Alert Dialog, Sheet, Drawer
- Popover, Hover Card, Tooltip
- Tabs, Accordion, Collapsible, Scroll Area, Separator
- Button, Input, Textarea, Select, Checkbox, Radio Group, Switch, Slider
- Form, Label, Badge, Card, Alert, Skeleton, Progress, Avatar
- Table, Data Table, Pagination
- Chart and Empty patterns where appropriate

Phase 1 implements the components needed for the foundation, navigation shell, mobile nav polish, and Product Movement pilot first. Components that need additional business-specific migration, such as Command, Navigation Menu, Calendar, Chart, and dedicated form/date-picker abstractions, should be migrated in later phases.

## Design References

The Dashboard UI Kit and SnowUI Figma references were inspected for visual mood only. The useful direction for Bazaar is:

- soft app surfaces with clear light/dark token separation
- compact sidebar and mobile bottom navigation
- readable card/table spacing
- subtle muted backgrounds for table headers and alternating emphasis
- clear active states using Bazaar blue, not the reference kit's default blue/black identity

The implementation does not copy Figma frame code or introduce page-specific styling from those files. shadcn-style Bazaar components remain the source of truth.

## Bazaar Brand Mapping

The UI foundation keeps Bazaar's existing blue identity:

- Light primary: `--primary: 221 83% 45%`
- Dark primary: `--primary: 217 91% 56%`
- Sidebar active state maps to `--sidebar-primary`
- Focus rings map to `--ring` and `--sidebar-ring`

Primary buttons, active navigation states, selected states, focus rings, primary links, and important highlights should continue to use Bazaar blue.

## Navigation Foundation

Phase 1 adds shadcn-style sidebar and breadcrumb primitives:

- `SidebarProvider`
- `Sidebar`
- `SidebarInset`
- `SidebarHeader`
- `SidebarContent`
- `SidebarFooter`
- `SidebarGroup`
- `SidebarMenu`
- `SidebarMenuButton`
- `SidebarTrigger`
- `Breadcrumb`

The desktop app shell now renders through these sidebar primitives while preserving:

- grouped navigation sections
- unique icons
- Bazaar-blue active state
- collapsed desktop behavior
- current mobile shell behavior
- current permission/RBAC visibility rules

The existing mobile bottom navigation remains in place and was polished with:

- larger touch targets
- rounded app-like container
- safe-area-aware spacing
- Bazaar-blue active state
- dark/light safe surfaces
- cleaner mobile more-menu rows

## Pilot Page

Product Movement is the only migrated page in Phase 1:

- main journal table uses `DataTable`
- document edit surface uses `Dialog`
- edit-line table uses `DataTable`
- footer actions remain outside the scroll area
- mobile card fallback remains intact

## Next Recommended Pages

1. Products
2. Receiving
3. Transfers
4. Write-offs
5. Orders and receipt journal
6. Clients
7. Stores/settings
8. Integrations
9. POS receipt journal only after confirming cashier performance paths remain untouched

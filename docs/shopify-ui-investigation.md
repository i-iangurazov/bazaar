# Shopify UI Investigation for Bazaar

Sources reviewed:
- Shopify App Design Guidelines overview: https://shopify.dev/docs/apps/design
- Layout guidelines: https://shopify.dev/docs/apps/design/layout
- Page web component guidance: https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/page
- Navigation guidelines: https://shopify.dev/docs/apps/design/navigation
- Content guidelines: https://shopify.dev/docs/apps/design/content
- Empty state pattern: https://shopify.dev/docs/api/app-home/patterns/compositions/empty-state
- Button guidance: https://shopify.dev/docs/api/app-home/web-components/actions/button
- Modal guidance: https://polaris-react.shopify.com/components/internal-only/modal
- Index table guidance: https://polaris-react.shopify.com/components/tables/index-table

## Page Layout Principles

Shopify pages are organized around a predictable page container: title, page-level actions, optional breadcrumbs, then task content. The Page guidance treats the heading and action slots as page-level controls, not a place for duplicated navigation. Shopify's layout guidance recommends full-width pages for resource indexes and narrower/focused layouts for forms and simple workflows. Bazaar should preserve this hierarchy across dashboard, products, inventory, POS, reports, and settings.

## Card Usage

Shopify uses containers to make content scannable, but it avoids cards becoming the action hierarchy. Cards with actions should have at most one primary styled action. For Bazaar, cards should group related information only: product readiness, stock state, cash summary, report metrics, print profile. Nested cards and repeated CTA blocks should be reduced.

## Action Hierarchy

Shopify's page pattern has one primary action and a small number of secondary actions. Button guidance emphasizes clear intent, loading states, and preventing duplicate submissions. For Bazaar, page headers should keep the main action obvious: Add product, Start sale, Receive stock, Print labels. Secondary actions such as settings, export, and download should be visually quieter.

## Density

Shopify explicitly varies density by task and recommends not mixing density within one page. Bazaar should be denser on operational screens like POS, product index, inventory, and orders, but use looser spacing on onboarding and settings. The base grid should stay on 4px increments.

## Forms

Forms should be focused, grouped by settings topic, and avoid long unbroken walls of fields. Bazaar forms should separate quick product creation from advanced details, keep helper text short, and make required/invalid states explicit.

## Modals

Shopify treats modals as focused and potentially disruptive. They should have clear headings, primary/secondary actions, and not become large permanent settings surfaces. Bazaar should use modals for confirmations, compact setup, and transient status. Full print setup belongs in a settings area; fast print should not open a large settings modal.

## Buttons

Buttons should communicate hierarchy: primary for the single main action, secondary for support actions, destructive for irreversible work, icon-only buttons with accessible labels. Bazaar should enforce fixed square dimensions for icon-only controls, including help/tips buttons.

## Tables and Index Views

Shopify IndexTable guidance centers on resource lists: search, filters, sorting, pagination, row navigation, and bulk actions. Tables should use secondary row actions and pagination for long lists. Bazaar product, inventory, suppliers, orders, reports, and admin job lists should follow this index structure.

## Empty States

Shopify empty states provide guidance and a clear next step. Bazaar should add or keep empty states for products, inventory, POS/registers, reports, print profiles, and barcode queues.

## Help and Tips

Shopify content guidance favors clear, short, plain language and no duplicated content. Bazaar help should be discoverable but visually quiet: fixed square tip buttons, concise tips, and contextual links rather than noisy helper paragraphs everywhere.

## Navigation

Shopify navigation is task-based, short, scannable, and avoids duplicating app navigation in page bodies. Bazaar should keep a role-aware sidebar organized by merchant jobs: selling, products, inventory, reports, settings, and system/admin only for authorized users.

## How Shopify Avoids Visual Clutter

The main techniques are predictable page anatomy, one primary action, limited secondary actions, concise content, consistent spacing, table density for resource lists, clear empty states, and hiding less common actions in menus.

## What Bazaar Should Adapt

- Use one page title and one primary page action.
- Make resource pages full-width and table-first.
- Move advanced setup into settings surfaces.
- Keep row/table actions secondary.
- Use concise merchant-friendly labels.
- Standardize modal footers.
- Standardize sharp, non-rounded component surfaces while keeping Bazaar's current color direction.

## What Bazaar Should Not Copy Blindly

- Do not install Polaris just to imitate visuals; Bazaar already has a component system.
- Do not copy Shopify's rounded corners because the Bazaar direction is deliberately sharp.
- Do not embed Shopify App Bridge assumptions into this standalone app.
- Do not force all screens into cards; POS and dense operational views need purpose-built layouts.
- Do not hide necessary settings if they are part of a one-time setup workflow.

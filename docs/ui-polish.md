# UI Polish Notes

## Rules applied
- Buttons: default height is `h-10`; icon-only actions use `Button size="icon" variant="ghost"` with aria-label and tooltip.
- Forms: `FormMessage` always renders with a minimum height to prevent layout jumps.
- Tables: standardized with `Table` components and `overflow-x-auto` wrappers; row actions are icon-only or a dropdown when more than two.
- Product form: single card with clear sections and stable barcode/variant layouts.

## Key updates
- `src/components/ui/button.tsx`: added size variants and standardized default height.
- `src/components/ui/form.tsx`: reserved message space in `FormMessage`.
- `src/components/product-form.tsx`: card sections, barcode chips with icon remove, variant delete modal, and icon actions.
- `src/app/(app)/products/page.tsx`: icon-only row actions and table cleanup.
- `src/app/(app)/inventory/page.tsx`: dropdown row actions, table components, movements table.
- `src/app/(app)/stores/page.tsx`, `src/app/(app)/suppliers/page.tsx`, `src/app/(app)/settings/users/page.tsx`: table components and icon/dropdown actions.
- `src/app/(app)/purchase-orders/page.tsx`, `src/app/(app)/purchase-orders/new/page.tsx`, `src/app/(app)/purchase-orders/[id]/page.tsx`: icon-only actions and table alignment.

## QA checklist
1) Product detail form: sections are aligned, barcode add/remove does not shift layout, variant delete shows confirmation.
2) All list pages: icon-only actions show tooltips and stay aligned on mobile.
3) Validation messages appear without pushing layout.

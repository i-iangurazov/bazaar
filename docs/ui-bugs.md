# UI Bugs

## Print price tags modal shows fewer items than selected
- **Root cause:** the print queue was initialized from the current page (`productsQuery.data`) instead of the full selection set, so items selected across pages were missing. The queue list container also wasn’t a flex column, which prevented the scroll area from filling the available height.
- **Fix:** initialize the queue from `selectedIds` and fetch missing product details with `products.byIds`. Convert the queue wrapper to `flex min-h-0 flex-1 flex-col` and make the list `flex-1 min-h-0 overflow-y-auto` so it scrolls reliably.

### Manual QA
- Select 20 products (even across pages).
- Open “Print price tags”.
- Verify all 20 appear and the list scrolls.
- Search and confirm “Filtered: M of N”.
- Reorder and download PDF.

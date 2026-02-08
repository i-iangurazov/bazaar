# Responsive Data Lists Audit

Goal: keep dense tables on desktop and show card lists on mobile (<=768px) with prioritized fields and accessible actions.

## Pages audited

### Products
- P0 (mobile): name, SKU, status (active/archived), effective/base price, barcodes count, actions.
- P1 (tablet+): category, unit, stores count.
- P2 (desktop): full store pricing detail, secondary meta.

### Product Detail
- Bundle components P0: component name, variant, qty, remove action.
- Expiry lots P0: expiry date, on hand.
- Movement history P0: date, type, qty, user/note.

### Inventory
- P0 (mobile): product name + variant, SKU, on hand, min stock, low stock badge, actions.
- P1 (tablet+): on order, suggested order.
- P2 (desktop): planning detail rows (why/reorder breakdown).

### Inventory Movements (dialog)
- P0: date, type, qty, user, note.

### Users
- P0 (mobile): name, email, role, status, actions.
- P1 (tablet+): locale.
- P2 (desktop): full table columns.

### Invites
- P0 (mobile): email, role, status, expires at, created by.
- P1 (tablet+): none.
- P2 (desktop): full table columns.

### Purchase Orders
- P0: status, supplier, total, created/updated date, actions.
- P1: store.
- P2: received/approved details.

### Purchase Order Detail
- Lines P0: product, variant, ordered/received, actions.
- Receive dialog P0: product, remaining, receive qty, unit.

### Suppliers
- P0: name, contact, status, actions.
- P1: address/notes.
- P2: legal details.

### Stores
- P0: name, code, policy badges, actions.
- P1: phone/address/legal name.
- P2: full legal details.

### Units
- P0: code, labels, actions.
- P1: none.
- P2: full metadata.

### Attributes
- P0: key, labels, type, required, actions.
- P1: options count.
- P2: full metadata.

### Admin Jobs
- P0: job name, status, attempts, last error date, actions.
- P1: last error text.
- P2: full payload metadata.

### Stock Counts
- P0: store, status, variance counts.
- P1: created/applied by.
- P2: full audit details.

### Stock Count Detail
- Lines P0: product, variant, expected/counted/delta, actions.
- Movement history P0: type, qty, date, user.

### Exports
- P0: type, status, period, download action.
- P1: created by.
- P2: metadata/params.

### Period Close
- P0: period, closed at, status, download action.
- P1: none.
- P2: audit metadata.

### Reports (Stockouts / Slow Movers / Shrinkage)
- P0: product, store, variant, count/qty, last movement/user.
- P1: extra audit fields.
- P2: full desktop table columns.

### Imports
- History P0: date, source, rows/created/updated, status, rollback action.
- Preview P0: name, SKU, category, unit.

## Notes
- Mobile uses card lists with icon-only actions and localized tooltips.
- Desktop tables remain unchanged, wrapped in `overflow-x-auto` for safety.
- Actions align to a shared RowActions/IconButton system.

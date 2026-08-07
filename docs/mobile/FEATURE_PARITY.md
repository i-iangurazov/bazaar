# Feature parity

All clients use the same deployed Bazaar UI, APIs, permissions and business logic. “Native” means the same workflow plus device integration.

| Feature                            | Web                  | PWA                       | Android            | iOS                |
| ---------------------------------- | -------------------- | ------------------------- | ------------------ | ------------------ |
| Login/logout/session               | Yes                  | Yes                       | Yes                | Yes                |
| Dashboard                          | Yes                  | Yes                       | Yes                | Yes                |
| Products / edit / variants         | Yes                  | Yes                       | Yes                | Yes                |
| Inventory overview                 | Yes                  | Yes                       | Yes                | Yes                |
| Receiving / transfer / write-off   | Yes                  | Yes                       | Yes                | Yes                |
| Inventory count / movement         | Yes                  | Yes                       | Yes                | Yes                |
| POS / discounts / split payment    | Yes                  | Yes                       | Yes                | Yes                |
| Held/resumed receipt / shifts      | Yes                  | Yes                       | Yes                | Yes                |
| Barcode scan                       | Browser input/camera | Browser input/camera      | Native camera      | Native camera      |
| Orders / tracking / cancellation   | Yes                  | Yes                       | Yes                | Yes                |
| Customers / reports / integrations | Yes                  | Yes                       | Yes                | Yes                |
| Bazaar Guide                       | Yes                  | Yes                       | Yes                | Yes                |
| PDF/export open/share              | Browser              | Browser                   | Native share sheet | Native share sheet |
| Network awareness                  | Browser              | Browser                   | Native             | Native             |
| Haptics                            | No                   | Browser fallback only     | Native             | Native             |
| Push registration/deep link        | No                   | Web notification separate | Native foundation  | Native foundation  |
| Offline server mutations           | Rejected             | Rejected                  | Rejected           | Rejected           |

Offline sales are intentionally not claimed. Server-dependent mutations require connectivity and preserve the existing idempotency/retry contracts on reconnect.

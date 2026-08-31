import { authenticatedE2EAccounts, authenticatedE2EIds } from "./contract";

export const authenticatedSalesOrderAcceptanceFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  productId: authenticatedE2EIds.primaryProduct,
  productSku: "QA-BAZAAR-AUTH-PRIMARY",
  productName: "QA-BAZAAR Authenticated Product",
  additionalProduct: {
    id: "qa_bazaar_acceptance_product_additional",
    sku: "QA-BAZAAR-ACCEPTANCE-ADDITIONAL",
    name: "QA-BAZAAR Additional Order Product",
    unitPriceKgs: 75,
  },
  adminEmail: authenticatedE2EAccounts.admin.email,
  editableOrder: {
    id: "qa_bazaar_acceptance_order_editable",
    lineId: "qa_bazaar_acceptance_order_editable_line",
    number: "QA-BAZAAR-ACCEPTANCE-EDITABLE-ORDER",
    customerName: "QA-BAZAAR Editable Order Customer",
    initialQuantity: 2,
    addedQuantity: 3,
  },
  canceledOrder: {
    id: "qa_bazaar_acceptance_order_canceled",
    lineId: "qa_bazaar_acceptance_order_canceled_line",
    number: "QA-BAZAAR-ACCEPTANCE-CANCELED-ORDER",
    customerName: "QA-BAZAAR Canceled Customer",
    customerEmail: "qa-bazaar-canceled-order@auth-e2e.test",
  },
  createdOrder: {
    customerName: "QA-BAZAAR Browser Order Customer",
    customerEmail: "qa-bazaar-browser-order@auth-e2e.test",
    notes: "QA-BAZAAR browser order acceptance",
    quantity: 2,
    unitPriceKgs: 125,
  },
} as const;

import type { LegalCopy } from "./types";

export const enLegal: LegalCopy = {
  back: "Back to home",
  navigation: "Bazaar documents",
  contents: "On this page",
  draft: "Draft · local preview only",
  published: "Version dated 10 November 2026",
  paymentSystemsTitle: "Payment methods",
  paymentSystemsNotice:
    "Available payment methods and restrictions are shown on the provider page opened from your Bazaar invoice. Owning a card or bank app does not guarantee support for a particular method.",
  draftNotice:
    "Draft for review. Entrepreneur and Bakai KGS account details are prepared, and the support mailbox is verified. Public address, refund and receipt requirements are being clarified with GoPay. This is unpublished and is not an effective offer. Viewing this page does not enable payments.",
  missing: "To be completed from the entrepreneur's documents",
  sellerTitle: "Service provider details",
  sellerIntro:
    "The recipient of payment for access to Bazaar. These are the software seller's details, not those of stores using Bazaar.",
  sellerLabels: {
    legalName: "Full registered business name",
    entrepreneurName: "Entrepreneur's full name",
    taxId: "Tax identification number",
    registrationNumber: "Entrepreneur registration number",
    registrationDate: "Registration date",
    registrationAuthority: "Registration authority",
    registeredAddress: "Registered address",
    correspondenceAddress: "Address for correspondence",
    phone: "Business phone",
    email: "Support and correspondence email",
    bankName: "Bank",
    beneficiary: "Payment beneficiary",
    accountNumber: "Bank account",
    accountCurrency: "Account currency",
    bankCode: "Bank identification code (BIK)",
  },
  pricing: "Plans and features",
  privacy: "Privacy policy",
  documents: {
    offer: {
      title: "Public offer",
      description: "Terms for paid access to Bazaar software for managing a retail business.",
      sections: [
        {
          id: "parties",
          title: "1. Parties and subject",
          paragraphs: [
            "The provider is the individual entrepreneur identified in Service provider details. The customer is an individual entrepreneur or legal entity purchasing access to Bazaar for its business. An authorised representative acts on behalf of that customer.",
            "The provider supplies remote internet access to Bazaar for the paid period within the selected plan. The customer pays for that access and uses the software in its organisation. Payment does not transfer exclusive rights to the software.",
            "These terms concern a subscription to Bazaar. Product sales, payments from shoppers, refunds and obligations of the customer's stores towards their shoppers fall outside this offer.",
          ],
        },
        {
          id: "acceptance",
          title: "2. Choosing a plan and accepting terms",
          paragraphs: [
            "Before paying, the customer reviews the offer, refund rules, privacy policy, price and plan limits. For online payment, the customer selects a plan in the subscription section and expressly agrees to the offer before a payment link is created. Visiting the website or registering does not constitute consent to paid renewal.",
            "The agreement for the selected period is concluded upon verified successful payment following prior acceptance of the offer. The invoice record retains the amount, plan, provider name, terms version and terms link. A failed or incomplete payment does not create a paid period.",
            "Existing customers whose access is granted or renewed through support retain their agreed arrangements until separately agreed otherwise. Having an account does not automatically switch it to online billing.",
          ],
        },
        {
          id: "service",
          title: "3. What the service includes",
          paragraphs: [
            "Bazaar supports product and stock records, POS, orders, inventory operations and reporting. Available features and limits on stores, products and users depend on the selected plan, published under Plans and features and displayed in the account before payment.",
            "Hardware, fiscal services and external integrations may require compatible equipment, configuration, a separate agreement or payment to a third party. Paying for Bazaar does not itself activate every external service. AI features may make mistakes; verify financial and inventory decisions against source records.",
            "The service is delivered remotely; no physical goods are shipped. Internet access and a compatible browser are required. Contact the provider for access and setup questions.",
            "Add-ons accompany the selected plan and do not unlock another plan’s features. Starter cannot add stores; the total store limits with add-ons are 1, 5 and 15 respectively. One capacity reserve adds 1,000 product cards and two users; only one such pack may be active at a time. Products and people are counted across the organization and are not multiplied by store count.",
            "Included AI, image, email and external API allowances are shown in the plan. Monthly allowances renew monthly even when six or twelve months are prepaid. Processing reserves capacity before execution; failed operations release unused reservations. Automatic paid overages are not enabled.",
          ],
        },
        {
          id: "price",
          title: "4. Price and payment",
          paragraphs: [
            "Prices are in Kyrgyz som (KGS). The final amount and selected plan are shown before payment confirmation. If the price changes before invoice creation, the updated amount must be confirmed again. The price of an already paid period cannot be increased retrospectively.",
            "Access is purchased in one payment for a selected term of 1, 6 or 12 calendar months, when that term is available in the published plan. The discount, its application to extra capacity and the full amount are determined by the selected offer and shown before payment. There are no automatic charges or mandatory card saving.",
            "When online payment is available, the provider identified at confirmation and in the invoice history processes the transaction. Available payment methods and restrictions are shown on its payment page. Card details and bank verification codes are entered on the provider's side. The payer's bank determines any bank fees and currency conversion.",
          ],
        },
        {
          id: "period",
          title: "5. When access starts and ends",
          paragraphs: [
            "The paid period is recorded in the account after Bazaar's server verifies successful payment. Returning from the payment page alone is not proof of payment. If confirmation is delayed, check the invoice status or contact support instead of paying again.",
            "If an existing paid or trial period is still active, the new period starts after it ends. If access has expired, the new period starts after payment confirmation. Exact dates are displayed in the account. A month is not a fixed 30 days. Calendar boundaries are calculated in UTC: if the corresponding day does not exist in the following month, its last day is used. The account displays exact dates in the application time zone.",
            "Early renewal adds the selected term after existing access. An upgrade credits unused service value and preserves the end date; the additional payment is shown before confirmation. Plan and capacity reductions start next period if the selected capacity accommodates current usage. Changes across already prepaid future periods are arranged with support. Existing individual agreements and lifetime free access remain in force.",
            "New contracts provide seven calendar days to renew after a paid period ends, unless access has been cancelled or restricted on another basis. This does not extend an unpaid trial. After that grace period, creating and changing operational data is restricted; history is preserved, with available read access, obtaining your data and renewal remaining accessible. Expiry does not authorize a card charge or data deletion. Existing customers retain their agreed terms.",
          ],
        },
        {
          id: "responsibilities",
          title: "6. Using the software and support",
          paragraphs: [
            "The customer is responsible for staff permissions, the accuracy of entered records, account credentials and lawful processing of information uploaded to Bazaar. Access must not be shared with unauthorised people or used for unlawful purposes or attempts to compromise security.",
            "The provider supplies the agreed access, reviews reports of problems and takes steps to resolve them. If access is restricted because of a security threat, the customer is informed of the reason and recovery process unless disclosure would create a further threat or is prohibited by law.",
            "When reporting a problem, include the organisation, time, affected feature and invoice number if payment is involved. Do not send support passwords, full card numbers, CVV/CVC or one-time bank codes. Failure to provide the service and refund requests are addressed under the refund rules; these terms do not exclude liability imposed by law.",
          ],
        },
        {
          id: "refunds",
          title: "7. Cancellation and refunds",
          paragraphs: [
            "The customer may contact the provider about mistaken or duplicate payment, failure to provide the service and discontinuing its use. The Refund rules page explains requests, verification and repayment. Mandatory rights under applicable Kyrgyz Republic law remain unaffected.",
          ],
        },
        {
          id: "changes",
          title: "8. Changes and disputes",
          paragraphs: [
            "Updated terms are published with a new version and apply to new payments after the customer reviews them. Changes do not reduce an already paid period or introduce additional charges without the customer's consent.",
            "Kyrgyz Republic law governs the agreement. Send enquiries to the provider's listed contacts. If a dispute remains unresolved, the parties may use remedies provided by law. This offer does not restrict applicable jurisdiction or mandatory rights.",
          ],
        },
      ],
    },
    refunds: {
      title: "Refund rules",
      description:
        "How to enquire about subscription payments, cancellation and refunds for Bazaar.",
      sections: [
        {
          id: "scope",
          title: "1. Payments covered",
          paragraphs: [
            "These rules cover payment for access to Bazaar software. Stores using Bazaar handle refunds to their shoppers under their own agreements and rules.",
            "Each renewal requires a separate payment initiated by the customer. To stop renewal for the next period, do not create another payment. This does not cancel an existing payment or replace a refund request.",
          ],
        },
        {
          id: "grounds",
          title: "2. When to contact us",
          paragraphs: [
            "Contact the provider if payment was duplicated or made by mistake, the amount differs from the confirmed invoice, paid access was not provided or you wish to stop using the service.",
            "Duplicate money received for the same period and payment for a service not provided are refundable after verification. Payments for different months are not automatically technical duplicates: early renewal adds another period. Cancellation of a period that has not yet started is considered separately.",
            "When cancellation follows the start of service, the access actually provided and the grounds and amount for a refund are assessed under the agreement and applicable law. The provider supplies a reasoned calculation. Merely signing in to an account is not an unconditional ground to refuse every refund.",
          ],
        },
        {
          id: "request",
          title: "3. Submitting a request",
          paragraphs: [
            "Write to the provider's business email or call the phone number listed under Service provider details. Include the organisation and account email, invoice or payment number, date, amount and reason. If needed, attach payment confirmation with unnecessary personal and banking information concealed.",
            "Do not send passwords, full card numbers, CVV/CVC or one-time bank codes. If further information is necessary to verify the requester's authority or the payment, support will explain its purpose and a secure way to provide it.",
          ],
        },
        {
          id: "review",
          title: "4. Review and timing",
          paragraphs: [
            "The provider reviews the request within 10 business days of receipt: checks the invoice, provider status and access supplied, and communicates the result and justification of the amount. Following a refund decision, the provider submits the operation to the payment provider within 3 business days. Any shorter statutory review or refund deadline takes precedence. Requests for further information do not automatically extend mandatory deadlines.",
            "The time for funds to reach the account after a refund is processed depends on the payment provider and the payer's bank. The provider supplies confirmation once the refund is processed. If funds do not arrive, contact your bank with that confirmation and inform the provider.",
          ],
        },
        {
          id: "method",
          title: "5. How refunds are made",
          paragraphs: [
            "Refunds reference the original transaction and require verification of the payer and recipient. The available process is agreed with GoPay and the bank for that payment. Funds are not sent to an arbitrary third party. If the original account is unavailable, the process is agreed with the provider and bank after verifying the recipient.",
            "A partial refund is processed if the amount is justified and the provider supports it for that transaction. Full or partial repayment is determined by the request's circumstances and applicable law. Receiving a request does not mean repayment has already occurred; processing is confirmed separately.",
            "The effect of a refund on its corresponding paid period is agreed and recorded separately. Transaction history and other periods must not be changed without grounds. The Bazaar account has no automatic self-service refund button: the service provider handles the request. Cancelling an unpaid invoice stops awaiting payment and does not refund money.",
          ],
        },
        {
          id: "rights",
          title: "6. Disputes",
          paragraphs: [
            "If you disagree with the review outcome, send clarifications and supporting evidence to the provider. Rights to contact a bank, competent authority or court as provided by law remain intact. These rules do not waive mandatory guarantees or deadlines under Kyrgyz Republic law.",
          ],
        },
      ],
    },
    requisites: {
      title: "Business details and contacts",
      description:
        "The seller of access to Bazaar and contacts for support, contractual enquiries and refunds.",
      sections: [
        {
          id: "seller",
          title: "Who provides Bazaar",
          paragraphs: [
            "The individual entrepreneur identified below provides access to the software. Bazaar is the software brand; the named entrepreneur is the contracting party and payment recipient.",
            "All new online purchases of Bazaar services use GoPay in Kyrgyz som (KGS). Previously created FreedomPay invoices remain in the history with their original provider. The payment provider is identified on the invoice and does not replace the seller's details. The stores of Bazaar users are also not the sellers of the Bazaar subscription.",
          ],
        },
        {
          id: "contact",
          title: "What to contact us about",
          paragraphs: [
            "Use the business phone and email below for access, setup, payments, documents and refunds. Include the organisation and a short description; add the invoice number and date for payment questions.",
            "Bank details identify the service provider and support document preparation. Do not transfer money using them instead of paying a generated invoice without a separate arrangement: such a transfer is not an automatically verified online payment in Bazaar.",
          ],
        },
      ],
    },
    payment: {
      title: "Subscription payment",
      description:
        "Paying for a month, six months or a year of Bazaar access through the connected payment provider and checking the result.",
      sections: [
        {
          id: "before",
          title: "1. What you are paying for",
          paragraphs: [
            "Payment covers 1, 6 or 12 calendar months of Bazaar access on the selected plan with the chosen extra capacity. Prices are in Kyrgyz som (KGS). Compare features and limits on the plans page; the full amount and discount appear in the account before confirmation.",
            "This pays for business software, not purchases by shoppers at a store's POS. Online payment is available only with acquiring connected and for organisations eligible for this renewal method. If no payment button is available, contact support; do not pay through somebody else's account.",
          ],
        },
        {
          id: "steps",
          title: "2. How to pay",
          paragraphs: [
            "Open the organisation's subscription section using an account authorised to manage the subscription. Select an available plan, check the amount and review the offer and refund rules. Accept the offer and continue to payment.",
            "Bazaar creates a KGS invoice and opens GoPay. On a computer, scan the displayed QR code with a supported banking app; on a phone, select an available banking app on GoPay. Check the recipient and amount in your bank before confirming. GoPay and the bank determine app availability. You do not need to link a card to Bazaar.",
            "Payment links expire; the account shows the deadline. If a link expires, first check the original invoice status. Contact support about an incomplete or disputed operation before creating another payment.",
          ],
        },
        {
          id: "result",
          title: "3. Checking the result",
          paragraphs: [
            "After payment, return to Bazaar and check the invoice status and access dates in the subscription section. Access is extended after server-side verification of successful payment with the provider identified on the invoice. A browser message, transfer screenshot or success-page redirect alone is not confirmation.",
            "If the bank charged you but the invoice still awaits confirmation, check its status in the account or contact support with the invoice number. Do not pay again until the first transaction's result is established. Bank-declined or cancelled payments do not add a paid period.",
          ],
        },
        {
          id: "renewal",
          title: "4. Renewal",
          paragraphs: [
            "If a paid or trial period is still active, the selected term is added after it ends. Without an active period, it starts after payment confirmation. The account displays exact start and end dates.",
            "Early renewal adds the selected term after existing access. An upgrade credits unused service value and preserves the end date; the additional payment is shown before confirmation. Plan and capacity reductions start next period if the selected capacity accommodates current usage. Changes across already prepaid future periods are arranged with support. Existing individual agreements and lifetime free access remain in force.",
          ],
        },
        {
          id: "security",
          title: "5. Security and refunds",
          paragraphs: [
            "Use bazaar.kg and the GoPay page opened from the invoice in your account. Confirm payment in your own banking app. Do not disclose passwords, PINs or one-time bank codes to support staff or send them in messages.",
            "For mistaken payment, access not provided or service cancellation, follow the refund rules and contact the service provider. A refund follows verification of the original transaction; receiving the request is not the same as the bank crediting the money.",
          ],
        },
      ],
    },
  },
};

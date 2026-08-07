# Bazaar Guide — reference patterns

Reviewed 8 August 2026. These notes describe interaction patterns only; Bazaar does not copy wording, branding, assets, or source code.

## Patterns worth adapting

| Reference                                                                                                                                                       | Useful pattern                                                                                                      | Bazaar adaptation                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [Shopify Help Center — Getting started](https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-getting-started)                                | A short ordered path to the first useful outcome, platform-specific steps, and a clear next action.                 | Six visible milestones from store selection to first analytics result, with progress stored locally until server-side progress is justified. |
| [Shopify POS launch checklist](https://help.shopify.com/en/manual/intro-to-shopify/shopify-pos-launch-checklist)                                                | Checklist framing, prerequisites before action, and links that preserve a learning sequence.                        | A lightweight Bazaar start path and role shortcuts rather than one long onboarding article.                                                  |
| [Square — View, receive, and adjust inventory](https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app)                           | Task names match merchant language; “before you begin,” short numbered steps, and related actions are easy to scan. | Bazaar guides use 3–7 steps, visual checklists, one concrete success state, and 2–4 related guides.                                          |
| [Square — Start and end a cash drawer session](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)                                | One article follows a real operating sequence and clearly separates prerequisites from the action.                  | Shift guides distinguish opening balance, cash movements, actual cash, and closing without introducing implementation terms.                 |
| [Lightspeed Retail Help Center](https://retail-support.lightspeedhq.com/hc/en-us/)                                                                              | Search dominates the first screen, common searches are suggested, and categories remain available below it.         | “Как вам помочь?” is the primary control; aliases cover notebook-era customer wording such as “закончить день” and “X отчёт.”                |
| [Lightspeed — Using the Help Center](https://retail-support.lightspeedhq.com/hc/en-us/articles/16726482037275-Using-the-Lightspeed-Retail-R-Series-Help-Center) | Predictive results appear before submit and category browsing is a fallback, not the first obstacle.                | Bazaar search is instant, keyboard-friendly, fuzzy enough for common wording, and reports zero-result queries without collecting identity.   |
| [Lightspeed — Inventory counts](https://retail-support.lightspeedhq.com/hc/en-us/articles/229129948-Performing-inventory-counts-in-Retail-POS)                  | Explains the business meaning before the clicks and warns about the one irreversible misunderstanding.              | Each inventory guide starts with one sentence explaining stock impact and keeps warnings next to the step where they matter.                 |

## Bazaar Guide rules derived from the review

1. Start with the customer’s task, not Bazaar’s module name.
2. Keep normal guides to 3–7 steps and one primary outcome.
3. Put a real annotated Bazaar screen beside the action it explains.
4. Offer role tracks as shortcuts only; never hide information.
5. Search titles, aliases, keywords, and step headings; tolerate everyday wording.
6. Keep prerequisites, warnings, and troubleshooting short and local to the task.
7. End every guide with the app CTA, related next actions, and a support escape hatch.
8. Keep the public portal independent of authenticated application layout and business logic.

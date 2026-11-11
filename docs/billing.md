# Billing, invoices and wallets

## Hosting prices

Products have a standard billing term and can offer extra day/week/month/year terms, one-time purchases and free service. Configurable options can add quantities, choices, checkboxes or validated text. Setup fees appear on the first invoice and do not renew.

Admin → Pricing defines exact country/currency price books. When enabled, customer billing country selects an eligible price book. This is explicit pricing, not an automatic exchange-rate feed. Every service retains its purchased term, recurring amount, currency and selected configuration.

Coupons can be percentage/fixed and scoped by products, countries, currencies, dates, first-order restrictions and limits. Fully discounted orders settle without collecting money. Tax is calculated after the applicable discount; setup fees are not discounted.

## Invoice lifecycle

An invoice records seller/buyer billing details, line items, prices, discount and tax at issue time. Later company/profile edits do not rewrite that snapshot. Numbered references, PDF downloads and browser printing are available.

A customer can combine several hosting plans in one checkout/invoice. Capacity is reserved atomically: unavailable stock/resources roll back the whole checkout. Items must share a checkout currency. Services provision only after the entire invoice balance is covered, then renew independently.

Staff can issue ad-hoc invoices and record verified offline receipts. Partial wallet/offline/gateway receipts do not erase the outstanding balance. Overpayments and receipts for cancelled/voided periods remain recorded for staff reconciliation; they do not automatically reactivate services.

## Wallets

Wallets keep separate balances by currency. Customers can pay eligible invoices from the matching currency balance or request funding. A funding invoice cannot pay itself from wallet funds.

Manual deposit requests are claims, not credits. Staff approve only after verifying funds and entering a unique external transaction reference. Concurrent payments cannot overdraw a balance or over-allocate an invoice. Configurable deposit and balance caps apply; receipts that cannot be safely credited are held for reconciliation.

Automatic wallet renewal payments require both the company setting and the customer's explicit opt-in, with sufficient balance in the invoice currency. This is separate from saved-card recurring gateway billing, which is not implemented.

## Renewals and cancellation

Recurring hosting uses its saved billing term. One-time/free contracts do not renew. The grace period leads to suspension, not automatic permanent deletion. Customer account suspension and service suspension are separate administrative controls.

Customer cancellation requests require staff review. Approved requests stop renewal at the cutoff and can schedule provider deletion; withdrawal is allowed before the applicable cutoff. Data deletion requires confirmation. Refunds and reconciliation are separate workflows and are not performed by merely cancelling a service.

## Email and gateways

Configure SMTP in Settings and enable automatic invoice PDFs when desired. Enabling delivery does not mail the entire invoice history. Staff can send an invoice manually and inspect its delivery history.

Configure Stripe/PayPal credentials and webhook verification, then test sandbox settlement, duplicate delivery and failures before live use. A browser success page is not payment proof: the backend waits for verified settlement. Payment methods, tax policies and accounting obligations remain the operator's responsibility.

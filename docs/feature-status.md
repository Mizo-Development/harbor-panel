# Feature status

Harbor is an early self-hosted release. This describes implemented workflows, not a guarantee that every provider configuration or external billing environment has been certified.

## Implemented

- Administrator/customer workspaces and optional storefront, dark/light appearance, responsive layouts and branding.
- Account registration/login, TOTP, sessions, recovery/verification, customer billing profiles and staff customer management.
- Products, categories, stock/ownership limits, configurable billing terms/options, coupons, country/currency price books and atomic combined checkout.
- Numbered invoices, immutable billing/tax snapshots, PDFs, partial receipts, wallet ledgers/funding, manual receipts, verified Stripe/PayPal settlement and reconciliation flags.
- Renewals, configurable automation, suspension, staff-reviewed cancellation and durable hosting operations.
- Direct Wings provider, PTDL v1/v2 egg import/assignment, automatic stable Paper resolution/checksum installation, console, files, backups, SFTP details and isolated node enrollment.
- Proxmox QEMU/LXC, Plesk and native-agent integration contracts; verify your host, templates and permissions before selling services.
- Support threads, departments, staff assignment, private notes and attachments.
- SMTP configuration, selected notification templates/preferences, invoice email outbox, metadata/audit logs and system monitoring.
- Scoped customer/admin API keys, expiry/CIDR controls, rotation/revocation, OpenAPI and extension/theme SDKs.

## Not implemented

- Full Paymenter feature parity or compatibility with all Paymenter/Pterodactyl plugins.
- Trials, prorated upgrades/downgrades and in-place purchased option changes.
- Saved payment methods, recurring gateway collection and automated gateway refunds.
- Full accounting credit/debit notes and arbitrary cross-invoice receipt reallocation.
- Fine-grained staff roles, OAuth/social login, affiliate payouts and full UI translations.
- Domain registration, Windows VPS, provider-to-provider migration and additional unlisted provider/gateway adapters.
- A public plugin marketplace and automatic application update administration.

## Validation boundary

Local unit/integration/browser checks validate implemented code paths. Provider fixtures and mocked node-install tests do not prove that every game egg, operating system, TLS/firewall layout or provider version works. Test one complete sandbox order, provision, console/file operation, suspension/restore and cancellation with your own infrastructure before accepting customers.

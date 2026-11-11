# First steps

Complete [installation](installation.md) and create the administrator account at `/setup` before configuring hosting.

## 1. Configure the company

Open **Admin → Settings**. Set the company name, billing identity, address, tax/registration details, payment instructions and invoice footer. New invoices snapshot these details; editing them does not rewrite issued invoices.

In Branding, upload a logo, choose the accent, dark/light default, density and motion preference. Configure SMTP and send a test email. Registration, maintenance, customer email verification and staff two-factor requirements live under Security. Enable staff TOTP on your account before requiring it globally.

The storefront can be enabled or disabled independently of existing customer dashboards.

## 2. Connect infrastructure

Open **Infrastructure** and add the provider connection. Credentials are encrypted with this installation's encryption key. Run the actual connection check; a draft/unavailable connection cannot be used to accept new hosting orders.

- **Wings:** choose unused management/SFTP ports and game allocations. Generate the install command for the target VPS, run it there, then verify the result. Import trusted eggs under Game eggs when the built-in Paper template is insufficient.
- **Proxmox:** configure nodes, guest storage, network bridge, templates, IP pools and locations. Prepare suitable QEMU cloud-init or LXC templates in Proxmox first.
- **Plesk:** configure a valid API connection, hosting IP and Plesk service plans.
- **Native web:** deploy/configure the separate agent following the provider guide.

Do not assign one IP/port allocation to multiple game servers or providers. Node firewalls and provider security groups must permit the selected ports.

## 3. Create a hosting plan

Open Products and create a draft. Choose its provider, connection, resources, price, billing term, category and visibility. Configure stock/per-customer limits where appropriate.

For game plans, select an egg, one of its runtime images and validated defaults. Paper defaults to the latest stable release at install/reinstall and verifies its official checksum. A normal power restart keeps the installed JAR. Service assignment snapshots preserve purchased settings when you later edit the plan or egg.

Use Configure options for additional billing terms, setup fees and configurable resource/text choices. Regional prices are explicit country/currency amounts, not live exchange-rate conversions. Enable exact regional pricing in settings only after creating the corresponding price books.

Publish the plan only after the assigned connection is healthy and the workload has been tested.

## 4. Configure billing and publish

Configure Stripe/PayPal or offline payment methods. Set the company's tax policy, invoice due dates, renewal lead time and grace/suspension rules. Use sandbox accounts for your first payment validation.

Customers complete their billing profile before ordering real hosting. Checkout reserves capacity and issues the invoice; provisioning starts after full verified payment. Partial receipts remain recorded and do not prematurely provision hosting.

## 5. Customer operations

Customers can manage their own services, invoices, wallets and support tickets. Game service pages include console, files, startup variables, backups and SFTP details. Uploads are limited to 100 MiB per file; use SFTP for larger transfers. Startup variable edits apply on the next reinstall.

Reinstall and restore can replace game data. Use service backups before these operations. Panel database backups do not back up remote game/VPS/web workloads.

## 6. Staff operations

Customers can be edited or suspended from their record. Suspension revokes sessions and blocks new starts/orders while preserving billing/history. Cancellation requests require staff review before provider deletion; cancellation is separate from refund/reconciliation.

System shows operation errors, worker heartbeat, maintenance, metadata logs and audit history. Investigate failed operations before retrying. API access supports scoped customer/admin keys; choose only the permissions needed by the integration.

Further reading: [billing](billing.md), [providers](providers.md), [operations](operations.md), [API](api.md).

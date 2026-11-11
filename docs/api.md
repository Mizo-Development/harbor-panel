# Harbor API

Use your own panel hostname. The examples use this base URL: `https://panel.example.com/api/v1`.

Interactive reference and OpenAPI schema: [API documentation](https://panel.example.com/api/docs) and [OpenAPI JSON](https://panel.example.com/api/docs-json). Supported operations declare `apiKey` bearer authentication and `x-harbor-scopes` metadata. API requests use the same pricing, ownership, payment and provisioning rules as the dashboard.

## Create a key

Customers open **API keys** in their dashboard. Administrators open **API access**, where they can create customer keys for their own resources or admin keys for company operations. Select only the permissions required, choose a lifetime (7–365 days in the UI), optionally restrict source IPv4/IPv6 addresses/CIDRs, and confirm the current password and authenticator code when enabled.

Save the secret immediately: it is shown once. Only its SHA-256 hash and masked prefix are stored. Keys are server-side credentials; store them in environment variables or a secret manager, and keep them out of browser bundles, source control, URLs and application logs. This API does not enable cross-origin browser access to bearer keys.

Send the complete key in a header:

```sh
export HARBOR_API_URL='https://panel.example.com/api/v1'
# Set HARBOR_API_KEY privately to the secret shown by the dashboard.
curl --fail --silent --show-error \
  -H "Authorization: Bearer $HARBOR_API_KEY" \
  "$HARBOR_API_URL/services"
```

Customer keys start with `hbr_c_`; admin keys start with `hbr_a_`. A customer key issued by an administrator still acts as a customer and can only access that administrator's own resources. An admin key requires its owner to remain an administrator. Ownership and scope checks run on every request. Providing an invalid bearer key never falls back to an accompanying session cookie.

## Responses and limits

Successful responses use `{ "data": ... }`; errors use `{ "error": { "message": "...", "code": 403 } }`. Some existing endpoints include validation details. IDs are opaque strings; monetary values are integer minor units in the returned currency. Do not combine amounts in different currencies.

- `401`: invalid, expired, revoked or credential-invalidated key.
- `403`: missing scope, IP restriction, suspended account, maintenance policy or a session-only endpoint.
- `404`: resource missing or inaccessible to the customer.
- `409`: changed quote, insufficient availability or another state conflict.
- `429`: rate limit; honor `Retry-After`. Limits are 120 requests/minute per key and 300 requests/minute per source IP across API v1. Shared source IPs share that IP budget. Key issuance/rotation has a separate limit of 30 password confirmations per account per 15 minutes. Login authentication retains its source-IP limit; revocation does not consume the password-confirmation budget.

Each account can keep 20 unrevoked, unexpired keys. Lifetimes are 1–365 days through the API. Each request gets `X-Request-ID`; HTTP metadata records the key ID and owner, without credentials, headers, query strings or request bodies. Key metadata shows last use and its source IP.

Rotation requires a dashboard session and password/TOTP confirmation, retains scopes and IP restrictions, and revokes the old key atomically. Revocation takes effect on subsequent requests. It does not cancel already queued operations or retract provider console/SSO and machine-enrollment grants issued earlier; those retain their own expiry and revocation lifecycle. Suspending an account blocks API access; restoring it permits still-valid keys again. Password resets/replacements, email changes and TOTP changes invalidate existing keys. Staff can inspect account keys and revoke a compromised integration with an audit reason.

## Customer API

| Work              | Endpoints                                                                                       | Permissions                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Identity          | `GET /auth/me`                                                                                  | Any valid key; identifies its effective role                                   |
| Available hosting | `GET /catalog/products`, `/products`, `/catalog/categories`                                     | `catalog:read`                                                                 |
| Profile           | `GET /profile`, `PATCH /profile`                                                                | `profile:read`, `profile:write`                                                |
| Services          | `GET /services`, `/services/:id`, `/services/:id/usage`, `/services/:id/operations`             | `services:read`                                                                |
| Power             | `POST /services/:id/actions` with `start`, `stop`, `restart`                                    | `services:control`                                                             |
| Game console      | Action `console.tail`; action `console.send` or `POST /services/:id/console`                    | `services:read`; `services:console`                                            |
| Files             | Action `files.list`, `GET /services/:id/files/content?path=...`; `POST` to the content endpoint | `services:files:read`; `services:files:write`                                  |
| Backups           | `GET /services/:id/backups`; actions `backup`, `restore`                                        | `services:backups`                                                             |
| Reinstall         | Action `rebuild`                                                                                | `services:rebuild`                                                             |
| Web management    | `POST /services/:id/database`, `/certificate`, `/panel-login`                                   | Respective `services:database`, `services:certificate`, `services:panel-login` |
| Orders            | `POST /orders/quote`, `/orders`; cart edit/checkout and cancellation requests                   | `orders:write`                                                                 |
| Cart/history      | `GET /cart`, `/cancellations`, `/services/:id/cancellations`                                    | `orders:read`                                                                  |
| Invoices          | `GET /invoices`, `/invoices/:id`, `/invoices/:id/pdf`                                           | `invoices:read`                                                                |
| Pay invoices      | `POST /invoices/:id/wallet-payment`, `/checkout`, `/paypal/capture`                             | `invoices:pay`                                                                 |
| Wallet            | `GET /wallet?currency=USD`                                                                      | `wallet:read`                                                                  |
| Funding           | `POST /wallet/topups`, `/wallet/funding-invoices`; void an eligible funding invoice             | `wallet:fund`                                                                  |
| Support           | Ticket/department/attachment reads; create/reply/update tickets                                 | `support:read`, `support:write`                                                |

Changing automatic wallet renewal consent through `PATCH /profile` requires both `profile:write` and `invoices:pay`.

Permissions do not bypass normal provider availability, billing-address requirements, email verification, service status, suspension, resource availability or ownership. A customer cannot terminate or suspend another service, impersonate staff, or access an administrator endpoint. Destructive operations retain the dashboard's service-name confirmation requirement. Wings console tickets include power controls only when the key also has `services:control`. Browser Proxmox/noVNC consoles require a dashboard session; API power/usage operations and Wings console access remain available with their scopes.

Example power operation, with one UUID retained for retries:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $HARBOR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"action":"restart","idempotencyKey":"09f4528b-a5cd-4b45-8d0d-a1615e7ab25a"}' \
  "$HARBOR_API_URL/services/SERVICE_ID/actions"
```

Service operations usually return an `operationId` and run asynchronously. Poll `GET /services/:id/operations` or service status. A repeated operation UUID returns its existing result; changing the action or service with the same key is rejected.

To purchase, first `POST /orders/quote` with `{ "productId": "..." }` and any selected `planId`, `options` or `couponCode`. Submit `POST /orders` with those selections, a new `idempotencyKey`, and `expectedQuoteId` from the quote. An order returns its invoice and service IDs. Pay the invoice separately; paid fulfillment is unchanged. Retain the same idempotency key when retrying a timed-out creation request.

## Admin API

Admin keys operate across customer accounts only within their selected scopes.

| Work                                                                                    | Scope family                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Customer reads, creation/edits, suspension/restoration                                  | `admin:customers:read`, `admin:customers:write`                |
| Customer password replacement/session revocation                                        | `admin:customers:security`                                     |
| All services, power/console, destructive actions, files, backups and credential actions | Separate `admin:services:*` scopes                             |
| All order/cancellation reads; order creation for a customer and cancellation review     | `admin:orders:read`, `admin:orders:write`                      |
| Invoice/payment/wallet/tax reads and billing writes                                     | `admin:billing:read`, `admin:billing:write`                    |
| Product/option/category/coupon/regional price administration                            | `admin:catalog:read`, `admin:catalog:write`                    |
| Nodes/locations/allocations and Proxmox inventory; editing them                         | `admin:infrastructure:read`, `admin:infrastructure:write`      |
| Remote Wings installer issuance/revocation; reading daemon credentials                  | `admin:infrastructure:install`, `admin:infrastructure:secrets` |
| Ticket, staff-note and support-department administration                                | `admin:support:read`, `admin:support:write`                    |
| Company/branding/email settings and templates                                           | `admin:settings:read`, `admin:settings:write`                  |
| System status/logs; maintenance and operation retries                                   | `admin:system:read`, `admin:system:write`                      |
| Dashboard reports/audit history                                                         | `admin:reports:read`                                           |

Customer creation uses `POST /customers`, for example:

```json
{
  "name": "Example customer",
  "email": "customer@example.com",
  "password": "use-a-unique-long-password",
  "billingAddress": {
    "line1": "10 Example Road",
    "city": "London",
    "postalCode": "SW1A 1AA",
    "country": "GB"
  }
}
```

This always creates a customer, never a staff account, and does not sign that customer in. Role promotion and staff creation are unavailable through this endpoint. Do not send the password by email.

Place an order for an existing customer with `POST /customers/:id/orders/quote`, then `POST /customers/:id/orders`. The quote/order bodies match their customer counterparts. Customer ownership, address, eligibility, prices, tax snapshots and billing contracts are preserved. The order audit identifies the acting administrator and API key, plus its customer. `GET /orders` is the staff order list.

Admin service `terminate`, `rebuild` and `restore` require `admin:services:destructive`; power/suspension/console uses `admin:services:control`. Files and database/SSO credentials have separate high-privilege scopes. A general infrastructure read key cannot retrieve Wings daemon configuration.

Key management, the owner's login/password/TOTP endpoints, extension installation/configuration/arbitrary plugin routes and Proxmox browser-console grants remain dashboard-session operations. Unknown endpoints are denied to keys by default; future features must explicitly declare a scope. Existing machine-enrollment and provider/webhook credentials use their dedicated protocols, not user API keys.

## JavaScript and Python examples

```js
const response = await fetch(`${process.env.HARBOR_API_URL}/services`, {
  headers: { Authorization: `Bearer ${process.env.HARBOR_API_KEY}` },
  signal: AbortSignal.timeout(15000),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
console.log(result.data);
```

```python
import json, os, urllib.request
request = urllib.request.Request(
    os.environ['HARBOR_API_URL'] + '/services',
    headers={'Authorization': 'Bearer ' + os.environ['HARBOR_API_KEY']}
)
with urllib.request.urlopen(request, timeout=15) as response:
    services = json.load(response)['data']
print(services)
```

Use the account's API key options page or OpenAPI `x-harbor-scopes` metadata for the currently supported permissions. API keys authenticate service-to-service requests; OAuth/social login and delegated authorization flows are separate work.

## Game eggs and files

Admin catalog keys can read `GET /admin/eggs` with `admin:catalog:read`, and import/update `POST /admin/eggs`, `PATCH /admin/eggs/:id` with `admin:catalog:write`. The body is `{ "nest": "Minecraft", "definition": <PTDL JSON object>, "reviewedScript": true, "archived": false }`. Product `gameConfig` accepts `{ "eggId": "...", "image": "<egg-listed image, optional>", "variables": { "MINECRAFT_VERSION": "latest" } }`. Omit it for automatic Paper. Egg scripts and hidden values are admin-only; orders snapshot the assignment.

`GET /services/:id/startup` uses service read permission and exposes only visible variables for customers. `PATCH /services/:id/startup` takes `{ "variables": { "MINECRAFT_VERSION": "latest" } }` and requires `services:startup` or `admin:services:control`. These values apply on reinstall, which retains its separate destructive permission.

File routes enforce ownership and require an active Wings service:

| Route                                                        | Body                                                       | Customer scope         |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------- |
| `GET /services/:id/files/download?path=/plugins/example.jar` | Binary attachment response, streamed                       | `services:files:read`  |
| `POST /services/:id/files/upload?directory=/plugins`         | Multipart field `file`, up to 100 MB, one file per request | `services:files:write` |
| `POST /services/:id/files/operations`                        | JSON below                                                 | `services:files:write` |

Admin equivalents use `admin:services:files`. Operations take `directory` (default `/`) and an `action`: `create-file` / `create-folder` use `name`; `rename` uses `name` and `target`; `copy` / `decompress` use `name`; `compress` uses `files`; `delete` uses `files` and `confirmation: "DELETE"`. Names must be single path components and traversal is rejected. Uploads replace existing files with the same name. Downloads use a binary response rather than a JSON envelope.

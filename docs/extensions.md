# Plugins and themes

Harbor SDK 1.0 supports trusted backend plugins, provider and gateway adapters, event listeners, authenticated routes, pages, UI slots, and theme layouts. Extensions execute with application privileges. Declared permissions describe access for administrators; they are not a sandbox.

## Package layout

Upload a gzip tar archive with `harbor.json` at its root. The manifest defines an ID, semantic version, SDK range, type, declared permissions, and dependencies. Plugins have a bundled CommonJS `dist/index.js`; frontend modules have an optional `ui/index.tsx`. Themes additionally supply `theme.json` with validated CSS tokens and supported areas. Dependencies must already be installed and enabled; bundle runtime backend dependencies instead of shipping installation scripts.

```sh
npm run build -w @harbor/sdk
node scripts/package-extension.mjs examples/plugins/hello
node scripts/package-extension.mjs examples/themes/harbor-custom
```

Upload through Admin → Extensions/Themes. Packages install disabled. Enable after review. For frontend extensions, run `npm run extensions:build` from the project root, then restart frontend, API, and worker. Backend plugins activate at process startup. Docker deployments use `scripts/rebuild-extensions.sh`.

## SDK

Backend entries export `activate(context)` and optionally `deactivate()`. Register providers and gateways under the extension’s own ID. Provider capabilities determine available controls. `registerRoute` accepts GET/POST/PATCH/DELETE, one path segment, an `admin` flag, and a handler. Routes live at `/api/v1/extensions/<id>/routes/<segment>` and receive an authenticated user, body, and query. Use SDK types in `packages/sdk/src/index.ts`.

Events: `service.created`, `service.updated`, `invoice.paid`. Listener failures do not roll back a paid invoice. Handlers must be idempotent and avoid long synchronous work.

Frontend modules export `pages`, `slots`, and/or `ThemeLayout`. Pages define area, label, and component and appear at `/extensions/<id>/<slug>`. `ThemeLayout` receives area, settings, user, and children and may replace the whole rendered layout. Preserve navigation and accessibility when doing so. The `sidebar.navigation` slot is currently available; new slots are additive SDK changes. Customer-facing plugins must perform ownership checks in their own backend handlers where they access resources beyond the supplied user.

The frontend registry is generated at build time, never by evaluating JavaScript received from a browser request. Custom frontend dependencies must be bundled or included in the host build environment. Validate with `npm run extensions:build` before restarting services. Disabled frontend modules are omitted on the next build and hidden immediately by the enabled-extension list.

## Upgrades and rollback

Upload a higher semantic version to stage an upgrade. Previous release directories are retained. Build the frontend before restarting services. If the build fails, keep the running frontend and call `POST /api/v1/extensions/<id>/rollback`, rebuild, then restart. The endpoint restores the previous manifest and directory. This restores application code, not arbitrary database changes performed by trusted plugins; take a database backup before installing or upgrading third-party code. The v1 SDK does not automatically run plugin database migrations.

Providers with existing services and gateways with unpaid checkouts cannot be disabled. Themes must be deselected before disabling. Default Harbor remains available as the fallback. Public marketplace discovery and installation are outside this release.

## Purchased configuration metadata

Provider plugins receive the service's purchased `plan` resource limits, not the current product defaults. `service.metadata.configuration` is an immutable array of `{id, key, name, kind, value, choiceId, choiceName, amount, setupFee, quantity, unitAmount}` records. Use stable property keys for custom integration behavior; the built-in bindings handle supported resource fields. These properties are ordinary configuration values, not encrypted credential storage.

`service.metadata.billingContract` records `{id, name, type, unit, period, label, amount, setupFee, currency}` for the selected offer. `type` is `RECURRING`, `ONE_TIME`, or `FREE`. Recurring dates use the public SDK's `calculateDueDate(start, {unit, period})`; its older `monthly` and `annual` arguments remain supported. `metadata.pricingLines` preserves recurring plan/option lines for invoice snapshots. Plugins must not mutate historical invoice or wallet records to implement plan changes.

Storefront themes should request `GET /api/v1/catalog/products` (or the `useProducts` frontend hook). It applies public visibility rules even when a staff member is signed in. `GET /api/v1/products` is also used by administration and returns drafts to administrators. A billing contract's `amount`/`setupFee` describe its selected base plan; option charges are stored separately in configuration records, and the service recurring total includes applicable recurring discounts.

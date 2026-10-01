# Tenax Grupa – Outlook Signature Service (Build Brief for Claude Code)

## 1. Goal

Build a service that automatically inserts the correct company-branded email signature in Outlook for every Tenax Grupa employee, across:

- New Outlook for Windows
- Classic Outlook for Windows (Microsoft 365 Apps)
- Outlook on the web (OWA)
- Outlook for Mac
- Outlook mobile (iOS/Android), where event-based add-ins are supported

The work has two parts:

1. **Signature API + admin UI** (`sig.tenaxgrupa.lv`). It resolves who the user is, which company they belong to, and what their signature data is, then renders HTML from a per-company template.
2. **Outlook add-in** using event-based activation (`OnNewMessageCompose`, `OnNewAppointmentOrganizer`, `OnMessageFromChanged`). It fetches the rendered signature and inserts it with `setSignatureAsync`.

Start with a **local mock mode** and a **test user sample**. Do not touch production users until the pilot phase.

---

## 2. Environment facts

| Item | Value |
|---|---|
| M365 tenant | `TenaxMID.onmicrosoft.com` |
| Mail domain | `tenaxgrupa.lv` (all 4 companies share it) |
| Identity | Hybrid: on-prem AD synced to Entra ID via Entra Connect |
| Signature host | `https://sig.tenaxgrupa.lv` (TLS required) |
| Admin running this | Global Administrator |

**Important consequence of hybrid identity:** attributes such as `jobTitle`, `mobilePhone`, `department` and `companyName` are **mastered in on-prem AD** for synced users. They **cannot be written via Graph**. The service must therefore keep its **own override store** for signature data and never try to write back to Entra.

---

## 3. The four companies

| Key | Legal name | Security group (proposed) |
|---|---|---|
| `tenax` | SIA "Tenax" | `SG-Signature-Tenax` |
| `tenapors` | SIA "Tenapors" | `SG-Signature-Tenapors` |
| `tenaxpanel` | SIA "Tenax Panel" | `SG-Signature-TenaxPanel` |
| `vareno` | SIA "Vareno Group" | `SG-Signature-Vareno` |

Additional groups:

- `SG-Signature-Pilot`: the add-in is assigned only to this group during the pilot.
- `SG-Signature-Admins`: users allowed to access the admin UI.

Group names must be **configurable** in `config/companies.json`. Do not hard-code them.

### 3.1 Company resolution rules

1. Read the user's **transitive** group memberships via Graph (`/users/{id}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName`). Match on **group object ID** (configured), not display name.
2. If the user is in exactly one company group, use that company.
3. If the user is in several, use the explicit `priority` order in `config/companies.json`, and **log a warning** that appears in the data-quality report.
4. If the user is in none, check for an admin override (`company` field in the override store). If there is none, fall back to `defaultCompany` from config and flag the user in the data-quality report.

---

## 4. Signature data model and precedence

Contact data in Entra is incomplete or outdated, especially job titles. Resolve each field in this order:

```
admin override (service DB)  >  Entra ID attribute  >  omit field from signature
```

Never render an empty label (e.g. "Mob: " with no number). Omit the whole line instead.

### 4.1 Fields

| Field | Entra source | Overridable | Notes |
|---|---|---|---|
| `displayName` | `displayName` | yes | |
| `jobTitleLv` | `jobTitle` | yes | Latvian title |
| `jobTitleEn` | none | yes | English title; store-only |
| `mobilePhone` | `mobilePhone` | yes | Normalise to `+371 2X XXX XXX` style |
| `officePhone` | `businessPhones[0]` | yes | |
| `email` | `mail` | no | Always from Entra |
| `department` | `department` | yes | Optional in templates |
| `company` | group membership | yes | See 3.1 |
| `hideMobile` | none | yes | Boolean; user or admin can hide mobile |

### 4.2 Storage

- Use SQLite for the MVP, behind a repository interface so Postgres can be swapped in later.
- Table `signature_overrides`: `upn` (PK), each overridable field (nullable), `updated_by`, `updated_at`.
- Keep an audit log table of all changes.

### 4.3 Data-quality report

Admin UI page plus a CSV export listing every licensed user with:

- the resolved company and how it was resolved (group / override / default)
- which fields are missing
- which fields come from an override versus Entra
- multi-group conflicts

The point of this report is to fix the source data in on-prem AD over time. Overrides are a stopgap.

---

## 5. Templates (four designs, revisable)

- One folder per company: `templates/<companyKey>/`
  - `new.hbs`: full signature for new messages
  - `reply.hbs`: compact signature for replies and forwards
  - `meta.json`: logo URL, brand colours, legal footer text (registration number, address, website), version
- Use Handlebars with **HTML-escaping on**. Never use triple-stash on user data.
- Email HTML rules:
  - table-based layout
  - inline CSS only
  - max width 600px
  - web-safe font stack (`Arial, Helvetica, sans-serif`)
- Images must be **absolute HTTPS URLs** served from `https://sig.tenaxgrupa.lv/assets/<company>/...`.
  - No base64 and no `cid:` images.
  - Provide PNGs at 2× resolution with explicit `width`/`height` attributes.
- Dark mode: avoid transparent logos on text-coloured backgrounds; provide a solid-background variant if needed.
- Templates must be editable **without redeploying code**: reloaded from disk or DB, and versioned. The admin UI shows a live preview.
- Ship four placeholder designs that differ visibly (colour and company name) so tests can assert the right one was picked. Real designs will replace them later.

---

## 6. API

Stack: **Node.js 20 + TypeScript + Fastify**. Use `@azure/msal-node` for Graph and `jose` for token validation.

### 6.1 Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/signature?type=newMail\|reply\|forward` | Bearer (user) | Returns rendered HTML for **the caller only** |
| GET | `/api/admin/users` | Bearer + `SG-Signature-Admins` | List users with resolved data |
| GET | `/api/admin/users/{upn}/preview?type=` | admin | Render preview for any user |
| PUT | `/api/admin/users/{upn}/overrides` | admin | Set overrides |
| GET | `/api/admin/report.csv` | admin | Data-quality export |
| GET | `/api/me` | Bearer (user) | Self-service: view own data |
| PUT | `/api/me/overrides` | Bearer (user) | Self-service: edit limited fields (`jobTitleEn`, `hideMobile`) if enabled in config |
| GET | `/healthz` | none | Health check |

### 6.2 Security requirements

- **Never trust a `upn` query parameter.** The UPN comes from the validated token claims (`preferred_username` / `upn`, cross-checked with `oid`).
- Validate token issuer (tenant), audience (the API app ID URI) and signature against Entra JWKS.
- The admin endpoints also check group membership of the caller.
- Configure CORS to allow only the add-in origin(s).
- Rate-limit per user.
- Cache resolved user data for 10 minutes and group memberships for 30 minutes (in-memory LRU).

### 6.3 Graph access (app-only)

Entra app registration **"Tenax Signature API"**:

- Application permissions: `User.Read.All`, `GroupMember.Read.All` (admin consent required)
- Certificate credential (no client secret in production)
- Exposes scope `api://sig.tenaxgrupa.lv/<appId>/Signature.Read` for the add-in

Document the exact registration steps in `docs/entra-setup.md`, including a PowerShell or Graph CLI script where possible.

---

## 7. Outlook add-in

### 7.1 Manifest

Use the **XML manifest** (best support for classic Outlook), with requirement set `Mailbox 1.10` minimum.

LaunchEvents:

- `OnNewMessageCompose` → `onNewMessageComposeHandler`
- `OnNewAppointmentOrganizer` → `onNewAppointmentComposeHandler`
- `OnMessageFromChanged` → `onMessageFromChangedHandler` (for shared mailboxes / delegates; requires a higher requirement set, so gate it appropriately)

Runtime configuration:

```xml
<Runtime resid="WebViewRuntime.Url">
  <Override type="javascript" resid="JSRuntime.Url"/>
</Runtime>
```

- `WebViewRuntime.Url` → `https://sig.tenaxgrupa.lv/addin/launchevent.html` (new Outlook, OWA, Mac)
- `JSRuntime.Url` → `https://sig.tenaxgrupa.lv/addin/launchevent.js` (classic Outlook)

### 7.2 Classic Outlook JS-runtime constraints (must follow)

- `launchevent.js` must be a **single bundled file** with no ES `import` statements at runtime. Use esbuild or webpack to produce one IIFE bundle.
- Code in `Office.onReady()` does **not** run for event handlers. Register handlers with `Office.actions.associate(...)` at top level.
- Use **absolute URLs** in `fetch`.
- Serve `https://sig.tenaxgrupa.lv/.well-known/microsoft-officeaddins-allowed.json`:

  ```json
  { "allowed": ["https://sig.tenaxgrupa.lv/addin/launchevent.js"] }
  ```

- Always call `event.completed()`, including on error and timeout paths. Use a timeout of about 4s on the fetch.

### 7.3 Handler behaviour

1. Get the compose type (`getComposeTypeAsync`) → `newMail` / `reply` / `forward`.
2. Get an access token for the API:
   - primary: **Nested App Authentication** (MSAL.js `createNestablePublicClientApplication`)
   - fallback: `Office.auth.getAccessToken`
   - Verify current Microsoft docs for NAA support in the classic Outlook event runtime, and implement whichever path is supported, with the other as fallback.
3. `GET /api/signature?type=...` with the Bearer token.
4. `disableClientSignatureAsync()` to prevent a duplicate local signature, then `body.setSignatureAsync(html, { coercionType: Html })`.
5. On any failure, complete the event without inserting anything and log to the API's telemetry endpoint. Never block composing.
6. For `OnMessageFromChanged`: re-resolve the signature for the new From address. If it's a shared mailbox, the API returns the shared mailbox's configured company signature. Add a `shared_mailboxes` config table for this.

### 7.4 Deployment

- Test and pilot: M365 admin center → Integrated apps → Upload custom app → assign **only** to `SG-Signature-Pilot`.
- Production: reassign to the entire organisation.
- Also provide `scripts/deploy-addin.ps1` using the `O365CentralizedAddInDeployment` module (`New-OrganizationAddIn`, `Set-OrganizationAddInAssignments`). Mark it as optional; the admin center UI is the primary path.
- Note that propagation can take up to 24h.

---

## 8. Test user sample

### 8.1 Mock mode (no tenant access needed)

When `MOCK_GRAPH=true`, the API reads users and groups from `fixtures/users.json` instead of Graph, and accepts a dev-only header `X-Mock-User: <upn>` instead of a token. This header **must be impossible to enable in production builds**: guard it on `NODE_ENV !== 'production'` and add a startup assertion.

`fixtures/users.json` must include at least these cases:

| UPN | Groups | Entra data | Expected result |
|---|---|---|---|
| `test.tenax@tenaxgrupa.lv` | Tenax | complete | Tenax template, all fields |
| `test.tenapors@tenaxgrupa.lv` | Tenapors | `jobTitle` missing | Tenapors template, no title line |
| `test.panel@tenaxgrupa.lv` | TenaxPanel | outdated `jobTitle`, override set | Override title shown |
| `test.vareno@tenaxgrupa.lv` | Vareno | no mobile | Vareno template, mobile line omitted |
| `test.multi@tenaxgrupa.lv` | Tenax + Vareno | complete | Priority winner, conflict in report |
| `test.nogroup@tenaxgrupa.lv` | none | complete | Default company, flagged in report |
| `test.xss@tenaxgrupa.lv` | Tenax | `displayName` = `<img src=x onerror=alert(1)>` | Escaped output, no raw tag |
| `test.lv@tenaxgrupa.lv` | Tenapors | name with `ā ē ī ū š ž ņ ļ ķ ģ č` | Diacritics intact (UTF-8) |

### 8.2 Automated tests

Use Vitest. Cover:

- company resolution (all cases above)
- field precedence
- line omission for empty fields
- HTML escaping
- UTF-8 handling
- reply versus new template selection
- token validation (reject wrong audience, wrong tenant, expired token)
- the admin authorisation check

Add **snapshot tests** of rendered HTML per company.

### 8.3 Local preview

`npm run preview` starts the server in mock mode. `/dev/preview` shows every fixture user's new and reply signatures side by side for visual review.

### 8.4 Real-tenant pilot

The admin creates this manually; Claude Code must not create accounts:

- One licensed test mailbox, e.g. `sig.test@tenaxgrupa.lv`, added to `SG-Signature-Pilot` and to one company group.
- The pilot checklist in `docs/pilot-checklist.md`: verify insertion in new Outlook, classic Outlook, OWA, Mac (if available) and mobile, covering new mail, reply, forward, meeting invite and a shared-mailbox From switch. Also verify there is no duplicate signature, images load, and a dark-mode check.
- Then move the test user between company groups and confirm the design switches after cache expiry.

---

## 9. Admin UI

Minimal React (Vite) SPA served by the same host, with Entra login via MSAL.js and access restricted to `SG-Signature-Admins`. Pages:

- **Users:** searchable table showing resolved company, source flags and missing-field badges.
- **User detail:** Entra values alongside overrides, an edit form and a live preview (new and reply).
- **Templates:** list per company with version, preview against any user, and reload.
- **Report:** data-quality summary plus CSV download.

---

## 10. Repository layout

```
/api            Fastify service (TypeScript)
/addin          manifest.xml, launchevent.ts, launchevent.html, build config
/admin          React admin SPA
/templates      <company>/new.hbs, reply.hbs, meta.json
/assets         logos per company
/config         companies.json, shared_mailboxes.json
/fixtures       users.json (mock mode)
/scripts        deploy-addin.ps1, entra-setup.ps1
/docs           entra-setup.md, pilot-checklist.md, operations.md
docker-compose.yml, Dockerfile, .env.example, README.md
```

---

## 11. Build phases and acceptance criteria

**Phase 1: Mock core.** Template rendering, company resolution, precedence and fixtures, with all tests green. `npm run preview` shows correct signatures for all 8 fixture users.

**Phase 2: Graph integration.** Real Graph lookups with a certificate credential, caching and token validation. `/api/signature` works for `sig.test@tenaxgrupa.lv` with a real token.

**Phase 3: Add-in.** Manifest, bundled classic-runtime JS, HTML runtime and well-known URI. Deployed to the pilot group, the signature is inserted in new Outlook, classic Outlook and OWA without duplicates.

**Phase 4: Admin UI and overrides.** Overrides change the rendered output within the cache TTL, and the report CSV is correct.

**Phase 5: Hardening.** Audit log, rate limiting, telemetry for handler failures, Docker deployment and `docs/operations.md` covering how to change a template, add a company, fix a user's data and roll back.

---

## 12. Open items for the admin to fill in

These are placeholders in config; ask before inventing values:

- Final security group object IDs for the four companies plus Pilot and Admins
- Logos and brand colours per company
- Legal footer per company (registration number, legal address, website)
- Whether signatures are Latvian-only, English-only or bilingual (the template supports `jobTitleLv` / `jobTitleEn`)
- Whether user self-service editing is enabled, and for which fields
- Shared mailboxes that need their own signature, and their company mapping
- Hosting target for `sig.tenaxgrupa.lv` (self-hosted Docker or Azure App Service)

## 13. Things Claude Code must not do

- Create, modify or delete real users, groups or mailboxes in the tenant
- Write to Entra user attributes
- Commit secrets, certificates or tenant IDs; use `.env` and add `.env.example` only
- Enable the mock auth header in production builds

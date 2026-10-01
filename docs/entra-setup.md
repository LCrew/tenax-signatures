# Entra ID setup: "Tenax Signature API"

One app registration covers all three roles:

| Role | How it uses the registration |
|---|---|
| **Signature API** (server, app-only) | Reads users and group memberships from Microsoft Graph with a **certificate** credential (`User.Read.All`, `GroupMember.Read.All`). |
| **Outlook add-in** (delegated) | Gets a user token for `api://sig.tenax.lv/<appId>/Signature.Read` through Nested App Authentication (NAA), falling back to legacy Office SSO (`access_as_user`). |
| **Admin SPA** (delegated) | Signs admins in with MSAL.js and calls the API with the same scope. |

Automated version: [`scripts/entra-setup.ps1`](../scripts/entra-setup.ps1) (step 11). The manual steps below are the reference.

> **Ground rules (brief §13).** Nothing here creates, modifies or deletes users or mailboxes, or writes user attributes. The admin creates the security groups and manages their membership. Never commit certificates, private keys, tenant IDs or client IDs to git; they go into the setup wizard or `.env`.

Placeholders used below: `<appId>` = Application (client) ID, `<tenantId>` = Directory (tenant) ID.

---

## 0. Prerequisites

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as **Global Administrator** (or Application Administrator plus Privileged Role Administrator for the consent steps).
2. Confirm that `tenax.lv` is a **verified custom domain** (Entra ID → Domain names). Entra only accepts an Application ID URI of the form `api://sig.tenax.lv/…` if `tenax.lv` (or the subdomain) is verified in the tenant. The mail domain `tenaxgrupa.lv` being verified is not enough.
3. `https://sig.tenax.lv` must be reachable over TLS before the pilot, but not for these steps.

## 1. Register the application

1. Go to **Entra ID → App registrations → New registration**.
2. **Name:** `Tenax Signature API`
3. **Supported account types:** *Accounts in this organizational directory only (TenaxMID only – Single tenant)*.
4. **Redirect URI:** platform **Single-page application (SPA)**, value `brk-multihub://sig.tenax.lv`
   (NAA trusted-broker redirect. Origin only, no path.)
5. Select **Register**.
6. On **Overview**, copy the **Application (client) ID** (`<appId>`) and the **Directory (tenant) ID** (`<tenantId>`).

## 2. Add the SPA redirect URIs

1. **Authentication → Single-page application → Add URI**, and add:
   - `https://sig.tenax.lv/` (web console: employee self-service and admins, production)
   - `http://localhost:8085/` (web console, local testing; match `HOST_PORT` if you changed it)
2. Check that the SPA list now has exactly three URIs: `brk-multihub://sig.tenax.lv`, `https://sig.tenax.lv/`, `http://localhost:8085/`.
3. Leave **Implicit grant** (access tokens / ID tokens) **unchecked**. MSAL uses auth code + PKCE.
4. Leave **Allow public client flows** at **No**. **Save**.

## 3. Use v2 access tokens

1. **Manifest** → in the JSON set `"requestedAccessTokenVersion": 2`. In the Microsoft Graph manifest format this is `api.requestedAccessTokenVersion`; in the legacy AAD Graph format it's `accessTokenAcceptedVersion`. **Save**.

   Legacy Office SSO requires v2 tokens. It also fixes the token shape the API validates:

   | Claim | Value (v2) |
   |---|---|
   | `iss` | `https://login.microsoftonline.com/<tenantId>/v2.0` |
   | `aud` | `<appId>` (the GUID, **not** the `api://` URI) |
   | `scp` | `Signature.Read` (NAA, admin SPA) **or** `access_as_user` (legacy Office SSO fallback) |
   | `oid`, `preferred_username`, `tid` | user identity (the API takes the UPN from here, never from a query parameter) |

## 4. Expose the API

1. **Expose an API → Application ID URI → Add** and replace the default with
   `api://sig.tenax.lv/<appId>`. **Save**.
2. **Add a scope**:

   | Field | Value |
   |---|---|
   | Scope name | `Signature.Read` |
   | Who can consent | Admins only |
   | Admin consent display name | Read own email signature |
   | Admin consent description | Allows the Outlook add-in and admin UI to read the signed-in user's rendered email signature. |
   | State | Enabled |

3. **Add a scope** again, for the legacy Office SSO fallback. Office requests this exact name:

   | Field | Value |
   |---|---|
   | Scope name | `access_as_user` |
   | Who can consent | Admins only |
   | Admin consent display name | Access Tenax Signature API as the user (Office SSO) |
   | Admin consent description | Allows Office to call the signature API as the signed-in user. |
   | State | Enabled |

## 5. Pre-authorise the Office clients (legacy Office SSO)

1. **Expose an API → Authorized client applications → Add a client application**.
2. **Client ID:** `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e`. Tick **both** scopes (`…/Signature.Read` and `…/access_as_user`). **Add application**.

This single ID pre-authorises Microsoft Office on every platform, including Outlook desktop, web, Mac, mobile and new Outlook. Microsoft's reference ([Register an Office Add-in that uses legacy Office SSO](https://learn.microsoft.com/office/dev/add-ins/develop/register-sso-add-in-aad-v2), checked 2026-09) lists what it covers:

| Client ID | Client |
|---|---|
| `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e` | **All Microsoft Office application endpoints** (use this one) |
| `d3590ed6-52b3-4102-aeff-aad2292ab01c` | Microsoft Office |
| `93d53678-613d-4013-afc1-62e9e444a0a5` | Office on the web |
| `bc59ab01-8403-45c6-8796-ac3ef710b3e3` | Outlook on the web |

Only add the three individual IDs if you deliberately want to exclude some platforms. We don't need the Teams IDs (`1fec8e78-…`, `5e3ce6c0-…`).

NAA doesn't use pre-authorisation. With NAA the add-in acts as **this same app** (client ID `<appId>`) and requests its own scope, and step 6 grants that consent.

## 6. API permissions and admin consent

1. **API permissions → Add a permission → Microsoft Graph → Application permissions** and add:
   - `User.Read.All`
   - `GroupMember.Read.All`
2. **Add a permission → Microsoft Graph → Delegated permissions** and add `openid`, `profile` and `offline_access`. `User.Read`, which is added by default, can stay or go; neither the add-in nor the API needs it.
3. **Add a permission → APIs my organization uses** (or **My APIs**) → `Tenax Signature API` → **Delegated** and add `Signature.Read` and `access_as_user`.
4. Select **Grant admin consent for TenaxMID** and confirm. Every row must show a green **Granted** status.

   Event handlers can't show sign-in or consent UI, so tenant-wide admin consent is **mandatory**. Without it, token acquisition fails silently and no signature is inserted. The add-in reports that failure to `/api/telemetry` with stage `token`.

## 6a. Web console sign-in (employee self-service)

Employees sign in at `https://sig.tenax.lv` with **Sign in with Microsoft**, which uses OAuth 2.0 authorization code
with PKCE through MSAL.js. The console uses **this same app registration**. The steps above already cover it:

| Setting | Where | Value |
|---|---|---|
| SPA redirect URI | Authentication (step 2) | `https://sig.tenax.lv/` (trailing slash) |
| Scope requested at sign-in | Expose an API (step 4) | `api://sig.tenax.lv/<appId>/Signature.Read` |
| Consent | API permissions (step 6) | Admin consent granted, so employees are never asked to consent |
| Who can sign in | Enterprise applications › Tenax Signature API › Properties | **Assignment required: No** (or assign the users/groups who should have access) |

What each person gets after signing in:

- **Everyone:** the *My signature* page, with their own signature (new and reply), where each value comes from, and a
  **Copy signature** button for apps where the add-in doesn't run. When self-service is on (Settings › Signature
  options), they can also edit the allowed fields (English title, hide mobile, and optionally mobile or Latvian title).
- **Members of the admins group:** the full admin console, plus *My signature* in the menu.

The API accepts only tokens for this app (`aud` = `<appId>`) from this tenant, and takes the identity from the token
(`oid` + `preferred_username`). A person can only ever see or change their own signature.

Once the app is registered, enter its tenant ID, client ID and credential in the web console under **Settings › Entra ID
connection**, or in step 4 of the setup wizard. The **Sign in with Microsoft** button appears as soon as that's saved.

## 7. Certificate credential (no client secret in production)

Create a self-signed certificate. Upload **only the public part** to Entra. The **private key** goes to the server's setup wizard and nowhere else.

**Option A: openssl (Linux/macOS/WSL)**

```bash
# 2-year RSA-2048 key + self-signed certificate
openssl req -x509 -newkey rsa:2048 -sha256 -days 730 -nodes \
  -subj "/CN=Tenax Signature API" \
  -keyout tenax-signature-api.key.pem -out tenax-signature-api.crt.pem

# Public certificate for Entra (DER .cer; the PEM .crt.pem is also accepted)
openssl x509 -in tenax-signature-api.crt.pem -outform der -out tenax-signature-api.cer

# SHA-1 thumbprint, to compare with the one Entra shows
openssl x509 -in tenax-signature-api.crt.pem -noout -fingerprint -sha1
```

**Option B: PowerShell 7.4+ on Windows**

```powershell
$cert = New-SelfSignedCertificate -Subject 'CN=Tenax Signature API' `
  -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy Exportable -KeySpec Signature `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(2)

Export-Certificate -Cert $cert -FilePath .\tenax-signature-api.cer | Out-Null          # public, for Entra
$cert.ExportCertificatePem() | Set-Content -Encoding ascii .\tenax-signature-api.crt.pem  # public, PEM
[System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert).
  ExportPkcs8PrivateKeyPem() | Set-Content -Encoding ascii .\tenax-signature-api.key.pem  # PRIVATE
$cert.Thumbprint
# Afterwards remove it from the user store if this machine isn't the server:
# Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)"
```

Then:

1. **Certificates & secrets → Certificates → Upload certificate** → select `tenax-signature-api.cer` → description `Signature API <yyyy-mm>` → **Add**. Check that the thumbprint matches.
2. In the server's **setup wizard**, upload the private key PEM (`tenax-signature-api.key.pem`). If the wizard also asks for the certificate or thumbprint, give it `tenax-signature-api.crt.pem` or the thumbprint Entra shows. Alternatively, upload one PEM that contains both: `cat tenax-signature-api.key.pem tenax-signature-api.crt.pem > tenax-signature-api.pem`.
3. Delete the private key from your workstation once the server has it. Keep a copy only in your password manager or vault.
4. Add a calendar reminder about 30 days before expiry. To rotate: upload the new certificate, switch the key in the wizard, then remove the old certificate.

Don't create a client secret. If one is ever needed temporarily (for example while testing), give it an expiry of 3 months or less and delete it after moving to the certificate.

## 8. Security groups (created by the admin)

In **Entra ID → Groups → New group**, create any of these that don't exist yet. Settings: **Group type:** Security, **Membership type:** Assigned, **Microsoft Entra roles can be assigned:** No.

| Group | Purpose | `config/companies.json` key |
|---|---|---|
| `SG-Signature-Tenax` | SIA "Tenax" template | `companies[tenax].groupId` |
| `SG-Signature-Tenapors` | SIA "Tenapors" template | `companies[tenapors].groupId` |
| `SG-Signature-TenaxPanel` | SIA "Tenax Panel" template | `companies[tenaxpanel].groupId` |
| `SG-Signature-TenaxInstall` | SIA "Tenax Install" template | `companies[tenaxinstall].groupId` |
| `SG-Signature-Vareno` | SIA "Vareno Group" template | `companies[vareno].groupId` |
| `SG-Signature-Pilot` | Add-in assignment during the pilot | `groups.pilot.groupId` |
| `SG-Signature-Admins` | **IT administrators**: full access to the admin console | `groups.admins.groupId` |
| `SG-Signature-Excluded` | Optional. Service accounts, scanners, test and room mailboxes: no signature, hidden from People and the report | Companies and groups › Excluded accounts |
| `SG-Signature-<Company>-Editors` (one per company, e.g. `SG-Signature-Tenapors-Editors`) | **Signature editors** for that company only: its design, brand details and its people's signature data. No other companies, no settings | `companies[<key>].editorGroupId` (or Companies and groups in the console) |

1. Open each group and copy its **Object ID** from Overview. The API matches on **object ID**, never on display name, so renaming a group later is safe.
2. Nested groups work: the API reads **transitive** memberships (`/users/{id}/transitiveMemberOf`), so an existing department group can be a member of `SG-Signature-Tenax`.
3. Adding the pilot mailbox (for example `sig.test@tenaxgrupa.lv`) to `SG-Signature-Pilot` and one company group is part of the pilot, which the admin does by hand (see [pilot-checklist.md](pilot-checklist.md)).
4. The M365 admin center can assign the add-in to a plain security group. `scripts/deploy-addin.ps1` may need a mail-enabled group; see the note in that script.

## 9. Optional: groups claim

**Not required, and we recommend leaving it off.** The API resolves companies and the admin role through Microsoft Graph (`GroupMember.Read.All`) and caches the result for 30 minutes, so tokens don't need a `groups` claim.

If you enable it anyway (**Token configuration → Add groups claim → Security groups**, access token), keep in mind:

- above 200 groups the token carries an overage marker instead of the list, so the server must fall back to Graph regardless;
- the claim only changes when a new token is issued (up to about 1 hour), so group changes show up more slowly than the API's cache TTL;
- the claim adds size to every token the add-in sends.

To use it only for the admin UI, prefer **"Groups assigned to the application"** and assign just `SG-Signature-Admins` under **Enterprise applications → Tenax Signature API → Users and groups**.

## 10. Values for the setup wizard

The first time the server starts, the web setup wizard asks for these (nothing goes into git):

| Wizard field | Where to find it |
|---|---|
| Tenant ID | Step 1.6, `<tenantId>` |
| Client ID | Step 1.6, `<appId>` |
| Certificate private key (PEM), or a client secret for testing | Step 7 |
| Company group object IDs (Tenax, Tenapors, TenaxPanel, Vareno) | Step 8 |
| Pilot and Admins group object IDs | Step 8 |

The server derives `api://sig.tenax.lv/<appId>` and the add-in scope `api://sig.tenax.lv/<appId>/Signature.Read`, injects them into `/addin/launchevent.js` at request time, and renders the add-in manifest with the same values.

## 11. Automating steps 1–8 with PowerShell

`scripts/entra-setup.ps1` does steps 1–6, uploads the certificate from step 7 if you pass one, and looks up the groups from step 8. Re-running it is safe.

```powershell
# PowerShell 7+, Microsoft Graph SDK: Install-Module Microsoft.Graph -Scope CurrentUser
./scripts/entra-setup.ps1 -TenantId TenaxMID.onmicrosoft.com -CertPath ./tenax-signature-api.cer
# Add -CreateGroups only if you want the script to create missing SG-Signature-* groups (no members).
# -PublicHost defaults to sig.tenax.lv
```

It prints `tenantId`, `clientId`, the scope URIs and every group's object ID. It never writes user attributes or group memberships.

## 12. How the add-in authenticates (NAA in the classic Outlook runtime)

Checked against Microsoft Learn in September 2026:

- **NAA is the primary path and works in event handlers, including classic Outlook on Windows.** Outlook has `NestedAppAuth 1.1` as GA on every platform: classic Outlook M365 Version 2409 (Build 18025.20000)+, retail perpetual 2501+, LTSC 2408+, Mac 16.89+, iOS/Android 4.2433+, and the web. Microsoft's sample *Outlook-Event-SSO-NAA* ("applies to Outlook on Windows (new and classic), Mac, mobile, and on the web") calls `createNestablePublicClientApplication` + `acquireTokenSilent` inside `OnNewMessageCompose`. Event code can't show UI, so it never calls `acquireTokenPopup`. Our add-in follows the same pattern, adds `ssoSilent` as a second silent attempt, and checks `Office.context.requirements.isSetSupported("NestedAppAuth", "1.1")` at runtime (Outlook manifests can't declare this set).
- **Fallback: legacy Office SSO.** For older builds, the add-in calls `OfficeRuntime.auth.getAccessToken` (or `Office.auth.getAccessToken`) with `allowSignInPrompt: false` and `allowConsentPrompt: false`. Microsoft notes that `Office.auth.getAccessToken` only works in classic Outlook from Version 2111 and that `OfficeRuntime.auth.getAccessToken` works in every version that supports event-based activation plus SSO, so the add-in tries `OfficeRuntime.auth` first. This path needs `<WebApplicationInfo>` in the manifest, the `access_as_user` scope and the Office pre-authorisation from step 5.
- **Both paths in classic Outlook** need the well-known URI `https://sig.tenax.lv/.well-known/microsoft-officeaddins-allowed.json` to list `https://sig.tenax.lv/addin/launchevent.js`. The API serves it.
- NAA isn't available when the mailbox is an Outlook.com or Gmail account. That doesn't matter for Tenax (Exchange Online only).

Sources: [Enable SSO with NAA](https://learn.microsoft.com/office/dev/add-ins/develop/enable-nested-app-authentication-in-your-add-in) · [NestedAppAuth requirement set](https://learn.microsoft.com/javascript/api/requirement-sets/common/nested-app-auth-requirement-sets) · [SSO in event-based add-ins](https://learn.microsoft.com/office/dev/add-ins/develop/use-sso-in-event-based-activation) · [Outlook-Event-SSO-NAA sample](https://github.com/OfficeDev/Office-Add-in-samples/tree/main/Samples/auth/Outlook-Event-SSO-NAA)

## 13. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `AADSTS500011` / invalid resource | The Application ID URI in step 4 doesn't match `API_SCOPE_URI` in the manifest or config. |
| `AADSTS65001` / consent required | Step 6.4 was skipped, or a new permission was added after consent. Grant admin consent again. |
| `AADSTS50011` / redirect mismatch in NAA | `brk-multihub://sig.tenax.lv` is missing or has a path or trailing slash. |
| Setting the identifier URI fails with "must use a verified domain" | See step 0.2. |
| Telemetry stage `token` with `sso: … 13xxx` | Legacy Office SSO error codes (see Microsoft's *Troubleshoot error messages for single sign-on*). Usually missing pre-authorisation (step 5) or admin consent (step 6). |
| API returns 401 but the token looks right | The API must accept `aud = <appId>` with the v2 issuer, and `scp` containing `Signature.Read` **or** `access_as_user`. |

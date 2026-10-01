# Operations

Everything below is done in the admin console (`https://sig.tenax.lv`) unless stated otherwise. Every change is
recorded under **Activity**.

## Change a signature design

1. **Designs** › pick the company.
2. **Brand and footer**: logo (upload a PNG at 2× the shown size on a solid background), colours, registration number,
   address, website. **New message** / **Reply and forward**: the Handlebars HTML.
3. The preview updates as you type. Use **Preview as** for a real person, and **Dark mode check** for transparent-logo issues.
4. **Save version** (add a note). The next message people write uses it. Nothing needs redeploying.

Rules enforced on save: `{{{ }}}` / `{{& }}` and `<script>` are rejected, and every value is HTML-escaped. Keep to
email-safe HTML: tables, inline styles, max 600px wide, absolute image URLs (`{{meta.logoUrl}}`).

Editing on disk instead: change `templates/<company>/*.hbs|meta.json` in the repo (or mount the folder), then
**Designs › Reload from disk**. Files that differ are imported as new versions. At startup, disk files are only
imported for companies with no versions yet, so UI edits are never overwritten silently.

## Roll back a design

**Designs › Versions** › **Restore** on any older version. Restoring creates a new version with the old content, so
history stays linear and you can restore forward again.

## Rename a company or change its group

**Companies and groups**: short name, legal name, group name and object ID (use **Find** to look it up in Entra), and
priority order (arrows). Save. The group membership cache is cleared automatically.

## Add a company

**Companies and groups › Add company**. Pick an existing design to start from, set its group, then adjust its design.

## Fix a person's data

Best fix: correct the attribute in on-premises AD (title, phone, department) and let Entra Connect sync it.

Stopgap: **People** › person › type a correction (empty = use Entra), tick **Leave the mobile number out** if needed,
**Save corrections**. The preview shows the result before saving.

A company picked on the person page only applies when they're in *no* company group. Group membership always wins, so
fix memberships in AD.

## After moving someone between groups

User data is cached for 10 minutes, group memberships for 30. For an immediate change use **Settings › Server › Clear
cache** (or **Overview › Refresh from directory**).

## Shared mailboxes

**Shared mailboxes**: when a user switches From to one of these, the add-in (`OnMessageFromChanged`) inserts the
mailbox's signature with the chosen company design.

## Rotate the Entra certificate

1. Create a new certificate (see [setup-guide.md](setup-guide.md#step-4-in-detail-entra-id)) and upload the `.cer` to the
   app registration in Entra (keep the old one for now).
2. **Settings › Entra ID connection** › choose both PEM files › **Test connection** › **Save connection**.
3. Remove the old certificate from the app registration. **Settings** shows the stored certificate's expiry date.

## Admin access

- Microsoft accounts: members of the admins group (Companies and groups › Access groups).
- Local accounts: **Settings › Local accounts**. Keep at least one as a break-glass login. Sessions last 8 hours.

## Add-in problems

**Activity › Add-in errors** (and **Overview**) lists failures reported by Outlook clients: stage (token, fetch,
setSignature…), message, host and platform. The add-in never blocks composing. On failure it inserts nothing.

## Backup and restore

All state is in the `sig-data` Docker volume: `signature.db` (SQLite: settings, companies, corrections, design versions,
audit log), `assets/` (uploaded logos) and `app.key` (if `APP_SECRET` isn't set).

```bash
docker compose exec -w /app/api signature node -e "require('better-sqlite3')('/data/signature.db').backup('/data/backup.db').then(()=>console.log('ok'))" \
  && docker compose cp signature:/data/backup.db ./signature-$(date +%F).db
```

Restore: stop the service, copy the file into the volume as `signature.db`, start. Keep the same `APP_SECRET` (or
`app.key`), or re-enter the Entra credential.

## Upgrade

```bash
git pull && docker compose up -d --build
```

Database migrations run automatically at startup.

## Health and logs

- `GET /healthz` (Docker healthcheck uses it)
- `docker compose logs -f signature` (JSON logs; add-in failures are logged at warn level)

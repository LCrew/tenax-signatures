# Operations

Everything below is done in the admin console (`https://sig.tenax.lv`) unless stated otherwise. Every change is
recorded under **Activity**.

## Change a signature design

1. **Designs** › pick the company › **New message** or **Reply and forward**.
2. **Visual** mode (the default for every shipped design):
   - **Layout:** logo beside text, logo above text, or text only. Also logo alignment, gap, divider line or accent
     bar, and maximum width.
   - **Text:** font, base size (pt), line spacing, default colour, and whether to show the closing line.
   - **Blocks:** drag to reorder (or use the arrows). Click a block for its size, bold, italic, capitals, colour and
     space after, plus its label (`M:`, `T:`) or its text. The eye icon hides a block without deleting it.
     **Add block** adds fields, websites, free text, spaces and lines.
   - **Colours:** the chips follow the company's brand colours from **Brand and footer**, so changing a brand colour
     updates every block that uses it. **Custom** sets a fixed colour.
3. **Brand and footer:** logo, brand colours, closing line, company line, address, websites, promo banner and
   confidentiality notice.
4. The preview updates as you type. Use **Preview as** to see a real person, and **Dark mode check** for logo problems.
5. **Save version** (add a note). The next message people write uses it. Nothing needs redeploying.

Visual designs are compiled on the server into email-safe HTML (tables and inline styles). A field that's empty for
someone drops its whole line. **HTML** mode is for full control. Switching a visual design to HTML is one-way for that
version; to go back, restore an earlier version or start a new visual layout.

Rules enforced on save: `{{{ }}}` / `{{& }}` and `<script>` are rejected, and every value is HTML-escaped. Text typed into
blocks is always literal.

Editing on disk instead: change `templates/<company>/*`, then **Designs › Reload from disk**. Files that differ are
imported as new versions. `npx tsx scripts/seed-templates.ts` (in `api/`) regenerates the shipped designs.

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

## Who can do what

| Role | How someone gets it | Can do |
|---|---|---|
| **IT administrator** | Member of the IT admins group (Companies and groups › Access groups), or a local account (Settings › Local accounts) | Everything |
| **Signature editor** for a company | Member of that company's *Signature editors* group (Companies and groups, one per company, e.g. `SG-Signature-Tenapors-Editors`) | That company only: Overview, People (view and correct its people's signature details), Designs (layout, brand and footer, logos and banners, versions) |
| Everyone else | Signs in with Microsoft | *My signature*: view their own, and edit the fields allowed in Settings › Signature options |

Signature editors **cannot**:
- see or change other companies or their people;
- move a person to another company;
- change companies, groups, shared mailboxes or settings;
- reload designs from disk, view the activity log or download the add-in manifest.

Every change is recorded under Activity with who made it.

To give a team their company's design: create the group in Entra (the setup script with `-CreateGroups` creates
`SG-Signature-<Company>-Editors`), add the people, then in **Companies and groups** use **Find** next to *Signature
editors* and save. New members can edit after their next sign-in (group memberships are cached for up to 30 minutes).

## Remove a company

**Companies and groups** › trash icon on the company › type its name › **Remove company**. Its people get the default
company's signature until they're in another company group. The default company can't be removed (pick another default
first), and neither can a company that shared mailboxes still use. Its design versions stay in the database.

## Local accounts

Settings › Local accounts. Local accounts are always IT administrators. Keep at least one as a break-glass login.
Sessions last 8 hours.

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

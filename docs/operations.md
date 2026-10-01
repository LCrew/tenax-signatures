# Operations

Everything below is done in the admin console (`https://sig.tenax.lv`) unless stated otherwise. Every change is
recorded under **Activity**.

## Change a signature design

1. **Designs** › pick the company › **New message** or **Reply and forward**.
2. **Visual** mode (the default for every shipped design):
   - **Layout:** logo beside text, logo above text, or text only. Also logo alignment, gap, divider line or accent
     bar, and maximum width.
   - **Text:** font, base size (pt), line spacing, default colour, and whether to show the closing line.
     Fonts uploaded in **Settings › Fonts** appear under *Uploaded fonts*. Email apps draw text with the
     reader's own fonts, so an uploaded font shows only for people who have it installed; everyone else sees the
     *If they don't have it* font. For a pixel-exact look everywhere, use an image (SVG) design instead.
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

## Several designs per company (Standard, English, Service…)

**Designs** › company › design chips. **New design** creates a copy. Pick **People** (e.g. "English" for
English-speaking clients) or **Service accounts** (shared/service mailboxes; only admins assign it).
- **New message** / **Reply and forward**: this design's layouts.
- **Wording**: this design's own closing line, company line, confidentiality notice and banner. Anything not set
  here uses the company's **Brand (company)** settings (logo, colours, websites and address are always company-wide).
- **Design settings**: rename, *people can choose it*, **Make default** (what everyone gets unless they chose or were
  assigned something else), remove (its users fall back to their next option, usually the default).

Who gets which design:
1. A design an admin or the company's editor **assigned and locked** (People › person › *Signature design* + *Lock*).
2. Otherwise the person's **own choice** (My signature › *Your signature*, or **Make default** in Outlook's
   Signatures pane). Only designs marked *people can choose*.
3. Otherwise a design an admin assigned without locking (the person may still change it).
4. Otherwise the company default.

In Outlook the default is inserted automatically. The **Signatures** button in the compose window lists the
person's other designs and inserts one for that email only (unless locked).

Shared mailboxes (Shared mailboxes › design) use their chosen design, else the company's Service design, else the
default.

### Finding and pinning the Signatures button
The button (navy square with a red signature) is in the compose window. Where it sits depends on the Outlook client:
- **Classic Outlook (Windows):** on the **Message** ribbon tab, in the **Tenax** group. Always visible.
- **New Outlook (Windows) and Outlook on the web:** under the **Apps** button in the compose toolbar. To pin it to the
  toolbar: in the compose window click **⋯** › **Customize actions**, tick **Signatures** under add-ins, and **Save**.
  Each person does this once; it isn't a central setting.
- **Outlook for Mac (new):** in the compose toolbar, or under **⋯** when the window is narrow. To keep it visible:
  **⋯** › **Customize toolbar**, then drag **Signatures** into the toolbar.
- **Mobile:** not available; the default signature is still inserted automatically.

### After updating to the version with the Signatures button
The add-in manifest changed (version 1.1.0.0). Download it again (Settings › Outlook add-in) and in the
**Microsoft 365 admin center** › Integrated apps › *Tenax Signature* › **Update add-in**, upload it and accept. Users
see the button after the update propagates (hours, up to 24). Update a personal test copy the same way
(`/addin/manifest.xml?variant=test`, remove the old one and add the new file).

## Image signatures from an SVG (e.g. Vareno Group)

For companies whose signature is one designed image. **Designs** › company › design › **Design settings** ›
**Use an SVG image** › **Upload SVG** (exported from Inkscape/Illustrator with real text, not outlined).
- The upload is cleaned: scripts, external links and the bulky colour profile are removed.
- The service suggests a mapping: the biggest single line becomes the name, the next one the title, and a
  "Mob…" line gets the mobile number. Check it, adjust any line, and use the **+ Name / + Mobile / …** buttons
  to insert details.
- A line whose details are all empty (e.g. no mobile) is left out, and the lines below move up.
- **Make smaller if too long to fit** shrinks long names or titles so they stay inside the card.
- **Shown width** is how wide the image appears in the email; it's rendered at twice that for sharp screens.
  Keep it close to the card's own size so small print stays readable.
- **Link when clicked** makes the whole image open that address. The contact details are also written into the
  image's alternative text.
- **Crop** is detected automatically from the visible artwork; adjust it if needed.

The same image is used for new emails and replies. Each person's image is rendered once and cached. Its address
(`/sig-img/<hash>.png`) only exists for renders the server created, so nobody can generate images with
arbitrary text. Images in sent emails never change.

**Fonts:** the server draws the text, so it needs the font files. Poppins is included. Upload the fonts the
company licenses (e.g. **Arial Nova Light** for Vareno) in **Settings › Fonts** (IT only). They're stored on the
server's data volume and never published. Until a font is uploaded, the editor warns and a similar font is used.

## Job title language (Latvian / English)

**Settings › Signature options › Job title language** is the default for every design: *Latvian and English*,
*Latvian only* (English titles are left out everywhere) or *English only* (the English title replaces the Latvian
one when set). Each design can choose its own in **Designs › Job titles in this design** (above the preview), e.g.
an "English" design for foreign clients while Standard stays Latvian. Company editors can change it for their own
company's designs. English titles aren't in Entra: set them per person in **People** (or people set their own in
**My signature** when self-service allows it).

## Language versions (LV / EN / LT / EE)

Make one design per language in **Designs › New design** (copy from Standard), e.g. *Standard EN*, *Standard LT*:

- **Wording** tab: that language's closing line, company line and confidentiality notice.
- **Promo banner** block (in New message and Reply): pick the banner in that language, with its own link and text.
  Upload the banner images in **Brand and footer** first. "This design's banner" uses the Wording/Brand banner.
- **Job titles in this design** (above the preview): e.g. English for EN/LT/EE versions.
- Set each person's default version on their page in **People** (lock it if they shouldn't change it). People can
  switch for a single email with the **Signatures** button in Outlook.

Layout changes (sizes, fonts, order) are per design, so repeat them in each language version.

## Roll back a design

**Designs › Versions** lists every saved change to the selected design, newest first: *New message*, *Reply*,
*Wording* (this design's closing line, company line, notice and banner), *Image (SVG)*, and the company's
*Brand* (colours, logo, footer — shared by all of the company's designs).

- **Restore** brings back just that one part.
- **Restore all to here** puts every part back the way it was at that moment — layout, fonts, sizes, wording and
  brand together. Use this when "it looked right yesterday".

Restoring creates a new version with the old content, so history stays linear and you can restore forward again.
Brand restores affect every design of that company.

## Rename a company or change its group

**Companies and groups**: short name, legal name, group name and object ID (use **Find** to look it up in Entra), and
priority order (arrows). Save. The group membership cache is cleared automatically.

## Add a company

**Companies and groups › Add company**. Pick an existing design to start from, set its group, then adjust its design.

## Fix a person's data

Best fix: correct the attribute in on-premises AD (title, phone, department) and let Entra Connect sync it.

Stopgap: **People** › person › type a correction (empty = use Entra), tick **Leave the mobile number out** if needed,
**Save corrections**. The preview shows the result before saving.

**Company** on the person page (IT only) overrides group membership. Use it for colleagues who are in two company
groups but should sign as one company. Their signature then uses that company's designs (its default, unless
they choose or are assigned another). **From group membership** undoes it. People with an override aren't reported
as multi-group conflicts.

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

## Closing line ("Ar cieņu,")

Each design has a closing line, set in **Brand (company)** or per design under **Wording**. Everyone can replace
it with their own on **My signature › Closing line**: **Company default**, **My own** (one line, max 120
characters) or **None**. This doesn't depend on the self-service setting. Admins can set it on the person page too.
It works for every design type, including SVG image designs, where it appears as text above the image.

## Service accounts and unlicensed accounts

People lists only **enabled member accounts with an active Exchange Online mailbox plan**. Accounts without a licence,
or with only free licences (Power BI, Teams Exploratory, Fabric…), don't appear and get no signature. After changing
licences in Microsoft 365, click **Overview › Refresh from directory**.

Service accounts that do have a mailbox licence (noreply@, scanners, test or room mailboxes):
- **Many accounts:** create the group `SG-Signature-Excluded` (the setup script with `-CreateGroups` can), add the
  accounts, and select it under **Companies and groups › Excluded accounts**.
- **One account:** open it in **People** › **Exclude from signatures** (with an optional reason).

Excluded accounts disappear from People, the Overview and the report, and Outlook inserts no signature for them.
**People › Excluded** lists them; **Include again** reverses a manual exclusion. Group exclusions end when the
account leaves the group. Only IT administrators can exclude, and company editors never see excluded accounts.

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

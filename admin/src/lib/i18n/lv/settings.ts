export const settings: Record<string, string> = {
  // Settings.tsx
  Server: 'Serveris',
  'Entra ID connection': 'Entra ID savienojums',
  Fonts: 'Fonti',
  'Local accounts': 'Lokālie konti',
  'Outlook add-in': 'Outlook pievienojumprogramma',
  'Server settings saved': 'Servera iestatījumi saglabāti',
  'Where Outlook loads the add-in and logos from. Changing it means re-uploading the add-in manifest.':
    'No šejienes Outlook ielādē pievienojumprogrammu un logotipus. Pēc maiņas manifests jāaugšupielādē no jauna.',
  'Extra allowed origins': 'Papildu atļautie avoti',
  'One per line. The public address is always allowed. Only add origins that call the API from a browser.':
    'Katrs savā rindā. Publiskā adrese vienmēr ir atļauta. Jāpievieno tikai avoti, kas izsauc API no pārlūka.',
  'Save server settings': 'Saglabāt servera iestatījumus',
  'Setup wizard': 'Iestatīšanas vednis',
  'Walk through the first-launch steps again: server address, Entra ID, companies and groups, signature options and the Outlook add-in. Your current settings are kept and shown in each step.':
    'Vēlreiz iziet pirmās palaišanas soļus: servera adrese, Entra ID, uzņēmumi un grupas, paraksta iestatījumi un Outlook pievienojumprogramma. Pašreizējie iestatījumi saglabājas un ir redzami katrā solī.',
  'Run setup wizard again': 'Palaist iestatīšanas vedni vēlreiz',
  'Cached directory data': 'Kataloga dati kešatmiņā',
  'Profiles are cached for 10 minutes and group memberships for 30. Clear the cache after moving someone between groups to see the change immediately.':
    'Profilus kešatmiņā glabā 10 minūtes, dalību grupās – 30. Pēc darbinieka pārcelšanas citā grupā kešatmiņu var notīrīt, lai izmaiņas redzētu uzreiz.',
  'Cache cleared': 'Kešatmiņa notīrīta',
  'Clear cache': 'Notīrīt kešatmiņu',
  'Local accounts sign in with a username and password and always have full access. Keep at least one as a break-glass login. Day to day, admins can use their Microsoft account instead.':
    'Lokālie konti pierakstās ar lietotājvārdu un paroli, un tiem vienmēr ir pilna piekļuve. Vismaz viens jāpatur ārkārtas piekļuvei. Ikdienā administratori var lietot savu Microsoft kontu.',
  'Last sign-in': 'Pēdējā pierakstīšanās',
  You: 'Jūs',
  'Change password': 'Mainīt paroli',
  'Add local account': 'Pievienot lokālo kontu',
  'New password for {name}': 'Jauna parole: {name}',
  'Password changed': 'Parole nomainīta',
  'Account added': 'Konts pievienots',
  'Add account': 'Pievienot kontu',
  'larger than 12 MB': 'lielāks par 12 MB',
  'could not read the file': 'neizdevās nolasīt failu',
  '{font} added': '{font} pievienots',
  'Image signatures (designs made from an SVG) are drawn on the server, so it needs the font files the design uses. Poppins is included. Upload the .ttf or .otf files of other fonts your company licenses, for example {font} for Vareno Group. They’re stored on this server only and never published. After adding a font, new emails use it; images in already-sent emails don’t change.':
    'Attēla parakstus (dizainus no SVG) zīmē serveris, tāpēc tam vajag dizainā lietoto fontu failus. Poppins ir iekļauts. Citiem uzņēmuma licencētiem fontiem jāaugšupielādē .ttf vai .otf faili, piemēram, {font} uzņēmumam Vareno Group. Tie glabājas tikai šajā serverī un netiek publicēti. Pievienoto fontu lieto jaunās vēstules; jau nosūtītajās vēstulēs attēli nemainās.',
  'Uploading…': 'Augšupielādē…',
  'Upload font files': 'Augšupielādēt fontu failus',
  Weight: 'Treknums',
  File: 'Fails',
  Included: 'Iekļauts',

  // DirectoryForm.tsx
  'Filled in the IDs from the script output': 'ID aizpildīti no skripta izvades',
  'Directory connection saved': 'Kataloga savienojums saglabāts',
  'The container runs with {flag}, so demo data is used whatever you pick here. Remove it from the environment to use Entra ID.':
    'Konteiners darbojas ar {flag}, tāpēc vienmēr tiek lietoti demo dati neatkarīgi no izvēles šeit. Lai lietotu Entra ID, tas jānoņem no vides.',
  'Where people come from': 'Darbinieku avots',
  'Read real users and groups from your tenant through Microsoft Graph (read-only).':
    'Nolasa īstos lietotājus un grupas no nomnieka caur Microsoft Graph (tikai lasīšana).',
  'Demo data': 'Demo dati',
  'Eight sample people from fixtures/users.json. Good for trying designs before connecting the tenant.':
    'Astoņi parauga darbinieki no fixtures/users.json. Der dizainu izmēģināšanai pirms nomnieka pievienošanas.',
  'Register the app in Entra ID': 'Lietotnes reģistrācija Entra ID',
  'Create a certificate on your admin machine. The private key stays with you until you upload it below.':
    'Administratora datorā izveidot sertifikātu. Privātā atslēga paliek pie jums, līdz to augšupielādē zemāk.',
  'As a Global Administrator, run the setup script from the repository in PowerShell 7. It creates the "Tenax Signature API" registration, grants read-only Graph permissions and prints the IDs. It never touches users or mailboxes.':
    'Kā globālajam administratoram palaist repozitorija iestatīšanas skriptu PowerShell 7 vidē. Tas izveido reģistrāciju „Tenax Signature API“, piešķir Graph atļaujas tikai lasīšanai un izdrukā ID. Lietotājus un pastkastes tas neskar.',
  'Prefer clicking through the portal? Follow docs/entra-setup.md; it covers the same steps by hand.':
    'Ērtāk portālā? Tie paši soļi manuāli aprakstīti failā docs/entra-setup.md.',
  'Paste everything the script printed. The IDs below fill in automatically.': 'Ielīmēt visu skripta izvadi. ID zemāk aizpildīsies automātiski.',
  'Script output': 'Skripta izvade',
  'Directory (tenant) ID': 'Kataloga (nomnieka) ID',
  'Use the GUID, not the domain name': 'Jānorāda GUID, nevis domēna nosaukums',
  'Application (client) ID': 'Lietotnes (klienta) ID',
  'Should be a GUID': 'Jābūt GUID',
  'Application ID URI': 'Lietotnes ID URI',
  'Leave empty to use {uri}': 'Ja tukšs, izmanto {uri}',
  'App credential': 'Lietotnes akreditācijas dati',
  Certificate: 'Sertifikāts',
  '(recommended for production)': '(ieteicams produkcijai)',
  'Client secret': 'Klienta noslēpums',
  '(testing only)': '(tikai testēšanai)',
  'A certificate is stored (expires {date}). Upload a new one only to rotate it.':
    'Sertifikāts saglabāts (derīgs līdz {date}). Jaunu augšupielādēt tikai nomaiņai.',
  'A certificate is stored. Upload a new one only to rotate it.': 'Sertifikāts saglabāts. Jaunu augšupielādēt tikai nomaiņai.',
  'Certificate and private key (PEM)': 'Sertifikāts un privātā atslēga (PEM)',
  'Select both .crt.pem and .key.pem, or paste them together. Stored encrypted on the server.':
    'Jāizvēlas abi faili .crt.pem un .key.pem vai jāielīmē tie kopā. Serverī glabājas šifrēti.',
  'Choose PEM files': 'Izvēlēties PEM failus',
  'Client secret value': 'Klienta noslēpuma vērtība',
  'A secret is stored. Enter a new one only to replace it.': 'Noslēpums saglabāts. Jaunu ievadīt tikai nomaiņai.',
  'Secrets expire and are easy to leak. Switch to a certificate before going live.':
    'Noslēpumiem beidzas derīgums, un tie viegli nopludināmi. Pirms ieviešanas jāpāriet uz sertifikātu.',
  'Connection works.': 'Savienojums darbojas.',
  "Couldn't connect.": 'Neizdevās savienoties.',
  'Testing…': 'Pārbauda…',
  'Test connection': 'Pārbaudīt savienojumu',
  'Save connection': 'Saglabāt savienojumu',

  // CompanyGroupsEditor.tsx
  '{company} removed. Its people now get the default company’s signature until they’re in another company group.':
    '{company} noņemts. Tā darbinieki saņem noklusējuma uzņēmuma parakstu, līdz tiek iekļauti citā uzņēmuma grupā.',
  'Companies and groups saved': 'Uzņēmumi un grupas saglabāti',
  'Priority {n}': 'Prioritāte {n}',
  'This is the default company. Choose another default below first.': 'Šis ir noklusējuma uzņēmums. Vispirms zemāk jāizvēlas cits.',
  'Short name': 'Īsais nosaukums',
  'Shown in signatures and in this console': 'Rāda parakstos un šajā konsolē',
  'Used in the footer, e.g. SIA "Tenax"': 'Izmanto kājenē, piem., SIA "Tenax"',
  'Security group name': 'Drošības grupas nosaukums',
  'Members get {company}’s signature.': 'Dalībnieki saņem uzņēmuma {company} parakstu.',
  'Members get this company’s signature.': 'Dalībnieki saņem šī uzņēmuma parakstu.',
  'Signature editors group name': 'Parakstu redaktoru grupas nosaukums',
  'Members can edit {company}’s design, brand details and its people’s signature details, and nothing else: no other companies, no settings. Leave the ID empty if nobody outside IT should edit it.':
    'Dalībnieki var rediģēt tikai uzņēmuma {company} dizainu, zīmola datus un tā darbinieku parakstu datus – ne citus uzņēmumus, ne iestatījumus. Ja ārpus IT neviens nedrīkst rediģēt, ID atstāj tukšu.',
  'Members can edit this company’s design, brand details and its people’s signature details, and nothing else: no other companies, no settings. Leave the ID empty if nobody outside IT should edit it.':
    'Dalībnieki var rediģēt tikai šī uzņēmuma dizainu, zīmola datus un tā darbinieku parakstu datus – ne citus uzņēmumus, ne iestatījumus. Ja ārpus IT neviens nedrīkst rediģēt, ID atstāj tukšu.',
  "When someone is in more than one company group, the company higher in this list wins, and they're flagged on the Overview page so you can fix their membership.":
    'Ja darbinieks ir vairākās uzņēmumu grupās, noteicošais ir sarakstā augstāk esošais uzņēmums, un darbinieks tiek atzīmēts lapā „Pārskats“, lai dalību varētu izlabot.',
  'People in no company group': 'Darbinieki bez uzņēmuma grupas',
  "Use this company's signature": 'Izmantot šī uzņēmuma parakstu',
  "They're also listed on the Overview page so you can add them to the right group.":
    'Tie redzami arī lapā „Pārskats“, lai tos varētu pievienot pareizajai grupai.',
  'Access groups': 'Piekļuves grupas',
  'IT administrators group name': 'IT administratoru grupas nosaukums',
  'Full access to everything: all companies, groups, settings and accounts. Keep this to your IT team.':
    'Pilna piekļuve visam: visiem uzņēmumiem, grupām, iestatījumiem un kontiem. Tikai IT komandai.',
  'Pilot group name': 'Pilotgrupas nosaukums',
  'Assign the Outlook add-in to this group first. Everyone else keeps their current signature until you roll out.':
    'Outlook pievienojumprogrammu vispirms piešķir šai grupai. Pārējie līdz ieviešanai saglabā pašreizējo parakstu.',
  'Excluded accounts group name': 'Izslēgto kontu grupas nosaukums',
  'Service accounts, scanners, test and room mailboxes: members get no signature and don’t appear in People or the report. Single accounts can also be excluded from their person page.':
    'Servisa konti, skeneri, testa un telpu pastkastes: dalībnieki nesaņem parakstu un neparādās sadaļā „Darbinieki“ vai atskaitē. Atsevišķus kontus var izslēgt arī darbinieka lapā.',
  'Save companies and groups': 'Saglabāt uzņēmumus un grupas',
  'Remove {company}?': 'Noņemt {company}?',
  'People in its group will get the default company’s signature until they’re added to another company group. Its designs stay in the version history, but the company and its editors group mapping are removed.':
    'Tā grupas darbinieki saņems noklusējuma uzņēmuma parakstu, līdz tiks pievienoti citai uzņēmuma grupai. Dizaini paliek versiju vēsturē, bet uzņēmums un tā redaktoru grupas sasaiste tiek noņemti.',
  'Keep it': 'Paturēt',
  'Remove company': 'Noņemt uzņēmumu',

  // GroupPicker.tsx
  'No group named like "{name}" in the directory.': 'Katalogā nav grupas ar nosaukumu, kas līdzīgs „{name}“.',
  'Object IDs look like 8-4-4-4-12 hex characters': 'Objekta ID formāts: 8-4-4-4-12 heksadecimālas rakstzīmes',
  'Placeholder ID: replace with the real object ID': 'Viettura ID: jāaizstāj ar īsto objekta ID',
  'Object ID': 'Objekta ID',
  'Look up this group name in Entra ID': 'Meklēt šo grupas nosaukumu Entra ID',
  Finding: 'Meklē',
  Find: 'Atrast',
  'Matching groups': 'Atbilstošās grupas',

  // Companies.tsx
  'Company names used in signatures, and the Entra security group that puts each person in a company.':
    'Parakstos lietotie uzņēmumu nosaukumi un Entra drošības grupa, kas nosaka katra darbinieka uzņēmumu.',
  'Add company': 'Pievienot uzņēmumu',
  '{company} added. Set its group, then adjust its design.': '{company} pievienots. Tālāk jāiestata grupa un jāpielāgo dizains.',
  'Add a company': 'Jauns uzņēmums',
  'Defaults to SIA "{name}"': 'Pēc noklusējuma SIA "{name}"',
  Key: 'Kods',
  "Lowercase ID used in folders and URLs. It can't be changed later.": 'ID ar mazajiem burtiem mapēm un URL. Vēlāk to mainīt nevar.',
  'Start from the design of': 'Dizainu kopēt no',

  // lib/types.ts (ownTitleLabel)
  'Job title (Latvian)': 'Amats (latviski)',
  'Job title (Estonian)': 'Amats (igauniski)',
  'Job title (Lithuanian)': 'Amats (lietuviski)',
};

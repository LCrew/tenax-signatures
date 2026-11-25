/** Latvian console text: shell. Key = the English text exactly as in the code; value = Latvian. */
export const shell: Record<string, string> = {
  'Console language': 'Konsoles valoda',

  // App.tsx
  "The signature service isn't responding. Check that the container is running.": 'Parakstu serviss neatbild. Pārbaudiet, vai konteiners darbojas.',
  Starting: 'Startē',

  // Layout.tsx
  'Demo directory': 'Demo katalogs',
  "You can edit these companies' designs and their people's signature details": 'Var rediģēt šo uzņēmumu dizainus un to darbinieku paraksta datus',
  'Editor: {companies}': 'Redaktors: {companies}',
  'Local account': 'Lokālais konts',
  'Main navigation': 'Galvenā navigācija',
  Setup: 'Iestatīšana',
  More: 'Vairāk',

  // ui.tsx
  Copied: 'Nokopēts',
  Copy: 'Kopēt',
  Loading: 'Ielādē',
  'Try again': 'Mēģināt vēlreiz',
  never: 'nekad',
  'just now': 'tikko',
  '{n} min ago': 'pirms {n} min',
  '{n} h ago': 'pirms {n} h',

  // Appearance.tsx
  Theme: 'Motīvs',
  Recommended: 'Ieteicams',
  Surfaces: 'Virsmas',
  Glass: 'Stikls',
  Solid: 'Necaurspīdīgs',
  'Glass lets the page’s colour show through panels and bars. Solid keeps every panel plain and opaque.':
    'Stikls: lapas krāsa redzama cauri paneļiem un joslām. Necaurspīdīgs: visi paneļi vienkrāsaini un necaurspīdīgi.',
  'Saved in this browser only. Signature previews always show the email on white, as recipients see it.':
    'Saglabāts tikai šajā pārlūkā. Parakstu priekšskatījumos e-pasts vienmēr ir uz balta fona, kā to redz saņēmēji.',

  // appearance.ts
  'Match system': 'Kā sistēmā',
  'Light or dark, as your device is set': 'Gaišs vai tumšs, kā iestatīts ierīcē',
  Light: 'Gaišs',
  Dark: 'Tumšs',
  Blue: 'Zils',
  Green: 'Zaļš',
  Neon: 'Neons',

  // api.ts
  'Download failed ({status})': 'Lejupielāde neizdevās ({status})',

  // auth.ts
  'Microsoft sign-in is not configured yet': 'Microsoft pierakstīšanās vēl nav iestatīta',

  // Login.tsx
  'Sign-in failed': 'Pierakstīšanās neizdevās',
  Username: 'Lietotājvārds',
  Password: 'Parole',
  'Signing in…': 'Pierakstās…',
  'Sign in as administrator': 'Pierakstīties kā administratoram',
  'One signature per company, filled in from the company directory. Outlook adds it automatically on every device.':
    'Viens paraksts katram uzņēmumam, aizpildīts no uzņēmuma kataloga. Outlook to pievieno automātiski visās ierīcēs.',
  'Email signature': 'E-pasta paraksts',
  'Sign in with your work account to see and adjust your signature.': 'Pierakstieties ar darba kontu, lai skatītu un pielāgotu savu parakstu.',
  'Sign in with Microsoft': 'Pierakstīties ar Microsoft',
  'Administrator sign-in with a local account': 'Administratora pierakstīšanās ar lokālo kontu',
  "Microsoft sign-in isn't connected yet, so employees can't sign in. An administrator can connect it in Settings › Entra ID connection.":
    'Microsoft pierakstīšanās vēl nav pievienota, tāpēc darbinieki nevar pierakstīties. Administrators to var pievienot sadaļā Iestatījumi › Entra ID savienojums.',
  'Development: sign in as a fixture user': 'Izstrāde: pierakstīties kā testa lietotājam',
  'Fixture UPN': 'Testa lietotāja UPN',
  'test.tenax@tenaxgrupa.lv is an admin; the others see only their own signature': 'test.tenax@tenaxgrupa.lv ir administrators; pārējie redz tikai savu parakstu',
  'Continue as fixture user': 'Turpināt kā testa lietotājam',

  // Setup.tsx
  'Unlock setup': 'Atbloķēt iestatīšanu',
  'Create your admin account': 'Administratora konts',
  'Server address': 'Servera adrese',
  'Connect Entra ID': 'Entra ID savienojums',
  'Companies and groups': 'Uzņēmumi un grupas',
  'Signature options': 'Paraksta iestatījumi',
  'Check a signature': 'Paraksta pārbaude',
  'Roll out the Outlook add-in': 'Outlook pievienojumprogrammas ieviešana',
  'The service reads names, titles and phone numbers from Entra ID. It never writes to it. You can start with demo data and connect the tenant later in Settings.':
    'Serviss nolasa vārdus, amatus un tālruņu numurus no Entra ID, bet tur neko neraksta. Var sākt ar demo datiem un nomnieku pievienot vēlāk sadaļā Iestatījumi.',
  'Skip for now': 'Pagaidām izlaist',
  "Each person gets their company's signature based on the security group they're in. Rename companies, point them at the right groups, and set the order that settles overlaps.":
    'Katrs darbinieks saņem sava uzņēmuma parakstu pēc drošības grupas, kurā ir. Pārdēvējiet uzņēmumus, piesaistiet tiem pareizās grupas un iestatiet secību, kas izšķir pārklāšanos.',
  'Group IDs from the setup script are filled in. Check them, then save.': 'Grupu ID no iestatīšanas skripta ir aizpildīti. Pārbaudiet tos un saglabājiet.',
  'Save and continue': 'Saglabāt un turpināt',
  'First-time setup': 'Sākotnējā iestatīšana',
  'Everything here can be changed later in Settings. Your progress is saved as you go.': 'Visu var vēlāk mainīt sadaļā Iestatījumi. Progress tiek saglabāts automātiski.',
  Continue: 'Turpināt',
  Welcome: 'Laipni lūdzam',
  'This console sets up company email signatures for everyone at Tenax Grupa. First, prove you have access to the server: it printed a one-time setup code when it started.':
    'Šajā konsolē iestata uzņēmuma e-pasta parakstus visiem Tenax Grupa darbiniekiem. Vispirms jāapliecina piekļuve serverim: startējot tas žurnālā izvadīja vienreizēju iestatīšanas kodu.',
  'On the Docker host, show the container log:': 'Docker resursdatorā parādiet konteinera žurnālu:',
  'Copy the code from the box that says {box}. It works once, and only until the first admin account exists.':
    'Nokopējiet kodu no lodziņa ar uzrakstu {box}. Tas derīgs vienu reizi un tikai līdz pirmā administratora konta izveidei.',
  'Setup code': 'Iestatīšanas kods',
  'Checking…': 'Pārbauda…',
  "The passwords don't match": 'Paroles nesakrīt',
  'This local account always works, even if Microsoft sign-in is misconfigured. Keep it as a break-glass login and store the password in your password manager.':
    'Šis lokālais konts darbojas vienmēr, arī ja Microsoft pierakstīšanās iestatīta nepareizi. Paturiet to ārkārtas piekļuvei un glabājiet paroli paroļu pārvaldniekā.',
  'At least 12 characters, mixing letters with numbers or symbols': 'Vismaz 12 rakstzīmes: burti kopā ar cipariem vai simboliem',
  'Repeat password': 'Atkārtot paroli',
  'Creating…': 'Izveido…',
  'Create account and continue': 'Izveidot kontu un turpināt',
  'Use https:// and a host name only, e.g. https://sig.tenax.lv': 'Tikai https:// un resursdatora nosaukums, piem., https://sig.tenax.lv',
  'Outlook downloads the add-in and logo images from this address, so it must be reachable over HTTPS by everyone who sends email.':
    'Outlook no šīs adreses lejupielādē pievienojumprogrammu un logotipu attēlus, tāpēc tai jābūt sasniedzamai ar HTTPS ikvienam, kas sūta e-pastu.',
  'Public address': 'Publiskā adrese',
  "You're using this console at {here}. That's fine for setup. Point DNS for the public address at this server and terminate TLS in front of it (reverse proxy or load balancer) before the pilot.":
    'Konsole atvērta adresē {here}. Iestatīšanai tas der. Pirms pilotprojekta novirziet publiskās adreses DNS uz šo serveri un nodrošiniet TLS tā priekšā (reversais starpniekserveris vai slodzes līdzsvarotājs).',
  'Hide mobile number': 'Slēpt mobilā numuru',
  'Mobile number': 'Mobilā tālruņa numurs',
  'Latvian job title': 'Amats latviski',
  'Address line (e.g. another office)': 'Adreses rinda (piem., cits birojs)',
  'Signature options saved': 'Paraksta iestatījumi saglabāti',
  'Job title language': 'Amata valoda',
  'Both titles, English on its own line when set': 'Abi amati; angliskais atsevišķā rindā, ja norādīts',
  'English titles are ignored': 'Angliskos amatus neņem vērā',
  'Falls back to the Latvian title when no English one is set': 'Ja angliskā amata nav, rāda latvisko',
  'Self-service': 'Pašapkalpošanās',
  'Let people edit parts of their own signature': 'Ļaut darbiniekiem rediģēt daļu sava paraksta',
  'People sign in with Microsoft at this address and edit the fields you tick on their My signature page. Everyone can always view their own signature.':
    'Darbinieki šajā adresē pierakstās ar Microsoft un lapā „Mans paraksts“ rediģē atzīmētos laukus. Savu parakstu var skatīt ikviens.',
  'Save options': 'Saglabāt iestatījumus',
  'Choose the job title language and whether people can adjust their own signature.': 'Izvēlieties amata valodu un to, vai darbinieki var pielāgot savu parakstu.',
  'Pick a few people and look at their signature. You can change the designs in the Designs page after setup.':
    'Izvēlieties dažus darbiniekus un apskatiet viņu parakstus. Dizainus pēc iestatīšanas var mainīt lapā „Dizaini“.',
  "Couldn't load people: {error}. Go back and test the directory connection.": 'Neizdevās ielādēt darbiniekus: {error}. Atgriezieties un pārbaudiet savienojumu ar katalogu.',
  'Loading people': 'Ielādē darbiniekus',
  'The directory returned no licensed users. Check the Graph permissions from the Entra step.': 'Katalogā nav licencētu lietotāju. Pārbaudiet Graph atļaujas no Entra soļa.',
  Person: 'Darbinieks',
  '(missing {n})': '(trūkst: {n})',
  'The add-in inserts the signature automatically in new Outlook, classic Outlook, Outlook on the web, Mac and mobile. Start with the pilot group.':
    'Pievienojumprogramma automātiski ievieto parakstu jaunajā Outlook, klasiskajā Outlook, Outlook tīmeklī, Mac un mobilajās ierīcēs. Sāciet ar pilotgrupu.',
  "You're still on demo data. The add-in needs the Entra connection to identify real people, so connect it in Settings before uploading the manifest.":
    'Joprojām tiek lietoti demo dati. Lai atpazītu īstus darbiniekus, pievienojumprogrammai vajag Entra savienojumu, tāpēc pirms manifesta augšupielādes pievienojiet to sadaļā Iestatījumi.',
  'Finish setup': 'Pabeigt iestatīšanu',

  // AddinSteps.tsx
  'Make sure {url} reaches this container over HTTPS. Outlook only loads add-ins from trusted TLS hosts.':
    'Pārliecinieties, ka {url} ar HTTPS sasniedz šo konteineru. Outlook ielādē pievienojumprogrammas tikai no uzticamiem TLS resursdatoriem.',
  "Download the manifest. It already contains this server's address and your app ID.": 'Lejupielādējiet manifestu. Tajā jau ir šī servera adrese un lietotnes ID.',
  'Download manifest.xml': 'Lejupielādēt manifest.xml',
  'In the {center}, go to Settings › Integrated apps › Upload custom apps, and choose "Office Add-in" › "Upload manifest file (.xml) from device".':
    'Atveriet {center}, dodieties uz Settings › Integrated apps › Upload custom apps un izvēlieties „Office Add-in“ › „Upload manifest file (.xml) from device“.',
  'Assign it to {users} and pick {group}. Leave the deployment as "Fixed". Do not assign it to the entire organisation yet.':
    'Piešķiriet to opcijai {users} un izvēlieties {group}. Izvēršanas veidu atstājiet „Fixed“. Visai organizācijai to vēl nepiešķiriet.',
  'the pilot group': 'pilotgrupu',
  'Wait. Microsoft can take up to 24 hours to push the add-in to Outlook clients. Then work through docs/pilot-checklist.md with a pilot mailbox.':
    'Gaidiet: Microsoft var vajadzēt līdz 24 stundām, lai pievienojumprogramma nonāktu Outlook klientos. Tad izpildiet docs/pilot-checklist.md ar pilotgrupas pastkasti.',
  'When the pilot passes, edit the deployment in the admin center and change the assignment to the entire organisation.':
    'Kad pilotprojekts izdevies, administrēšanas centrā rediģējiet izvēršanu un piešķiriet to visai organizācijai.',
  'Scripted alternative: scripts/deploy-addin.ps1 does the same with the O365CentralizedAddInDeployment module.':
    'Ar skriptu: scripts/deploy-addin.ps1 dara to pašu ar moduli O365CentralizedAddInDeployment.',

  // Overview.tsx
  "How complete everyone's signature data is. Fix gaps in on-premises AD where you can; corrections here are a stopgap.":
    'Cik pilnīgi ir visu darbinieku paraksta dati. Trūkstošo labojiet lokālajā AD, kur iespējams; labojumi šeit ir pagaidu risinājums.',
  'Reloaded from the directory': 'Atkārtoti ielādēts no kataloga',
  'Refresh from directory': 'Atsvaidzināt no kataloga',
  'Download CSV': 'Lejupielādēt CSV',
  'Building report': 'Veido atskaiti',
  'person with a mailbox licence': 'darbinieks ar pastkastes licenci',
  'people with a mailbox licence': 'darbinieki ar pastkastes licenci',
  'have every signature field': 'ir visi paraksta lauki',
  'in more than one company group': 'vairāk nekā vienā uzņēmuma grupā',
  'in no company group': 'nav nevienā uzņēmuma grupā',
  'Counting people with an Exchange mailbox licence.': 'Skaitīti darbinieki ar Exchange pastkastes licenci.',
  '{n} account is excluded (service accounts etc.), see {link}.': '{n} konts izslēgts (servisa konti u. c.), sk. {link}.',
  '{n} accounts are excluded (service accounts etc.), see {link}.': '{n} konti izslēgti (servisa konti u. c.), sk. {link}.',
  'People › Excluded': 'Darbinieki › Izslēgtie',
  'Exclude service accounts from their person page or with the exclusion group.': 'Servisa kontus izslēdziet to darbinieka lapā vai ar izslēgšanas grupu.',
  'Missing fields': 'Trūkstošie lauki',
  'Nothing missing. Every signature is complete.': 'Nekā netrūkst. Visi paraksti ir pilnīgi.',
  'People per company': 'Darbinieki pa uzņēmumiem',
  'Needs attention': 'Nepieciešama uzmanība',
  'No conflicts, no one without a company, no missing fields.': 'Nav konfliktu, visiem ir uzņēmums, netrūkst neviena lauka.',
  Problem: 'Problēma',
  'In {n} company groups': 'Uzņēmuma grupās: {n}',
  'No company group': 'Nav uzņēmuma grupas',
  'No {field}': 'Trūkst: {field}',
  'Outlook add-in errors': 'Outlook pievienojumprogrammas kļūdas',
  'Last 24 hours': 'Pēdējās 24 stundas',
  'No failures reported by Outlook clients.': 'Outlook klienti nav ziņojuši par kļūmēm.',
  'unknown user': 'nezināms lietotājs',

  // Activity.tsx
  'Signed in': 'Pierakstījās',
  'Failed sign-in': 'Neizdevusies pierakstīšanās',
  'Corrected signature details': 'Laboja paraksta datus',
  'Edited own signature': 'Rediģēja savu parakstu',
  'Saved a design version': 'Saglabāja dizaina versiju',
  'Restored a design version': 'Atjaunoja dizaina versiju',
  'Reloaded designs from disk': 'Pārlādēja dizainus no diska',
  'Changed a company': 'Mainīja uzņēmumu',
  'Added a company': 'Pievienoja uzņēmumu',
  'Removed a company': 'Noņēma uzņēmumu',
  'Added a shared mailbox': 'Pievienoja koplietojamo pastkasti',
  'Changed a shared mailbox': 'Mainīja koplietojamo pastkasti',
  'Removed a shared mailbox': 'Noņēma koplietojamo pastkasti',
  'Changed settings': 'Mainīja iestatījumus',
  'Changed the Entra connection': 'Mainīja Entra savienojumu',
  'Created the first admin': 'Izveidoja pirmo administratoru',
  'Finished setup': 'Pabeidza iestatīšanu',
  'Reopened the setup wizard': 'Atkārtoti atvēra iestatīšanas vedni',
  'Excluded an account from signatures': 'Izslēdza kontu no parakstiem',
  'Created a design': 'Izveidoja dizainu',
  'Changed a design': 'Mainīja dizainu',
  'Removed a design': 'Noņēma dizainu',
  'Chose their signature design': 'Izvēlējās sava paraksta dizainu',
  'Changed their closing line': 'Mainīja savu noslēguma frāzi',
  'Saved an image (SVG) design': 'Saglabāja attēla (SVG) dizainu',
  'Uploaded a font': 'Augšupielādēja fontu',
  'Removed a font': 'Noņēma fontu',
  'Included an account in signatures again': 'Atkal iekļāva kontu parakstos',
  'Cleared the cache': 'Iztīrīja kešatmiņu',
  'Uploaded an image': 'Augšupielādēja attēlu',
  'Added a local account': 'Pievienoja lokālo kontu',
  'Changed a password': 'Nomainīja paroli',
  'Removed a local account': 'Noņēma lokālo kontu',
  'Every change made in this console, and failures reported by Outlook clients. Add-in errors are reported anonymously by the client, so treat their text as unverified.':
    'Visas šajā konsolē veiktās izmaiņas un Outlook klientu ziņotās kļūmes. Pievienojumprogrammas kļūdas klients ziņo anonīmi, tāpēc to teksts nav pārbaudīts.',
  View: 'Skats',
  Changes: 'Izmaiņas',
  'Add-in errors': 'Pievienojumprogrammas kļūdas',
  When: 'Kad',
  Who: 'Kas',
  What: 'Darbība',
  Target: 'Objekts',
  "No failures reported. The add-in reports here when it can't insert a signature.": 'Kļūmju nav. Pievienojumprogramma ziņo šeit, ja nevar ievietot parakstu.',
  User: 'Lietotājs',
  Stage: 'Posms',
  Message: 'Ziņojums',
  Client: 'Klients',
  unknown: 'nezināms',
};

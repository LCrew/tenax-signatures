# First launch: step-by-step setup (Docker)

This takes about 30 minutes, plus up to 24 hours for Microsoft to push the add-in to Outlook. You need:

- a Linux or Windows server with Docker Engine and the Compose plugin
- DNS for `sig.tenaxgrupa.lv` pointing at that server, with ports 80 and 443 reachable (or your own reverse proxy / load balancer)
- a Global Administrator account for the `TenaxMID.onmicrosoft.com` tenant
- PowerShell 7 with the Microsoft Graph module on an admin workstation (only for the Entra step)

## 1. Start the container

```bash
git clone <this repo> tenax-signatures && cd tenax-signatures
cp .env.example .env
# Recommended: a fixed key for encrypting stored credentials
sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 32)|" .env
```

Pick one:

| Setup | Command | `.env` |
|---|---|---|
| Built-in HTTPS (Caddy + Let's Encrypt) | `docker compose --profile tls up -d --build` | `TRUST_PROXY=true`, `TLS_HOST=sig.tenaxgrupa.lv` |
| Your own reverse proxy / load balancer | `docker compose up -d --build`, proxy to port 8085 | `TRUST_PROXY=true` |
| Local trial on a laptop | `docker compose up -d --build` | defaults |

Data (SQLite database, uploaded logos, encryption key) lives in the `sig-data` volume. Back it up.

### On the Linux hosting machine

```bash
git clone <your remote>/tenax-signatures.git /opt/tenax-signatures && cd /opt/tenax-signatures
cp .env.example .env
sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 32)|" .env
docker compose up -d --build
docker compose ps                 # wait for "healthy"
curl -s http://127.0.0.1:8085/healthz
```

The service listens on **port 8085** (container and host). Change `HOST_PORT` in `.env` if 8085 is taken too.

**HTTPS is required for Microsoft sign-in.** Browsers only allow MSAL's sign-in on `https://` or `http://localhost`.
Plain `http://<server-ip>:8085` is fine for the setup wizard with the local admin account, but "Sign in with Microsoft"
won't work there. Before employees use it, put TLS in front:

- **Cloudflare Zero Trust tunnel** (recommended here): see [Cloudflare Tunnel](#cloudflare-tunnel) below.
- **Existing reverse proxy** (nginx, Traefik, a load balancer): proxy `https://sig.tenaxgrupa.lv` → `http://<host>:8085`,
  and set `TRUST_PROXY=true` in `.env`.
- **Built-in Caddy** (`--profile tls`): needs ports 80 and 443 free on the host, plus public DNS for `TLS_HOST`.

For a quick test from your own computer before DNS/TLS exist, tunnel the port so the browser sees `localhost`:
`ssh -L 8085:127.0.0.1:8085 user@server`, then open http://localhost:8085. The redirect URI `http://localhost:8085/`
must be registered on the app (see entra-setup.md step 2).

Updating later: `git pull && docker compose up -d --build` (add `--profile tunnel` if you use it). Data stays in the
`sig-data` volume.

### Cloudflare Tunnel

The tunnel is outbound-only: no inbound ports, no certificates on the host. Cloudflare terminates HTTPS for
`sig.tenaxgrupa.lv`.

1. **Zero Trust › Networks › Tunnels › Create a tunnel** (type *Cloudflared*), name it e.g. `tenax-signatures`.
   Copy the token from the install command (the long string after `--token`).
2. **Public hostname** on that tunnel: subdomain `sig`, domain `tenaxgrupa.lv`, path empty,
   service **HTTP** `signature:8085`. Use `localhost:8085` instead if you run cloudflared on the host
   rather than with this compose file.
3. In `.env` on the server:
   ```
   TUNNEL_TOKEN=<token>
   TRUST_PROXY=true
   HOST_BIND=127.0.0.1     # optional: only the tunnel (and the host itself) can reach the app
   PUBLIC_URL=https://sig.tenaxgrupa.lv
   ```
4. `docker compose --profile tunnel up -d --build`, then open `https://sig.tenaxgrupa.lv`.

**Cloudflare Access: don't put the whole hostname behind a login.** Outlook clients and **everyone who receives
your emails** must reach some paths anonymously. Recipients' mail apps download the logos and banners. Outlook loads the
add-in and calls the API with its own Microsoft token, and can't complete a Cloudflare login. The app already enforces
its own sign-in (Microsoft / local admin) on everything else.

If you do add an Access application for `sig.tenaxgrupa.lv`, add **Bypass** (Everyone) policies, or separate
path-scoped Access applications with a Bypass action, for:

| Path | Who calls it |
|---|---|
| `/assets/*` | Every email recipient (logos, banners) |
| `/addin/*` | Outlook (add-in runtime and manifest) |
| `/.well-known/*` | Classic Outlook (add-in allow-list) |
| `/api/signature`, `/api/telemetry` | Outlook add-in |
| `/api/public/config`, `/api/auth/*`, `/api/me*` | Web console sign-in |
| `/healthz` | Monitoring |

Restricting only the admin pages (`/`, `/people`, `/designs`, …) with Access is possible but adds little, since they
already require an admins-group Microsoft account or a local admin. A simpler setup is no Access policy on this
hostname. Optionally, under **Security › WAF**, rate-limit `/api/auth/login`.

Also check that Cloudflare doesn't cache API responses. The app sends `Cache-Control: no-store` on signatures, and the
default Cloudflare cache rules respect it, so nothing extra is usually needed.

## 2. Get the setup code

```bash
docker compose logs signature | grep "Setup code"
```

The container prints a one-time code on every start until the first admin account exists. Nobody can take over a
fresh install without access to the server's logs.

## 3. Run the wizard

Open `https://sig.tenaxgrupa.lv` (or `http://localhost:8085` for a local trial). The wizard walks through eight steps
and saves progress as you go. Reloading the page resumes on the same step.

| Step | What you do | Notes |
|---|---|---|
| 1. Unlock setup | Paste the setup code | The code stops working once step 2 is done |
| 2. Create your admin account | Username + password (12+ chars) | Local break-glass account. Store it in the password manager |
| 3. Server address | Confirm `https://sig.tenaxgrupa.lv` | Outlook loads the add-in and logos from here |
| 4. Connect Entra ID | See step 4 below, or choose **Demo data** to try the designs first | Changeable later in Settings |
| 5. Companies and groups | Rename companies, map each one to its security group, set priority, default company, admin + pilot groups | "Find" looks the group up in Entra so you don't copy GUIDs |
| 6. Signature options | Title language (LV / EN / both), self-service editing | |
| 7. Check a signature | Preview real people, new vs reply, dark-mode check | |
| 8. Roll out the Outlook add-in | Download the ready-made manifest, upload it in the M365 admin center, assign to the pilot group | |

### Step 4 in detail: Entra ID

On an admin workstation:

```bash
# 1. Certificate. The private key stays on this machine until you upload it in the wizard
openssl req -x509 -newkey rsa:2048 -sha256 -days 730 -nodes \
  -subj "/CN=Tenax Signature API" \
  -keyout tenax-signature-api.key.pem -out tenax-signature-api.crt.pem
openssl x509 -in tenax-signature-api.crt.pem -outform der -out tenax-signature-api.cer
```

```powershell
# 2. App registration (PowerShell 7, as Global Administrator)
Install-Module Microsoft.Graph -Scope CurrentUser
./scripts/entra-setup.ps1 -TenantId TenaxMID.onmicrosoft.com -PublicHost sig.tenaxgrupa.lv -CertPath ./tenax-signature-api.cer
```

3. Paste the JSON the script prints into the wizard's box. It fills in the tenant ID, client ID, Application ID URI and
   (on the next step) the group object IDs.
4. Choose both `tenax-signature-api.crt.pem` and `tenax-signature-api.key.pem` under **Choose PEM files**.
5. **Test connection**, then **Save connection**. Then delete the key file from the workstation.

The script only creates the app registration and grants read-only Graph permissions (`User.Read.All`,
`GroupMember.Read.All`). It never creates or changes users. To create the `SG-Signature-*` groups too, add
`-CreateGroups`; they're created empty. Manual portal steps are in [entra-setup.md](entra-setup.md).

## 4. After the wizard

1. **Sign in with Microsoft.** Once Entra is connected, the sign-in page offers "Sign in with Microsoft" for members of
   `SG-Signature-Admins`. The local account keeps working as a fallback.
2. **Fix data gaps.** Overview lists people in no company group, in several groups, or missing titles and phones.
   Fix them in on-premises AD where possible, and use People › Corrections for the rest.
3. **Replace the placeholder designs.** Use Designs to set logos (upload at 2× size), colours and legal footers, and to
   edit the HTML of each company's new-message and reply signatures. Every save is a version you can restore.
4. **Pilot.** Add a test mailbox (e.g. `sig.test@tenaxgrupa.lv`) to `SG-Signature-Pilot` and one company group, then work
   through [pilot-checklist.md](pilot-checklist.md).
5. **Roll out.** In the M365 admin center, change the add-in's assignment from the pilot group to the entire organisation.

## Troubleshooting first launch

| Symptom | Fix |
|---|---|
| No setup code in the log | An admin account already exists. Sign in, or reset by removing the `sig-data` volume (this deletes everything) |
| "That setup code does not match" | The code changes on every restart until setup is done. Copy the latest one |
| Caddy can't get a certificate | DNS for `TLS_HOST` must point at this host, and ports 80/443 must be open from the internet |
| Test connection: "did not find that application" | Tenant and client IDs swapped, or the app is in a different tenant |
| Test connection: "Graph refused the call" | Admin consent missing: Entra › App registrations › Tenax Signature API › API permissions › Grant admin consent |
| Signed in with Microsoft but "isn't in the admins group" | Add the account to the admins group set in Companies and groups, wait for sync, sign in again |

# First launch: step-by-step setup (Docker)

This takes about 30 minutes, plus up to 24 hours for Microsoft to push the add-in to Outlook. You need:

- a Linux or Windows server with Docker Engine and the Compose plugin
- DNS for `sig.tenax.lv` pointing at that server, with ports 80 and 443 reachable (or your own reverse proxy / load balancer)
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
| Built-in HTTPS (Caddy + Let's Encrypt) | `docker compose --profile tls up -d --build` | `TRUST_PROXY=true`, `TLS_HOST=sig.tenax.lv` |
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

- **Cloudflare Zero Trust tunnel** (our setup: the host's existing tunnel → `localhost:8085`): see [Cloudflare Tunnel](#cloudflare-tunnel) below.
- **Existing reverse proxy** (nginx, Traefik, a load balancer): proxy `https://sig.tenax.lv` → `http://<host>:8085`,
  and set `TRUST_PROXY=true` in `.env`.
- **Built-in Caddy** (`--profile tls`): needs ports 80 and 443 free on the host, plus public DNS for `TLS_HOST`.

For a quick test from your own computer before DNS/TLS exist, tunnel the port so the browser sees `localhost`:
`ssh -L 8085:127.0.0.1:8085 user@server`, then open http://localhost:8085. The redirect URI `http://localhost:8085/`
must be registered on the app (see entra-setup.md step 2).

Updating later: `git pull && docker compose up -d --build` (add `--profile tunnel` if you use it). Data stays in the
`sig-data` volume.

### Cloudflare Tunnel

The tunnel is outbound-only: no inbound ports, no certificates on the host. Cloudflare terminates HTTPS for
`sig.tenax.lv`.

**Using the tunnel that already runs on the host (our setup).** `cloudflared` is installed on the machine itself, so
there's nothing to add to this compose file:

1. **Zero Trust › Networks › Tunnels ›** the host's existing tunnel **› Public hostname › Add a public hostname**:
   subdomain `sig`, domain `tenax.lv`, path empty, service **HTTP** `localhost:8085`.
2. In `.env` on the server:
   ```
   PUBLIC_URL=https://sig.tenax.lv
   TRUST_PROXY=true        # app sees https (secure cookies) and the real client IP
   HOST_BIND=127.0.0.1     # port 8085 reachable only from the host, so only through the tunnel
   ```
3. `docker compose up -d --build` (no `--profile tunnel`), then open `https://sig.tenax.lv`.

`HOST_BIND=127.0.0.1` works because the host's `cloudflared` connects to `localhost:8085`. To reach the app from
another machine on the LAN, for example during setup, leave it at `0.0.0.0`.

*Alternative:* on a host without `cloudflared`, run it from this compose file instead. Create a tunnel, set
`TUNNEL_TOKEN=<token>` in `.env`, point the public hostname at `http://signature:8085`, and start with
`docker compose --profile tunnel up -d --build`.

**Cloudflare Access: don't put the whole hostname behind a login.** Outlook clients and **everyone who receives
your emails** must reach some paths anonymously. Recipients' mail apps download the logos and banners. Outlook loads the
add-in and calls the API with its own Microsoft token, and can't complete a Cloudflare login. The app already enforces
its own sign-in (Microsoft / local admin) on everything else.

If you do add an Access application for `sig.tenax.lv`, add **Bypass** (Everyone) policies, or separate
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

Open `https://sig.tenax.lv` (or `http://localhost:8085` for a local trial). The wizard walks through eight steps
and saves progress as you go. Reloading the page resumes on the same step.

| Step | What you do | Notes |
|---|---|---|
| 1. Unlock setup | Paste the setup code | The code stops working once step 2 is done |
| 2. Create your admin account | Username + password (12+ chars) | Local break-glass account. Store it in the password manager |
| 3. Server address | Confirm `https://sig.tenax.lv` | Outlook loads the add-in and logos from here |
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
./scripts/entra-setup.ps1 -TenantId TenaxMID.onmicrosoft.com -PublicHost sig.tenax.lv -CertPath ./tenax-signature-api.cer
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

## Security checklist (production)

Settings outside the code that the security review asked for. Do them once.

**Server `.env`**
- `TRUST_PROXY=true`: the app then trusts only the proxy hop (cloudflared on this host), so it sees https and the
  real client IP for rate limits, and clients can't spoof it.
- `HOST_BIND=127.0.0.1`: port 8085 is reachable only from the host itself, so only through the tunnel. Check with
  `ss -ltnp | grep 8085`; it should show `127.0.0.1:8085`.
- `APP_SECRET=<openssl rand -base64 32>`, with a copy in your password manager. Without it, the key that encrypts
  the Entra certificate sits in the same volume as the database. **On an existing install**, after setting it,
  re-enter the certificate under Settings › Entra ID connection, and expect everyone to sign in again.

**Cloudflare (dashboard for tenax.lv)**
- SSL/TLS › Edge Certificates: **Always Use HTTPS** on. **HSTS**: enable with max-age ≥ 6 months (the app also
  sends HSTS on https).
- Caching › Configuration › Browser Cache TTL: **Respect Existing Headers**. Or add a Cache Rule that bypasses the
  cache for `/addin/*` and `/.well-known/*`, so add-in changes reach Outlook immediately.
- Optional: Security › WAF rate-limit rule for `/api/auth/login` and `/api/telemetry`.
- No Cloudflare Access login on the whole hostname (see Cloudflare Tunnel above).

**Entra app registration**
- Remove `http://localhost:8085/` from the SPA redirect URIs once you no longer test on a laptop. Use a separate
  app registration for development.
- Optional, stricter: Enterprise applications › Tenax Signature API › Properties › **Assignment required = Yes**,
  then assign the company groups, the editors groups and the IT admins group. Guests and disabled accounts are
  refused by the service either way.
- Keep the certificate's expiry in your calendar (Settings shows the date).

**Access**
- Keep the IT admins group small. Give design work to the per-company *Signature editors* groups instead.
- Local accounts are full IT admins: strong unique passwords, few accounts. After 10 failed sign-ins an account is
  locked for 15 minutes.

## Troubleshooting first launch

| Symptom | Fix |
|---|---|
| No setup code in the log | An admin account already exists. Sign in, or reset by removing the `sig-data` volume (this deletes everything) |
| "That setup code does not match" | The code changes on every restart until setup is done. Copy the latest one |
| Caddy can't get a certificate | DNS for `TLS_HOST` must point at this host, and ports 80/443 must be open from the internet |
| Test connection: "did not find that application" | Tenant and client IDs swapped, or the app is in a different tenant |
| Test connection: "Graph refused the call" | Admin consent missing: Entra › App registrations › Tenax Signature API › API permissions › Grant admin consent |
| Signed in with Microsoft but "isn't in the admins group" | Add the account to the admins group set in Companies and groups, wait for sync, sign in again |

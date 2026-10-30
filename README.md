# Redirector Studio

A local web app that builds, deploys, and **visualizes chained Cloudflare Worker redirectors** for C2 traffic —
Workers, service bindings, and cloudflared, wrapped in a GUI with a live route graph.

```
Implant ──▶ Hop 1 ──▶ Hop 2 ──▶ Hop 3 ──▶ C2
         secret     secret     secret
         header     header     header
```

## Features

- **1–3 hops per chain**, multiple named chains (one per listener/operation)
- **HTTP chains**: hops forward via Cloudflare **service bindings** — inner hops have no public URL at all
- **WebSocket chains**: hops forward via public `fetch` (all hops exposed, still secret-gated), because
  websocket pass-through over service bindings is unreliable
- **Per-hop Cloudflare accounts**: spread a chain across up to 3 accounts (burner separation) — the canvas
  badges every hop with `@account`; cross-account legs forward via public `fetch` instead of service bindings
- **Never leaks**: unauthenticated requests get a benign disguise page (portfolio / blog / business templates
  or your own HTML); so do requests when the tunnel/listener is down — no Cloudflare-branded error pages
- **Quarantine kill switch**: one click blackholes a chain (hop 1 serves the disguise page to everything)
  without destroying infra; Destroy reverses it all
- **Pause a hop** (testing/debugging): mark any hop but the first as paused and traffic routes straight past
  it — the previous hop targets the next active one (or the C2), and the paused worker itself serves the
  disguise page. Applies on the next deploy of that hop + upstream. Removing a hop from a deployed chain
  tears its worker (and domains) down automatically; validation nudges when a chain's front sits on the
  primary while a burner account exists
- **Live validation**: the canvas shows draft problems as you edit (red banner = deploy-blocking errors,
  amber = warnings), so what you see is exactly what a deploy would enforce — no save-then-surprise
- **Agents that can't send headers**: the gate also accepts the secret as the first URL path segment —
  `https://<hop>/<secret>/…` — which the hop strips before forwarding, so the listener never sees it
- **Test path**: a canary request stamped by every hop shows exactly where a broken chain breaks, with latency
- **Profile export**: Generic HTTP, Havoc (.yaotl), Mythic (c2_instance), Sliver (implant_config) — pointed at
  hop 1 with the right headers, plus ready-to-paste implant build commands
- **Token doctor**: verifies your Cloudflare API token has every permission before you're mid-deploy

## Quick start

```bash
npm install
npm run build     # builds the UI into web/dist
npm start         # serves UI + API on http://127.0.0.1:7331
```

Requires Node 18+. Development mode: `npm run dev` (API + Vite dev server on :5173).

### Cloudflare setup

1. **API token** — dash.cloudflare.com → My Profile → API Tokens → Create Token (custom), one row per
   permission (scope → permission → level):
   - `Account > Workers Scripts > Edit` (also covers attaching Worker custom domains — there is no separate
     "Workers Custom Domains" permission in the token editor)
   - `Account > Account Settings > Read`
   - `Zone > Zone > Read` (All zones)
   - `Zone > DNS > Edit` (All zones) — DNS records live in the Zone scope; the Account-scoped "DNS Settings"
     entry is a different permission and won't cover the tunnel CNAME
   - `Account > Cloudflare Tunnel: Edit` (only for tunnel mode)
2. Enter the token in **Settings**, then **Save + run token doctor** — it reports anything missing and lets you
   pick the account/zone from the token.
3. Fill in the **workers.dev subdomain** (dashboard → Workers & Pages → right sidebar) for workers.dev exposure.

### Multiple accounts (per-hop)

**Settings → + Add account** stores extra Cloudflare credentials (up to 8; each row has its own token-doctor
run). Account placement is **automatic and positional** — there is no per-hop account picker:

- **1 hop** → the hop runs on the primary account.
- **2+ hops** → hop 1 (the disposable front) runs on the first marked burner; the backbone hops run on the
  primary. With no burner configured, everything lands on the primary.
- The policy re-applies whenever hops are added or removed, when a chain is saved/imported/duplicated, and
  when burner marks change in Settings — so e.g. dropping a 2-hop chain to 1 hop moves the remaining hop
  back to the primary. The hop panel shows the assignment read-only; the canvas shows an `@account` badge
  per hop plus a `fetch →` label on cross-account edges.

- **Same-account hops** chain via service bindings — inner hops stay unexposed.
- **Cross-account hops** forward via public `fetch()` (service bindings are same-account only), so the next
  hop must be exposed on workers.dev or a custom domain — validation enforces this before deploy. Each hop's
  secret gate still applies; the chain is only as exposed as its individual hops are.
- WebSocket chains always forward via fetch regardless of accounts.
- Deploy, destroy, quarantine, status, and the doctor all run **per-account** — every distinct account in a
  chain gets its own API calls and its own health report.
- The C2 tunnel is created in the account chosen on the C2 node (defaults to the last hop's account), since
  the DNS record for the listener hostname lives there.
- **Burner accounts**: any non-primary account can be marked as a *burner* (disposable, expected to be
  burned) — a small link on its Settings card, then a red chip. The primary (first) account can't be
  marked. Burners only matter through the positional policy above: with 2+ hops the front lives there, so
  seizing it exposes only the next hop's coordinates.

### Workflow

1. **+ New operation** (recommended) or **+ New chain**.
   - An **operation** is one red-team setup with two lanes: **listener** (implant callbacks, top row)
     and **stager** (payload retrieval, bottom row). Each lane is a full chain — its own hops, accounts,
     C2 target and deploy lifecycle. **In the sidebar an operation is a single entity**: one card with
     the lane summary (`listener 1h · stager 1h`), an `op` badge, and **Deploy all / Quarantine /
     Destroy** buttons that fan out over both lanes, plus **Ungroup** (chains become standalone, workers
     untouched). Deleting an operation never burns infrastructure.
   - Open any lane and the **canvas shows the whole operation**: one shared Implant node feeding both
     lanes (per-lane rows with deploy counts). Click a sibling lane's node to jump into that lane —
     edits always land in the lane you're on, and switching warns if that lane has unsaved edits.
   - A plain chain is a single lane; existing chains are unaffected.
2. Click **+ Add hop** on the canvas to chain up to 3 redirectors. Configure each hop in the right panel:
   display name, secret header/value (auto-generated, rotate anytime), exposure, gate-failure behavior,
   disguise page. Accounts are assigned automatically (see *Multiple accounts*).
   - Hop 1 needs a public URL (workers.dev or custom domain) — it is the implant's callback host.
   - Inner hops default to *no exposure*: only reachable via service bindings from the previous worker.
3. Click the **C2** node:
   - *Direct*: the final hop calls your listener URL over the public internet (firewall it to Cloudflare IP
     ranges at minimum).
   - *Tunnel*: set the public listener hostname + the local service the C2 listener binds to, hit
     **Provision tunnel**, then run the printed `cloudflared tunnel run --token <token>` on the C2 box
     (keep it alive in tmux/screen; to make it a boot-persistent service instead use
     `cloudflared service install <token>` on a fresh box, or a hand-written systemd unit when one
     already runs — the installer refuses a second service per box). The
     proxied CNAME, tunnel, and remote ingress config are all created via the API. For a Mythic setup the
     listener lane points at the Mythic listener port and the stager lane at the staging port — both can
     share one tunnel/connector with different hostnames.
   - **Two provisioned tunnels on one box:** the systemd installer only ever writes a single
     `cloudflared.service` — a second `service install` refuses with *"cloudflared service is already
     installed"*. Run the second tunnel as its own unit instead (never `service uninstall` the running
     one — that kills the first tunnel):

     ```bash
     sudo tee /etc/systemd/system/cloudflared-listener.service >/dev/null <<'EOF'
     [Unit]
     Description=cloudflared tunnel (listener)
     After=network.target
     Wants=network-online.target

     [Service]
     TimeoutStartSec=0
     Type=notify
     ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token PASTE_TOKEN_HERE
     Restart=on-failure
     RestartSec=5s

     [Install]
     WantedBy=multi-user.target
     EOF
     sudo systemctl daemon-reload && sudo systemctl enable --now cloudflared-listener
     ```

     Paste the second lane's token from its C2 panel (adjust the binary path to `which cloudflared`).
     The alternative shape is one shared tunnel whose ingress lists both hostnames → both local services.
4. **Deploy all** (or per-hop via the node panel — redeploys that hop plus everything upstream).
5. **Test path** — green/red per hop on the edges, plus round-trip latency. The probe header is stripped
   before the listener sees it and never affects real traffic.
6. **Export** → pick your framework → copy the profile / implant build command. For Mythic you need both
   lane URLs: listener → `c2_url`, stager → `staging_url`.
7. When it's time: **Quarantine** (blackhole, reversible) or **Destroy** (burn everything) — per chain or
   across the whole operation from the sidebar. **Deleting a chain also destroys**: the sidebar's
   **Delete & destroy** tears down its workers, custom domains, tunnel and DNS record before removing
   the definition, so stray workers can't pile up on your accounts (if the teardown fails, the chain is
   kept so you can retry). If the tunnel's cloudflared connector is still running, the confirm says so
   and gives the removal command (`cloudflared service uninstall` on the C2 box) before you commit.
   **Destroy** alone burns the resources but keeps the definition for a later redeploy.
8. **Everything auto-saves** — edits persist ~0.7s after you stop typing; switching lanes or chains
   flushes first, so nothing is lost moving around. The Save button is just an instant flush and the
   `unsaved` badge only shows for that brief window. Auto-save never races a deploy (it waits until
   the deploy finishes) and a failed save warns before anything discards your edits.

## How the workers are built

Every hop runs the same worker source (`worker/hop-template.js`); per-hop config arrives via bindings:

- `SECRET_HEADER` / `SECRET_VALUE` — timing-safe gate (`crypto.subtle.timingSafeEqual`); failure serves the
  disguise page, 401, or 404
- `NEXT` service binding (same-account hops) or `NEXT_URL` fetch target (cross-account hops, WebSocket
  chains, and the final hop's C2 target); optionally injects Cloudflare Access service-token headers
  (`CF_ACCESS_ID` / `CF_ACCESS_SECRET`)
- Each hop strips its own secret header and injects the next hop's; inbound `X-RDR-*` headers are stripped
  (probe anti-spoof); the probe marker never reaches the listener; `X-Forwarded-For` passthrough is a toggle
- `KILLSWITCH=1` → quarantine (redeploys hop 1 only)
- All upstream fetches are wrapped: any throw or Cloudflare infra status (502/503/504/52x/530) returns the
  disguise page instead of a fingerprintable error page

State (settings, chains, secrets) lives in `data/state.json` (gitignored, chmod 600 where applicable).

## Security notes

- Binds to `127.0.0.1` by default and validates `Host`/`Origin` on every request (blocks CSRF /
  DNS-rebinding from a browser tab hitting localhost). The API token is never returned by the API.
- Remote/team mode: `npm start -- --host 0.0.0.0 --token <shared-secret>` — every API call then requires the
  `X-Session-Token` header (the UI prompts for it). **Put it behind Tailscale/WireGuard**; do not expose it
  raw — it holds your Cloudflare credentials.
- No telemetry, no external calls except to api.cloudflare.com.

## API (for scripting)

```
GET/PUT /api/settings          GET /api/doctor?accountId=
GET/POST /api/chains           GET/PUT/DELETE /api/chains/:id
POST /api/chains/:id/deploy    {onlyIndex?}
POST /api/chains/:id/destroy|quarantine|release|probe|validate|duplicate
POST /api/chains/:id/hops/:hopId/rotate
POST /api/chains/:id/tunnel/provision|remove
GET  /api/chains/:id/status
POST /api/chains/:id/export    {framework, options:{includeSecrets, killdate}}
POST /api/chains/import
POST /api/operations           {name} -> creates the op + listener/stager lanes
DELETE /api/operations/:id     ungroups only — chains become standalone, workers untouched
```

`PUT /api/settings` takes `{accounts: [{id, label, accountId, apiToken, workersDevSubdomain, zoneId}]}` —
the first entry is the default account; an empty `apiToken` keeps the stored one, and tokens are never
returned by `GET`. `GET /api/doctor` without `accountId` checks the primary.

## Known limits / roadmap

- Cross-account hops forward over public URLs (Cloudflare service bindings are same-account only), so a
  cross-account middle hop is exposed on workers.dev / a custom domain — still secret-gated.
- WebSocket chains expose every hop (see above).
- Probe results are request-scoped — no continuous monitoring yet.
- Deploy/teardown require your real API token; nothing is mocked at runtime.

*For authorized red team infrastructure only.*

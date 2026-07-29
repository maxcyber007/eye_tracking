# Deploying MyEye with Docker / Portainer

One image contains everything: the FastAPI backend, the built Next.js client and
the model pipeline. The host needs Docker only — no Python, no Node.

---

## ⚠️ Read this first: the camera needs HTTPS

`getUserMedia` is a **secure-context** API. Browsers only allow it on:

- `https://` origins, or
- `http://localhost` / `http://127.0.0.1`

So a container published at `http://192.168.1.50:8182` will start fine, serve
every page, let you sign in, train models and read reports — **but the assessment
will never get past "เปิดกล้อง"**, because the browser blocks the camera before
any of this code runs. The app detects this and says so, but it cannot work
around it.

You therefore need one of:

| Situation | What to do |
| --- | --- |
| Real deployment | Put a TLS reverse proxy in front (Nginx Proxy Manager, Traefik, Caddy). Then set `SESSION_COOKIE_SECURE=true`. |
| Internal network, no public DNS | Issue an internal certificate, or use Tailscale/Cloudflare Tunnel which terminate TLS for you. |
| Just testing on the Docker host itself | Browse to `http://localhost:8182/ui` **on that machine**. |

Everything except the camera works over plain HTTP, which is exactly why this
trips people up late.

---

## Putting it on a domain

The app is designed to sit behind a TLS-terminating reverse proxy. `GET /`
redirects to `/ui/`, so the bare domain lands on the assessment page — set
`ROOT_REDIRECT_TO_UI=false` if you would rather keep the liveness JSON there.

The redirect is relative, so the app never needs to know its public scheme or
hostname, and nothing else in it derives behaviour from the request scheme.

Whichever proxy you use, three things must be true:

| Setting | Value | Why |
| --- | --- | --- |
| `SESSION_COOKIE_SECURE` | `true` | The session cookie must never travel in clear text |
| `CORS_ALLOW_ORIGINS` | your origin | Stop being a wildcard once you have a real domain |
| Proxy upload limit | ≥ `MAX_UPLOAD_SIZE_MB` | Recordings are tens of MB; the default 1 MB in Nginx will reject them |

That last row is the one that bites: the proxy rejects the upload before the
app ever sees it, and the browser only reports a generic failure.

Assuming the container publishes `8182` on the Docker host:

### Nginx Proxy Manager

**Hosts → Proxy Hosts → Add Proxy Host**

- *Domain Names*: `myeye.itdev.cmtc.ac.th`
- *Scheme*: `http`, *Forward Hostname*: the Docker host IP (or `myeye` if NPM
  shares a Docker network with the container), *Forward Port*: `8182`
- *Block Common Exploits*: on
- *Websockets Support*: on
- **SSL** tab: request a Let's Encrypt certificate, then turn on *Force SSL*
  and *HTTP/2 Support*
- **Advanced** tab:

```nginx
client_max_body_size 250M;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

### Caddy

```caddyfile
myeye.itdev.cmtc.ac.th {
    reverse_proxy 127.0.0.1:8182
    request_body {
        max_size 250MB
    }
}
```

Caddy obtains and renews the certificate on its own; nothing else to configure.

### Traefik (labels on the service)

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myeye.rule=Host(`myeye.itdev.cmtc.ac.th`)"
  - "traefik.http.routers.myeye.entrypoints=websecure"
  - "traefik.http.routers.myeye.tls.certresolver=letsencrypt"
  - "traefik.http.services.myeye.loadbalancer.server.port=8000"
```

With Traefik on the same Docker network you can drop the `ports:` block
entirely, so nothing is exposed on the host at all.

### Plain Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name myeye.itdev.cmtc.ac.th;

    ssl_certificate     /etc/letsencrypt/live/myeye.itdev.cmtc.ac.th/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myeye.itdev.cmtc.ac.th/privkey.pem;

    # Recordings are large; the 1 MB default would reject every upload.
    client_max_body_size 250M;
    # Feature extraction can take a minute on a long clip.
    proxy_read_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:8182;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name myeye.itdev.cmtc.ac.th;
    return 301 https://$host$request_uri;
}
```

### After the certificate is live

Set these in the Portainer stack and redeploy:

```
SESSION_COOKIE_SECURE=true
CORS_ALLOW_ORIGINS=https://myeye.itdev.cmtc.ac.th
```

Then check:

| URL | Expected |
| --- | --- |
| `https://myeye.itdev.cmtc.ac.th` | the assessment page (redirected from `/`) |
| `https://myeye.itdev.cmtc.ac.th/ui/login/` | the sign-in page |
| `https://myeye.itdev.cmtc.ac.th/health` | `{"status":"ok", ...}` |

Sign in, then run one real assessment end to end. Uploading an actual recording
is the only way to prove the proxy's body-size and timeout limits are right —
the pages all load fine even when they are not.

---

## Deploy through Portainer

### Option A — Repository (recommended)

Portainer clones the repository and builds the image itself, so a `git push`
plus a redeploy is the whole update flow.

1. **Stacks → Add stack → Repository**
2. Repository URL: your clone of this project
3. Reference: `refs/heads/<your branch>`
4. Compose path: `docker-compose.yml`
5. **Environment variables** — add at least:

   | Name | Value | Notes |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | a strong password | Leave unset and one is generated into the log **once** |
   | `MYEYE_PORT` | `8182` | Host port to publish (container always listens on 8000) |
   | `SESSION_COOKIE_SECURE` | `true` | Once you are behind HTTPS |
   | `CORS_ALLOW_ORIGINS` | your origin | Restrict away from `*` in production |

6. **Deploy the stack**

The first build takes roughly 5–15 minutes: it installs MediaPipe, OpenCV and
scikit-learn, and runs a production Next.js build. Later builds reuse the layer
cache and are much faster.

### Option B — Build elsewhere, deploy the image

Useful when the Portainer host is small, or has no access to npm/PyPI.

```bash
# On a machine that can build
docker build -t registry.example.com/myeye:1.0.0 ./backend
docker push registry.example.com/myeye:1.0.0
```

Then in the stack replace the `build:` block with the pushed tag:

```yaml
services:
  myeye:
    image: registry.example.com/myeye:1.0.0
    # ... keep the rest unchanged
```

> Pasting `docker-compose.yml` into Portainer's **Web editor** does *not* work
> with `build:` — the editor has no build context. Use Repository, or an image
> from a registry.

---

## First run

```bash
docker logs myeye
```

If you did not set `ADMIN_PASSWORD`, the generated one is printed here **once**:

```
====================================================================
  No ADMIN_PASSWORD was configured, so an account was created with a
  generated password. Save it now - it is not shown again.

      username: admin
      password: xK9mP2vQr4Tz
====================================================================
```

Then:

1. Open `https://your-host/ui/login/` and sign in.
2. **ภาพรวม** → collect data or seed a synthetic dataset, then **เทรนโมเดล**.
3. `https://your-host/ui/` is the participant-facing assessment.

To seed a synthetic dataset for a demo:

```bash
docker exec -it myeye python scripts/generate_synthetic_dataset.py --samples 200
```

Manage accounts:

```bash
docker exec -it myeye python scripts/manage_users.py list
docker exec -it myeye python scripts/manage_users.py add researcher1
docker exec -it myeye python scripts/manage_users.py passwd admin
```

---

## Data and backups

Everything mutable lives in the single named volume `myeye-data`, mounted at
`/app/data`:

```
/app/data/uploads/    recordings and their per-frame CSVs
/app/data/models/     myeye_model.pkl
/app/data/dataset/    dataset.csv
/app/data/myeye.db    assessment history and accounts
```

It is mounted outside `/app/app` on purpose — mounting over the package
directory would hide the application code.

Back it up:

```bash
docker run --rm -v myeye-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/myeye-data-$(date +%F).tar.gz -C /data .
```

Restore:

```bash
docker run --rm -v myeye-data:/data -v "$PWD:/backup" alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/myeye-data-YYYY-MM-DD.tar.gz -C /data"
```

**The uploads are face video — biometric personal data that cannot be
anonymised.** Encrypt the backups, restrict who can read the volume, and delete
recordings on the schedule your ethics approval specifies. If you only need the
extracted features, delete the `.mp4`/`.webm` files and keep the `_output.csv`
files; those cannot be turned back into a face.

---

## Configuration

Every setting in `backend/.env.example` can be passed as an environment
variable in the stack. The ones that matter most in a deployment:

| Variable | Default | Why you would change it |
| --- | --- | --- |
| `ADMIN_PASSWORD` | *(generated)* | Set it explicitly so it is not only in the log |
| `SESSION_COOKIE_SECURE` | `false` | **`true` behind HTTPS** |
| `CORS_ALLOW_ORIGINS` | `*` | Restrict to your origin |
| `MAX_UPLOAD_SIZE_MB` | `200` | Cap upload size |
| `MAX_FRAMES` | `3600` | Cap CPU per recording |
| `MYEYE_CPUS` / `MYEYE_MEMORY` | `2.0` / `3g` | Container resource ceiling |
| `AUTH_ENABLED` | `true` | Only disable on an isolated network |

Note that `ADMIN_PASSWORD` seeds the **first** account only. Changing it later
has no effect unless you also set `ADMIN_PASSWORD_RESET=true`; otherwise use
`manage_users.py passwd`.

---

## Sizing

- **Image**: roughly 2.5–3 GB. MediaPipe alone pulls in OpenCV, JAX and
  protobuf; there is no meaningfully smaller base for this stack.
- **Memory**: 3 GB limit is comfortable. Analysing one 30-second clip peaks
  around 1–1.5 GB.
- **CPU**: extraction is CPU-bound and single-recording-at-a-time. A 30-second
  clip takes roughly 20–60 seconds on 2 cores.
- **Concurrency**: each request builds its own MediaPipe graph, so several
  simultaneous uploads multiply memory use. Raise the limits before inviting a
  whole clinic to test at once.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Camera never opens; page says it needs HTTPS | Serving over plain HTTP on a non-localhost address. See the top of this document. |
| Container healthy, `/ui` shows the old plain UI | The Next.js build did not run. Check the build log for the `web` stage. |
| `409 ModelNotTrainedError` on assessment | No model yet — train from **ภาพรวม**. |
| Signed out on every request | `SESSION_COOKIE_SECURE=true` while served over HTTP. Either serve HTTPS or set it back to `false`. |
| Login fails with the password you set in the stack | `ADMIN_PASSWORD` only seeds the first account. Use `manage_users.py passwd admin`, or set `ADMIN_PASSWORD_RESET=true`. |
| Build fails pulling `node:22-slim` / `python:3.12-slim` | The host cannot reach Docker Hub. Use Option B, or configure a registry mirror. |
| Container OOM-killed during analysis | Raise `MYEYE_MEMORY`, or lower `MAX_FRAMES` / `MAX_UPLOAD_SIZE_MB`. |

---

## Reminder

This is research software. It is **not a medical device**, and nothing it
outputs is a diagnosis. Deploy it inside infrastructure your institution has
approved, with ethics approval and participant consent in place before any real
recording is made.

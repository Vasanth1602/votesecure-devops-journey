# Phase 2 — Reverse Proxy (NGINX)

**Goal:** Route all external traffic through a single NGINX entry point — serving the React SPA, proxying REST API calls, and forwarding WebSocket connections to the backend.

---

## Why NGINX Was Introduced

Without a reverse proxy, the frontend application would need to know the backend's address at build time. API calls would go directly to `http://localhost:5000` — hardcoded into the frontend code. This creates two problems:

1. **Environment coupling** — the frontend build is tied to a specific host and port. Changing the deployment environment (local → staging → production) requires rebuilding the frontend.
2. **Exposed backend** — the backend port must be publicly accessible for the browser to reach it.

NGINX solves both. The frontend makes all requests to relative paths (`/api/...`). NGINX intercepts those requests and forwards them to the backend using Docker's internal DNS. The browser never knows the backend's address or port.

This is the standard production pattern for React + API deployments.

---

## Where NGINX Lives

NGINX is not a separate container. It is **embedded inside the frontend container** via the multi-stage Dockerfile:

```dockerfile
# Stage 1: Build React app
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: NGINX serves the compiled output
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf   ← config injected here
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

The `nginx.conf` written for this project replaces nginx's default configuration at `/etc/nginx/conf.d/default.conf`. The final image is nginx:alpine serving compiled static files — there is no Node.js runtime in the production image.

---

## NGINX Configuration

Full configuration at [`frontend/nginx.conf`](../frontend/nginx.conf):

```nginx
server {
  listen 80;
  server_name localhost;

  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://backend:5000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /socket.io/ {
    proxy_pass http://backend:5000/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /favicon.ico {
    access_log off;
    log_not_found off;
    return 204;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

---

## Request Flow

```
Browser request: GET http://localhost:5173/api/auth/login
        │
        ▼
NGINX (frontend container, port 80)
        │
        ├─ matches location /api/
        │
        ▼
proxy_pass → http://backend:5000/api/auth/login
        │
        │  (Docker internal DNS resolves "backend" to container IP)
        │
        ▼
FastAPI (backend container, port 5000)
        │
        ▼
Response flows back through NGINX to browser
```

```
Browser request: WebSocket ws://localhost:5173/socket.io/
        │
        ▼
NGINX (frontend container, port 80)
        │
        ├─ matches location /socket.io/
        ├─ forwards Upgrade: websocket header
        ├─ forwards Connection: upgrade header
        │
        ▼
python-socketio (backend container, port 5000)
        │
        ▼
Persistent WebSocket connection established
Backend pushes resultsUpdated events → Browser
```

---

## API Routing

```nginx
location /api/ {
  proxy_pass http://backend:5000/api/;
  ...
}
```

**How it works:**  
Any request matching `/api/*` is forwarded to `http://backend:5000/api/*`. The path is preserved — a request for `/api/elections` reaches the backend as `/api/elections`.

**`backend:5000` resolution:**  
`backend` is a Docker Compose service name. Docker's embedded DNS resolver converts this to the backend container's internal IP at request time. This works because both containers are on the same Compose network (`voting-system_default`). No hardcoded IPs. No host machine ports.

**`proxy_http_version 1.1`:**  
Forces HTTP/1.1 between NGINX and the backend, which supports keep-alive connections. HTTP/1.0 (the default) closes the connection after every response, adding latency.

**Forwarded headers:**  
- `X-Real-IP` — passes the client's IP to the backend. Without this, the backend sees only NGINX's internal container IP as the request source, making IP-based rate limiting ineffective.
- `X-Forwarded-For` — standard header for proxy chains, logs the real client IP.
- `X-Forwarded-Proto` — tells the backend whether the original request was HTTP or HTTPS. Relevant for redirect logic and security checks in Phase 4.

---

## WebSocket Routing

```nginx
location /socket.io/ {
  proxy_pass http://backend:5000/socket.io/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ...
}
```

WebSocket connections begin as an HTTP request with an upgrade handshake:
```
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1
Upgrade: websocket
Connection: Upgrade
```

NGINX must forward these headers to the backend. If `Upgrade` and `Connection` headers are not forwarded:
- The backend never receives the upgrade request
- Socket.io falls back to HTTP long-polling
- Real-time vote result updates stop being instant
- Every connected client generates repeated polling requests every 1–2 seconds instead of one persistent connection

`proxy_http_version 1.1` is also required here — WebSocket over HTTP/1.0 is not supported.

---

## SPA Routing

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

React Router handles routing entirely in the browser. There are no physical files at paths like `/login`, `/admin/elections`, or `/voter/vote/123` — only `index.html` exists on disk.

**`try_files $uri $uri/ /index.html` behavior:**
1. Check if the exact file exists at the requested path (serves real static assets: `.js`, `.css`, images)
2. Check if a directory with that name exists
3. If neither, serve `/index.html` — React loads, Router reads the URL, renders the correct page

Without this directive, navigating directly to `http://localhost:5173/admin/elections` or hitting browser refresh returns `404 Not Found` from NGINX.

---

## Static File Serving

```nginx
root /usr/share/nginx/html;
index index.html;
```

Vite compiles the React application into static files (HTML, JS bundles, CSS, assets) placed in the `/app/dist` directory during the build stage. The Dockerfile copies these to `/usr/share/nginx/html` — nginx's default static file root.

Requests for `*.js`, `*.css`, images, and other static assets are served directly from the filesystem without touching the backend. This is one of NGINX's primary performance advantages.

---

## Favicon Handling

```nginx
location = /favicon.ico {
  access_log off;
  log_not_found off;
  return 204;
}
```

Browsers automatically request `/favicon.ico` on every page load. Without this, every missing favicon generates a `404 Not Found` log entry. `return 204` responds with No Content (success, no body) — suppressing the log noise while satisfying the browser.

---

## Dev Proxy vs Production Proxy

Two separate proxy configurations exist — one for development, one for Docker:

| | Development | Docker (Production) |
|---|---|---|
| **Config file** | `frontend/vite.config.js` | `frontend/nginx.conf` |
| **Who proxies** | Vite dev server | NGINX |
| **Target** | `http://localhost:5000` | `http://backend:5000` |
| **Used when** | `npm run dev` | `docker compose up` |
| **In final image?** | ❌ No | ✅ Yes |

`vite.config.js` proxy config is development-only tooling. It is not included in the Docker image and has no effect in containerized deployment. The nginx.conf is what runs in production.

---

## Security Posture

**Backend is not exposed to the host.** The backend container has no `ports` mapping in `docker-compose.yml`. It is only reachable from within the Docker network — meaning only NGINX can reach it. A request to `http://localhost:5000` from the host machine fails. All traffic must enter through NGINX.

**Redis is not exposed to the host.** Same pattern — Redis is internal-only.

**NGINX is the single public entry point.** Only port 5173 (mapped to NGINX port 80) is accessible externally. This creates a controlled chokepoint for future additions: rate limiting at the proxy layer, TLS termination, request filtering.

---

## Lessons Learned

**The frontend doesn't know the backend exists.** The React application calls `/api/...` — a relative path with no server address. NGINX handles the routing. This is what makes the frontend environment-agnostic: the same built image can be proxied to any backend address by changing nginx.conf, without rebuilding the React app.

**WebSocket requires explicit header forwarding.** Removing `Upgrade $http_upgrade` and `Connection "upgrade"` causes Socket.io to silently fall back to long-polling. The app still works — but real-time updates become polling updates. No visible error. Only discoverable by inspecting the Network tab in DevTools or watching backend logs for polling vs websocket transport.

**SPA routing and static file serving are orthogonal concerns.** Real static assets (JS, CSS, images) are served by path match. Virtual routes (React Router paths) must fall through to `index.html`. Both are handled by `try_files`. Missing this directive breaks deep links and browser refresh on any route except `/`.

**`nginx -t` validates config without restarting.** A syntax error in nginx.conf prevents the container from starting at all — not just the broken location block, the entire server. Validating config before deploying (`nginx -t` in CI) should be a mandatory step before any nginx change reaches a running environment.

**502 vs 504 tells you where the failure is.** `502 Bad Gateway` = upstream refused the connection (wrong port, backend not running). `504 Gateway Timeout` = upstream accepted the connection but didn't respond in time (backend hung, overloaded). The error code alone narrows the debug scope.

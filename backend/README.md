# Agrapatha BMKG Weather Gateway

A production-conscious, zero-dependency Node.js HTTP gateway that acts as a secure reverse proxy and caching layer for Indonesian BMKG macro-weather forecasts and early warning feeds.

## Features

- **Zero Runtime Dependencies**: Built entirely on native Node.js 22 LTS standard libraries (`node:http`, built-in `fetch`, `AbortSignal.timeout`, `ReadableStream`).
- **Fixed Upstream Allowlisting**: Only proxies to official BMKG endpoints (`api.bmkg.go.id` and `www.bmkg.go.id`). Arbitrary target URLs or proxy paths are strictly rejected.
- **Strict Input Validation**: Validates Indonesian ADM4 administrative district codes against regex `^\d{2}\.\d{2}\.\d{2}\.\d{4}$`.
- **Streaming Payload Caps**: Bounded stream readers cap responses at 512 KiB (forecast JSON) and 1 MiB (warning XML) before unlimited buffering.
- **Request Coalescing**: Merges concurrent identical in-flight requests to eliminate duplicate upstream fetches.
- **Bounded In-Memory Cache**: LRU caching with 15-minute TTL for forecasts (max 100 entries) and 5-minute TTL for nowcast XML (max 2 entries).
- **Bounded Same-Origin Redirects**: Strict maximum 2-hop limit on same-origin redirects to eliminate infinite redirect recursion loops. Cross-origin redirects are completely blocked.
- **Spoof-Resistant Rate Limiter**: Bounded sliding-window IP rate limiter (60 req/min/IP).
- **Strict CORS**: Explicit origin allowlisting with preflight `OPTIONS` handling. No wildcard origins.
- **Isolated Health Check**: `GET /health` reports service readiness immediately without pinging upstream BMKG.

> [!NOTE]
> **Process-Isolated Storage**: In-memory caches and rate limits are per process/container instance and reset whenever the container restarts.

## Endpoints

| Method | Path | Description | Upstream Target | Cache TTL |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/bmkg/forecast?adm4={adm4}` | Regional weather forecast | `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=...` | 15 Minutes |
| `GET` | `/api/bmkg/nowcast/id` | Extreme weather warning RSS/XML | `https://www.bmkg.go.id/alerts/nowcast/id` | 5 Minutes |
| `GET` | `/health` | Service readiness probe | None (Internal) | None |

## Proxy & IP Policy

1. **Default Policy (`TRUST_PROXY=false`)**: The gateway strictly relies on the unforgeable direct TCP socket remote address. Client-supplied `X-Forwarded-For` headers are completely ignored, making header-rotation evasion impossible.
   *Operational consequence*: Behind an unconfigured reverse proxy, all requests map to the proxy socket address.
2. **Explicit Trusted Proxy (`TRUST_PROXY=true`)**: Only enabled when a verified reverse-proxy contract is confirmed. The gateway reads the **rightmost** IP (appended by the trusted edge proxy), rather than the client-controlled leftmost IP.
   *Deployment Blocker*: Confirming Railway's exact proxy header rewriting contract is required before enabling `TRUST_PROXY=true`.

The rate-limiter store is bounded at max 2,000 entries (LRU eviction) to prevent memory bloat attacks.

## Configuration Options

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP server to listen on |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated list of exact allowed CORS origins |
| `UPSTREAM_TIMEOUT_MS` | `6000` | Upstream BMKG request timeout (milliseconds) |
| `FORECAST_CACHE_TTL_MS`| `900000` (15 min) | Forecast in-memory cache TTL (milliseconds) |
| `NOWCAST_CACHE_TTL_MS` | `300000` (5 min) | Warning feed in-memory cache TTL (milliseconds) |
| `MAX_FORECAST_BYTES` | `524288` (512 KiB) | Maximum allowed forecast response size in bytes |
| `MAX_NOWCAST_BYTES` | `1048576` (1 MiB) | Maximum allowed nowcast XML response size in bytes |
| `RATE_LIMIT_WINDOW_MS` | `60000` (1 min) | Sliding window duration for rate limiting |
| `RATE_LIMIT_MAX_REQUESTS`| `60` | Maximum requests per IP within window |
| `TRUST_PROXY` | `false` | Enable only after confirming Railway proxy header contract |

## Testing & Type Checking

Run the automated test suite using Node.js built-in test runner:

```bash
node --experimental-strip-types --test tests/gateway.test.ts
```

Run standalone TypeScript type checking:

```bash
node "../agrapatha-dashboard/node_modules/typescript/bin/tsc" --project tsconfig.json --noEmit
```

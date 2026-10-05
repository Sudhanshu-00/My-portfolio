# 🛡 Security — Pentest Audit & Hardening

> Internal adversarial audit: attack-lab (isolated instance) pe full exploitation
> attempt kiya gaya — NoSQLi, XSS, CSRF, auth bypass, IDOR, traversal, upload
> attacks, captcha replay, session fixation, prototype pollution, DoS/flood.

## Attack results (pre-fix)

| # | Attack vector | Result |
|---|---------------|--------|
| 1 | NoSQL injection login (`$ne`, `$gt`, `$regex` — urlencoded + JSON) | ✅ BLOCKED (`extended:false` + `$`/dot-key stripper) |
| 2 | Reflected XSS (query params → 4 pages) | ✅ BLOCKED (EJS auto-escape) |
| 3 | Stored XSS — page-builder, contact, feedback, replies | ✅ BLOCKED (EJS escape + safeUrl) |
| 4 | Path traversal (`..%2f`, `%2e%2e`, static dotfiles) → `.env` | ✅ BLOCKED |
| 5 | Unauthenticated admin-panel access (6 routes) | ✅ 302 → login (fail-closed) |
| 6 | `/admin/*` path guessing | ✅ 404 (secret mount only) |
| 7 | Malformed ObjectIds (CastError → 500) | ✅ 404 (param validation) |
| 8 | Captcha skip / replay / cross-session reuse | ✅ BLOCKED (single-use, 5-min expiry) |
| 9 | Two-tier auth bypass (admin creds @ public login) | ✅ BLOCKED (counts as fail) |
| 10 | Session fixation (pre-set cookie → login) | ✅ Session ID regenerated |
| 11 | IDOR `/user/<other>` | ✅ Redirect to own dashboard |
| 12 | CSRF on admin/user POSTs (incl. multipart) | ✅ Enforced everywhere |
| 13 | SVG upload (XSS smuggle) | ✅ Rejected (MIME whitelist, no svg) |
| 14 | HTML-as-PDF polyglot | ✅ Safe (`nosniff` + `attachment`) |
| 15 | Prototype pollution (`__proto__` JSON) | ✅ No effect |
| 16 | Timing-based account enumeration (/forgot) | ✅ Constant-time + generic replies |
| 17 | Rate-limit / brute-force lock | ✅ 300/min global + per-IP+user locks + auto-block |

## Vulnerabilities found & fixed

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | **MEDIUM** | `PageView` me TTL index nahi — attacker 300 req/min se analytics flood karke DB bhar sakta hai | TTL index (180 din auto-delete) + `{path, createdAt}` index |
| 2 | **MEDIUM** | `POST /logout` bina CSRF — koi bhi victim ko force-logout kar sakta tha | Logged-in logout ab CSRF token maangta hai; navbar form token bhejta hai |
| 3 | LOW | Admin users page ko `passwordHash`/`otpHash` pass ho rahe the | `.select('-passwordHash -otpHash')` — hashes view tak nahi jaate |
| 4 | LOW | Admin password-reset pe weak policy (baaki jagah strong) | `strongPass()` everywhere — consistent policy |
| 5 | LOW | Profile email uniqueness missing — do accounts same email (`/forgot` confusion) | Duplicate email reject (user + admin dono flows) |
| 6 | LOW | Nav/footer links me `//evil.com` protocol-relative URL chhup raha tha | `//` prefix → neutralized (plain text) |
| 7 | LOW | GitHub username API-path me unsanitized jata tha | `[^a-zA-Z0-9-]` strip — path injection impossible |

## Defense layers (already in place)

- **CSP** `script-src 'self'` (zero inline JS), `frame-ancestors 'none'`, `object-src 'none'`
- **Headers**: nosniff, XFO DENY, Referrer-Policy, COOP/CORP, HSTS (prod)
- **Sessions**: httpOnly + SameSite=Lax + secure (prod) + rotate-on-login + Mongo store
- **Captcha**: single-use, 5-min expiry, confusion-safe alphabet, SVG (no image libs)
- **Brute force**: per-(IP+username) 5-fail lock + per-IP 25-fail lock + 400ms delay
- **Auto-block**: 404-fuzzing (30/10min), sensitive-path probes (10/10min), login brute (8/15min) → IP block + email alert
- **Secrets**: koi hardcoded credential nahi — env/recovery-chain (`lib/env.js`), `adminPath` fail-closed random
- **Uploads**: memory-storage, 3–5MB caps, strict MIME whitelists (no SVG), data-URL storage
- **MongoDB**: operator-key sanitizer + `extended:false` + ObjectId param validation
- **URLs**: `javascript:`/`data:` hrefs blocked at write time (safeUrl/linkUrl)
- **Errors**: stack traces never leak; multer errors → 413/400

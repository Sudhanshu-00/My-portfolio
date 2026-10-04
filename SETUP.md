# 🚀 Portfolio — Setup & Recovery Guide for a New Device

## 📦 Fresh Setup (new device / new clone)

```bash
git clone https://github.com/Sudhanshu-00/My-portfolio.git
cd My-portfolio
npm install
cp .env.example .env        # ← then fill REAL values into .env (from your backup)
node server.js
```

## 🔑 How Do I Get .env Back?

`.env` never goes into git (it contains secrets). Two recovery paths:

### Path 1: Your own backup (easiest)
You saved the `.env` content in your Gmail / Drive / password manager
(backup file on device: `~/portfolio-env-backup.txt`). Copy-paste it to recreate `.env`.

### Path 2: MongoDB Atlas dashboard (if the backup is gone too)
1. **cloud.mongodb.com** → log in with your Gmail
2. **Database → Connect → Drivers** → copy the connection string
   (replace the DB password with the one you set for the Atlas user)
3. Paste it into `MONGODB_URI=`

You can regenerate the other values:
- `SESSION_SECRET` → `openssl rand -hex 32` (a new one is fine — everyone just gets logged out)
- `ADMIN_PATH` → `openssl rand -hex 10` (new path = new secret URL, even better)
- `ADMIN_PASS` → only used for the first-run seed; if the account already exists in the DB, ignore it
- `SMTP_PASS` → Gmail App Password (myaccount.google.com → App passwords)

⚠️ **Note**: without `MONGODB_URI` the app runs on an **in-memory MongoDB** —
data lasts only as long as the server is running. Always use the Atlas URI.

## 🧘 Stress-Free Recovery (forgot password, changed device, anything)

1. Open the portfolio → footer 🔐 → login page
2. **Forgot password?** → username + registered email
3. 📧 OTP arrives by email (valid 3 min) → enter OTP → set new password
4. Login ✅ — admin panel restored

> Note: OTP recovery runs on the Atlas DB, so `MONGODB_URI` must be correct.

## 🔐 Security Notes

- `/admin` always returns 404 — the real panel only exists at `/<ADMIN_PATH>`
- Login brute force: 5 failures per (IP+username) → 15 min lock; 25 failures per IP → IP blocked
- Global rate limit: 300 req/min per IP → 5 min auto-block
- OTP: valid 3 min, 5 wrong attempts → dead, max 3 requests / 15 min
- Session cookie is httpOnly — JavaScript cannot access it
- CSRF tokens on every admin POST; strict CSP (no inline scripts anywhere)

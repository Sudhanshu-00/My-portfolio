# 🚀 Portfolio — Naye Device Pe Setup & Recovery Guide

## 📦 Fresh Setup (naya device / naya clone)

```bash
git clone https://github.com/Sudhanshu-00/My-portfolio.git
cd My-portfolio
npm install
cp .env.example .env        # ← phir .env me REAL values bharo (backup se)
node server.js
```

## 🔑 .env Kaha Se Wapas Milega?

`.env` git me **kabhi nahi jata** (secrets hain). Recovery ke 2 raste:

### Raste 1: Tumhara backup (sabse aasan)
`.env` ka content tumne apne Gmail / Drive / password manager me save kiya hua hai
(backup file: device pe `~/portfolio-env-backup.txt`). Usse copy-paste karke `.env` banao.

### Raste 2: MongoDB Atlas dashboard (agar backup bhi gaya)
1. **cloud.mongodb.com** → apne Gmail se login
2. **Database → Connect → Drivers** → connection string copy karo
   (isame DB password replace hota hai — Atlas pe user banaya tha wahi)
3. `MONGODB_URI=` me paste karo

Baaki values fir se bana sakte ho:
- `SESSION_SECRET` → `openssl rand -hex 32` (naya bhi chalega — bas sab logout ho jayenge)
- `ADMIN_PATH` → `openssl rand -hex 10` (naya path = naya secret URL, aur behtar)
- `ADMIN_PASS` → sirf first-run seed ke liye; account DB me pehle se hai to ignore
- `SMTP_PASS` → Gmail App Password (myaccount.google.com → App passwords)

⚠️ **Dhyan**: `MONGODB_URI` ke bina app **in-memory MongoDB** pe chalta hai —
data sirf tab tak rahega jab tak server chal raha hai. Hamesha Atlas URI lagao.

## 🧘 Tension-Free Recovery (password bhool gaye, device badal diye, kuch bhi)

1. Portfolio kholo → footer 🔐 → login page
2. **Forgot password?** → username + registered email
3. 📧 OTP email pe (3 min valid) → OTP daalo → naya password set
4. Login ✅ — admin panel wapas

> Note: OTP recovery Atlas DB se chalti hai, isliye `MONGODB_URI` sahi hona chahiye.

## 🔐 Security Notes

- `/admin` hamesha 404 — asli panel sirf `/<ADMIN_PATH>` pe
- Login brute-force: 5 galat → 15 min lock
- OTP: 3 min valid, 5 galat → dead, 3 requests/15 min
- Session cookie httpOnly — JS access nahi kar sakta

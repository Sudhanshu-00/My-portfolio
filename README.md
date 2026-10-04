# 🌐 My Portfolio — Dynamic Website + Admin Panel

Fully dynamic portfolio website with admin panel. Sab kuch database se chalta hai — pages, photos, skills, projects, contact messages. Admin panel se **kahi se bhi** (sirf browser se) manage karo.

## ✨ Features

- 🏠 **Home / About / Projects / Contact** — sab pages dynamic (database se)
- 🔐 **Admin Panel** (`/admin`) — secure login (session + bcrypt password)
- 🖼️ **Photo Upload** — profile photo aur project images (database me store)
- 📩 **Contact Form** — messages admin panel me dikhenge
- 🚀 **Free Hosting** — MongoDB Atlas + Render

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express 5 |
| Database | MongoDB (Atlas — free cloud) |
| Frontend | EJS templates + vanilla CSS |
| Auth | express-session + bcryptjs |
| Uploads | multer (images DB me base64) |

## 💻 Local Me Chalana

```bash
npm install
npm run dev
```

> `MONGODB_URI` set nahi hai to khud ek temporary in-memory MongoDB start hota hai (test ke liye — data restart pe delete ho jata hai).

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin → **admin / admin@123**

## ☁️ Step 1 — MongoDB Atlas (Free Database)

1. https://www.mongodb.com/cloud/atlas/register pe account banao (Google login fastest)
2. **Free M0 cluster** banao (region: Mumbai `ap-south-1`)
3. **Database Access** → Add New Database User → username/password set karo
4. **Network Access** → Add IP → `0.0.0.0/0` (Allow from anywhere)
5. **Database → Connect → Drivers** → connection string copy karo:
   ```
   mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/portfolio
   ```
6. Project me `.env` banao (`.env.example` copy karke) aur `MONGODB_URI` me wo string daalo

## 🐙 Step 2 — GitHub Pe Push

```bash
cd "my portfolio"
git add .
git commit -m "Portfolio website with admin panel"
```

Phir https://github.com/new pe **new repository** banao (naam: `my-portfolio`), aur:

```bash
git remote add origin https://github.com/TUMHARA-USERNAME/my-portfolio.git
git push -u origin main
```

## 🚀 Step 3 — Render Pe Host (Free)

1. https://render.com → GitHub se login karo
2. **New → Web Service** → apna `my-portfolio` repo select karo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     | Key | Value |
     |-----|-------|
     | `MONGODB_URI` | Atlas wali connection string |
     | `SESSION_SECRET` | koi lamba random string |
     | `NODE_ENV` | `production` |
4. **Create Web Service** → 2-3 min me live! 🎉

> Render deploy hone ke baad har `git push` pe **auto-deploy** ho jata hai. Code edit karo → push → live!

## 🎛️ Admin Panel Se Kya-Kya Manage Hoga

| Section | Kya kar sakte ho |
|---------|-----------------|
| **Settings** | Site name, hero title/subtitle, profile photo, about text, email/phone/location, social links |
| **Projects** | Add / Edit / Delete projects + photo upload + featured mark |
| **Skills** | Add / Delete skills with level bars |
| **Messages** | Contact form ke messages dekho / mark read / delete |
| **Password** | Admin password change |

## 🔒 Security Notes

- First login ke baad **password change kar lo** (`/admin/password`)
- `.env` file GitHub pe push NahI hoti (`.gitignore` me hai) — secrets safe
- Passwords bcrypt se hash hote hain, sessions MongoDB me store hote hain

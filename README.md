# My Portfolio — H4x0r Theme

Fully dynamic portfolio website with admin panel. Everything runs from the database — pages, photos, skills, projects, contact messages. Manage it entirely from the admin panel (just a browser, from anywhere).

## ✨ Features

- Dynamic home page (hero, skills, services, projects, testimonials) — all DB-driven
- Tools for sale with WhatsApp buy integration
- Projects with live GitHub repo data (stars, languages, README)
- TryHackMe / PortSwigger lab tracker
- Public feedback wall (admin-moderated)
- Contact form → admin inbox
- Full admin panel: content, uploads (photo/resume), messages, settings

## 💻 Run Locally

```bash
npm install
npm start        # or: npm run dev (auto-restart on file changes)
```

> If `MONGODB_URI` is not set, a temporary in-memory MongoDB starts automatically (for testing — data is deleted on restart).

## ☁️ MongoDB Atlas (Free Cloud DB)

1. Create an account at https://www.mongodb.com/cloud/atlas/register (Google login is fastest)
2. Create a **Free M0 cluster** (region: Mumbai `ap-south-1`)
3. **Database Access** → Add New Database User → set username/password
4. **Network Access** → Allow from anywhere `0.0.0.0/0` (or your server IP)
5. **Database → Connect → Drivers** → copy the connection string:

```
mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/?retryWrites=true
```

6. Create `.env` in the project (copy `.env.example`) and paste the string into `MONGODB_URI`

## 🚀 Deploy to Render (Free)

1. Push the code to GitHub:

```bash
git init
git add .
git commit -m "portfolio"
git remote add origin https://github.com/USERNAME/my-portfolio.git
git push -u origin main
```

2. Go to https://render.com → log in with GitHub
3. **New → Web Service** → select your `my-portfolio` repo
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. **Environment** → add all variables from `.env` (MONGODB_URI, SESSION_SECRET, ADMIN_USER, ADMIN_PASS, ADMIN_PATH, ADMIN_EMAIL, SMTP_*)

> After the first Render deploy, every `git push` auto-deploys. Edit code → push → live!

## 🛠 Admin Panel

| Section | What you can do |
|---|---|
| **Dashboard** | Traffic stats, visitor chart, quick actions |
| **Settings** | Site name, hero, about text, contact info, all social links, profile photo, resume upload |
| **Tools** | Add/edit/delete tools for sale (with photos, prices, buy links) |
| **Projects** | Case-file style portfolio projects |
| **Skills** | Skill bars with levels & categories |
| **Services** | Hire-me packages with pricing |
| **Testimonials** | Client feedback with star ratings |
| **Experience** | Work-history timeline |
| **Labs** | TryHackMe / PortSwigger solved labs |
| **Messages** | Read / delete contact-form messages |
| **Feedback** | Approve / hide / reply to public feedback |
| **Password** | Change admin password |

- `.env` is never pushed to GitHub (it's in `.gitignore`) — secrets stay safe
- **ADMIN_PATH** is the secret panel path — `/admin` always shows a public 404

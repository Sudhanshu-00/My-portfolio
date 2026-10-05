const mongoose = require('mongoose');

const SiteSettingSchema = new mongoose.Schema({
  siteName: { type: String, default: 'My Portfolio', maxlength: 100 },
  heroTitle: { type: String, default: 'Hi, I am a Web Developer', maxlength: 150 },
  heroSubtitle: { type: String, default: 'I love building clean and modern websites and web apps.', maxlength: 300 },
  aboutText: {
    type: String,
    maxlength: 5000,
    default:
      'Hello! I am a passionate web developer. I enjoy turning ideas into real, working products. Edit this text anytime from the Admin Panel → Settings.',
  },
  email: { type: String, default: '', maxlength: 100 },
  phone: { type: String, default: '', maxlength: 20 },
  location: { type: String, default: '', maxlength: 120 },
  profilePhoto: { type: String, default: '' }, // stored as data URL (size capped by upload limit)
  github: { type: String, default: '', maxlength: 500 },
  githubUsername: { type: String, default: 'Sudhanshu-00', maxlength: 60 }, // for live GitHub intel
  thmUsername: { type: String, default: '', maxlength: 60 }, // TryHackMe username → badge on /labs
  // live THM stats — services/thm.js auto-sync karta hai (jina reader → parse → yahan save)
  // /img/thm-card.svg isi se dynamic SVG render karta hai
  thmStats: {
    type: {
      username: { type: String, default: '' },
      points: { type: Number, default: 0 },
      level: { type: String, default: '', maxlength: 40 },
      rankPct: { type: String, default: '' },
      rankNum: { type: Number, default: 0 },
      badges: { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      rooms: { type: Number, default: 0 },
      syncedAt: { type: Date, default: null },
    },
    default: {},
  },
  linkedin: { type: String, default: '', maxlength: 500 },
  twitter: { type: String, default: '', maxlength: 500 },
  instagram: { type: String, default: '', maxlength: 500 },
  whatsapp: { type: String, default: '', maxlength: 20 }, // e.g. 919876543210 (tool sales)
  telegram: { type: String, default: '', maxlength: 60 }, // e.g. username
  // ghsync tombstone — admin ne jo auto-synced projects delete kiye unke URLs
  // (warna 6h me sync wapas add kar deta)
  ghSyncSkip: { type: [String], default: [] },
  customLinks: { type: [{ label: { type: String, maxlength: 40 }, url: { type: String, maxlength: 500 } }], default: [] }, // extra social/public URLs
  // ---- navbar links (editable from Admin → Appearance) ----
  // url empty → plain text (not clickable); newTab → opens in a new tab
  navItems: {
    type: [{
      label: { type: String, maxlength: 30 },
      url: { type: String, maxlength: 500, default: '' },
      order: { type: Number, default: 0 }, // lower = left-most
      visible: { type: Boolean, default: true },
      newTab: { type: Boolean, default: false },
    }],
    default: [],
  },
  // ---- footer links (clickable rows above the copyright line) ----
  footerLinks: {
    type: [{
      label: { type: String, maxlength: 40 },
      url: { type: String, maxlength: 500, default: '' },
      newTab: { type: Boolean, default: false },
    }],
    default: [],
  },
  footerText: { type: String, default: 'built with ♥ & caffeine', maxlength: 200 },
  footerNote: { type: String, default: '', maxlength: 200 }, // extra line under the copyright
  resumeFile: { type: String, default: '' }, // base64 PDF (size capped by upload limit)
  resumeName: { type: String, default: 'resume.pdf', maxlength: 200 },
});

// Always returns the single settings document (creates it if missing)
// First boot → seed the default navbar (same links as the old hardcoded one)
// One-time migration: purane default 6-link nav → usme './blog' add (customized nav untouched)
SiteSettingSchema.statics.get = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({ navItems: DEFAULT_NAV });
  const nav = doc.navItems || [];
  const hasBlog = nav.some((n) => n && n.url === '/blog');
  const isOldDefault = nav.length === 6 && ['/', '/about', '/tools', '/projects', '/labs', '/contact'].every((u) => nav.some((n) => n && n.url === u));
  if (!hasBlog && isOldDefault) {
    doc.navItems.push({ label: './blog', url: '/blog', order: 6, visible: true, newTab: false });
    doc.navItems.filter((n) => n && n.url === '/contact').forEach((n) => { n.order = 7; });
    await doc.save();
  }
  return doc;
};

// Default navbar — used when the settings doc has no items yet (back-compat with old DBs)
const DEFAULT_NAV = [
  { label: './home', url: '/', order: 1, visible: true, newTab: false },
  { label: './about', url: '/about', order: 2, visible: true, newTab: false },
  { label: './tools', url: '/tools', order: 3, visible: true, newTab: false },
  { label: './projects', url: '/projects', order: 4, visible: true, newTab: false },
  { label: './labs', url: '/labs', order: 5, visible: true, newTab: false },
  { label: './blog', url: '/blog', order: 6, visible: true, newTab: false },
  { label: './contact', url: '/contact', order: 7, visible: true, newTab: false },
];
SiteSettingSchema.statics.defaultNav = DEFAULT_NAV;

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 5000 },
    techStack: { type: String, default: '', maxlength: 300 }, // comma separated e.g. "HTML, CSS, JS"
    image: { type: String, default: '' }, // data URL (size capped by upload limit)
    liveUrl: { type: String, default: '', maxlength: 500 },
    githubUrl: { type: String, default: '', maxlength: 500 },
    featured: { type: Boolean, default: false },
    // services/ghsync.js — GitHub se auto-synced projects ('github' = auto, 'manual' = admin)
    // ghSyncedAt ke baad admin edit kare to sync us repo ko kabhi overwrite nahi karta
    source: { type: String, default: 'manual', maxlength: 20 },
    ghSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const ToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 5000 },
    category: { type: String, default: 'Other', trim: true, maxlength: 40 }, // Android / Web / Network / Other
    price: { type: String, default: '', maxlength: 40 }, // e.g. ₹1,999 or $29
    image: { type: String, default: '' }, // data URL screenshot (size capped by upload limit)
    demoUrl: { type: String, default: '', maxlength: 500 },
    buyUrl: { type: String, default: '', maxlength: 500 }, // custom buy link; empty = WhatsApp link
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const SkillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    level: { type: Number, default: 80, min: 0, max: 100 },
    category: { type: String, default: 'General', trim: true, maxlength: 40 },
  },
  { timestamps: true }
);

const MessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, trim: true, maxlength: 100 },
    message: { type: String, required: true, maxlength: 2000 },
    read: { type: Boolean, default: false },
    ip: { type: String, default: '', maxlength: 45 }, // contact-form rate limit
  },
  { timestamps: true }
);

const AdminUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' }, // 'admin' → panel access, 'user' → normal login only
  // ---- per-user panel permissions (Admin → Users → Permissions) ----
  // Applies to role='admin' accounts only. `all` = full access (owner).
  // Individual keys grant single sections; dashboard is always visible.
  panelPerms: {
    all: { type: Boolean, default: true },
    content: { type: Boolean, default: true }, // projects/tools/skills/services/testimonials/experience/labs
    pages: { type: Boolean, default: true }, // page builder + navbar/footer editor
    settings: { type: Boolean, default: true }, // site settings + resume
    messages: { type: Boolean, default: true }, // messages + feedback moderation
    users: { type: Boolean, default: true }, // user management
    security: { type: Boolean, default: true }, // security logs + IP blocks
  },
  name: { type: String, default: '', trim: true, maxlength: 60 }, // public profile (self-editable, admin-editable)
  email: { type: String, default: '', trim: true, lowercase: true, maxlength: 100 }, // forgot-password OTP
  phone: { type: String, default: '', trim: true, maxlength: 20 },
  bio: { type: String, default: '', trim: true, maxlength: 300 },
  lastLoginAt: { type: Date },
  otpHash: { type: String, default: '' }, // bcrypt(otp) — plain OTP is never stored
  otpExpiry: { type: Date },
  otpAttempts: { type: Number, default: 0 },
});

const PageViewSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, maxlength: 200 },
  },
  { timestamps: true }
);
// TTL → 180 din purane page-views auto-delete (visitor-counter DB flood-proof:
// attacker 300 req/min se jitna bhi junk kare, DB bounded rehta hai)
PageViewSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
PageViewSchema.index({ path: 1, createdAt: -1 }); // top-pages aggregate fast

const ServiceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 1000 },
    price: { type: String, default: '', maxlength: 40 },
  },
  { timestamps: true }
);

const TestimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    company: { type: String, default: '', trim: true, maxlength: 80 },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    rating: { type: Number, default: 5, min: 1, max: 5 },
  },
  { timestamps: true }
);

const ExperienceSchema = new mongoose.Schema(
  {
    company: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, required: true, trim: true, maxlength: 80 },
    duration: { type: String, default: '', maxlength: 60 }, // e.g. "Jan 2024 – Present"
    description: { type: String, default: '', maxlength: 1000 },
    current: { type: Boolean, default: false },
    order: { type: Number, default: 0 }, // lower = shown higher
  },
  { timestamps: true }
);

const LabSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['TryHackMe', 'PortSwigger', 'Other'], default: 'TryHackMe' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, default: 'General', trim: true, maxlength: 40 }, // SQLi, XSS, Auth Bypass, Recon...
    difficulty: { type: String, default: 'Easy', maxlength: 20 }, // Easy / Medium / Hard / Insane
    url: { type: String, default: '', maxlength: 500 }, // room/lab link
    solvedAt: { type: Date },
  },
  { timestamps: true }
);

// ---------- security log (who visited / tested / attacked) ----------
// TTL index → MongoDB auto-deletes events 30 days after createdAt (no cron needed).
const SecurityEventSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, index: true, maxlength: 45 },
    method: { type: String, default: '', maxlength: 10 },
    path: { type: String, default: '', maxlength: 300 }, // secret admin path is masked as /[panel]
    status: { type: Number, default: 0 },
    ua: { type: String, default: '', maxlength: 300 }, // raw user-agent (truncated)
    device: { type: String, default: '', maxlength: 100 }, // "Chrome · Windows · Desktop"
    browser: { type: String, default: '', maxlength: 60 },
    os: { type: String, default: '', maxlength: 60 },
    devType: { type: String, default: '', maxlength: 20 }, // Desktop / Mobile / Bot / Tool
    city: { type: String, default: '', maxlength: 80 },
    region: { type: String, default: '', maxlength: 80 },
    country: { type: String, default: '', maxlength: 60 },
    reason: { type: String, default: 'visit', index: true, maxlength: 40 },
    severity: { type: String, enum: ['info', 'low', 'medium', 'high'], default: 'info', index: true },
  },
  { timestamps: true }
);
// 30 days = 30 * 24 * 60 * 60 s → old log entries auto-delete (user requirement)
SecurityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// ---------- blocked IPs (visible + unblockable from admin panel) ----------
// `until: null` → permanent block (TTL skips null dates, never auto-expires).
// `until: <date>` → TTL index deletes the doc at that moment = automatic unblock.
const BlockedIpSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, unique: true, maxlength: 45 },
    reason: { type: String, default: '', maxlength: 300 },
    until: { type: Date, default: null },
    auto: { type: Boolean, default: false }, // true = blocked by auto-defence
  },
  { timestamps: true }
);
BlockedIpSchema.index({ until: 1 }, { expireAfterSeconds: 0 });

const FeedbackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, default: '', trim: true, maxlength: 100 },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'hidden'], default: 'pending' },
    ip: { type: String, default: '', maxlength: 45 }, // for rate limiting
    reply: {
      text: { type: String, default: '', maxlength: 1000 },
      at: { type: Date },
    },
  },
  { timestamps: true }
);
FeedbackSchema.index({ ip: 1, createdAt: -1 }); // per-IP rate-limit query fast

// ---------- live threat feed (blog page) ----------
// services/news.js multiple security sites se fetch karke yahan store karta hai.
// TTL index → 10 din purane items MongoDB khud delete kar deta hai ("purana wala hate").
// extId unique → same article kabhi dobara store nahi hota (dedupe).
const NewsItemSchema = new mongoose.Schema(
  {
    extId: { type: String, required: true, unique: true }, // sha1(source|link)
    source: { type: String, required: true, maxlength: 40 }, // source key
    sourceLabel: { type: String, default: '', maxlength: 60 }, // display name
    title: { type: String, required: true, maxlength: 260 },
    link: { type: String, required: true, maxlength: 800 },
    summary: { type: String, default: '', maxlength: 500 },
    kind: { type: String, enum: ['news', 'cve', 'exploit'], default: 'news', index: true },
    severity: { type: String, enum: ['', 'low', 'medium', 'high', 'critical'], default: '' },
    tags: { type: [String], default: [] },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
// 10 din = auto-delete of stale feed items (user requirement: purana hat-ta rahe)
NewsItemSchema.index({ createdAt: 1 }, { expireAfterSeconds: 10 * 24 * 60 * 60 });
NewsItemSchema.index({ publishedAt: -1 }); // feed sorted by publish time

// ---------- custom pages (Admin → Pages) ----------
// Blocks are stored as plain typed content (heading/text/image) — EJS escapes
// everything, no raw HTML is ever stored, so stored-XSS is impossible by design.
const PageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, maxlength: 60 }, // /p/<slug>
    title: { type: String, required: true, trim: true, maxlength: 100 },
    blocks: {
      type: [{
        type: { type: String, enum: ['heading', 'text', 'image'], default: 'text' },
        text: { type: String, default: '', maxlength: 3000 },
        url: { type: String, default: '', maxlength: 5000000 }, // image: data URL (3MB upload ≈ 4.2M base64 chars — purana 800k cap 500+KB images par save hi crash karta tha) or https URL
      }],
      default: [],
    },
    published: { type: Boolean, default: true },
    showInNav: { type: Boolean, default: false }, // adds a navbar link automatically
    navLabel: { type: String, default: '', maxlength: 30 },
    navOrder: { type: Number, default: 50 },
    navNewTab: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = {
  SiteSetting: mongoose.model('SiteSetting', SiteSettingSchema),
  Project: mongoose.model('Project', ProjectSchema),
  Tool: mongoose.model('Tool', ToolSchema),
  Skill: mongoose.model('Skill', SkillSchema),
  Message: mongoose.model('Message', MessageSchema),
  AdminUser: mongoose.model('AdminUser', AdminUserSchema),
  PageView: mongoose.model('PageView', PageViewSchema),
  Service: mongoose.model('Service', ServiceSchema),
  Testimonial: mongoose.model('Testimonial', TestimonialSchema),
  Experience: mongoose.model('Experience', ExperienceSchema),
  Lab: mongoose.model('Lab', LabSchema),
  Feedback: mongoose.model('Feedback', FeedbackSchema),
  SecurityEvent: mongoose.model('SecurityEvent', SecurityEventSchema),
  BlockedIp: mongoose.model('BlockedIp', BlockedIpSchema),
  Page: mongoose.model('Page', PageSchema),
  NewsItem: mongoose.model('NewsItem', NewsItemSchema),
};

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
  linkedin: { type: String, default: '', maxlength: 500 },
  twitter: { type: String, default: '', maxlength: 500 },
  instagram: { type: String, default: '', maxlength: 500 },
  whatsapp: { type: String, default: '', maxlength: 20 }, // e.g. 919876543210 (tool sales)
  telegram: { type: String, default: '', maxlength: 60 }, // e.g. username
  customLinks: { type: [{ label: { type: String, maxlength: 40 }, url: { type: String, maxlength: 500 } }], default: [] }, // extra social/public URLs
  resumeFile: { type: String, default: '' }, // base64 PDF (size capped by upload limit)
  resumeName: { type: String, default: 'resume.pdf', maxlength: 200 },
});

// Always returns the single settings document (creates it if missing)
SiteSettingSchema.statics.get = function () {
  return this.findOne().then((doc) => doc || this.create({}));
};

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 5000 },
    techStack: { type: String, default: '', maxlength: 300 }, // comma separated e.g. "HTML, CSS, JS"
    image: { type: String, default: '' }, // data URL (size capped by upload limit)
    liveUrl: { type: String, default: '', maxlength: 500 },
    githubUrl: { type: String, default: '', maxlength: 500 },
    featured: { type: Boolean, default: false },
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
};

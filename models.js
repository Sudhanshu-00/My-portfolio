const mongoose = require('mongoose');

const SiteSettingSchema = new mongoose.Schema({
  siteName: { type: String, default: 'My Portfolio' },
  heroTitle: { type: String, default: 'Hi, I am a Web Developer' },
  heroSubtitle: { type: String, default: 'I love building clean and modern websites and web apps.' },
  aboutText: {
    type: String,
    default:
      'Hello! I am a passionate web developer. I enjoy turning ideas into real, working products. Edit this text anytime from the Admin Panel → Settings.',
  },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  location: { type: String, default: '' },
  profilePhoto: { type: String, default: '' }, // stored as data URL
  github: { type: String, default: '' },
  githubUsername: { type: String, default: 'Sudhanshu-00' }, // for live GitHub intel
  thmUsername: { type: String, default: '' }, // TryHackMe username → badge on /labs
  linkedin: { type: String, default: '' },
  twitter: { type: String, default: '' },
  instagram: { type: String, default: '' },
  whatsapp: { type: String, default: '' }, // e.g. 919876543210 (tool sales)
  telegram: { type: String, default: '' }, // e.g. username
  customLinks: { type: [{ label: String, url: String }], default: [] }, // extra social/public URLs
  resumeFile: { type: String, default: '' }, // base64 PDF
  resumeName: { type: String, default: 'resume.pdf' },
});

// Always returns the single settings document (creates it if missing)
SiteSettingSchema.statics.get = function () {
  return this.findOne().then((doc) => doc || this.create({}));
};

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    techStack: { type: String, default: '' }, // comma separated e.g. "HTML, CSS, JS"
    image: { type: String, default: '' }, // data URL
    liveUrl: { type: String, default: '' },
    githubUrl: { type: String, default: '' },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const ToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'Other', trim: true }, // Android / Web / Network / Other
    price: { type: String, default: '' }, // e.g. ₹1,999 or $29
    image: { type: String, default: '' }, // data URL screenshot
    demoUrl: { type: String, default: '' },
    buyUrl: { type: String, default: '' }, // custom buy link; empty = WhatsApp link
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const SkillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    level: { type: Number, default: 80, min: 0, max: 100 },
    category: { type: String, default: 'General', trim: true },
  },
  { timestamps: true }
);

const MessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    message: { type: String, required: true, maxlength: 2000 },
    read: { type: Boolean, default: false },
    ip: { type: String, default: '' }, // contact-form rate limit
  },
  { timestamps: true }
);

const AdminUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  email: { type: String, default: '', trim: true, lowercase: true }, // forgot-password OTP
  otpHash: { type: String, default: '' }, // bcrypt(otp), plain kabhi store nahi
  otpExpiry: { type: Date },
  otpAttempts: { type: Number, default: 0 },
});

const PageViewSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
  },
  { timestamps: true }
);

const ServiceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: String, default: '' },
  },
  { timestamps: true }
);

const TestimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, default: '' },
    text: { type: String, required: true },
    rating: { type: Number, default: 5, min: 1, max: 5 },
  },
  { timestamps: true }
);

const ExperienceSchema = new mongoose.Schema(
  {
    company: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    duration: { type: String, default: '' }, // e.g. "Jan 2024 – Present"
    description: { type: String, default: '' },
    current: { type: Boolean, default: false },
    order: { type: Number, default: 0 }, // lower = upar dikhega
  },
  { timestamps: true }
);

const LabSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['TryHackMe', 'PortSwigger', 'Other'], default: 'TryHackMe' },
    title: { type: String, required: true, trim: true },
    category: { type: String, default: 'General', trim: true }, // SQLi, XSS, Auth Bypass, Recon...
    difficulty: { type: String, default: 'Easy' }, // Easy / Medium / Hard / Insane
    url: { type: String, default: '' }, // room/lab link
    solvedAt: { type: Date },
  },
  { timestamps: true }
);

const FeedbackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, default: '', trim: true },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'hidden'], default: 'pending' },
    ip: { type: String, default: '' }, // rate-limit ke liye
    reply: {
      text: { type: String, default: '' },
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
};

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
  linkedin: { type: String, default: '' },
  twitter: { type: String, default: '' },
  instagram: { type: String, default: '' },
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
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const AdminUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
});

module.exports = {
  SiteSetting: mongoose.model('SiteSetting', SiteSettingSchema),
  Project: mongoose.model('Project', ProjectSchema),
  Skill: mongoose.model('Skill', SkillSchema),
  Message: mongoose.model('Message', MessageSchema),
  AdminUser: mongoose.model('AdminUser', AdminUserSchema),
};

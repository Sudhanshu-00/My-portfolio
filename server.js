require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const { initDB, getActiveUri } = require('./db');
const { SiteSetting, PageView } = require('./models');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

async function main() {
  await initDB();

  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: getActiveUri(), collectionName: 'sessions' }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24, // 1 day
      },
    })
  );

  // Settings + query available in every view
  app.use((req, res, next) => {
    res.locals.query = req.query;
    next();
  });
  app.use(async (req, res, next) => {
    try {
      res.locals.settings = await SiteSetting.get();
    } catch (e) {
      res.locals.settings = {};
    }
    next();
  });

  // Page view analytics (public pages only)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/admin')) {
      PageView.create({ path: req.path }).catch(() => {});
    }
    next();
  });

  // Visitor counter for footer (total + today)
  app.use(async (req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/admin')) {
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [total, today] = await Promise.all([
          PageView.countDocuments(),
          PageView.countDocuments({ createdAt: { $gte: todayStart } }),
        ]);
        res.locals.visits = { total, today };
      } catch {
        res.locals.visits = { total: 0, today: 0 };
      }
    }
    next();
  });

  app.use('/', publicRoutes);
  app.use('/admin', adminRoutes);

  // 404
  app.use((req, res) => res.status(404).render('404'));

  // Error handler
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong. Please try again.');
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🚀 Portfolio running → http://localhost:${port}`));
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});

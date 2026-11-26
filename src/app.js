import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import expressLayouts from 'express-ejs-layouts';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';

import prisma from './lib/prisma.js';
import authRoutes from './routes/auth.routes.js';
import pageRoutes from './routes/page.routes.js';
import cartRoutes from './routes/cart.routes.js';
import contactRoutes from './routes/contact.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for reverse proxies like Render / Cloudflare
app.set('trust proxy', 1);

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Silence favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Static assets (CSS, client JS, images)
app.use(express.static(path.join(process.cwd(), 'public')));

// View engine setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.set('layout', 'layouts/base');

// 1. Session middleware MUST run before ANY routes are mounted
const isProd = process.env.NODE_ENV === 'production';

app.use(
  session({
    name: 'roinax_sid',
    secret: process.env.SESSION_SECRET || 'roinax_session_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 2 * 60 * 1000, // Prunes expired sessions every 2 minutes
      dbRecordIdIsSessionId: true,
      dbRecordIdFunction: undefined,
    }),
    cookie: {
      httpOnly: true,
      secure: isProd, // Must be FALSE on http://localhost:3000
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// 2. Global locals middleware (makes session state available across all EJS templates)
app.use((req, res, next) => {
  res.locals.user = req.session?.user || null;
  res.locals.userId = req.session?.userId || null;
  next();
});

// 3. Mount Routes (All receive parsed sessions)
app.use('/api/auth', authRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/contact', contactRoutes);
app.use('/', pageRoutes); // Handles all page views including /profile and forms

// 404 Catch-All Handler
app.use((req, res) => {
  res.status(404);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({
      success: false,
      message: 'Resource not found or endpoint does not exist.',
    });
  }

  return res.render('pages/404', {
    layout: false,
    title: '404 - Page Not Found | ROINAX Global',
    path: req.originalUrl,
  });
});

// Final 500 Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER_ERROR]:', err);
  const status = err.status || 500;

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(status).json({
      success: false,
      message: err.message || 'Internal server error.',
    });
  }

  return res.status(status).render('pages/404', {
    layout: false,
    title: '500 - Server Error | ROINAX Global',
    path: req.originalUrl,
  });
});

export default app;
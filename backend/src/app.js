import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';

import peopleRouter from './routes/people.js';
import expensesRouter from './routes/expenses.js';
import dashboardRouter from './routes/dashboard.js';
import profileRouter from './routes/profile.js';
import settingsRouter from './routes/settings.js';
import remindersRouter from './routes/reminders.js';

// Builds the Express app. Exported so it can run both as a long-lived server
// (local dev, src/index.js) and as a serverless handler (Vercel, api/index.js).
const app = express();

app.use(
  cors({
    origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map((s) => s.trim()),
  }),
);
app.use(express.json());
app.use(morgan('dev'));

// Health check (public).
app.get('/health', (req, res) => res.json({ ok: true, service: 'pocket-police-backend' }));

// Reminders router owns its own auth (cron secret vs user JWT), mount first.
app.use('/api', remindersRouter);

// All routes below require a valid Supabase user JWT.
app.use('/api/me', requireAuth, profileRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/people', requireAuth, peopleRouter);
app.use('/api/expenses', requireAuth, expensesRouter);

app.use(notFound);
app.use(errorHandler);

export default app;

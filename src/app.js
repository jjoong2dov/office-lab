import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser, checkCsrf } from './auth.js';
import { notFound } from './views.js';
import { homeRoutes } from './routes/home.js';
import { boardRoutes } from './routes/boards.js';
import { adminRoutes } from './routes/admin.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(root, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(loadUser(pool));
  app.use(checkCsrf);

  app.use(homeRoutes(pool));
  app.use(boardRoutes(pool));
  app.use(adminRoutes(pool));

  app.use((req, res) => (req.user ? notFound(req, res) : res.redirect('/login')));
  app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).send('서버 오류가 났습니다.');
  });
  return app;
}

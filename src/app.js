import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser, checkCsrf, isMultipart, CSRF_MESSAGE } from './auth.js';
import { notFound } from './views.js';
import { requestId } from './audit.js';
import { homeRoutes } from './routes/home.js';
import { boardRoutes } from './routes/boards.js';
import { adminRoutes } from './routes/admin.js';
import { fileRoutes, UPLOAD_PATH } from './routes/files.js';
import { auditRoutes } from './routes/audit.js';
import { requestRoutes } from './routes/requests.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 파일 폴더: createApp 에 준 값 → 환경 변수 FILES_DIR → .data/files. 없으면 만든다.
// 웹으로 바로 열리는 public/ 안에는 둘 수 없다. 받는 길은 권한 검사를 거치는 내려받기 주소 하나뿐이어야 한다.
function prepareFilesDir(given) {
  const dir = path.resolve(root, given || process.env.FILES_DIR || '.data/files');
  const rel = path.relative(path.join(root, 'public'), dir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('파일 폴더(FILES_DIR)는 public/ 안에 둘 수 없습니다.');
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createApp(pool, { filesDir } = {}) {
  const dir = prepareFilesDir(filesDir);
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);   // 요청마다 번호를 붙인다. 기록(audit_events)의 request_id 가 된다.
  app.use(express.static(path.join(root, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(loadUser(pool));
  app.use(checkCsrf);
  // checkCsrf 는 multipart POST 를 건너뛴다. 본문을 읽은 뒤 토큰을 다시 검사하는 경로(파일 올리기)만 통과시키고,
  // 나머지 경로로 온 multipart POST 는 여기서 막는다 (토큰 검사 없이 처리되는 길을 남기지 않는다).
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.user && isMultipart(req) && !UPLOAD_PATH.test(req.path)) {
      return res.status(403).send(CSRF_MESSAGE);
    }
    next();
  });

  app.use(homeRoutes(pool));
  app.use(boardRoutes(pool));
  app.use(adminRoutes(pool));
  app.use(fileRoutes(pool, dir));
  app.use(auditRoutes(pool));
  app.use(requestRoutes(pool));

  app.use((req, res) => (req.user ? notFound(req, res) : res.redirect('/login')));
  app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).send('서버 오류가 났습니다.');
  });
  return app;
}

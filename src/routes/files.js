// 첨부 파일. 올리기와 내려받기 두 경로뿐이고, 둘 다 그 글의 게시판으로 canReadBoard() 를 거친다.
// 파일은 filesDir 에 서버가 만든 이름(UUID)으로 두고, 받는 길은 내려받기 주소 하나뿐이다.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { requireLogin, csrfOk, CSRF_MESSAGE } from '../auth.js';
import { canReadBoard, canAttachToPost } from '../policy.js';
import { layout, esc, notFound } from '../views.js';

export const FILE_MAX_BYTES = 5 * 1024 * 1024;
const NAME_MAX = 255;

// multipart 본문을 받는 주소는 이것 하나다. app.js 가 이 밖의 multipart POST 를 막는 데 쓴다.
export const UPLOAD_PATH = /^\/posts\/\d+\/attachments\/?$/i;

// 주소의 id 는 숫자만 받는다. 아니면 null (→ 404).
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null);

// 올린 파일 이름은 화면과 내려받기 머리글에만 쓴다. 경로 부분과 제어 문자를 떼고 길이를 자른다.
function cleanName(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...base].slice(0, NAME_MAX).join('') || '이름 없음';
}

// 종류(content_type)는 올린 쪽이 보낸 값이다. 모양이 맞을 때만 쓰고 아니면 일반 파일로 둔다.
const cleanType = (raw) => (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(String(raw ?? ''))
  ? String(raw).toLowerCase() : 'application/octet-stream');

// Content-Disposition. 한글 이름은 filename*=UTF-8''... 로 싣고, 옛 브라우저용 ASCII 이름도 같이 준다.
export function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const removeFile = (file) => (file ? fs.promises.rm(file.path, { force: true }) : Promise.resolve());

export function fileRoutes(pool, filesDir) {
  const r = express.Router();

  // 디스크 이름은 서버가 만든 UUID. 올린 파일 이름은 여기에 전혀 쓰지 않는다.
  const upload = multer({
    storage: multer.diskStorage({
      destination: filesDir,
      filename: (req, file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: FILE_MAX_BYTES, files: 1, fields: 10, fieldSize: 10 * 1024, parts: 12 },
    defParamCharset: 'utf8',   // 한글 파일 이름이 깨지지 않게
  }).single('file');

  const fail = (req, res, status, message, postId) => res.status(status).send(layout(req, {
    title: '첨부 파일', active: 'boards',
    body: `<h1>첨부 파일</h1>
<p class="error">${esc(message)}</p>
<p><a class="btn ghost" href="/posts/${postId}">글로 돌아가기</a></p>`,
  }));

  // 파일 올리기. 순서: 로그인 → 글을 볼 수 있나(404) → 글쓴이인가(403) → 본문 읽기(multer) → CSRF → 파일 확인 → 저장.
  // 권한은 본문을 읽기 전에 본다. 그래서 볼 수 없는 사람·글쓴이가 아닌 사람의 파일은 디스크에 닿지도 않는다.
  r.post('/posts/:id/attachments', requireLogin,
    async (req, res, next) => {
      const id = parseId(req.params.id);
      if (id === null) return notFound(req, res);
      const { rows } = await pool.query(
        `SELECT p.id, p.author_id, b.id AS board_id, b.department_id
           FROM posts p JOIN boards b ON b.id = p.board_id
          WHERE p.id = $1`, [id]);
      const p = rows[0];
      if (!p || !canReadBoard(req.user, { id: p.board_id, department_id: p.department_id })) return notFound(req, res);
      if (!canAttachToPost(req.user, p)) return res.status(403).send('글쓴이만 파일을 붙일 수 있습니다.');
      req.post = p;
      next();
    },
    (req, res, next) => upload(req, res, (err) => {
      if (!err) return next();
      // 크기를 넘기거나 형식이 맞지 않는 요청. 쓰다 만 파일은 multer 가 지운다.
      if (err instanceof multer.MulterError) {
        return err.code === 'LIMIT_FILE_SIZE'
          ? fail(req, res, 413, '파일은 5MB 까지 올릴 수 있습니다.', req.post.id)
          : fail(req, res, 400, '파일을 하나만 골라 다시 올려 주세요.', req.post.id);
      }
      next(err);
    }),
    async (req, res) => {
      // multipart 는 본문을 읽은 지금에야 토큰을 알 수 있다. 틀리면 올라온 파일을 지운다.
      if (!csrfOk(req)) {
        await removeFile(req.file);
        return res.status(403).send(CSRF_MESSAGE);
      }
      if (!req.file) return fail(req, res, 400, '올릴 파일을 골라 주세요.', req.post.id);
      try {
        await pool.query(
          `INSERT INTO attachments(post_id, storage_key, original_name, size_bytes, content_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.post.id, req.file.filename, cleanName(req.file.originalname), req.file.size, cleanType(req.file.mimetype)]);
      } catch (e) {
        await removeFile(req.file);   // DB 에 남지 않은 파일은 디스크에도 남기지 않는다
        throw e;
      }
      res.redirect(`/posts/${req.post.id}`);
    });

  // 내려받기. 없는 첨부와 볼 수 없는 첨부는 같은 404 로 답한다.
  r.get('/attachments/:id/download', requireLogin, async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(req, res);
    const { rows } = await pool.query(
      `SELECT a.storage_key, a.original_name, a.content_type, b.id AS board_id, b.department_id
         FROM attachments a JOIN posts p ON p.id = a.post_id
         JOIN boards b ON b.id = p.board_id
        WHERE a.id = $1`, [id]);
    const a = rows[0];
    if (!a || !canReadBoard(req.user, { id: a.board_id, department_id: a.department_id })) return notFound(req, res);
    // 경로는 DB 의 storage_key(UUID)로만 만든다.
    const file = path.join(filesDir, a.storage_key);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat || !stat.isFile()) return notFound(req, res);
    res.set({
      'Content-Type': a.content_type,
      'Content-Length': String(stat.size),
      'Content-Disposition': contentDisposition(a.original_name),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    const stream = fs.createReadStream(file);
    stream.on('error', (e) => (res.headersSent ? res.destroy(e) : next(e)));
    stream.pipe(res);
  });

  return r;
}

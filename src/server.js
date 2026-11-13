import { loadEnv, createPool } from './db.js';
import { createApp } from './app.js';

loadEnv();
const pool = createPool();
const port = Number(process.env.PORT || 3000);
createApp(pool).listen(port, '127.0.0.1', () => {
  console.log(`예제상사 사내 시스템: http://127.0.0.1:${port}`);
});

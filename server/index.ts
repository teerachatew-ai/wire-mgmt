import dotenv from 'dotenv';
dotenv.config({ override: true }); // override ทับ env เก่าที่ค้างใน Windows
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDb, flushNow, dbWriteBlocked } from './db';
import { apiCache } from './apiCache';

const app = express();
const PORT = process.env.PORT || 3001;

// เซฟฐานข้อมูลค้างก่อนปิดโปรเซส (cloud restart/deploy ส่ง SIGTERM)
const shutdown = async () => { try { await flushNow(); } catch {} process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.use(cors());
// เก็บ raw body ไว้ใน req.rawBody ด้วย (นอกจาก req.body ที่ parse แล้ว) — ต้องใช้ตรวจลายเซ็น
// webhook ของ LINE (x-line-signature คำนวณจาก raw bytes ก่อนแปลงเป็น JSON เท่านั้น)
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// ── endpoint สำหรับ "ปลุกเครื่องไม่ให้หลับ" ────────────────────────────────
// Render แพลนฟรีจะหลับเมื่อไม่มีคนเข้า 15 นาที แล้วครั้งถัดไปที่เปิดเว็บต้องรอตื่น 30-50 วินาที
// ให้ตัวตั้งเวลาภายนอก (เช่น cron-job.org) ยิงมาที่ /api/ping ทุก ~10 นาทีเฉพาะช่วงเวลาทำงาน
// เครื่องจะตื่นอยู่ตลอดช่วงนั้น เปิดเว็บแล้วเข้าได้ทันที
// จงใจให้เบาที่สุด: ไม่แตะฐานข้อมูล ตอบสั้น
// write_blocked = true แปลว่ามีระบบ 2 ชุดเขียนฐานเดียวกันอยู่ (ดู DEPLOY-FLY.md)
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, write_blocked: dbWriteBlocked(), at: new Date().toISOString() });
});

// เปิดรับ connection ทันที ไม่รอ initDb — ตอน cold start (โดยเฉพาะ Render free tier ที่
// spin ใหม่ทุกครั้งที่หลับ) initDb ต้องโหลดฐานข้อมูลทั้งก้อนจาก Postgres เข้าหน่วยความจำก่อน
// ยิ่งข้อมูลสะสมเยอะยิ่งใช้เวลานาน ถ้าผูก listen() ไว้หลัง initDb() เสร็จ (แบบเดิม) ตัว /api/ping
// เองก็ต้องรอไปด้วย ทั้งที่ตั้งใจให้มันตอบได้ก่อนใครเพื่อปลุกเครื่องเร็วที่สุด
// ส่วน route อื่นๆ ที่ต้องใช้ฐานข้อมูล ค่อย mount เข้า app ทีหลังเมื่อ initDb() เสร็จ (ปลอดภัย
// เพราะ Express จับคู่ route ตอนมี request เข้ามาจริงๆ ไม่ใช่ตอน app.use() ถูกเรียก)
app.listen(PORT, () => {
  console.log(`🚀 Server listening: http://localhost:${PORT} (กำลังโหลดฐานข้อมูล...)`);
});

// ระหว่างที่ยังโหลดฐานข้อมูลไม่เสร็จ ให้ /api/* ตอบ 503 "กำลังเตรียมระบบ" แทนที่จะ 404
// (ของเดิม route ยังไม่ถูก mount เลย request จะตกไป 404 ซึ่งอ่านไม่ออกว่าเกิดอะไรขึ้น)
// วางไว้หลัง /api/ping เพื่อให้ ping ตอบได้ตลอดแม้ฐานข้อมูลยังไม่พร้อม
let dbReady = false;
app.use('/api', (_req, res, next) => {
  if (dbReady) return next();
  res.setHeader('Retry-After', '15');
  res.status(503).json({ error: 'ระบบกำลังเตรียมฐานข้อมูล กรุณารอสักครู่แล้วลองใหม่', warming_up: true });
});

// cache คำตอบ GET /api/* ไว้ใช้ซ้ำระหว่างผู้ใช้หลายคน (ล้างเองทุกครั้งที่มีการเขียนข้อมูล)
// ต้องวางก่อน mount router เพื่อให้ดักได้ทุกเส้น
app.use('/api', apiCache);

// DB must init before routes (sql.js is async)
// ลองใหม่เรื่อยๆ ถ้าโหลดไม่สำเร็จ — ห้าม process.exit เด็ดขาด
// เหตุผล: ฐานข้อมูล Neon (แพลนฟรี) จะพักตัวเองเมื่อไม่มีใครใช้ ~5 นาที พอ Render ตื่นมาเชื่อมต่อ
// ครั้งแรกอาจเจอ error ระหว่าง Neon กำลังปลุก compute ถ้าเจอแล้วดับโปรเซสทิ้ง Render จะรีสตาร์ท
// วนไปเรื่อยๆ แบบถ่างเวลาขึ้นทุกครั้ง (เคยทำให้ล่มยาว 3 ชั่วโมงครึ่ง) — retry เองนิ่งกว่ามาก
function bootDb(attempt = 1): void {
  initDb().then(() => {
  // Import routes after db is ready
  const membersRouter = require('./routes/members').default;
  const productsRouter = require('./routes/products').default;
  const receivesRouter = require('./routes/receives').default;
  const issuesRouter = require('./routes/issues').default;
  const returnsRouter = require('./routes/returns').default;
  const reportsRouter = require('./routes/reports').default;
  const ocrRouter = require('./routes/ocr').default;
  const managersRouter = require('./routes/managers').default;
  const shipmentsRouter = require('./routes/shipments').default;
  const smartcardRouter = require('./routes/smartcard').default;
  const expensesRouter = require('./routes/expenses').default;
  const assetsRouter = require('./routes/assets').default;
  const portalRouter = require('./routes/portal').default;
  const returnRequestsRouter = require('./routes/returnRequests').default;
  const issueRequestsRouter = require('./routes/issueRequests').default;
  const lineRouter = require('./routes/line').default;

  app.use('/api/members', membersRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/receives', receivesRouter);
  app.use('/api/issues', issuesRouter);
  app.use('/api/returns', returnsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/ocr', ocrRouter);
  app.use('/api/managers', managersRouter);
  app.use('/api/shipments', shipmentsRouter);
  app.use('/api/smartcard', smartcardRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/assets', assetsRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/return-requests', returnRequestsRouter);
  app.use('/api/issue-requests', issueRequestsRouter);
  app.use('/api/line', lineRouter);

  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    // ไฟล์ asset (มี hash ในชื่อ) แคชยาวได้ (deploy ใหม่ = hash เปลี่ยน = ไฟล์คนละชื่อ ไม่ชนของเก่า)
    // ส่วน index.html ห้ามแคช เพื่อให้ทุกเครื่อง/มือถือได้เวอร์ชันล่าสุดเสมอ (อ้างชื่อไฟล์ asset ล่าสุดถูกต้อง)
    app.use(express.static(clientDist, {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      },
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

    dbReady = true;
    console.log(`✅ ฐานข้อมูลพร้อมใช้งาน — เปิด route ครบแล้ว`);
  }).catch(err => {
    // ถ่างเวลาขึ้นทีละรอบ แต่ไม่เกิน 30 วิ (Neon ปกติตื่นภายในไม่กี่วินาที)
    const waitMs = Math.min(30000, 2000 * attempt);
    console.error(`DB init failed (ครั้งที่ ${attempt}): ${err?.message || err} — ลองใหม่ใน ${waitMs / 1000} วิ`);
    setTimeout(() => bootDb(attempt + 1), waitMs);
  });
}
bootDb();

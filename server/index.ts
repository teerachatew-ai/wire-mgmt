import dotenv from 'dotenv';
dotenv.config({ override: true }); // override ทับ env เก่าที่ค้างใน Windows
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDb, flushNow } from './db';

const app = express();
const PORT = process.env.PORT || 3001;

// เซฟฐานข้อมูลค้างก่อนปิดโปรเซส (cloud restart/deploy ส่ง SIGTERM)
const shutdown = async () => { try { await flushNow(); } catch {} process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB must init before routes (sql.js is async)
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

  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});

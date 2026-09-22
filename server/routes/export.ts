import { Router } from 'express';
import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Export ตารางบนหน้าจอเป็นไฟล์ Excel — สร้างไฟล์ที่ server แล้วส่งกลับเป็นไฟล์แนบ
   เดิมสร้างไฟล์ในเบราว์เซอร์แล้วดาวน์โหลดผ่าน blob: URL ซึ่ง Safari บน macOS เปิดไม่ได้
   (ขึ้น "Safari ไม่สามารถเปิดหน้าเว็บได้") เพราะ Safari ไม่ยอมดาวน์โหลด blob: ของไฟล์ไบนารี
   ฝั่งเบราว์เซอร์จึงเปลี่ยนมา submit ฟอร์มมาที่นี่ตรงๆ — เป็นการดาวน์โหลดไฟล์แนบปกติ
   ใช้ได้ทุกเบราว์เซอร์รวม Safari (ดู client/src/utils/exportExcel.ts) */
const router = Router();
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ตารางบางหน้ามีหลายพันแถว — body ใหญ่กว่า default 100kb ของ express มาก
router.use(express.urlencoded({ limit: '30mb', extended: true }));
router.use(express.json({ limit: '30mb' }));

router.post('/xlsx', (req, res) => {
  let rows: any[] = [];
  try {
    const raw = req.body?.rows;
    rows = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
  } catch {
    return res.status(400).send('ข้อมูลไม่ถูกต้อง');
  }
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).send('ไม่มีข้อมูลให้ export');

  const nameRaw = String(req.body?.filename || 'export').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'export';
  const filename = nameRaw.toLowerCase().endsWith('.xlsx') ? nameRaw : `${nameRaw}.xlsx`;
  const sheet = String(req.body?.sheet || 'Sheet1');

  const root = process.cwd();
  const script = path.join(root, 'server', 'scripts', 'rows_export.py');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rows-export-'));
  const dataFile = path.join(tmpDir, 'data.json');
  const outFile = path.join(tmpDir, 'out.xlsx');
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  fs.writeFileSync(dataFile, JSON.stringify({ sheet, rows }), 'utf-8');

  const py = spawn(PYTHON, [script, dataFile, outFile], { env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  let errOut = '';
  py.stderr.on('data', c => { errOut += c.toString(); });
  py.on('error', e => { cleanup(); res.status(500).send('สร้างไฟล์ไม่สำเร็จ: ' + e.message); });
  py.on('close', code => {
    if (code !== 0 || !fs.existsSync(outFile)) { cleanup(); return res.status(500).send('สร้างไฟล์ไม่สำเร็จ ' + errOut); }
    // ชื่อไฟล์ภาษาไทยต้องส่งแบบ RFC 5987 (filename*) ไม่งั้นเบราว์เซอร์บางตัวได้ชื่อเพี้ยน
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on('close', cleanup);
  });
});

export default router;

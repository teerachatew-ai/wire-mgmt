import { Router } from 'express';
import { verifyLineSignature, handleLineEvent, lineConfigured, getLineGroupId } from '../line';

const router = Router();

// Webhook รับ event จาก LINE (มีคนเข้ากลุ่ม/ออกจากกลุ่ม/พิมพ์ข้อความ ฯลฯ)
// ต้องตอบ 200 ให้ไวที่สุดเสมอ ไม่งั้น LINE จะคิดว่าส่งไม่สำเร็จแล้วส่งซ้ำ
router.post('/webhook', (req: any, res) => {
  const sig = req.headers['x-line-signature'] as string | undefined;
  if (!verifyLineSignature(req.rawBody, sig)) {
    console.error('LINE webhook: ลายเซ็นไม่ถูกต้อง (เช็ค LINE_CHANNEL_SECRET ให้ตรงกับ LINE Developers Console)');
    return res.status(401).json({ error: 'invalid signature' });
  }
  res.status(200).end(); // ตอบก่อนเสมอ ส่วนประมวลผล event ทำต่อข้างหลังได้ ไม่ต้องรอ
  const events = req.body?.events || [];
  for (const ev of events) {
    handleLineEvent(ev).catch((e: any) => console.error('LINE event error:', e?.message));
  }
});

// เช็คสถานะการตั้งค่า LINE จากหน้า Settings (ไม่โชว์ค่าจริงของ token/secret)
router.get('/status', (_req, res) => {
  res.json({ configured: lineConfigured(), group_id_known: !!getLineGroupId() });
});

export default router;

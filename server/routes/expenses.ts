import { Router } from 'express';
import { prepare } from '../db';

const router = Router();

router.get('/', (req, res) => {
  const { month } = req.query;
  let sql = `SELECT * FROM expenses WHERE 1=1`;
  const params: any[] = [];
  if (month) { sql += ` AND month = ?`; params.push(month); }
  sql += ` ORDER BY created_at DESC, id DESC`;
  res.json(prepare(sql).all(...params));
});

/* ── ค่าใช้จ่ายประจำ (recurring_expenses) — ตั้งครั้งเดียว หักทุกเดือนในช่วงที่กำหนด ── */
const YM = /^\d{4}-\d{2}$/;
const cleanRecurring = (b: any, prev?: any) => {
  const kind = (b.kind ?? prev?.kind) === 'percent' ? 'percent' : 'fixed';
  const value = parseFloat(b.value ?? prev?.value);
  const start = String(b.start_month ?? prev?.start_month ?? '');
  const endRaw = b.end_month === undefined ? prev?.end_month : b.end_month;
  const end = endRaw && YM.test(String(endRaw)) ? String(endRaw) : null;
  const name = String(b.name ?? prev?.name ?? '').trim();
  if (!name) return { error: 'กรุณาใส่ชื่อรายการ' };
  if (!isFinite(value) || value < 0) return { error: 'จำนวนไม่ถูกต้อง' };
  if (kind === 'percent' && value > 100) return { error: '% ต้องไม่เกิน 100' };
  if (!YM.test(start)) return { error: 'ระบุเดือนเริ่ม (YYYY-MM)' };
  if (end && end < start) return { error: 'เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม' };
  const active = b.active === undefined ? (prev?.active ?? 1) : (b.active ? 1 : 0);
  return { name, kind, value, start, end, active };
};
router.get('/recurring', (_req, res) => {
  res.json(prepare(`SELECT * FROM recurring_expenses ORDER BY active DESC, start_month, id`).all());
});
router.post('/recurring', (req, res) => {
  const v: any = cleanRecurring(req.body || {});
  if (v.error) return res.status(400).json(v);
  const r = prepare(`INSERT INTO recurring_expenses (name, kind, value, start_month, end_month, active) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(v.name, v.kind, v.value, v.start, v.end, v.active);
  res.json(prepare(`SELECT * FROM recurring_expenses WHERE id = ?`).get(r.lastInsertRowid));
});
router.put('/recurring/:id', (req, res) => {
  const prev = prepare(`SELECT * FROM recurring_expenses WHERE id = ?`).get(req.params.id) as any;
  if (!prev) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const v: any = cleanRecurring(req.body || {}, prev);
  if (v.error) return res.status(400).json(v);
  prepare(`UPDATE recurring_expenses SET name=?, kind=?, value=?, start_month=?, end_month=?, active=? WHERE id=?`)
    .run(v.name, v.kind, v.value, v.start, v.end, v.active, req.params.id);
  res.json(prepare(`SELECT * FROM recurring_expenses WHERE id = ?`).get(req.params.id));
});
router.delete('/recurring/:id', (req, res) => {
  prepare(`DELETE FROM recurring_expenses WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

router.post('/', (req, res) => {
  const { month, description, amount, paid_to_type, paid_to_id, paid_to_name } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'ระบุเดือน (YYYY-MM) ไม่ถูกต้อง' });
  if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'กรุณากรอกจำนวนเงิน' });
  const ptype = ['member', 'manager'].includes(paid_to_type) ? paid_to_type : 'general';
  const r = prepare(`INSERT INTO expenses (month, description, amount, paid_to_type, paid_to_id, paid_to_name) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(month, description || null, parseFloat(amount), ptype, ptype === 'general' ? null : (paid_to_id || null), ptype === 'general' ? null : (paid_to_name || null));
  res.json(prepare(`SELECT * FROM expenses WHERE id = ?`).get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { month, description, amount, paid_to_type, paid_to_id, paid_to_name } = req.body;
  const ex = prepare(`SELECT * FROM expenses WHERE id = ?`).get(req.params.id) as any;
  if (!ex) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const ptype = paid_to_type === undefined ? ex.paid_to_type : (['member', 'manager'].includes(paid_to_type) ? paid_to_type : 'general');
  prepare(`UPDATE expenses SET month=?, description=?, amount=?, paid_to_type=?, paid_to_id=?, paid_to_name=? WHERE id=?`)
    .run(month || ex.month, description ?? ex.description, amount != null ? parseFloat(amount) : ex.amount,
      ptype, ptype === 'general' ? null : (paid_to_id ?? ex.paid_to_id), ptype === 'general' ? null : (paid_to_name ?? ex.paid_to_name), req.params.id);
  res.json(prepare(`SELECT * FROM expenses WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  prepare(`DELETE FROM expenses WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

export default router;

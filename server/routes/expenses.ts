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

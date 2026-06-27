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
  const { month, description, amount } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'ระบุเดือน (YYYY-MM) ไม่ถูกต้อง' });
  if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'กรุณากรอกจำนวนเงิน' });
  const r = prepare(`INSERT INTO expenses (month, description, amount) VALUES (?, ?, ?)`)
    .run(month, description || null, parseFloat(amount));
  res.json(prepare(`SELECT * FROM expenses WHERE id = ?`).get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { month, description, amount } = req.body;
  const ex = prepare(`SELECT * FROM expenses WHERE id = ?`).get(req.params.id) as any;
  if (!ex) return res.status(404).json({ error: 'ไม่พบรายการ' });
  prepare(`UPDATE expenses SET month=?, description=?, amount=? WHERE id=?`)
    .run(month || ex.month, description ?? ex.description, amount != null ? parseFloat(amount) : ex.amount, req.params.id);
  res.json(prepare(`SELECT * FROM expenses WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  prepare(`DELETE FROM expenses WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

export default router;

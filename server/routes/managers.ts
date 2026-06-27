import { Router } from 'express';
import { prepare } from '../db';

const router = Router();

router.get('/', (_req, res) => {
  res.json(prepare(`SELECT * FROM managers ORDER BY sort_order, id`).all());
});

router.post('/', (req, res) => {
  const { name, role, compensation_type, amount, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
  prepare(
    `INSERT INTO managers (name, role, compensation_type, amount, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).run(name, role || '', compensation_type || 'fixed', Number(amount) || 0, Number(sort_order) || 0);
  // sql.js last_insert_rowid may not be reliable via exec — use MAX(id) instead
  const created = prepare(`SELECT * FROM managers ORDER BY id DESC LIMIT 1`).get();
  res.json(created);
});

router.put('/:id', (req, res) => {
  const { name, role, compensation_type, amount, active, sort_order } = req.body;
  prepare(`UPDATE managers SET name=?, role=?, compensation_type=?, amount=?, active=?, sort_order=? WHERE id=?`)
    .run(name, role || '', compensation_type || 'fixed', Number(amount) || 0, active != null ? Number(active) : 1, Number(sort_order) || 0, Number(req.params.id));
  res.json(prepare(`SELECT * FROM managers WHERE id = ?`).get(Number(req.params.id)));
});

router.delete('/:id', (req, res) => {
  prepare(`DELETE FROM managers WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

export default router;

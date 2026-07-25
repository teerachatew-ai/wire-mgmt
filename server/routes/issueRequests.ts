import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { userOf } from '../reqUser';

const router = Router();

function getSettings() {
  const rows = prepare(`SELECT key, value FROM settings`).all() as any[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = `SELECT ir.*, m.code as member_code, m.name as member_name, m.nickname as member_nickname,
      p.name as product_name, p.color, p.unit, p.project
    FROM issue_requests ir
    JOIN members m ON ir.member_id = m.id
    JOIN products p ON ir.product_id = p.id
    WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ` AND ir.status = ?`; params.push(status); }
  sql += ` ORDER BY ir.submitted_at ASC`;
  res.json(prepare(sql).all(...params));
});

router.post('/:id/confirm', (req, res) => {
  const request = prepare(`SELECT * FROM issue_requests WHERE id = ?`).get(req.params.id) as any;
  if (!request) return res.status(404).json({ error: 'ไม่พบคำขอ' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' });

  const { product_id, quantity, issued_at, due_date, notes } = req.body;
  const productId = product_id || request.product_id;
  const qty = quantity !== undefined ? (parseFloat(quantity) || 0) : request.quantity;
  const issuedAt = issued_at || request.issued_at || new Date().toISOString().split('T')[0];
  if (qty <= 0) return res.status(400).json({ error: 'กรุณาระบุจำนวน' });

  const settings = getSettings();
  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(request.member_id) as any;
  if (!member) return res.status(400).json({ error: 'ไม่พบสมาชิก' });
  if (member.status !== 'active') return res.status(400).json({ error: 'สมาชิกถูกพักสถานะ' });

  const overdue = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE member_id = ? AND status != 'closed' AND due_date < date('now')`).get(request.member_id) as any;
  if (overdue.cnt > 0) return res.status(400).json({ error: `สมาชิกมีงานค้างเกินกำหนด ${overdue.cnt} ใบ` });

  const pending = prepare(`SELECT COALESCE(SUM(quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0)),0) as total FROM issues i WHERE member_id = ? AND status != 'closed'`).get(request.member_id) as any;
  const maxUnits = parseFloat(settings.max_pending_units || '500');
  if ((pending.total || 0) + qty > maxUnits) {
    return res.status(400).json({ error: `เบิกเกินเพดาน (คงค้าง ${pending.total} + ขอเบิก ${qty} > ${maxUnits} หน่วย)` });
  }

  const code = nextDateCode('IS', 'issues', issuedAt);
  const result = prepare(`INSERT INTO issues (code, issued_at, member_id, product_id, quantity, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, issuedAt, request.member_id, productId, qty, due_date || null, notes || request.notes || null, userOf(req));

  prepare(`UPDATE issue_requests SET status='confirmed', confirmed_issue_id=?, confirmed_at=datetime('now'), confirmed_by=? WHERE id=?`)
    .run(result.lastInsertRowid, userOf(req), req.params.id);

  res.json({ ok: true, issue_id: result.lastInsertRowid });
});

router.post('/:id/reject', (req, res) => {
  const request = prepare(`SELECT * FROM issue_requests WHERE id = ?`).get(req.params.id) as any;
  if (!request) return res.status(404).json({ error: 'ไม่พบคำขอ' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' });
  const { reason } = req.body;
  prepare(`UPDATE issue_requests SET status='rejected', confirmed_at=datetime('now'), confirmed_by=?, reject_reason=? WHERE id=?`)
    .run(userOf(req), reason || null, req.params.id);
  res.json({ ok: true });
});

export default router;

import { Router } from 'express';
import { prepare, nextCode } from '../db';
import { userOf } from '../reqUser';

const router = Router();

function getSettings() {
  const rows = prepare(`SELECT key, value FROM settings`).all() as any[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function calcIssueStatus(issueId: number) {
  const issue = prepare(`SELECT quantity FROM issues WHERE id = ?`).get(issueId) as any;
  const rets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d, COALESCE(SUM(waste_qty),0) as w FROM returns WHERE issue_id = ?`).get(issueId) as any;
  const total = rets.g + rets.d + rets.w;
  if (total >= issue.quantity) return 'closed';
  if (total > 0) return 'partial';
  return 'pending';
}

router.get('/', (req, res) => {
  const { status, member_id, from, to, date } = req.query;
  let sql = `SELECT i.*,
    m.name as member_name, m.code as member_code, m.nickname as member_nickname,
    p.name as product_name, p.unit, p.wage_per_unit, p.color, p.project,
    COALESCE((SELECT SUM(good_qty) FROM returns WHERE issue_id = i.id),0) as returned_good,
    COALESCE((SELECT SUM(defect_qty) FROM returns WHERE issue_id = i.id),0) as returned_defect,
    COALESCE((SELECT SUM(waste_qty) FROM returns WHERE issue_id = i.id),0) as returned_waste
    FROM issues i
    JOIN members m ON i.member_id = m.id
    JOIN products p ON i.product_id = p.id
    WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ` AND i.status = ?`; params.push(status); }
  if (member_id) { sql += ` AND i.member_id = ?`; params.push(member_id); }
  if (date) { sql += ` AND i.issued_at LIKE ?`; params.push(`${date}%`); }
  if (from) { sql += ` AND i.issued_at >= ?`; params.push(from); }
  if (to) { sql += ` AND i.issued_at <= ?`; params.push(to); }
  sql += ` ORDER BY i.issued_at DESC, i.id DESC`;
  res.json(prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = prepare(`SELECT i.*, m.name as member_name, m.code as member_code, p.name as product_name, p.unit, p.wage_per_unit
    FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  const rets = prepare(`SELECT * FROM returns WHERE issue_id = ? ORDER BY returned_at`).all(req.params.id);
  res.json({ ...row as object, returns: rets });
});

router.post('/', (req, res) => {
  const { issued_at, member_id, product_id, quantity, due_date, notes } = req.body;
  if (!issued_at || !member_id || !product_id || !quantity) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });

  const settings = getSettings();
  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(member_id) as any;
  if (!member) return res.status(400).json({ error: 'ไม่พบสมาชิก' });
  if (member.status !== 'active') return res.status(400).json({ error: 'สมาชิกถูกพักสถานะ' });

  const overdue = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE member_id = ? AND status != 'closed' AND due_date < date('now')`).get(member_id) as any;
  if (overdue.cnt > 0) return res.status(400).json({ error: `สมาชิกมีงานค้างเกินกำหนด ${overdue.cnt} ใบ` });

  const pending = prepare(`SELECT COALESCE(SUM(quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty) FROM returns WHERE issue_id=i.id),0)),0) as total FROM issues i WHERE member_id = ? AND status != 'closed'`).get(member_id) as any;
  const maxUnits = parseFloat(settings.max_pending_units || '500');
  if ((pending.total || 0) + parseFloat(quantity) > maxUnits) {
    return res.status(400).json({ error: `เบิกเกินเพดาน (คงค้าง ${pending.total} + ขอเบิก ${quantity} > ${maxUnits} หน่วย)` });
  }

  const code = nextCode('IS', 'issues');
  const result = prepare(`INSERT INTO issues (code, issued_at, member_id, product_id, quantity, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, issued_at, member_id, product_id, quantity, due_date || null, notes || null, userOf(req));

  res.json(prepare(`SELECT i.*, m.name as member_name, m.code as member_code, p.name as product_name, p.unit, p.wage_per_unit FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { issued_at, member_id, product_id, quantity, due_date, notes } = req.body;
  const issue = prepare(`SELECT * FROM issues WHERE id = ?`).get(req.params.id) as any;
  if (!issue) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (!issued_at || !member_id || !product_id || !quantity) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });

  // จำนวนที่คืนแล้ว — ห้ามแก้จำนวนเบิกให้น้อยกว่าที่คืนไปแล้ว
  const ret = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty),0) as total FROM returns WHERE issue_id = ?`).get(req.params.id) as any;
  if (parseFloat(quantity) < (ret.total || 0)) {
    return res.status(400).json({ error: `แก้จำนวนเบิกได้ไม่ต่ำกว่าจำนวนที่คืนแล้ว (${ret.total} หน่วย)` });
  }

  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(member_id) as any;
  if (!member) return res.status(400).json({ error: 'ไม่พบสมาชิก' });

  prepare(`UPDATE issues SET issued_at=?, member_id=?, product_id=?, quantity=?, due_date=?, notes=? WHERE id=?`)
    .run(issued_at, member_id, product_id, quantity, due_date || null, notes || null, req.params.id);

  // คำนวณสถานะใหม่ตามจำนวนเบิกที่เปลี่ยน
  const newStatus = (ret.total || 0) >= parseFloat(quantity) ? 'closed' : (ret.total || 0) > 0 ? 'partial' : 'pending';
  prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(newStatus, req.params.id);

  res.json(prepare(`SELECT i.*, m.name as member_name, m.code as member_code, p.name as product_name, p.unit, p.wage_per_unit FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const issue = prepare(`SELECT * FROM issues WHERE id = ?`).get(req.params.id) as any;
  if (!issue) return res.status(404).json({ error: 'ไม่พบใบเบิก' });

  const ret = prepare(`SELECT COUNT(*) as cnt FROM returns WHERE issue_id = ?`).get(req.params.id) as any;
  if (ret.cnt > 0 && req.query.force !== '1') {
    return res.status(409).json({
      confirm_required: true,
      return_count: ret.cnt,
      message: `ใบเบิก ${issue.code} มีรายการรับคืน ${ret.cnt} รายการ การลบจะลบรายการคืนทั้งหมดด้วย ยืนยันหรือไม่?`
    });
  }
  // ลบรายการคืนที่ผูกอยู่ก่อน
  prepare(`DELETE FROM returns WHERE issue_id = ?`).run(req.params.id);
  prepare(`DELETE FROM issues WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true, code: issue.code });
});

export default router;

import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
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

  const pending = prepare(`SELECT COALESCE(SUM(quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0)),0) as total FROM issues i WHERE member_id = ? AND status != 'closed'`).get(member_id) as any;
  const maxUnits = parseFloat(settings.max_pending_units || '500');
  if ((pending.total || 0) + parseFloat(quantity) > maxUnits) {
    return res.status(400).json({ error: `เบิกเกินเพดาน (คงค้าง ${pending.total} + ขอเบิก ${quantity} > ${maxUnits} หน่วย)` });
  }

  const code = nextDateCode('IS', 'issues', issued_at);
  const result = prepare(`INSERT INTO issues (code, issued_at, member_id, product_id, quantity, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, issued_at, member_id, product_id, quantity, due_date || null, notes || null, userOf(req));

  res.json(prepare(`SELECT i.*, m.name as member_name, m.code as member_code, p.name as product_name, p.unit, p.wage_per_unit FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(result.lastInsertRowid));
});

// สร้างใบเบิกหลายรุ่นให้สมาชิกคนเดียวใน request เดียว — ฝั่งหน้าเว็บเคยยิงทีละรุ่นเรียงกัน
// (เบิกทั้งชุด 4 รุ่น = 4 รอบ รอบละ ~250ms บนเซิร์ฟเวอร์ฟรี = รอเกือบ 1 วินาทีทุกครั้งที่เซฟ)
// รวมเป็นรอบเดียว + ตรวจเพดานคงค้างจากยอดรวมทั้งชุดทีเดียว (ยิงแยกขนานกันจะตรวจเพดานพลาด
// เพราะแต่ละ request เห็นยอดคงค้างก่อนหน้าเหมือนกันหมด รวมกันแล้วอาจทะลุเพดานได้)
router.post('/batch', (req, res) => {
  const { issued_at, member_id, due_date, notes, lines } = req.body || {};
  if (!issued_at || !member_id || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  }
  const valid = lines.filter((l: any) => l && l.product_id && parseFloat(l.quantity) > 0);
  if (valid.length === 0) return res.status(400).json({ error: 'ไม่มีรายการที่มีจำนวนมากกว่า 0' });

  const settings = getSettings();
  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(member_id) as any;
  if (!member) return res.status(400).json({ error: 'ไม่พบสมาชิก' });
  if (member.status !== 'active') return res.status(400).json({ error: 'สมาชิกถูกพักสถานะ' });

  const overdue = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE member_id = ? AND status != 'closed' AND due_date < date('now')`).get(member_id) as any;
  if (overdue.cnt > 0) return res.status(400).json({ error: `สมาชิกมีงานค้างเกินกำหนด ${overdue.cnt} ใบ` });

  const pending = prepare(`SELECT COALESCE(SUM(quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0)),0) as total FROM issues i WHERE member_id = ? AND status != 'closed'`).get(member_id) as any;
  const maxUnits = parseFloat(settings.max_pending_units || '500');
  const askTotal = valid.reduce((s: number, l: any) => s + parseFloat(l.quantity), 0);
  if ((pending.total || 0) + askTotal > maxUnits) {
    return res.status(400).json({ error: `เบิกเกินเพดาน (คงค้าง ${pending.total} + ขอเบิกรวม ${askTotal} > ${maxUnits} หน่วย)` });
  }

  const by = userOf(req);
  const created: any[] = [];
  const failed: any[] = [];
  for (const l of valid) {
    try {
      const code = nextDateCode('IS', 'issues', issued_at);
      const r = prepare(`INSERT INTO issues (code, issued_at, member_id, product_id, quantity, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(code, issued_at, member_id, l.product_id, l.quantity, due_date || null, notes || null, by);
      created.push(prepare(`SELECT i.*, m.name as member_name, m.code as member_code, p.name as product_name, p.unit, p.wage_per_unit FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(r.lastInsertRowid));
    } catch (e: any) {
      failed.push({ product_id: l.product_id, error: e?.message || 'บันทึกไม่สำเร็จ' });
    }
  }
  res.json({ created, failed });
});

router.put('/:id', (req, res) => {
  const { issued_at, member_id, product_id, quantity, due_date, notes } = req.body;
  const issue = prepare(`SELECT * FROM issues WHERE id = ?`).get(req.params.id) as any;
  if (!issue) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (!issued_at || !member_id || !product_id || !quantity) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });

  // จำนวนที่คืนแล้ว — ห้ามแก้จำนวนเบิกให้น้อยกว่าที่คืนไปแล้ว
  const ret = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty+lost_qty),0) as total FROM returns WHERE issue_id = ?`).get(req.params.id) as any;
  if (parseFloat(quantity) < (ret.total || 0)) {
    return res.status(400).json({ error: `แก้จำนวนเบิกได้ไม่ต่ำกว่าจำนวนที่คืนแล้ว (${ret.total} หน่วย)` });
  }

  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(member_id) as any;
  if (!member) return res.status(400).json({ error: 'ไม่พบสมาชิก' });

  // ใบเบิกอื่นที่เบิกพร้อมกัน (ชุดเดียวกัน) — คนเดียวกัน วันเดียวกัน จำนวนเท่ากับก่อนแก้ — เผื่ออยากแก้จำนวนให้ตรงกันด้วย
  const qtyChanged = parseFloat(quantity) !== issue.quantity;
  const siblings = qtyChanged ? prepare(`
    SELECT i.id, i.code, i.quantity, i.issued_at, i.member_id, i.product_id, i.due_date, i.notes, p.name as product_name, p.unit
    FROM issues i JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND i.issued_at = ? AND i.quantity = ? AND i.id != ?
  `).all(issue.member_id, issue.issued_at, issue.quantity, req.params.id) : [];

  prepare(`UPDATE issues SET issued_at=?, member_id=?, product_id=?, quantity=?, due_date=?, notes=? WHERE id=?`)
    .run(issued_at, member_id, product_id, quantity, due_date || null, notes || null, req.params.id);

  // คำนวณสถานะใหม่ตามจำนวนเบิกที่เปลี่ยน
  const newStatus = (ret.total || 0) >= parseFloat(quantity) ? 'closed' : (ret.total || 0) > 0 ? 'partial' : 'pending';
  prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(newStatus, req.params.id);

  res.json({
    ...prepare(`SELECT i.*, m.name as member_name, m.code as member_code, p.name as product_name, p.unit, p.wage_per_unit FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(req.params.id) as any,
    siblings,
  });
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
  // ใบเบิกอื่นที่เบิกพร้อมกัน (ชุดเดียวกัน) — คนเดียวกัน วันเดียวกัน จำนวนเดิมเท่ากัน — เผื่ออยากลบทั้งชุดด้วย
  const siblings = prepare(`
    SELECT i.id, i.code, i.quantity, i.issued_at, p.name as product_name, p.unit
    FROM issues i JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND i.issued_at = ? AND i.quantity = ? AND i.id != ?
  `).all(issue.member_id, issue.issued_at, issue.quantity, req.params.id);

  // ลบใบเบิกแล้วต้องลบให้ครบทุกฝั่ง — ทั้งรายการรับคืนที่ผูกอยู่ และคำขอจากพอร์ทัลสมาชิก
  // (ทั้งคำขอเบิกที่ยืนยันแล้วกลายเป็นใบเบิกนี้ และคำขอคืนที่อ้างอิงใบเบิก/รายการคืนนี้)
  // กันไม่ให้เหลือแถวค้างอ้างถึงรายการที่ถูกลบไปแล้ว
  prepare(`DELETE FROM return_requests WHERE issue_id = ? OR confirmed_return_id IN (SELECT id FROM returns WHERE issue_id = ?)`)
    .run(req.params.id, req.params.id);
  prepare(`DELETE FROM issue_requests WHERE confirmed_issue_id = ?`).run(req.params.id);
  prepare(`DELETE FROM returns WHERE issue_id = ?`).run(req.params.id);
  prepare(`DELETE FROM issues WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true, code: issue.code, siblings });
});

export default router;

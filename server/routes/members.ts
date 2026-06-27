import { Router } from 'express';
import { prepare, nextCode } from '../db';

const router = Router();

router.get('/', (req, res) => {
  const { q, status } = req.query;
  let sql = `SELECT m.*,
    (SELECT COUNT(*) FROM issues WHERE member_id = m.id AND status != 'closed') AS pending_issues,
    (SELECT COALESCE(SUM(quantity),0) FROM issues WHERE member_id = m.id AND status != 'closed') AS pending_units,
    (SELECT COUNT(*) FROM returns r JOIN issues i ON r.issue_id = i.id
       WHERE i.member_id = m.id AND (r.good_qty + r.defect_qty) > 0
       AND (r.ng_cut * 100.0 / (r.good_qty + r.defect_qty)) > 3) AS ng_count,
    (SELECT COUNT(*) FROM returns r JOIN issues i ON r.issue_id = i.id
       WHERE i.member_id = m.id AND (r.good_qty + r.defect_qty) > 0) AS batch_count
    FROM members m WHERE 1=1`;
  const params: any[] = [];
  if (q) { sql += ` AND (m.name LIKE ? OR m.nickname LIKE ? OR m.code LIKE ? OR m.phone LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { sql += ` AND m.status = ?`; params.push(status); }
  sql += ` ORDER BY m.code`;
  const rows = prepare(sql).all(...params) as any[];
  // เกรด: NG เกิน 3% — 0 ครั้ง=A, 1 ครั้ง=B, มากกว่านั้น=C
  const graded = rows.map(m => ({ ...m, grade: m.ng_count === 0 ? 'A' : m.ng_count === 1 ? 'B' : 'C' }));
  res.json(graded);
});

router.get('/:id', (req, res) => {
  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(req.params.id);
  if (!member) return res.status(404).json({ error: 'ไม่พบสมาชิก' });
  res.json(member);
});

router.post('/', (req, res) => {
  const { name, nickname, id_card, phone, address, bank_account, bank_name, registered_at, pdpa_consent } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
  const code = nextCode('M', 'members');
  const consent = pdpa_consent ? 1 : 0;
  const consentAt = consent ? new Date().toISOString().split('T')[0] : null;
  const result = prepare(
    `INSERT INTO members (code, name, nickname, id_card, phone, address, bank_account, bank_name, registered_at, pdpa_consent, pdpa_consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, name, nickname || null, id_card || null, phone || null, address || null, bank_account || null, bank_name || null, registered_at || new Date().toISOString().split('T')[0], consent, consentAt);
  res.json(prepare(`SELECT * FROM members WHERE id = ?`).get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, nickname, id_card, phone, address, bank_account, bank_name, status, pdpa_consent } = req.body;
  const existing = prepare(`SELECT pdpa_consent, pdpa_consent_at FROM members WHERE id = ?`).get(req.params.id) as any;
  const consent = pdpa_consent ? 1 : 0;
  // keep original consent date if already consented; set today when newly consenting
  const consentAt = consent ? (existing?.pdpa_consent_at || new Date().toISOString().split('T')[0]) : null;
  prepare(`UPDATE members SET name=?, nickname=?, id_card=?, phone=?, address=?, bank_account=?, bank_name=?, status=?, pdpa_consent=?, pdpa_consent_at=? WHERE id=?`)
    .run(name, nickname || null, id_card || null, phone || null, address || null, bank_account || null, bank_name || null, status || 'active', consent, consentAt, req.params.id);
  res.json(prepare(`SELECT * FROM members WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const member = prepare(`SELECT * FROM members WHERE id = ?`).get(req.params.id) as any;
  if (!member) return res.status(404).json({ error: 'ไม่พบสมาชิก' });

  // ตรวจสอบว่ามีใบเบิกค้างอยู่ไหม
  const pending = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE member_id = ? AND status != 'closed'`).get(req.params.id) as any;
  if (pending.cnt > 0) {
    return res.status(400).json({ error: `ไม่สามารถลบได้ — มีใบเบิกค้างอยู่ ${pending.cnt} ใบ กรุณาปิดงานให้ครบก่อน` });
  }

  const { force } = req.query;
  if (force === '1') {
    // Hard delete (มีประวัติในระบบแต่ยืนยันลบ)
    prepare(`DELETE FROM members WHERE id = ?`).run(req.params.id);
    res.json({ deleted: true, name: member.name });
  } else {
    // ตรวจว่ามีประวัติงานเลยไหม
    const hasHistory = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE member_id = ?`).get(req.params.id) as any;
    if (hasHistory.cnt > 0) {
      // มีประวัติ — ถามยืนยันก่อน
      return res.status(409).json({
        error: 'สมาชิกมีประวัติงานในระบบ',
        issue_count: hasHistory.cnt,
        confirm_required: true,
        message: `${member.name} มีประวัติใบเบิกทั้งหมด ${hasHistory.cnt} รายการ การลบจะลบข้อมูลทั้งหมดถาวร ยืนยันหรือไม่?`
      });
    }
    // ไม่มีประวัติ — ลบได้เลย
    prepare(`DELETE FROM members WHERE id = ?`).run(req.params.id);
    res.json({ deleted: true, name: member.name });
  }
});

export default router;

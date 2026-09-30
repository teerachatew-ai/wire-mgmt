import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { computePayCycle, loadCutoffConfig } from '../payCycle';
import { userOf } from '../reqUser';

const router = Router();

function payCycleFor(returnedAt: string): string {
  const cfg = prepare(`SELECT key, value FROM settings`).all() as any[];
  const { holidays, overrides, cutoffDay } = loadCutoffConfig(cfg);
  return computePayCycle(returnedAt, holidays, overrides, cutoffDay);
}

/* แยกยอดคืนจาก body — ใช้ร่วมกันทั้ง POST / batch / PUT
   good_qty = งานดีทั้งหมด "รวมงานแก้ไขแล้ว" (งานแก้ไขส่งโรงงานได้เหมือนงานดี แต่หักค่าแรง % — ดู wagePolicy.ts)
   defect_qty = NG กลุ่ม + NG โรงงาน + NG ดึงเชือก (ยอดรวมของเสียที่ระบบสต็อก/คุณภาพใช้)
   ถ้าไม่ส่งฟิลด์ใหม่มา (หน้าจอเก่า/พอร์ทัล) ใช้ค่าเดิมของรายการ (prev) หรือ 0 */
function parseQty(b: any, prev?: any) {
  const num = (v: any) => parseFloat(v) || 0;
  const keep = (k: string) => (b[k] === undefined && prev ? num(prev[k]) : num(b[k]));
  const gQty = num(b.good_qty);
  const ngCut = num(b.ng_cut);                 // NG กลุ่ม (มีค่าปรับ)
  const ngFac = num(b.ng_factory);             // NG โรงงาน (จ่ายปกติ ไม่ปรับ)
  const ngRope = keep('ng_rope');              // NG ดึงเชือก (ค่าปรับอีกอัตรา)
  const rework = Math.min(keep('rework_qty'), gQty);
  const split = ngCut + ngFac + ngRope;
  // รองรับของเดิมที่ส่ง defect_qty มาเดี่ยวๆ -> นับเป็น NG กลุ่ม
  const dQty = split > 0 ? split : num(b.defect_qty);
  const finalNgCut = split > 0 ? ngCut : dQty;
  return { gQty, ngCut: finalNgCut, ngFac, ngRope, rework, dQty, wQty: num(b.waste_qty), lQty: keep('lost_qty') };
}

function updateIssueStatus(issueId: number) {
  const issue = prepare(`SELECT quantity FROM issues WHERE id = ?`).get(issueId) as any;
  const rets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d, COALESCE(SUM(waste_qty),0) as w, COALESCE(SUM(lost_qty),0) as l FROM returns WHERE issue_id = ?`).get(issueId) as any;
  const total = rets.g + rets.d + rets.w + rets.l;
  let status = total >= issue.quantity ? 'closed' : total > 0 ? 'partial' : 'pending';
  prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(status, issueId);
  return { status, total };
}

router.get('/', (req, res) => {
  const { issue_id, date, from, to } = req.query;
  let sql = `SELECT r.*, i.code as issue_code, i.issued_at as issued_at, m.name as member_name, m.nickname as member_nickname, p.name as product_name, p.color as product_color FROM returns r
    JOIN issues i ON r.issue_id = i.id JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE 1=1`;
  const params: any[] = [];
  if (issue_id) { sql += ` AND r.issue_id = ?`; params.push(issue_id); }
  if (date) {
    const d = String(date);
    if (/^\d{4}-\d{2}$/.test(d)) {
      // โหมด "รายเดือน" — กรองด้วย pay_cycle ที่บันทึกไว้ตอนรับคืนแต่ละรายการ (คำนวณตามรอบ Cut-off
      // ที่ตั้งไว้อยู่แล้ว ตรงกับรอบคิดค่าแรงเป๊ะ) แทนปฏิทิน 1-สิ้นเดือนของ returned_at ตรงๆ
      sql += ` AND r.pay_cycle = ?`; params.push(d);
    } else {
      sql += ` AND r.returned_at LIKE ?`; params.push(`${d}%`);
    }
  }
  if (from) { sql += ` AND r.returned_at >= ?`; params.push(from); }
  if (to) { sql += ` AND r.returned_at <= ?`; params.push(to); }
  sql += ` ORDER BY r.returned_at DESC, r.id DESC`;
  res.json(prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { issue_id, returned_at, inspector, notes } = req.body;
  if (!issue_id || !returned_at) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });

  const issue = prepare(`SELECT i.*, p.name as product_name, p.unit, p.defect_tolerance FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(issue_id) as any;
  if (!issue) return res.status(400).json({ error: 'ไม่พบใบเบิก' });
  if (issue.status === 'closed') return res.status(400).json({ error: 'ใบเบิกนี้ปิดแล้ว' });

  const { gQty, ngCut: finalNgCut, ngFac, ngRope, rework, dQty, wQty, lQty } = parseQty(req.body);

  const prev = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty+lost_qty),0) as total FROM returns WHERE issue_id = ?`).get(issue_id) as any;
  const remaining = issue.quantity - (prev.total || 0);
  if (gQty + dQty + wQty + lQty > remaining + 0.001) {
    return res.status(400).json({ error: `คืนเกินจำนวน (คงเหลือ ${remaining} ${issue.unit})` });
  }

  const code = nextDateCode('RT', 'returns', returned_at);
  const payCycle = payCycleFor(returned_at);
  const result = prepare(`INSERT INTO returns (code, issue_id, returned_at, good_qty, defect_qty, ng_cut, ng_factory, ng_rope, rework_qty, waste_qty, lost_qty, inspector, notes, pay_cycle, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, issue_id, returned_at, gQty, dQty, finalNgCut, ngFac, ngRope, rework, wQty, lQty, inspector || null, notes || null, payCycle, userOf(req));

  updateIssueStatus(parseInt(issue_id));

  const allRets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d FROM returns WHERE issue_id = ?`).get(issue_id) as any;
  const defectPct = allRets.g + allRets.d > 0 ? (allRets.d / (allRets.g + allRets.d)) * 100 : 0;
  const defectWarning = defectPct > issue.defect_tolerance ? `⚠️ ของเสีย ${defectPct.toFixed(1)}% เกินเกณฑ์ ${issue.defect_tolerance}%` : null;

  res.json({
    return: prepare(`SELECT * FROM returns WHERE id = ?`).get(result.lastInsertRowid),
    issue_status: issue.status,
    defect_warning: defectWarning
  });
});

// รับคืนหลายใบเบิกพร้อมกันใน request เดียว — เดิมหน้าเว็บยิงทีละใบเรียงกัน
// (คืนทั้งชุด 4 รุ่น = 4 รอบ รอบละ ~250ms บนเซิร์ฟเวอร์ฟรี = รอเกือบ 1 วินาทีทุกครั้งที่เซฟ)
// ตรรกะต่อรายการเหมือน POST / ทุกอย่าง แต่ตรวจ+บันทึกให้ครบในรอบเดียว
// รายการไหนไม่ผ่าน (เช่นคืนเกินจำนวน) จะข้ามเฉพาะรายการนั้น รายการที่เหลือยังบันทึกได้ตามปกติ
router.post('/batch', (req, res) => {
  const { returned_at, inspector, notes, lines } = req.body || {};
  if (!returned_at || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  }
  const by = userOf(req);
  const payCycle = payCycleFor(returned_at);
  const created: any[] = [];
  const failed: any[] = [];
  const warnings: any[] = [];

  for (const l of lines) {
    const issue_id = l?.issue_id;
    const issue = prepare(`SELECT i.*, p.name as product_name, p.unit, p.defect_tolerance FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(issue_id) as any;
    if (!issue) { failed.push({ issue_id, error: 'ไม่พบใบเบิก' }); continue; }
    if (issue.status === 'closed') { failed.push({ issue_id, code: issue.code, error: 'ใบเบิกนี้ปิดแล้ว' }); continue; }

    const { gQty, ngCut: finalNgCut, ngFac, ngRope, rework, dQty, wQty, lQty } = parseQty(l);

    const prev = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty+lost_qty),0) as total FROM returns WHERE issue_id = ?`).get(issue_id) as any;
    const remaining = issue.quantity - (prev.total || 0);
    if (gQty + dQty + wQty + lQty > remaining + 0.001) {
      failed.push({ issue_id, code: issue.code, error: `คืนเกินจำนวน (คงเหลือ ${remaining} ${issue.unit})` });
      continue;
    }

    const code = nextDateCode('RT', 'returns', returned_at);
    const result = prepare(`INSERT INTO returns (code, issue_id, returned_at, good_qty, defect_qty, ng_cut, ng_factory, ng_rope, rework_qty, waste_qty, lost_qty, inspector, notes, pay_cycle, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, issue_id, returned_at, gQty, dQty, finalNgCut, ngFac, ngRope, rework, wQty, lQty, inspector || null, notes || null, payCycle, by);
    updateIssueStatus(parseInt(issue_id));

    const allRets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d FROM returns WHERE issue_id = ?`).get(issue_id) as any;
    const defectPct = allRets.g + allRets.d > 0 ? (allRets.d / (allRets.g + allRets.d)) * 100 : 0;
    if (defectPct > issue.defect_tolerance) {
      warnings.push({ code: issue.code, warning: `⚠️ ของเสีย ${defectPct.toFixed(1)}% เกินเกณฑ์ ${issue.defect_tolerance}%` });
    }
    created.push(prepare(`SELECT * FROM returns WHERE id = ?`).get(result.lastInsertRowid));
  }

  res.json({ created, failed, warnings });
});

router.put('/:id', (req, res) => {
  const { returned_at, inspector, notes } = req.body;
  const ret = prepare(`SELECT * FROM returns WHERE id = ?`).get(req.params.id) as any;
  if (!ret) return res.status(404).json({ error: 'ไม่พบรายการรับคืน' });
  if (!returned_at) return res.status(400).json({ error: 'กรุณากรอกวันที่' });

  const issue = prepare(`SELECT i.*, p.unit, p.defect_tolerance FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(ret.issue_id) as any;

  const { gQty, ngCut: finalNgCut, ngFac, ngRope, rework, dQty, wQty, lQty } = parseQty(req.body, ret);

  // จำนวนคืนรวมของใบเบิกนี้ ไม่นับรายการที่กำลังแก้ + จำนวนใหม่ ต้องไม่เกินจำนวนเบิก
  const others = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty+lost_qty),0) as total FROM returns WHERE issue_id = ? AND id != ?`).get(ret.issue_id, req.params.id) as any;
  const remaining = issue.quantity - (others.total || 0);
  if (gQty + dQty + wQty + lQty > remaining + 0.001) {
    return res.status(400).json({ error: `คืนเกินจำนวน (คงเหลือ ${remaining} ${issue.unit})` });
  }

  // รายการรับคืนอื่นที่คืนพร้อมกัน (ชุดเดียวกัน) — คนเดียวกัน วันเดียวกัน งานดีเท่ากับก่อนแก้ — เผื่ออยากแก้จำนวนให้ตรงกันด้วย
  const goodQtyChanged = gQty !== ret.good_qty;
  const siblings = goodQtyChanged ? prepare(`
    SELECT r.id, r.code, r.good_qty, r.ng_cut, r.ng_factory, r.ng_rope, r.rework_qty, r.waste_qty, r.lost_qty, r.inspector, r.notes,
      r.returned_at, r.issue_id, i.member_id, p.name as product_name, p.unit
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND r.returned_at = ? AND r.good_qty = ? AND r.id != ?
  `).all(issue.member_id, ret.returned_at, ret.good_qty, req.params.id) : [];

  const payCycle = payCycleFor(returned_at);
  prepare(`UPDATE returns SET returned_at=?, good_qty=?, defect_qty=?, ng_cut=?, ng_factory=?, ng_rope=?, rework_qty=?, waste_qty=?, lost_qty=?, inspector=?, notes=?, pay_cycle=? WHERE id=?`)
    .run(returned_at, gQty, dQty, finalNgCut, ngFac, ngRope, rework, wQty, lQty, inspector || null, notes || null, payCycle, req.params.id);

  updateIssueStatus(ret.issue_id);
  res.json({ return: prepare(`SELECT * FROM returns WHERE id = ?`).get(req.params.id), siblings });
});

router.delete('/:id', (req, res) => {
  const ret = prepare(`SELECT * FROM returns WHERE id = ?`).get(req.params.id) as any;
  if (!ret) return res.status(404).json({ error: 'ไม่พบรายการรับคืน' });

  // รายการรับคืนอื่นที่คืนพร้อมกัน (ชุดเดียวกัน) — คนเดียวกัน วันเดียวกัน งานดีเท่ากัน — เผื่ออยากลบทั้งชุดด้วย
  const issue = prepare(`SELECT member_id FROM issues WHERE id = ?`).get(ret.issue_id) as any;
  const siblings = issue ? prepare(`
    SELECT r.id, r.code, r.good_qty, r.returned_at, p.name as product_name, p.unit
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND r.returned_at = ? AND r.good_qty = ? AND r.id != ?
  `).all(issue.member_id, ret.returned_at, ret.good_qty, req.params.id) : [];

  // ลบรายการรับคืนแล้วต้องลบคำขอคืนงานจากพอร์ทัลสมาชิกที่ยืนยันกลายเป็นรายการนี้ไปด้วย
  // กันไม่ให้เหลือคำขอค้างอ้างถึงรายการรับคืนที่ถูกลบไปแล้ว
  prepare(`DELETE FROM return_requests WHERE confirmed_return_id = ?`).run(req.params.id);
  prepare(`DELETE FROM returns WHERE id = ?`).run(req.params.id);
  updateIssueStatus(ret.issue_id);
  res.json({ deleted: true, code: ret.code, siblings });
});

export default router;

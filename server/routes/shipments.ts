import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { userOf } from '../reqUser';
import { monthCutoffRange } from '../payCycle';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const router = Router();

// ── List shipments ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { from, to, date } = req.query as any;
  let sql = `SELECT s.id, s.code, s.shipped_at, s.notes, s.created_by,
    COALESCE((SELECT SUM(si.good_qty + si.defect_qty) FROM shipment_items si WHERE si.shipment_id = s.id),0) as total_qty
    FROM shipments s WHERE 1=1`;
  const params: any[] = [];
  if (date) {
    const d = String(date);
    if (/^\d{4}-\d{2}$/.test(d)) {
      // โหมด "รายเดือน" — ใช้รอบ Cut-off ที่ตั้งไว้ (Settings) แทนปฏิทิน 1-สิ้นเดือน (สอดคล้องกับหน้ารับ/เบิก)
      const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
      const { start, end } = monthCutoffRange(d, settings);
      sql += ` AND s.shipped_at >= ? AND s.shipped_at <= ?`; params.push(start, end);
    } else {
      sql += ` AND s.shipped_at LIKE ?`; params.push(`${d}%`);
    }
  }
  if (from) { sql += ` AND s.shipped_at >= ?`; params.push(from); }
  if (to)   { sql += ` AND s.shipped_at <= ?`; params.push(to); }
  sql += ` ORDER BY s.shipped_at DESC, s.id DESC`;

  const rows = prepare(sql).all(...params) as any[];
  const result = rows.map(s => ({
    ...s,
    items: prepare(`
      SELECT si.good_qty, si.defect_qty, si.received_qty, si.bill_ng_qty, p.id as product_id, p.code as product_code, p.name as product_name, p.unit, p.color
      FROM shipment_items si JOIN products p ON si.product_id = p.id
      WHERE si.shipment_id = ?
    `).all(s.id)
  }));
  res.json(result);
});

// จำนวนที่ปลอดภัยสำหรับ SQLite (กัน NaN/undefined/null → 0)
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// NG ที่โรงงานแจ้ง (หักเงินในใบวางบิล/ใบแจ้งหนี้) — ว่าง/0 = ไม่มี (NULL)
const ngOf = (v: any) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n <= 0 ? null : n; };

// ── Create shipment ───────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { shipped_at, notes, items } = req.body;
    if (!shipped_at) return res.status(400).json({ error: 'กรุณาระบุวันที่ส่ง' });
    const validItems = (items || []).filter((it: any) => num(it.good_qty) + num(it.defect_qty) > 0 && it.product_id != null);
    if (validItems.length === 0) return res.status(400).json({ error: 'กรุณาระบุปริมาณอย่างน้อย 1 รายการ' });

    // สร้างรหัสอิงวันที่ส่งของจริง กันซ้ำในวันเดียวกัน
    const code = nextDateCode('SH', 'shipments', shipped_at);

    prepare(`INSERT INTO shipments (code, shipped_at, notes, created_by) VALUES (?, ?, ?, ?)`).run(code, shipped_at, notes || null, userOf(req));
    const shipment = prepare(`SELECT * FROM shipments ORDER BY id DESC LIMIT 1`).get() as any;

    for (const it of validItems) {
      const recv = (it.received_qty === '' || it.received_qty == null) ? null : num(it.received_qty);
      prepare(`INSERT INTO shipment_items (shipment_id, product_id, good_qty, defect_qty, received_qty, bill_ng_qty) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(shipment.id, num(it.product_id), num(it.good_qty), num(it.defect_qty), recv, ngOf(it.bill_ng_qty));
    }

    res.json({ ok: true, code, id: shipment.id });
  } catch (e: any) {
    console.error('[shipment create] error:', e);
    res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${e?.message || e}` });
  }
});

// ── Update shipment ───────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { shipped_at, notes, items } = req.body;
    const ship = prepare(`SELECT * FROM shipments WHERE id = ?`).get(id) as any;
    if (!ship) return res.status(404).json({ error: 'ไม่พบรายการส่งออก' });
    if (!shipped_at) return res.status(400).json({ error: 'กรุณาระบุวันที่ส่ง' });
    const validItems = (items || []).filter((it: any) => num(it.good_qty) + num(it.defect_qty) > 0 && it.product_id != null);
    if (validItems.length === 0) return res.status(400).json({ error: 'กรุณาระบุปริมาณอย่างน้อย 1 รายการ' });

    prepare(`UPDATE shipments SET shipped_at = ?, notes = ? WHERE id = ?`).run(shipped_at, notes || null, id);
    // NG เดิมต่อสินค้า — ถ้าฟอร์มไม่ได้ส่ง bill_ng_qty มา ใช้ค่าเดิม (กัน NG ที่กรอกในหน้าวางบิลหายตอนแก้ใบส่ง)
    const oldNg = new Map((prepare(`SELECT product_id, bill_ng_qty FROM shipment_items WHERE shipment_id = ?`).all(id) as any[])
      .map(r => [Number(r.product_id), r.bill_ng_qty]));
    // แทนที่รายการสินค้าทั้งหมด
    prepare(`DELETE FROM shipment_items WHERE shipment_id = ?`).run(id);
    for (const it of validItems) {
      const recv = (it.received_qty === '' || it.received_qty == null) ? null : num(it.received_qty);
      const ng = 'bill_ng_qty' in it ? ngOf(it.bill_ng_qty) : (oldNg.get(num(it.product_id)) ?? null);
      prepare(`INSERT INTO shipment_items (shipment_id, product_id, good_qty, defect_qty, received_qty, bill_ng_qty) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, num(it.product_id), num(it.good_qty), num(it.defect_qty), recv, ng);
    }
    res.json({ ok: true, id, code: ship.code });
  } catch (e: any) {
    console.error('[shipment update] error:', e);
    res.status(500).json({ error: `แก้ไขไม่สำเร็จ: ${e?.message || e}` });
  }
});

// ── ใบส่งสินค้า (PDF) — เติมจำนวนลงแบบฟอร์มว่างของ Amphenol (server/templates/delivery-note-blank.pdf) ──
/* แบบฟอร์มเป็นภาพสแกนแนวนอนวางหมุน 90° บนหน้า A4 แนวตั้ง (595×841pt) — ข้อความทั้งหมดต้องหมุน 90° ตาม
   พิกัดวัดจากเส้นตารางของแบบฟอร์ม: แถวที่ n (1–15) อยู่ช่วง x = 225.5 + 16.1·(n−1) ถึง +16.1
   คอลัมน์ (วัด y จากขอบบน): ชื่อสินค้า 457.2–625.8 · Amphenol part 625.8–723.5 · จำนวนการจัดส่ง 392.5–457.2
   · วันที่จัดส่ง 296.8–356.0 · หมายเหตุ 17.8–125.0 */
const DN_PAGE_H = 841;
const DN_ROW_X0 = 225.5, DN_ROW_H = (467.0 - 225.5) / 15;
const DN_COL = { name: [457.2, 625.8], part: [625.8, 723.5], qty: [392.5, 457.2], date: [296.8, 356.0], note: [17.8, 125.0] } as const;
// แถวที่พิมพ์ชื่อรุ่นไว้แล้วในแบบฟอร์ม (รหัสสินค้าในระบบ → แถว) — รุ่นอื่นที่ไม่มีในแบบฟอร์มลงแถวว่าง 13–15 พร้อมเขียนชื่อรุ่น
const DN_ROW_OF: Record<string, number> = { P001: 1, P002: 2, P003: 4, P004: 5, P007: 7, P006: 8, P005: 9, P008: 11, P009: 12 };
const DN_SPARE_ROWS = [13, 14, 15, 3, 6, 10];
let dnTemplate: Buffer | null = null;

router.post('/delivery-note-pdf', async (req, res) => {
  try {
    const date = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'กรุณาระบุวันที่ส่ง' });
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map((it: any) => {
        const lines = (Array.isArray(it.lines) ? it.lines : [])
          .map((l: any) => ({ per_box: num(l.per_box), boxes: num(l.boxes) }))
          .filter((l: any) => l.per_box > 0 && l.boxes > 0);
        return { product_id: num(it.product_id), lines, qty: lines.reduce((s: number, l: any) => s + l.per_box * l.boxes, 0) };
      })
      .filter((it: any) => it.qty > 0);
    if (!items.length) return res.status(400).json({ error: 'กรุณาเลือกรุ่นและกรอกจำนวนลังอย่างน้อย 1 รายการ' });

    if (!dnTemplate) dnTemplate = fs.readFileSync(path.join(process.cwd(), 'server', 'templates', 'delivery-note-blank.pdf'));
    const pdf = await PDFDocument.load(dnTemplate);
    const page = pdf.getPages()[0];
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.05, 0.1, 0.45);   // สีน้ำเงินเข้ม เหมือนเขียนด้วยปากกา แยกจากตัวพิมพ์ของแบบฟอร์ม

    // เขียนข้อความหมุน 90° ให้อยู่กลางช่อง (cx = กึ่งกลางแถวตามแกน x · col = ช่วง y ของคอลัมน์) — ย่อฟอนต์ถ้ายาวเกินช่อง
    const put = (text: string, cx: number, col: readonly [number, number], size: number, f = font) => {
      const room = (col[1] - col[0]) - 6;
      let s = size;
      while (s > 5 && f.widthOfTextAtSize(text, s) > room) s -= 0.5;
      const w = f.widthOfTextAtSize(text, s);
      const yMid = DN_PAGE_H - (col[0] + col[1]) / 2;
      page.drawText(text, { x: cx + s * 0.36, y: yMid - w / 2, size: s, font: f, color: ink, rotate: degrees(90) });
    };
    const rowCx = (n: number) => DN_ROW_X0 + DN_ROW_H * (n - 1) + DN_ROW_H / 2;
    const [y, m, d] = date.split('-');
    const dateTxt = `${d}/${m}/${y}`;

    const prods = new Map((prepare(`SELECT id, code, name, project FROM products`).all() as any[]).map(p => [Number(p.id), p]));
    const used = new Set<number>();
    const spare = DN_SPARE_ROWS.filter(r => !Object.values(DN_ROW_OF).includes(r));
    for (const it of items) {
      const p = prods.get(it.product_id);
      if (!p) continue;
      let row = DN_ROW_OF[p.code];
      const printed = !!row;
      if (!row) row = spare.find(r => !used.has(r)) as number;
      if (!row || used.has(row)) continue;
      used.add(row);
      if (!printed) {   // รุ่นที่ไม่มีในแบบฟอร์ม: เขียนชื่อรุ่น (ส่วนภาษาอังกฤษ) + รหัสงาน Amphenol เอง
        put(String(p.name).replace(/\(.*$/, '').trim(), rowCx(row), DN_COL.name, 8.5);
        if (p.project) put(String(p.project), rowCx(row), DN_COL.part, 8.5);
      }
      put(it.qty.toLocaleString('en-US'), rowCx(row), DN_COL.qty, 11, bold);
      put(dateTxt, rowCx(row), DN_COL.date, 9);
      put(it.lines.map((l: any) => `${l.boxes} x ${l.per_box.toLocaleString('en-US')}`).join(' + '), rowCx(row), DN_COL.note, 8);
    }
    // วันที่จัดส่ง ท้ายฟอร์ม (ต่อจากป้าย "送货日期 วันที่จัดส่ง:" มุมล่างซ้าย)
    page.drawText(dateTxt, { x: 523.5, y: DN_PAGE_H - 774, size: 10, font: bold, color: ink, rotate: degrees(90) });

    const out = Buffer.from(await pdf.save());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="delivery-note-${date}.pdf"`);
    res.send(out);
  } catch (e: any) {
    console.error('[delivery-note-pdf] error:', e);
    res.status(500).json({ error: `สร้างใบส่งสินค้าไม่สำเร็จ: ${e?.message || e}` });
  }
});

// ── Delete shipment ───────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  prepare(`DELETE FROM shipment_items WHERE shipment_id = ?`).run(Number(req.params.id));
  prepare(`DELETE FROM shipments WHERE id = ?`).run(Number(req.params.id));
  res.json({ deleted: true });
});

export default router;

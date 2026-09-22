import { prepare } from './db';

/* ── "ยอดรับจริง" ของแต่ละล็อตที่รับเข้าจากโรงงาน ───────────────────────────
   โรงงานนับไม่ละเอียด ของในลังจึงมากหรือน้อยกว่าใบส่งของได้ ระบบจึงเก็บสองยอด:
     • ยอดตามใบส่งของ (receives.quantity) — หลักฐานคู่กับโรงงาน ไม่แก้ทับ
     • ยอดรับจริง — ใช้คิดสต็อก/ยอดรอเบิกทุกหน้า มาจาก 2 ทาง
         1) นับเองตอนของลงจากรถ แล้วกรอกไว้ที่ใบรับ (receives.actual_qty)
         2) สมาชิกนับของในมัดแล้วมาแจ้งขาด/เกิน เจ้าหน้าที่แก้ยอดใบเบิก
            (issues.quantity เทียบกับ orig_quantity) แล้วผูกกลับล็อตด้วย lot_date
   สองทางนี้บวกกันได้ เพราะเกิดคนละจังหวะ (นับตอนรับ vs มาเจอทีหลังตอนตัดงาน)

   ขั้นต่ำของยอดรับจริง = ยอดที่แจกออกจากล็อตนั้นไปแล้วจริง — รับน้อยกว่าที่แจกออกไปไม่ได้
   (กันเคสพิมพ์ผิดตอนแก้ยอดเบิกแล้วกลายเป็น "ของขาด" ทั้งที่แค่แก้คำผิด) */

export type LotKey = string; // `${product_id}|YYYY-MM-DD`

export function lotKey(productId: number | string, receivedAt: string): LotKey {
  return `${productId}|${String(receivedAt).slice(0, 10)}`;
}

/** ส่วนต่าง "รับจริง − ใบส่งของ" รายล็อต (มีเฉพาะล็อตที่ไม่ตรงใบส่งของ) */
export function lotVariances(): Map<LotKey, number> {
  const nominal = new Map<LotKey, number>();
  const counted = new Map<LotKey, number>();   // ยอดนับเองที่กรอกไว้ (ใบไหนไม่ได้กรอก ใช้ยอดใบส่งของแทน)
  for (const r of prepare(`
    SELECT product_id, substr(received_at, 1, 10) d,
      SUM(quantity) nominal, SUM(COALESCE(actual_qty, quantity)) counted
    FROM receives GROUP BY product_id, d`).all() as any[]) {
    const k = lotKey(r.product_id, r.d);
    nominal.set(k, Number(r.nominal) || 0);
    counted.set(k, Number(r.counted) || 0);
  }
  const reported = new Map<LotKey, number>();  // ส่วนต่างที่สมาชิกแจ้งหลังรับของ
  for (const r of prepare(`
    SELECT product_id, lot_date d, SUM(quantity - COALESCE(orig_quantity, quantity)) v
    FROM issues WHERE lot_date IS NOT NULL GROUP BY product_id, lot_date`).all() as any[]) {
    reported.set(lotKey(r.product_id, r.d), Number(r.v) || 0);
  }
  const issued = new Map<LotKey, number>();
  for (const r of prepare(`
    SELECT product_id, lot_date d, SUM(quantity) v
    FROM issues WHERE lot_date IS NOT NULL GROUP BY product_id, lot_date`).all() as any[]) {
    issued.set(lotKey(r.product_id, r.d), Number(r.v) || 0);
  }

  const out = new Map<LotKey, number>();
  for (const [k, nom] of nominal) {
    const actual = Math.max((counted.get(k) ?? nom) + (reported.get(k) || 0), issued.get(k) || 0);
    if (actual !== nom) out.set(k, actual - nom);
  }
  return out;
}

/** รวมส่วนต่างต่อสินค้า เลือกช่วงวันที่ได้ (from/to รวมปลายทั้งสองข้าง, before = ก่อนวันนั้นไม่รวมวันนั้น) */
export function varianceByProduct(opts: { from?: string; to?: string; before?: string } = {}): Map<number, number> {
  const m = new Map<number, number>();
  for (const [k, v] of lotVariances()) {
    const [pid, d] = k.split('|');
    if (opts.before && !(d < opts.before)) continue;
    if (opts.from && d < opts.from) continue;
    if (opts.to && d > opts.to) continue;
    const id = Number(pid);
    m.set(id, (m.get(id) || 0) + v);
  }
  return m;
}

/** ใช้กับผลรวมที่ได้จาก SQL (ยอดตามใบส่งของ) ให้กลายเป็นยอดรับจริง */
export function withVariance(nominal: number, pid: number, variance: Map<number, number>): number {
  return nominal + (variance.get(pid) || 0);
}

import { prepare } from './db';
import { STOCK_CUTOFF } from './stockConfig';

/* ── "ยอดรับจริง" ของแต่ละล็อตที่รับเข้าจากโรงงาน ───────────────────────────
   โรงงานนับไม่ละเอียด ของในลังจึงมากหรือน้อยกว่าใบส่งของได้ ระบบจึงเก็บสองยอด:
     • ยอดตามใบส่งของ (receives.quantity) — หลักฐานคู่กับโรงงาน ไม่แก้ทับ
     • ยอดรับจริง — ใช้คิดสต็อก/ยอดรอเบิกทุกหน้า มาจาก
         1) นับเองตอนของลงจากรถ แล้วกรอกไว้ที่ใบรับ (receives.actual_qty) — มีแล้วถือเป็นที่สุด
         2) สมาชิกนับของในมัดแล้วมาแจ้งขาด/เกิน เจ้าหน้าที่แก้ยอดใบเบิก
            (issues.quantity เทียบกับ orig_quantity) แล้วผูกกลับล็อตด้วย lot_date
         3) ปรับอัตโนมัติ (ดู computeLots) — ปิดล็อตเก่าที่คลาดไปไม่กี่เส้นให้เอง
   ขั้นต่ำของยอดรับจริง = ยอดที่แจกออกจากล็อตนั้นไปแล้วจริง — รับน้อยกว่าที่แจกออกไปไม่ได้ */

export type LotKey = string; // `${product_id}|YYYY-MM-DD`

export function lotKey(productId: number | string, receivedAt: string): LotKey {
  return `${productId}|${String(receivedAt).slice(0, 10)}`;
}

/* ความคลาดเคลื่อน "เล็กน้อย" ที่ระบบปรับให้เอง = ไม่เกิน max(10 เส้น, 1% ของล็อต)
   ของจริงที่ยังเหลือในล็อตเก่ามักเป็นหลักร้อย (ครึ่งมัด/หนึ่งมัด) ยอดที่คลาดจากการนับมักแค่ไม่กี่เส้น
   เกินเกณฑ์นี้ระบบจะไม่แตะ ปล่อยให้เห็นเป็นยอดค้าง (สีส้มในตารางเทียบรับเข้า-เบิกออก) ให้คนตรวจเอง */
export const AUTO_CLOSE_MIN = 10;
export const AUTO_CLOSE_PCT = 0.01;
export const autoCloseTolerance = (lotQty: number) => Math.max(AUTO_CLOSE_MIN, Math.round(lotQty * AUTO_CLOSE_PCT));

export type LotRow = {
  product_id: number;
  lot_date: string;
  note: number;        // ยอดตามใบส่งของ
  manual: boolean;     // มีใบรับในล็อตนี้ที่นับเองแล้ว (ระบบไม่ปรับอัตโนมัติทับ)
  counted: number;     // ยอดตามใบส่งของ แทนด้วยยอดนับเองในใบที่นับไว้
  reported: number;    // ส่วนต่างที่สมาชิกแจ้งหลังรับของ
  tagged: number;      // เบิกที่ระบุล็อตนี้
  untagged: number;    // เบิกที่ไม่ได้ระบุล็อต ซึ่งระบบจัดสรรมาให้ล็อตนี้
  auto: number;        // ระบบปรับอัตโนมัติ (+ ของเกินเล็กน้อย / − ปิดล็อตที่เหลือเศษ)
  actual: number;      // ยอดรับจริงสุดท้าย
  remaining: number;   // ยังไม่ได้แจก
};

/* ── คงเหลือรายล็อต ตั้งแต่ STOCK_CUTOFF (แหล่งเดียวของทุกหน้าที่คิดยอดรอแจกจ่าย) ──
   ของจริงหน้างาน: ล็อตมาถึงตามลำดับวันที่ และสมาชิกเบิกของล็อตเก่าให้หมดก่อนค่อยเปิดล็อตใหม่
   ปัญหาเดิม: ยอดที่คลาดไปไม่กี่เส้นในล็อตเก่า (โรงงานนับไม่ละเอียด/เบิกคลาดไปเส้นสองเส้น) ค้างอยู่ตลอด
   หรือไหลไปกินล็อตใหม่ที่ยังไม่มีใครแตะ — ป้ายชมพูยาวขึ้น 1,001 สั้นขึ้น 999 ทั้งที่หน้างานมี 1,000 พอดีทั้งคู่

   กติกา
   1) ยอดรับจริงตั้งต้นของล็อต = นับเอง(ถ้ามี)/ใบส่งของ + ที่สมาชิกแจ้งขาดเกิน (ไม่ต่ำกว่าที่เบิกระบุล็อตนี้)
   2) "ปิดกลุ่มล็อตเก่า" — ทุกครั้งที่มีล็อตใหม่มาถึง ล็อตก่อนหน้าทั้งหมดรวมกันควรหมดพอดี:
        เหลือ/เกิน = ยอดรับจริงรวมของกลุ่ม − (เบิกที่ระบุล็อตในกลุ่ม + เบิกไม่ระบุล็อตที่เกิดก่อนล็อตใหม่มาถึง)
      ถ้าคลาดไม่เกินเกณฑ์เล็กน้อย → ปรับยอดรับจริงของล็อตสุดท้ายในกลุ่มให้พอดีอัตโนมัติ (ถือว่าโรงงานส่งขาด/เกิน)
      คิด "รวมทั้งกลุ่ม" ไม่ใช่ทีละล็อต เพราะเจ้าหน้าที่ติดป้ายล็อตผิดระหว่างล็อตเก่าด้วยกันได้บ่อย
      (เช่น ป้ายชมพูสั้นมีใบเบิก 400 เส้นวันที่ 16 ก.ย. ติดเป็นล็อต 7 ก.ย. ทั้งที่ล็อตนั้นหมดไปตั้งแต่วันที่ 7)
      ถ้าคลาดเกินเกณฑ์ ระบบไม่แตะ ปล่อยให้เห็นเป็นยอดค้าง (สีส้มในตารางเทียบรับเข้า-เบิกออก) ให้คนตรวจ
   3) แตกยอดคงเหลือรายล็อตไว้แสดงผล: เบิกระบุล็อต → หักล็อตนั้น · เบิกไม่ระบุล็อต → หักล็อตเก่าสุดที่
      "มาถึงแล้ว ณ วันที่เบิก" ก่อน (ใบเบิกวันที่ 20 ดึงของล็อตวันที่ 24 ไม่ได้) เกินจากนั้นค่อยไหลไปล็อตถัดไป
   ล็อตที่นับเองไว้แล้ว (manual) ไม่ปรับอัตโนมัติทับ — ยอดที่คนนับถือเป็นที่สุด
   ล็อตล่าสุดไม่ถูกปิดอัตโนมัติ (เป็นล็อตที่ยังแจกอยู่จริง) */
export function computeLots(productId?: number): LotRow[] {
  const where = productId ? ` AND product_id = ${Number(productId)}` : '';
  const recv = prepare(`
    SELECT product_id, substr(received_at, 1, 10) d,
      SUM(quantity) note, SUM(COALESCE(actual_qty, quantity)) counted,
      SUM(CASE WHEN actual_qty IS NOT NULL THEN 1 ELSE 0 END) n_manual
    FROM receives WHERE received_at >= ?${where} GROUP BY product_id, d`).all(STOCK_CUTOFF) as any[];
  const tagged = new Map<LotKey, { qty: number; reported: number }>();
  for (const r of prepare(`
    SELECT product_id, lot_date d, SUM(quantity) q, SUM(quantity - COALESCE(orig_quantity, quantity)) rep
    FROM issues WHERE lot_date IS NOT NULL AND lot_date >= ?${where} GROUP BY product_id, lot_date`).all(STOCK_CUTOFF) as any[]) {
    tagged.set(lotKey(r.product_id, r.d), { qty: Number(r.q) || 0, reported: Number(r.rep) || 0 });
  }
  const untaggedOf = new Map<number, { d: string; q: number }[]>();
  for (const u of prepare(`
    SELECT product_id, substr(issued_at, 1, 10) d, quantity q
    FROM issues WHERE lot_date IS NULL AND issued_at >= ?${where}
    ORDER BY issued_at, id`).all(STOCK_CUTOFF) as any[]) {
    if (!untaggedOf.has(u.product_id)) untaggedOf.set(u.product_id, []);
    untaggedOf.get(u.product_id)!.push({ d: u.d, q: Number(u.q) || 0 });
  }

  // 1) ยอดรับจริงตั้งต้นรายล็อต
  const byProduct = new Map<number, LotRow[]>();
  for (const r of recv) {
    const t = tagged.get(lotKey(r.product_id, r.d)) || { qty: 0, reported: 0 };
    const counted = Number(r.counted) || 0;
    const base = Math.max(counted + t.reported, t.qty);
    const row: LotRow = {
      product_id: r.product_id, lot_date: r.d, note: Number(r.note) || 0, manual: Number(r.n_manual) > 0,
      counted, reported: t.reported, tagged: t.qty, untagged: 0, auto: 0, actual: base, remaining: 0,
    };
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(row);
  }

  const out: LotRow[] = [];
  for (const [pid, lots] of byProduct) {
    lots.sort((a, b) => a.lot_date.localeCompare(b.lot_date));
    const unt = untaggedOf.get(pid) || [];

    // 2) ปิดกลุ่มล็อตเก่าทีละขั้น (กลุ่ม = ล็อตแรกถึงล็อต i เมื่อล็อต i+1 มาถึงแล้ว)
    for (let i = 0; i < lots.length - 1; i++) {
      const next = lots[i + 1].lot_date;
      let recvGroup = 0, issuedGroup = 0;
      for (let j = 0; j <= i; j++) { recvGroup += lots[j].actual; issuedGroup += lots[j].tagged; }
      for (const u of unt) if (u.d < next) issuedGroup += u.q;
      const residue = recvGroup - issuedGroup;
      const last = lots[i];
      if (residue !== 0 && !last.manual && Math.abs(residue) <= autoCloseTolerance(last.actual)) {
        last.auto -= residue; last.actual -= residue;
      }
    }

    // 3) แตกยอดคงเหลือรายล็อตไว้แสดงผล
    for (const l of lots) l.remaining = l.actual - l.tagged;
    for (const u of unt) {
      let left = u.q;
      const arrived = lots.filter(l => l.lot_date <= u.d);
      const order = arrived.length > 0 ? [...arrived, ...lots.filter(l => l.lot_date > u.d)] : lots;
      for (const l of order) {
        if (left <= 0) break;
        const take = Math.min(Math.max(0, l.remaining), left);
        l.untagged += take; l.remaining -= take; left -= take;
      }
    }
    out.push(...lots);
  }
  return out;
}

/** ส่วนต่าง "รับจริง − ใบส่งของ" รายล็อต (มีเฉพาะล็อตที่ไม่ตรงใบส่งของ)
    ล็อตตั้งแต่ STOCK_CUTOFF ใช้ computeLots (รวมการปรับอัตโนมัติ) · ล็อตเก่ากว่านั้นใช้แค่นับเอง/สมาชิกแจ้ง */
export function lotVariances(): Map<LotKey, number> {
  const out = new Map<LotKey, number>();
  for (const l of computeLots()) {
    if (l.actual !== l.note) out.set(lotKey(l.product_id, l.lot_date), l.actual - l.note);
  }

  const nominal = new Map<LotKey, number>();
  const counted = new Map<LotKey, number>();
  for (const r of prepare(`
    SELECT product_id, substr(received_at, 1, 10) d,
      SUM(quantity) nominal, SUM(COALESCE(actual_qty, quantity)) counted
    FROM receives WHERE received_at < ? GROUP BY product_id, d`).all(STOCK_CUTOFF) as any[]) {
    const k = lotKey(r.product_id, r.d);
    nominal.set(k, Number(r.nominal) || 0);
    counted.set(k, Number(r.counted) || 0);
  }
  const reported = new Map<LotKey, number>();
  const issued = new Map<LotKey, number>();
  for (const r of prepare(`
    SELECT product_id, lot_date d, SUM(quantity - COALESCE(orig_quantity, quantity)) rep, SUM(quantity) q
    FROM issues WHERE lot_date IS NOT NULL AND lot_date < ? GROUP BY product_id, lot_date`).all(STOCK_CUTOFF) as any[]) {
    const k = lotKey(r.product_id, r.d);
    reported.set(k, Number(r.rep) || 0);
    issued.set(k, Number(r.q) || 0);
  }
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

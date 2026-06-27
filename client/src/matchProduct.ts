// จับคู่รายการจาก OCR เข้ากับสินค้าในระบบ
// ลำดับ: โครงการ (หมายเลขชิ้นส่วน) + ชื่อ → ชื่ออย่างเดียว(ถ้าไม่กำกวม)
const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchProduct(products: any[], item: any, docPartNo?: string): any | null {
  const nm = norm(item.name);
  const proj = norm(item.part_no || docPartNo);
  if (!nm) return null;

  const nameMatch = (p: any) => { const pn = norm(p.name); return !!pn && (pn.includes(nm) || nm.includes(pn)); };
  const projMatch = (p: any) => { const pp = norm(p.project); return !!proj && !!pp && (pp.includes(proj) || proj.includes(pp)); };

  // 1) โครงการ + ชื่อ ตรงกัน
  if (proj) {
    const both = products.filter(p => projMatch(p) && nameMatch(p));
    if (both.length >= 1) return both[0];
  }
  // 2) ชื่อตรงและไม่กำกวม
  const byName = products.filter(nameMatch);
  if (byName.length === 1) return byName[0];
  // 3) ชื่อซ้ำหลายโครงการ — เลือกตามโครงการถ้าได้
  if (byName.length > 1) {
    const pm = byName.filter(projMatch);
    if (pm.length === 1) return pm[0];
    return null; // กำกวม ให้ผู้ใช้เลือกเอง
  }
  return null;
}

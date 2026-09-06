// คำนวณ "รอบจ่าย" (pay_cycle) จากวันที่รับคืน
// กฎ: เส้นตาย = วันทำการ "ก่อน" วันทำการสุดท้ายของเดือน (เว้นเสาร์-อาทิตย์ + วันหยุดที่ตั้งไว้)
//  - รับคืน <= เส้นตาย  -> pay_cycle = เดือนนั้น        (จ่าย 25 เดือนถัดไป)
//  - รับคืน >  เส้นตาย  -> pay_cycle = เดือนถัดไป       (จ่าย 25 อีก 2 เดือน)

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// วันนี้ตามเวลาไทย (Asia/Bangkok) เสมอ ไม่ว่าเซิร์ฟเวอร์จะตั้งโซนเวลาอะไรก็ตาม (เซิร์ฟเวอร์คลาวด์ส่วนใหญ่ตั้งเป็น UTC)
// กัน bug วันที่คลาดเคลื่อนไปหนึ่งวัน ช่วงเที่ยงคืนถึงตี 7 เวลาไทย ถ้าใช้ new Date().toISOString() ตรงๆ (เป็น UTC) จะยังนับเป็น "เมื่อวาน"
export function todayThai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}
const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate(); // m = 1-12
const dow = (y: number, m: number, d: number) => new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat

function isNonWorking(y: number, m: number, d: number, holidays: Set<string>): boolean {
  const w = dow(y, m, d);
  return w === 0 || w === 6 || holidays.has(fmt(y, m, d));
}

// เส้นตายของเดือน ym ("YYYY-MM")
//  - override รายเดือน (cutoff_YYYY-MM) มาก่อนเสมอ
//  - ถ้าตั้ง cutoffDay (1-31) ในตั้งค่า -> ใช้วันนั้นของเดือนตายตัว
//  - ไม่ตั้ง -> วันทำการก่อนวันทำการสุดท้ายของเดือน (ค่าเดิม)
export function computeCutoff(ym: string, holidays: Set<string>, overrides: Record<string, string>, cutoffDay?: number): string {
  if (overrides[ym]) return overrides[ym];
  const [y, m] = ym.split('-').map(Number);
  if (cutoffDay && cutoffDay >= 1) {
    return fmt(y, m, Math.min(cutoffDay, lastDayOfMonth(y, m)));
  }
  let d = lastDayOfMonth(y, m);
  while (d >= 1 && isNonWorking(y, m, d, holidays)) d--;   // วันทำการสุดท้าย
  d--;                                                      // ถอยอีก 1 วัน
  while (d >= 1 && isNonWorking(y, m, d, holidays)) d--;   // วันทำการก่อนวันสุดท้าย
  if (d < 1) return fmt(y, m, 1);
  return fmt(y, m, d);
}

export function nextMonth(ym: string): string {
  let [y, m] = ym.split('-').map(Number);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${pad(m)}`;
}

export function prevMonth(ym: string): string {
  let [y, m] = ym.split('-').map(Number);
  m--; if (m < 1) { m = 12; y--; }
  return `${y}-${pad(m)}`;
}

// ช่วงวันที่ของ "รอบจ่าย" (pay cycle) หนึ่งเดือน: วันถัดจากเส้นตายเดือนก่อน ถึง เส้นตายเดือนนี้
// ใช้กรองรายรับ/ยอดส่งออกให้อยู่ในช่วงเวลาเดียวกับที่ใช้คิดค่าแรง (cut-off)
export function payCycleWindow(ym: string, holidays: Set<string>, overrides: Record<string, string>, cutoffDay?: number): { start: string; end: string } {
  const end = computeCutoff(ym, holidays, overrides, cutoffDay);
  const prevCutoff = computeCutoff(prevMonth(ym), holidays, overrides, cutoffDay);
  const [py, pm, pd] = prevCutoff.split('-').map(Number);
  const d = new Date(py, pm - 1, pd);
  d.setDate(d.getDate() + 1);
  const start = fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { start, end };
}

// รอบจ่ายของรายการรับคืน
export function computePayCycle(returnedAt: string, holidays: Set<string>, overrides: Record<string, string>, cutoffDay?: number): string {
  const ym = returnedAt.slice(0, 7);
  const cutoff = computeCutoff(ym, holidays, overrides, cutoffDay);
  return returnedAt.slice(0, 10) <= cutoff ? ym : nextMonth(ym);
}

// แปลงเดือน "YYYY-MM" เป็นช่วงวันจริงตามรอบ Cut-off ที่ตั้งไว้ (ไม่ใช่ 1-สิ้นเดือนตามปฏิทิน)
// ใช้แทนการกรองแบบ LIKE 'YYYY-MM%' ตรงๆ ในหน้ารับเข้า/เบิกออก/ส่งงาน เพื่อให้ "รายเดือน"
// ตรงกับรอบที่ใช้คิดค่าแรงจริง (เดือนแต่ละเดือนยาวไม่เท่ากันได้ถ้ากำหนดเอง)
export function monthCutoffRange(ym: string, settingsRows: { key: string; value: string }[]): { start: string; end: string } {
  const { holidays, overrides, cutoffDay } = loadCutoffConfig(settingsRows);
  return payCycleWindow(ym, holidays, overrides, cutoffDay);
}

// รอบเดือนแบบ "อิงวันรับของจริงจากโรงงาน" — ใช้เฉพาะตารางเทียบรับเข้า vs เบิกออก
// (คนละตัวกับ monthCutoffRange/payCycleWindow ด้านบนที่ใช้ตัดสินรอบจ่ายค่าแรงจริง — ไม่กระทบกัน)
// กติกา: วันสิ้นสุดของเดือน = วันที่รับของจริงวันสุดท้ายที่มีบันทึกไว้ในเดือนนั้น (ไม่ใช่กฎวันทำการ)
//        วันเริ่มของเดือน = วันสิ้นสุดของเดือนก่อนหน้า (วันเดียวกัน) เช่น รอบ ก.ย. เริ่มนับจาก
//        วันรับของจริงวันสุดท้ายของ ส.ค. เป็นวันแรกเลย ไม่ใช่วันถัดไป
// ถ้าเดือนไหนไม่มีประวัติรับของเลย fallback เป็นปฏิทิน 1-สิ้นเดือนของเดือนนั้นแทน
export function deliveryCutoffRange(ym: string, lastReceiveByMonth: Record<string, string>): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const end = lastReceiveByMonth[ym] || fmt(y, m, lastDayOfMonth(y, m));
  const pm = prevMonth(ym);
  const [py, pmo] = pm.split('-').map(Number);
  const start = lastReceiveByMonth[pm] || fmt(py, pmo, 1);
  return { start, end };
}

// อ่านวันหยุด + วันเส้นตายที่ override จากตาราง settings
//  - holidays      = "2026-04-13,2026-04-14,..."  (comma)
//  - cutoff_YYYY-MM = "YYYY-MM-DD"                 (กำหนดเส้นตายเองรายเดือน)
export function loadCutoffConfig(settingsRows: { key: string; value: string }[]) {
  const holidays = new Set<string>();
  const overrides: Record<string, string> = {};
  let cutoffDay: number | undefined;
  for (const s of settingsRows) {
    if (s.key === 'holidays' && s.value) {
      s.value.split(',').map(x => x.trim()).filter(Boolean).forEach(d => holidays.add(d));
    } else if (s.key === 'pay_cutoff_day' && s.value) {
      const n = parseInt(s.value, 10);
      if (n >= 1 && n <= 31) cutoffDay = n;
    } else if (s.key.startsWith('cutoff_') && s.value) {
      overrides[s.key.replace('cutoff_', '')] = s.value.trim();
    }
  }
  return { holidays, overrides, cutoffDay };
}

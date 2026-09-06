import { useState, useCallback } from 'react';

// เลือกได้หลายรายการด้วย checkbox ใช้ร่วมกันได้ทุกหน้าตาราง — เก็บแค่ id ที่ติ๊กไว้ ไม่ผูกกับข้อมูลชุดใดชุดหนึ่ง
//
// useCallback สำคัญมาก: ฟังก์ชันพวกนี้ถูกส่งเป็น prop ให้แถวในตาราง (หลายร้อยแถว)
// ถ้าสร้างใหม่ทุกครั้งที่เรนเดอร์ memo() ของแถวจะไร้ผลทันที (มองว่า prop เปลี่ยนตลอด)
// แล้วทุกการพิมพ์/ติ๊ก จะไล่เรนเดอร์ใหม่ทั้งตาราง — วัดได้ว่าหน่วง ~150ms ต่อการกดปุ่ม 1 ครั้ง
// setSelected ของ React นิ่งอยู่แล้ว จึงใช้ dependency ว่างได้ปลอดภัย
export function useBulkSelect() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = useCallback((id: number) => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  }), []);
  const toggleAll = useCallback((ids: number[]) => setSelected(s => {
    const allSelected = ids.length > 0 && ids.every(id => s.has(id));
    return allSelected ? new Set() : new Set(ids);
  }), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, toggleAll, clear };
}

// ลบทีละรายการตามลำดับ (กันยิงพร้อมกันจำนวนมากถล่ม backend) เก็บผลสำเร็จ/ล้มเหลวแยกไว้รายงานสรุปท้ายสุด
export async function bulkDelete(
  ids: number[],
  deleteFn: (id: number) => Promise<any>,
): Promise<{ success: number; failed: { id: number; error: string }[] }> {
  const failed: { id: number; error: string }[] = [];
  let success = 0;
  for (const id of ids) {
    try {
      await deleteFn(id);
      success++;
    } catch (e: any) {
      failed.push({ id, error: e?.response?.data?.error || 'ลบไม่สำเร็จ' });
    }
  }
  return { success, failed };
}

export function bulkDeleteSummary(result: { success: number; failed: { id: number; error: string }[] }): string {
  if (result.failed.length === 0) return `ลบสำเร็จ ${result.success} รายการ`;
  const reasons = Array.from(new Set(result.failed.map(f => f.error))).join(', ');
  return `ลบสำเร็จ ${result.success} รายการ, ล้มเหลว ${result.failed.length} รายการ (${reasons})`;
}

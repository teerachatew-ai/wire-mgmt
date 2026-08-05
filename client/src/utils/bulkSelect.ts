import { useState } from 'react';

// เลือกได้หลายรายการด้วย checkbox ใช้ร่วมกันได้ทุกหน้าตาราง — เก็บแค่ id ที่ติ๊กไว้ ไม่ผูกกับข้อมูลชุดใดชุดหนึ่ง
export function useBulkSelect() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = (ids: number[]) => setSelected(s => {
    const allSelected = ids.length > 0 && ids.every(id => s.has(id));
    return allSelected ? new Set() : new Set(ids);
  });
  const clear = () => setSelected(new Set());
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

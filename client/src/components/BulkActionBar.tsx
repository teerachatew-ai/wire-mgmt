import { Trash2, Loader2 } from 'lucide-react';

// แถบขึ้นเหนือ table เมื่อมีการติ๊กเลือกรายการไว้ — ใช้ร่วมกันทุกหน้าที่มีปุ่มลบทีละรายการ
export default function BulkActionBar({ count, onDelete, onClear, deleting, label = 'รายการ' }: {
  count: number; onDelete: () => void; onClear: () => void; deleting?: boolean; label?: string;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
      <span className="text-sm font-medium text-blue-800">เลือกแล้ว {count} {label}</span>
      <button className="btn-danger btn-sm ml-auto" disabled={deleting} onClick={onDelete}>
        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} ลบที่เลือก
      </button>
      <button className="text-xs text-gray-500 hover:text-gray-700 underline" onClick={onClear} disabled={deleting}>ยกเลิก</button>
    </div>
  );
}

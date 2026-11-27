import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { memberApi } from '../api';
import ExportExcelButton from './ExportExcelButton';

/* โมดูลย่อย "พนักงานที่ใช้งาน" — เรียงตามเลขที่พนักงาน (staff_no) แยกจากรหัสสมาชิก
 * คนพักงานถูกซ่อนแต่ยังเก็บเลขไว้ กลับมาใช้งานได้เลขเดิม */
export default function StaffList({ members }: { members: any[] }) {
  const qc = useQueryClient();
  const active = members.filter(m => m.status === 'active');
  const staff = active.filter(m => m.staff_no != null).sort((a, b) => a.staff_no - b.staff_no);
  const unnumbered = active.filter(m => m.staff_no == null);
  const nextNo = Math.max(0, ...members.map(m => Number(m.staff_no) || 0)) + 1;

  const assign = useMutation({
    mutationFn: (id: number) => memberApi.assignStaffNo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
    onError: (e: any) => alert(e.response?.data?.error ?? 'เกิดข้อผิดพลาด'),
  });

  const rows = staff.map(m => ({
    'เลขที่': m.staff_no, 'รหัสสมาชิก': m.code, 'ชื่อ-สกุล': m.name,
    'ชื่อเล่น': m.nickname || '', 'เบอร์โทร': m.phone || '',
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">พนักงานที่ใช้งาน <b>{staff.length}</b> คน · เลขถัดไป <b>{nextNo}</b></p>
        <ExportExcelButton filename={`รายชื่อพนักงานที่ใช้งาน-${new Date().toISOString().split('T')[0]}`} rows={rows} />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium text-center w-16">เลขที่</th>
              <th className="px-4 py-3 font-medium">ชื่อ-สกุล</th>
              <th className="px-4 py-3 font-medium">รหัสสมาชิก</th>
              <th className="px-4 py-3 font-medium">เบอร์โทร</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>}
            {staff.map(m => (
              <tr key={m.id} className="border-b">
                <td className="px-4 py-2.5 text-center font-bold tabular-nums text-gray-800">{m.staff_no}</td>
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  {m.name}
                  {m.nickname && <span className="ml-2 text-sm font-normal text-gray-400">({m.nickname})</span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-blue-600 font-semibold">{m.code}</td>
                <td className="px-4 py-2.5 text-gray-500">{m.phone || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unnumbered.length > 0 && (
        <div className="card space-y-2">
          <p className="text-sm font-medium text-gray-700">สมาชิกสถานะใช้งานที่ยังไม่มีเลขที่พนักงาน ({unnumbered.length} คน)</p>
          {unnumbered.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 border-t pt-2">
              <span className="text-sm text-gray-600 min-w-0">
                <span className="font-mono text-xs text-blue-600 mr-2">{m.code}</span>{m.name}
              </span>
              <button className="btn-secondary btn-sm flex items-center gap-1 whitespace-nowrap" disabled={assign.isPending}
                onClick={() => { if (confirm(`เพิ่ม ${m.name} เข้ารายชื่อพนักงาน เป็นเลขที่ ${nextNo}? เมื่อให้เลขแล้วจะเป็นเลขประจำตัวของคนนี้`)) assign.mutate(m.id); }}>
                <UserPlus size={14} /> เพิ่มเข้ารายชื่อ
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

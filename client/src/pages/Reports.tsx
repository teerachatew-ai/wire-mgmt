import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi, memberApi } from '../api';
import { BarChart2 } from 'lucide-react';
import MemberSelect from '../components/MemberSelect';

function MemberHistory() {
  const [queryId, setQueryId] = useState<number | null>(null);
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const { data } = useQuery({
    queryKey: ['member-history', queryId],
    queryFn: () => reportApi.memberHistory(queryId!),
    enabled: !!queryId
  });
  return (
    <div className="space-y-3">
      <div>
        <label className="label">เลือกสมาชิกเพื่อดูประวัติงาน</label>
        <div className="max-w-sm">
          <MemberSelect
            members={members as any[]}
            value={queryId ?? ''}
            onChange={(id) => setQueryId(id === '' ? null : Number(id))}
          />
        </div>
      </div>

      {!queryId && (
        <div className="card text-center text-gray-400 py-12">
          เลือกสมาชิกด้านบนเพื่อดูประวัติการเบิก-คืนงาน และค่าแรง
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm flex gap-6">
            <div><span className="text-gray-500">งานดีรวม: </span><strong className="text-green-700">{data.defect_summary.total_good}</strong></div>
            <div><span className="text-gray-500">งานเสียรวม: </span><strong className="text-red-500">{data.defect_summary.total_defect}</strong></div>
            <div><span className="text-gray-500">% ของเสีย: </span>
              <strong className={parseFloat(data.defect_summary.defect_pct) > 5 ? 'text-red-600' : 'text-green-700'}>
                {data.defect_summary.defect_pct}%
              </strong>
            </div>
          </div>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">ใบเบิก</th>
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="px-4 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium text-right">เบิก</th>
                  <th className="px-4 py-3 font-medium text-right">งานดี</th>
                  <th className="px-4 py-3 font-medium text-right">งานเสีย</th>
                  <th className="px-4 py-3 font-medium text-right">ค่าแรง</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {data.issues.map((i: any) => (
                  <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600 font-semibold">{i.code}</td>
                    <td className="px-4 py-2.5 text-gray-700">{i.product_name}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{i.issued_at}</td>
                    <td className="px-4 py-2.5 text-right">{i.quantity} {i.unit}</td>
                    <td className="px-4 py-2.5 text-right text-green-600">{i.good_qty}</td>
                    <td className="px-4 py-2.5 text-right text-red-400">{i.defect_qty}</td>
                    <td className="px-4 py-2.5 text-right text-green-700 font-medium">
                      {(i.good_qty * i.wage_per_unit).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`badge-${i.status}`}>{i.status === 'pending' ? 'ค้าง' : i.status === 'partial' ? 'บางส่วน' : 'ปิด'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart2 size={20} className="text-purple-600" />
        <h1 className="text-xl font-bold text-gray-800">รายงานประวัติรายสมาชิก</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        ดูข้อมูลสต๊อกและงานค้างได้ที่เมนู "สต็อค & ตรวจสอบ"
      </p>
      <MemberHistory />
    </div>
  );
}

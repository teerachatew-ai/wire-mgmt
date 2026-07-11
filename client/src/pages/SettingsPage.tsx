import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportApi } from '../api';
import { Settings, Save, CheckCircle, Wallet } from 'lucide-react';
import CompensationStructure from '../components/CompensationStructure';

export default function SettingsPage() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState('');
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: reportApi.getSettings });

  const [form, setForm] = useState<any>({});
  const current = { ...(settings || {}), ...form };

  const saveMut = useMutation({
    mutationFn: () => reportApi.saveSettings(current),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['payroll-cumulative'] });
      setSaved(r?.recomputed ? `บันทึกแล้ว · คำนวณรอบจ่ายใหม่ ${r.recomputed} รายการ` : 'บันทึกแล้ว');
      setTimeout(() => setSaved(''), 3000);
    }
  });

  if (isLoading) return <div className="p-8 text-gray-500">กำลังโหลด...</div>;

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-gray-600" />
        <h1 className="text-xl font-bold text-gray-800">ตั้งค่าระบบ</h1>
      </div>

      <div className="card space-y-4 max-w-lg">
        <div>
          <label className="label">ชื่อแอดมิน</label>
          <input className="input" value={current.admin_name || ''} onChange={e => set('admin_name', e.target.value)} />
        </div>
        <div>
          <label className="label">เพดานงานค้างต่อคน (หน่วย)</label>
          <input type="number" min="1" className="input" value={current.max_pending_units || ''} onChange={e => set('max_pending_units', e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">สมาชิกที่มีงานค้างเกินจำนวนนี้จะเบิกเพิ่มไม่ได้</p>
        </div>
        <div>
          <label className="label">จำนวนวันที่ถือว่าค้างเกินกำหนด</label>
          <input type="number" min="1" className="input" value={current.overdue_days_limit || ''} onChange={e => set('overdue_days_limit', e.target.value)} />
        </div>
        <div>
          <label className="label">% ค่าจ้างสำหรับงานเสีย</label>
          <input type="number" min="0" max="100" step="1" className="input" value={current.defect_wage_percent || ''} onChange={e => set('defect_wage_percent', e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">0 = ไม่จ่ายค่าแรงสำหรับงานเสีย, 100 = จ่ายเต็ม</p>
        </div>
        <div>
          <label className="label">ค่าปรับงานเสียจากการตัด (บาท/เส้นที่เกินเกณฑ์)</label>
          <input type="number" min="0" step="1" className="input" value={current.ng_penalty_per_unit || ''} onChange={e => set('ng_penalty_per_unit', e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">หักจากสมาชิกเฉพาะเส้น NG-ตัด ที่เกิน % ยอมรับได้ของรุ่น (เข้ากลุ่ม)</p>
        </div>

        {/* วัน Cut-off รอบจ่ายค่าแรงตัด */}
        <div className="border-t pt-4">
          <label className="label">วัน Cut-off รอบจ่ายค่าแรงตัด (วันที่ของเดือน)</label>
          <input type="number" min="1" max="31" className="input" placeholder="เว้นว่าง = อัตโนมัติ (วันทำการก่อนวันสุดท้ายของเดือน)"
            value={current.pay_cutoff_day || ''} onChange={e => set('pay_cutoff_day', e.target.value)} />
          {(() => {
            const day = parseInt(current.pay_cutoff_day || '', 10);
            if (day >= 1 && day <= 31) {
              const prev = day + 1;
              return <p className="text-xs text-blue-600 mt-1">
                รอบจ่าย 1 เดือน = ตั้งแต่ <b>วันที่ {prev} ของเดือนก่อน</b> ถึง <b>วันที่ {day} ของเดือนนี้</b> → นับเข้ารอบเดือนนี้
                <br />งานที่คืนหลังวันที่ {day} จะเลื่อนไปรอบเดือนถัดไป
              </p>;
            }
            return <p className="text-xs text-gray-400 mt-1">เว้นว่าง = ใช้ค่าอัตโนมัติเดิม (เส้นตาย = วันทำการก่อนวันทำการสุดท้ายของเดือน)</p>;
          })()}
          <p className="text-[11px] text-amber-600 mt-1">⚠️ เมื่อบันทึก ระบบจะคำนวณรอบจ่ายของรายการคืนทั้งหมดใหม่ตามวันที่ตั้ง</p>
        </div>

        <div className="pt-2 flex items-center gap-3">
          <button className="btn-primary flex items-center gap-2" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            <Save size={15} /> {saveMut.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
          {saved && <span className="text-green-600 text-sm flex items-center gap-1"><CheckCircle size={14} /> {saved}</span>}
        </div>
      </div>

      {/* โครงสร้างค่าตอบแทน (ย้ายมาจากเมนูค่าแรง) */}
      <div className="flex items-center gap-2 pt-2">
        <Wallet size={20} className="text-purple-600" />
        <h2 className="text-lg font-bold text-gray-800">โครงสร้างค่าตอบแทน</h2>
      </div>
      <CompensationStructure />
    </div>
  );
}

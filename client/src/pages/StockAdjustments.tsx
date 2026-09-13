import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi, reportApi, stockAdjustmentApi } from '../api';
import { parseProductLabel, projectLabel } from '../projectLabel';
import { sortByColorGroup, colorPriority } from '../productOrder';
import { Wrench, Plus, Trash2 } from 'lucide-react';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const isoOf = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);

/* ปรับยอดสต็อกด้วยมือ — ใช้เมื่อยอด "พร้อมส่งโรงงาน" ในระบบไม่ตรงกับของจริงหน้างาน
   (ยอดผีที่ค้างมาจากการบันทึกรับเข้า/ส่งออกคลาดเคลื่อนช่วงแรกๆ ที่หาต้นตอไม่เจอแล้วว่าใบไหนผิด)
   ให้กรอกแค่ "นับของจริงได้เท่าไหร่" ระบบคำนวณส่วนต่างที่ต้องปรับให้เอง ไม่ต้องคิดเลขเอง
   บันทึกเป็นรายการแยก ไม่ไปแก้ไขใบรับ/ใบส่งเดิม — ตรวจสอบย้อนหลังได้เสมอ ไม่กระทบยอดค่าแรง/รายได้ */
export default function StockAdjustments() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: flow } = useQuery({ queryKey: ['stock-flow', 'all'], queryFn: () => reportApi.stockFlow() });
  const { data: adjustments = [], isLoading } = useQuery({ queryKey: ['stock-adjustments'], queryFn: () => stockAdjustmentApi.list() });

  const readyOf = useMemo(() => new Map(((flow?.products || []) as any[]).map((p: any) => [p.id, Number(p.stock_ready) || 0])), [flow]);

  const groups = useMemo(() => {
    const active = (products as any[]).filter(p => p.active);
    const byProject: Record<string, any[]> = {};
    for (const p of active) (byProject[p.project || 'อื่นๆ'] ??= []).push(p);
    return Object.entries(byProject)
      .map(([key, items]) => ({ key, items: sortByColorGroup(items, (p: any) => p.name, (p: any) => p.color) }))
      .sort((a, b) => colorPriority(a.items[0]?.color) - colorPriority(b.items[0]?.color) || a.key.localeCompare(b.key, 'th'));
  }, [products]);

  const [productId, setProductId] = useState('');
  const [target, setTarget] = useState('');
  const [adjustedAt, setAdjustedAt] = useState(isoOf(new Date()));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const current = productId ? (readyOf.get(Number(productId)) || 0) : null;
  const diff = productId && target !== '' && !isNaN(Number(target)) ? Number(target) - (current || 0) : null;

  const submit = async () => {
    setError('');
    if (!productId) { setError('กรุณาเลือกสินค้า'); return; }
    if (target === '' || isNaN(Number(target))) { setError('กรุณากรอกจำนวนที่นับได้จริง'); return; }
    if (!diff) { setError('จำนวนที่นับได้เท่ากับในระบบอยู่แล้ว ไม่ต้องปรับ'); return; }
    if (!reason.trim()) { setError('กรุณาระบุเหตุผลที่ปรับยอด'); return; }
    setSaving(true);
    try {
      await stockAdjustmentApi.create({ product_id: Number(productId), adjusted_at: adjustedAt, quantity: diff, reason: reason.trim() });
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
      qc.invalidateQueries({ queryKey: ['stock-flow'] });
      setProductId(''); setTarget(''); setReason('');
    } catch (e: any) {
      setError(e.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm('ลบรายการปรับยอดนี้? ยอดในระบบจะกลับไปเป็นก่อนปรับทันที')) return;
    await stockAdjustmentApi.delete(id);
    qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
    qc.invalidateQueries({ queryKey: ['stock-flow'] });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Wrench size={20} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">ปรับยอดสต็อก</h1>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        ใช้เมื่อยอด <b>"พร้อมส่งโรงงาน"</b> ในระบบไม่ตรงกับของจริงหน้างาน (มักเกิดจากการบันทึกรับเข้า/ส่งออกคลาดเคลื่อนในอดีต
        ที่หาต้นตอไม่เจอแล้วว่าใบไหนผิด) — ระบบจะบันทึกเป็นรายการแก้ยอดแยกต่างหาก ไม่ไปแก้ไขใบรับ/ใบส่งเดิม
        ตรวจสอบย้อนหลังได้เสมอ และ<b>ไม่กระทบยอดค่าแรง/รายได้</b>เลย
      </p>

      <div className="card space-y-3">
        <div>
          <label className="label">สินค้า *</label>
          <select className="input" value={productId} onChange={e => { setProductId(e.target.value); setTarget(''); setError(''); }}>
            <option value="">-- เลือกสินค้า --</option>
            {groups.map(g => (
              <optgroup key={g.key} label={projectLabel(g.key)}>
                {g.items.map((p: any) => {
                  const { num, label } = parseProductLabel(p.name);
                  return <option key={p.id} value={p.id}>{num ? `${num} ${label}` : p.name}</option>;
                })}
              </optgroup>
            ))}
          </select>
        </div>

        {productId && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center justify-between text-sm">
            <span className="text-gray-500">ยอดพร้อมส่งในระบบตอนนี้</span>
            <b className="text-gray-800 tabular-nums text-base">{fmt(current || 0)}</b>
          </div>
        )}

        <div>
          <label className="label">นับของจริงหน้างานได้เท่าไหร่ *</label>
          <input type="number" step="0.01" className="input" placeholder="กรอกจำนวนที่นับได้จริง"
            value={target} onChange={e => setTarget(e.target.value)} disabled={!productId} />
        </div>

        {diff !== null && diff !== 0 && (
          <div className={`rounded-xl border p-3 text-sm ${diff > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
            ระบบจะปรับยอด<b>{diff > 0 ? 'เพิ่ม' : 'ลด'} {fmt(Math.abs(diff))}</b> ให้เป็น {fmt(Number(target))}
            {diff > 0 ? ' (นับได้มากกว่าที่ระบบคิดไว้)' : ' (นับได้น้อยกว่าที่ระบบคิดไว้ — ตัดยอดผีทิ้ง)'}
          </div>
        )}

        <div>
          <label className="label">วันที่ปรับยอด</label>
          <input type="date" className="input w-40" value={adjustedAt} onChange={e => setAdjustedAt(e.target.value)} />
        </div>

        <div>
          <label className="label">เหตุผล *</label>
          <input className="input" placeholder="เช่น นับสต็อกจริงหน้างาน พบว่าไม่มีของเหลือ" value={reason} onChange={e => setReason(e.target.value)} />
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>}

        <div className="flex justify-end">
          <button type="button" className="btn-primary flex items-center gap-1.5" disabled={saving} onClick={submit}>
            <Plus size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกปรับยอด'}
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <span className="font-semibold text-gray-700 text-sm">ประวัติการปรับยอด</span>
        </div>
        {isLoading ? (
          <div className="py-8 text-center text-gray-400">กำลังโหลด...</div>
        ) : (adjustments as any[]).length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">ยังไม่มีการปรับยอด</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(adjustments as any[]).map((a: any) => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: a.color }} />}
                    <span className="font-medium text-gray-800 text-sm">{a.product_name}</span>
                    <span className={`text-sm font-bold tabular-nums ${a.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {a.quantity > 0 ? '+' : ''}{fmt(a.quantity)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{a.reason}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{a.adjusted_at} · โดย {a.created_by || 'ไม่ระบุ'}</p>
                </div>
                <button type="button" className="text-gray-300 hover:text-red-500 shrink-0" title="ลบ (ยอดจะกลับไปก่อนปรับทันที)" onClick={() => del(a.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

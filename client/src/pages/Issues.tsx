import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { issueApi, memberApi, productApi, reportApi } from '../api';
import MemberSelect from '../components/MemberSelect';
import { colorDot } from '../colorDot';
import { Plus, X, Eye, ArrowUpFromLine, Printer, FileText, Trash2, Edit2 } from 'lucide-react';

function openPrint(url: string) {
  window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
}

const statusLabel: Record<string, string> = { pending: 'ค้างส่ง', partial: 'คืนบางส่วน', closed: 'ปิดแล้ว' };
const statusClass: Record<string, string> = { pending: 'badge-pending', partial: 'badge-partial', closed: 'badge-closed' };

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold text-gray-800 text-base">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function DetailModal({ issue, onClose }: any) {
  if (!issue) return null;
  const returned = issue.returned_good + issue.returned_defect + issue.returned_waste;
  const remaining = issue.quantity - returned;
  return (
    <Modal title={`ใบเบิก ${issue.code}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div><span className="text-gray-500">สมาชิก: </span><strong>{issue.member_code} — {issue.member_name}</strong></div>
          <div><span className="text-gray-500">สินค้า: </span><strong>{issue.product_name}</strong></div>
          <div><span className="text-gray-500">วันที่เบิก: </span>{issue.issued_at}</div>
          <div><span className="text-gray-500">กำหนดคืน: </span>{issue.due_date || '-'}</div>
          <div><span className="text-gray-500">จำนวนเบิก: </span><strong>{issue.quantity} {issue.unit}</strong></div>
          <div><span className="text-gray-500">สถานะ: </span><span className={statusClass[issue.status]}>{statusLabel[issue.status]}</span></div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-2">สรุปการคืน</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div><p className="text-xs text-gray-400">คืนงานดี</p><p className="font-bold text-green-600">{issue.returned_good}</p></div>
            <div><p className="text-xs text-gray-400">คืนงานเสีย</p><p className="font-bold text-red-500">{issue.returned_defect}</p></div>
            <div><p className="text-xs text-gray-400">เศษคืน</p><p className="font-bold text-gray-500">{issue.returned_waste}</p></div>
            <div><p className="text-xs text-gray-400">คงเหลือ</p><p className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>{remaining}</p></div>
          </div>
        </div>
        {issue.returns?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">ประวัติการคืน</p>
            <table className="w-full text-xs border rounded-xl overflow-hidden">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">วันที่</th>
                  <th className="px-3 py-2 text-right">งานดี</th>
                  <th className="px-3 py-2 text-right">งานเสีย</th>
                  <th className="px-3 py-2 text-right">เศษ</th>
                  <th className="px-3 py-2 text-left">ผู้ตรวจ</th>
                </tr>
              </thead>
              <tbody>
                {issue.returns.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{r.returned_at}</td>
                    <td className="px-3 py-2 text-right text-green-600">{r.good_qty}</td>
                    <td className="px-3 py-2 text-right text-red-500">{r.defect_qty}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.waste_qty}</td>
                    <td className="px-3 py-2 text-gray-500">{r.inspector || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Create Issue Modal (multi-product) ── */
function CreateIssueModal({ members, products, stockMap = {}, onClose, onCreated }: any) {
  const { register, handleSubmit, watch, setValue } = useForm<any>({
    defaultValues: { issued_at: new Date().toISOString().split('T')[0], member_id: '' }
  });
  register('member_id', { required: true });
  const memberId = watch('member_id');

  const [lines, setLines] = useState([{ product_id: '', quantity: '' }]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const addLine = () => setLines(l => [...l, { product_id: '', quantity: '' }]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, val: string) =>
    setLines(l => l.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const onSubmit = async (formData: any) => {
    const validLines = lines.filter(l => l.product_id && l.quantity);
    if (validLines.length === 0) { setError('กรุณาเลือกสินค้าและจำนวนอย่างน้อย 1 รายการ'); return; }
    setLoading(true);
    setError('');
    try {
      for (const line of validLines) {
        await issueApi.create({ ...formData, product_id: line.product_id, quantity: line.quantity });
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const activeProducts = (products as any[]).filter((p: any) => p.active);

  return (
    <Modal title="สร้างใบเบิกงาน" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Header info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">วันที่เบิก *</label>
            <input type="date" className="input" {...register('issued_at', { required: true })} />
          </div>
          <div>
            <label className="label">กำหนดคืน</label>
            <input type="date" className="input" {...register('due_date')} />
          </div>
        </div>

        <div>
          <label className="label">สมาชิก *</label>
          <MemberSelect
            members={members}
            value={memberId}
            onChange={(id) => setValue('member_id', id, { shouldValidate: true })}
            activeOnly
          />
        </div>

        {/* Product lines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">ประเภทสินค้าที่เบิก *</label>
            <button type="button" onClick={addLine}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50">
              <Plus size={16} /> เพิ่มประเภท
            </button>
          </div>

          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center p-3 bg-gray-50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <select
                    className="input mb-2"
                    value={line.product_id}
                    onChange={e => updateLine(i, 'product_id', e.target.value)}
                  >
                    <option value="">-- เลือกสินค้า --</option>
                    {activeProducts.map((p: any) => (
                      <option key={p.id} value={p.id}>{colorDot(p.color)}{p.project ? `${p.project} · ` : ''}{p.name} · คงคลัง {Math.max(0, Math.round(stockMap[p.id] ?? 0)).toLocaleString()}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input"
                    placeholder="จำนวน"
                    value={line.quantity}
                    onChange={e => updateLine(i, 'quantity', e.target.value)}
                  />
                  {line.product_id && (
                    <p className="text-xs text-gray-500 mt-1">
                      เบิกได้สูงสุด <strong className="text-blue-600">{Math.max(0, Math.round(stockMap[line.product_id] ?? 0)).toLocaleString()}</strong> {activeProducts.find((p: any) => String(p.id) === String(line.product_id))?.unit || 'หน่วย'} (คงคลัง)
                    </p>
                  )}
                </div>
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(i)}
                    className="shrink-0 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label">หมายเหตุ</label>
          <input className="input" {...register('notes')} placeholder="(ไม่บังคับ)" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>
        )}

        {/* Summary */}
        {lines.some(l => l.product_id && l.quantity) && (
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-800">
            <p className="font-semibold mb-1">สรุปที่จะสร้าง:</p>
            {lines.filter(l => l.product_id && l.quantity).map((l, i) => {
              const p = activeProducts.find((p: any) => String(p.id) === String(l.product_id));
              return p ? <p key={i}>• {p.name}: <strong>{Number(l.quantity).toLocaleString()} {p.unit}</strong></p> : null;
            })}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'กำลังสร้าง...' : `สร้างใบเบิก (${lines.filter(l => l.product_id && l.quantity).length} รายการ)`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Edit Issue Modal (single product) ── */
function EditIssueModal({ issue, members, products, onClose, onSaved }: any) {
  const { register, handleSubmit, watch, setValue } = useForm<any>({
    defaultValues: {
      issued_at: issue.issued_at,
      due_date: issue.due_date || '',
      member_id: issue.member_id,
      product_id: issue.product_id,
      quantity: issue.quantity,
      notes: issue.notes || '',
    }
  });
  register('member_id', { required: true });
  const memberId = watch('member_id');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const activeProducts = (products as any[]).filter((p: any) => p.active || String(p.id) === String(issue.product_id));
  const returned = issue.returned_good + issue.returned_defect + issue.returned_waste;

  const onSubmit = async (data: any) => {
    setLoading(true); setError('');
    try {
      await issueApi.update(issue.id, data);
      onSaved(); onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  };

  return (
    <Modal title={`แก้ไขใบเบิก ${issue.code}`} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">วันที่เบิก *</label>
            <input type="date" className="input" {...register('issued_at', { required: true })} />
          </div>
          <div>
            <label className="label">กำหนดคืน</label>
            <input type="date" className="input" {...register('due_date')} />
          </div>
        </div>

        <div>
          <label className="label">สมาชิก *</label>
          <MemberSelect
            members={members}
            value={memberId}
            onChange={(id) => setValue('member_id', id, { shouldValidate: true })}
          />
        </div>

        <div>
          <label className="label">สินค้า *</label>
          <select className="input" {...register('product_id', { required: true })}>
            {activeProducts.map((p: any) => (
              <option key={p.id} value={p.id}>{colorDot(p.color)}{p.project ? `${p.project} · ` : ''}{p.name} ({p.wage_per_unit} บาท/{p.unit})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">จำนวนเบิก *</label>
          <input type="number" step="0.01" min="0.01" className="input" {...register('quantity', { required: true })} />
          {returned > 0 && <p className="text-xs text-amber-600 mt-1">คืนไปแล้ว {returned} หน่วย — แก้จำนวนได้ไม่ต่ำกว่านี้</p>}
        </div>

        <div>
          <label className="label">หมายเหตุ</label>
          <input className="input" {...register('notes')} placeholder="(ไม่บังคับ)" />
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Delete Issue Dialog ── */
function DeleteIssueDialog({ issue, onClose, onDeleted }: any) {
  const [step, setStep] = useState<'confirm' | 'loading' | 'error'>('confirm');
  const [msg, setMsg] = useState('');
  const [needForce, setNeedForce] = useState(false);

  const doDelete = async (force = false) => {
    setStep('loading');
    try {
      await issueApi.delete(issue.id, force);
      onDeleted(); onClose();
    } catch (e: any) {
      const data = e.response?.data;
      if (data?.confirm_required) { setMsg(data.message); setNeedForce(true); setStep('confirm'); }
      else { setMsg(data?.error || 'เกิดข้อผิดพลาด'); setStep('error'); }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-100 rounded-lg shrink-0"><Trash2 size={20} className="text-red-600" /></div>
          <div>
            <h3 className="font-semibold text-gray-800">ลบใบเบิก</h3>
            <p className="text-sm text-gray-500 mt-0.5">{issue.code} — {issue.member_name}</p>
          </div>
        </div>
        {step === 'loading' && <p className="text-sm text-gray-500">กำลังลบ...</p>}
        {step === 'error' && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{msg}</div>}
        {step === 'confirm' && !needForce && <p className="text-sm text-gray-600">ต้องการลบใบเบิกนี้? การกระทำนี้ยกเลิกไม่ได้</p>}
        {step === 'confirm' && needForce && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">⚠️ {msg}</div>}
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose} disabled={step === 'loading'}>ยกเลิก</button>
          {step !== 'error' && (
            <button className="btn-danger" disabled={step === 'loading'} onClick={() => doDelete(needForce)}>
              {needForce ? 'ยืนยันลบทั้งหมด' : 'ลบ'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Issues() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['issues', statusFilter],
    queryFn: () => issueApi.list({ status: statusFilter || undefined })
  });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: stockData } = useQuery({ queryKey: ['stock-flow', 'all'], queryFn: () => reportApi.stockFlow() });
  const stockMap: Record<number, number> = Object.fromEntries(((stockData?.products || []) as any[]).map((p: any) => [p.id, p.in_warehouse]));
  const { data: detail } = useQuery({
    queryKey: ['issue-detail', detailId],
    queryFn: () => issueApi.get(detailId!),
    enabled: !!detailId
  });

  const handleCreated = () => {
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ArrowUpFromLine size={20} className="text-amber-600" />
          <h1 className="text-xl font-bold text-gray-800">ใบเบิกงาน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-36 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            <option value="pending">ค้างส่ง</option>
            <option value="partial">คืนบางส่วน</option>
            <option value="closed">ปิดแล้ว</option>
          </select>
          <button className="btn-secondary btn-sm" onClick={() => openPrint(`/print?blank=1&count=10`)}>
            <FileText size={16} /> พิมพ์ฟอร์มเปล่า
          </button>
          <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
            <Plus size={18} /> สร้างใบเบิก
          </button>
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {isLoading && <div className="text-center text-gray-400 py-8">กำลังโหลด...</div>}
        {(issues as any[]).map((i: any) => {
          const returned = i.returned_good + i.returned_defect + i.returned_waste;
          const remaining = i.quantity - returned;
          const overdue = i.status !== 'closed' && i.due_date && i.due_date < new Date().toISOString().split('T')[0];
          return (
            <div key={i.id} className={`card space-y-2 ${overdue ? 'border-red-300 bg-red-50' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs text-blue-600 font-bold">{i.code}</span>
                  <p className="font-semibold text-gray-800 mt-0.5">{i.member_name}</p>
                  <p className="text-sm text-gray-500">{i.product_name}</p>
                </div>
                <span className={statusClass[i.status]}>{statusLabel[i.status]}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm bg-gray-50 rounded-xl p-2">
                <div><p className="text-xs text-gray-400">เบิก</p><p className="font-bold">{i.quantity}</p></div>
                <div><p className="text-xs text-gray-400">คืนแล้ว</p><p className="font-bold text-green-600">{returned}</p></div>
                <div><p className="text-xs text-gray-400">คงเหลือ</p><p className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{remaining}</p></div>
              </div>
              <div className="flex gap-2 justify-between items-center text-xs text-gray-400">
                <span>เบิก {i.issued_at}{i.due_date && ` · คืน ${i.due_date}`}</span>
                <div className="flex gap-3">
                  <button className="text-blue-500 hover:text-blue-700" onClick={() => setDetailId(i.id)}><Eye size={18} /></button>
                  <button className="text-amber-500 hover:text-amber-700" onClick={() => setEditing(i)}><Edit2 size={18} /></button>
                  <button className="text-green-500 hover:text-green-700" onClick={() => openPrint(`/print?id=${i.id}`)}><Printer size={18} /></button>
                  <button className="text-red-400 hover:text-red-600" onClick={() => setDeleting(i)}><Trash2 size={18} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {!isLoading && (issues as any[]).length === 0 && <div className="text-center text-gray-400 py-8">ยังไม่มีรายการ</div>}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">เลขใบเบิก</th>
              <th className="px-4 py-3 font-medium">วันที่/กำหนดคืน</th>
              <th className="px-4 py-3 font-medium">สมาชิก</th>
              <th className="px-4 py-3 font-medium">สินค้า</th>
              <th className="px-4 py-3 font-medium text-right">เบิก</th>
              <th className="px-4 py-3 font-medium text-right">คืนแล้ว</th>
              <th className="px-4 py-3 font-medium text-right">คงเหลือ</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {(issues as any[]).map((i: any) => {
              const returned = i.returned_good + i.returned_defect + i.returned_waste;
              const remaining = i.quantity - returned;
              const overdue = i.status !== 'closed' && i.due_date && i.due_date < new Date().toISOString().split('T')[0];
              return (
                <tr key={i.id} className={`border-b border-gray-50 hover:bg-gray-50 ${overdue ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{i.code}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <div>{i.issued_at}</div>
                    {i.due_date && <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-400'}>คืน: {i.due_date}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-500">{i.member_code}</span>{' '}
                    <span className="font-medium text-gray-800">{i.member_name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{i.product_name}</td>
                  <td className="px-4 py-3 text-right font-medium">{i.quantity} {i.unit}</td>
                  <td className="px-4 py-3 text-right text-green-600">{returned}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={remaining > 0 ? 'text-amber-600 font-medium' : 'text-green-600'}>{remaining}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusClass[i.status]}>{statusLabel[i.status]}</span>
                    {overdue && <span className="ml-1 text-red-500 text-xs">⚠️เกินกำหนด</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button className="text-gray-400 hover:text-blue-600" onClick={() => setDetailId(i.id)}><Eye size={15} /></button>
                      <button className="text-gray-400 hover:text-amber-600" onClick={() => setEditing(i)}><Edit2 size={15} /></button>
                      <button className="text-gray-400 hover:text-green-600" onClick={() => openPrint(`/print?id=${i.id}`)}><Printer size={15} /></button>
                      <button className="text-gray-400 hover:text-red-600" onClick={() => setDeleting(i)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && (issues as any[]).length === 0 && <tr><td colSpan={9} className="py-8 text-center text-gray-400">ยังไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <CreateIssueModal
          members={members}
          products={products}
          stockMap={stockMap}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {detailId && <DetailModal issue={detail} onClose={() => setDetailId(null)} />}

      {editing && (
        <EditIssueModal
          issue={editing}
          members={members}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={handleCreated}
        />
      )}

      {deleting && (
        <DeleteIssueDialog
          issue={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleCreated}
        />
      )}
    </div>
  );
}

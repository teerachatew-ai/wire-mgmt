import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { productApi } from '../api';
import { Plus, X, Edit2, Trash2 } from 'lucide-react';
import ExportExcelButton from '../components/ExportExcelButton';

// แสดงราคาทศนิยมสูงสุด 4 ตำแหน่ง (ตัดศูนย์ท้าย)
const price = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

const COLORS = [
  { name: 'ขาว', value: '#ffffff' },
  { name: 'ชมพู', value: '#ec4899' },
  { name: 'ฟ้า', value: '#3b82f6' },
  { name: 'แดง', value: '#ef4444' },
  { name: 'เขียว', value: '#22c55e' },
  { name: 'เหลือง', value: '#eab308' },
  { name: 'ส้ม', value: '#f97316' },
  { name: 'ม่วง', value: '#a855f7' },
  { name: 'เทา', value: '#9ca3af' },
];

function ProductForm({ defaultValues, onSubmit, loading }: any) {
  const { register, handleSubmit, watch, setValue } = useForm({ defaultValues });
  const units = ['เส้น', 'กก.', 'มัด', 'ชิ้น', 'โหล', 'กำ'];
  const color = watch('color');
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <input type="hidden" {...register('color')} />
      <div>
        <label className="label">สีป้ายสินค้า (ช่วยหาง่าย)</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map(c => (
            <button key={c.value} type="button" title={c.name}
              onClick={() => setValue('color', c.value)}
              className={`w-9 h-9 rounded-full border transition-all ${color === c.value ? 'ring-2 ring-offset-2 ring-blue-500 border-blue-500' : 'border-gray-300'}`}
              style={{ backgroundColor: c.value }}
            />
          ))}
          {color && (
            <button type="button" onClick={() => setValue('color', '')}
              className="text-xs text-gray-400 hover:text-gray-600 underline self-center ml-1">ล้างสี</button>
          )}
        </div>
      </div>
      <div>
        <label className="label">ชื่อโครงการ</label>
        <input className="input" {...register('project')} placeholder="เช่น Amphenol, โครงการ A" />
      </div>
      <div>
        <label className="label">ชื่อ/รุ่นสายไฟ *</label>
        <input className="input" {...register('name', { required: true })} />
      </div>
      <div>
        <label className="label">รายละเอียด (Description)</label>
        <textarea className="input" rows={2} {...register('description')} placeholder="เช่น สเปก/ลักษณะงาน เพิ่มเติม" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">หน่วยนับ *</label>
          <select className="input" {...register('unit', { required: true })}>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="label">ค่าจ้างต่อหน่วย (บาท) *</label>
          <input type="number" step="0.0001" min="0" className="input" {...register('wage_per_unit', { required: true })} />
          <p className="text-xs text-gray-400 mt-1">ที่กลุ่มจ่ายสมาชิก</p>
        </div>
      </div>
      <div>
        <label className="label">ราคาที่โรงงาน Amphenol จ้างกลุ่ม (บาท/หน่วย)</label>
        <input type="number" step="0.0001" min="0" className="input" {...register('factory_price')} defaultValue={0} />
        <p className="text-xs text-gray-400 mt-1">ราคาที่โรงงานจ่ายให้กลุ่มต่อหน่วย — ส่วนต่างคือกำไรของกลุ่ม</p>
      </div>
      <div>
        <label className="label">% ของเสียที่ยอมรับ</label>
        <input type="number" step="0.1" min="0" max="100" className="input" {...register('defect_tolerance')} defaultValue={5} />
      </div>
      {defaultValues?.id && (
        <div>
          <label className="label">สถานะ</label>
          <select className="input" {...register('active')}>
            <option value={1}>ใช้งาน</option>
            <option value={0}>ปิดใช้งาน</option>
          </select>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </form>
  );
}

export default function Products() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<any>(null);

  const { data = [], isLoading } = useQuery({ queryKey: ['products'], queryFn: productApi.list });

  // จัดกลุ่มตามโครงการ + เรียงตามรหัส (P001 อยู่บน)
  const groups: Record<string, any[]> = {};
  for (const p of data as any[]) {
    const key = p.project || 'ไม่ระบุโครงการ';
    (groups[key] ??= []).push(p);
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
  }
  // เรียงกลุ่มตามรหัสน้อยสุดของแต่ละกลุ่ม
  const groupKeys = Object.keys(groups).sort((a, b) =>
    (groups[a][0]?.code || '').localeCompare(groups[b][0]?.code || '', undefined, { numeric: true })
  );

  const createMut = useMutation({ mutationFn: productApi.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setModal(null); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }: any) => productApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setModal(null); } });
  const deleteMut = useMutation({
    mutationFn: ({ id, force }: any) => productApi.delete(id, force),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const onDelete = async (p: any) => {
    if (!confirm(`ลบสินค้า ${p.code} — ${p.name}?`)) return;
    try {
      await deleteMut.mutateAsync({ id: p.id, force: false });
    } catch (e: any) {
      const data = e.response?.data;
      if (data?.confirm_required) {
        if (confirm(`${data.message}\n\nยืนยันลบถาวร?`)) {
          await deleteMut.mutateAsync({ id: p.id, force: true });
        }
      } else {
        alert(data?.error || 'ลบไม่สำเร็จ');
      }
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">ประเภทงาน / สินค้า</h1>
        <div className="flex items-center gap-2">
          <ExportExcelButton filename="ประเภทสินค้า" rows={(data as any[]).map(p => ({
            'รหัส': p.code, 'โครงการ': p.project || '', 'ชื่อสินค้า': p.name, 'รายละเอียด': p.description || '',
            'หน่วย': p.unit, 'ราคาโรงงาน/หน่วย': p.factory_price, 'ค่าแรง/หน่วย': p.wage_per_unit,
            '%ยอมรับงานเสีย': p.defect_tolerance, 'สถานะ': p.active ? 'ใช้งาน' : 'ปิดใช้งาน',
          }))} />
          <button className="btn-primary btn-sm flex items-center gap-2" onClick={() => { setEditing(null); setModal('add'); }}>
            <Plus size={16} /> เพิ่มรุ่นสายไฟ
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">รหัส</th>
              <th className="px-4 py-3 font-medium">โครงการ</th>
              <th className="px-4 py-3 font-medium">ชื่อ/รุ่น</th>
              <th className="px-4 py-3 font-medium">หน่วย</th>
              <th className="px-4 py-3 font-medium text-right">ราคาโรงงาน/หน่วย</th>
              <th className="px-4 py-3 font-medium text-right">ค่าจ้าง/หน่วย</th>
              <th className="px-4 py-3 font-medium text-right">กำไรกลุ่ม/หน่วย</th>
              <th className="px-4 py-3 font-medium text-right">เกณฑ์เสีย (%)</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {groupKeys.map((proj) => {
              const items = groups[proj];
              const sumProfit = items.reduce((s: number, p: any) => s + ((p.factory_price ?? 0) - p.wage_per_unit), 0);
              return (
                <Fragment key={proj}>
                  {items.map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{p.code}</td>
                      <td className="px-4 py-3 text-gray-600">{p.project || '-'}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        <span className="inline-flex items-center gap-2">
                          {p.color && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                          {p.name}
                        </span>
                        {p.description && <div className="text-xs text-gray-400 font-normal mt-0.5">{p.description}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{p.unit}</td>
                      <td className="px-4 py-3 text-right font-medium text-blue-700">{price(p.factory_price ?? 0)} บาท</td>
                      <td className="px-4 py-3 text-right font-medium text-amber-700">{price(p.wage_per_unit)} บาท</td>
                      <td className="px-4 py-3 text-right text-gray-300">—</td>
                      <td className="px-4 py-3 text-right text-gray-500">{p.defect_tolerance}%</td>
                      <td className="px-4 py-3">
                        <span className={p.active ? 'badge-active' : 'badge-inactive'}>
                          {p.active ? 'ใช้งาน' : 'ปิด'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button className="text-gray-400 hover:text-blue-600" title="แก้ไข" onClick={() => { setEditing(p); setModal('edit'); }}>
                            <Edit2 size={15} />
                          </button>
                          <button className="text-gray-400 hover:text-red-600" title="ลบ" onClick={() => onDelete(p)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* แถวสรุปกำไรต่อหน่วยรวมของโครงการ */}
                  <tr className="bg-green-50 border-b-2 border-green-200 font-semibold">
                    <td colSpan={6} className="px-4 py-2.5 text-green-800">
                      รวมกำไรต่อหน่วย — โครงการ {proj} <span className="font-normal text-green-600">({items.length} รุ่น)</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-green-800">{price(sumProfit)} บาท</td>
                    <td colSpan={3}></td>
                  </tr>
                </Fragment>
              );
            })}
            {!isLoading && data.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal === 'add' ? 'เพิ่มรุ่นสายไฟใหม่' : 'แก้ไขข้อมูล'} onClose={() => setModal(null)}>
          <ProductForm
            defaultValues={editing || {}}
            loading={createMut.isPending || updateMut.isPending}
            onSubmit={(data: any) => {
              if (modal === 'add') createMut.mutate(data);
              else updateMut.mutate({ id: editing.id, data });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

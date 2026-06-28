import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { reportApi, shipmentApi, productApi, ocrApi } from '../api';
import {
  ArrowDownToLine, ArrowUpFromLine, Package, Truck,
  CheckCircle2, AlertTriangle, Plus, Trash2, X, Loader2,
  RefreshCw, BarChart3, ScanLine, Upload, FileText, CheckCircle, Edit2
} from 'lucide-react';
import { matchProduct } from '../matchProduct';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

/* ─── Summary card ────────────────────────────────────────── */
function FlowCard({ label, value, unit, color, icon: Icon, sub }: any) {
  const colors: any = {
    blue:   'bg-blue-50   border-blue-200   text-blue-800   text-blue-500',
    green:  'bg-green-50  border-green-200  text-green-800  text-green-500',
    amber:  'bg-amber-50  border-amber-200  text-amber-800  text-amber-500',
    purple: 'bg-purple-50 border-purple-200 text-purple-800 text-purple-500',
    red:    'bg-red-50    border-red-200    text-red-800    text-red-500',
    gray:   'bg-gray-50   border-gray-200   text-gray-700   text-gray-400',
  };
  const [bg, border, textD, textL] = colors[color].split(' ');
  return (
    <div className={`rounded-xl border p-4 ${bg} ${border}`}>
      <div className={`flex items-center gap-2 mb-1 ${textL}`}>
        <Icon size={15} />
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${textD}`}>{fmt(value)} <span className="text-sm font-normal">{unit}</span></p>
      {sub && <p className={`text-xs mt-0.5 ${textL}`}>{sub}</p>}
    </div>
  );
}

/* month options: last 12 months */
function monthOptions() {
  const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const out: { v: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ v, label: `${names[d.getMonth()]} ${d.getFullYear() + 543}` });
  }
  return out;
}

/* ─── Tab 1: Check & Balance + month movement ────────────── */
function CheckBalance() {
  const [month, setMonth] = useState(''); // '' = ทั้งหมด
  const monthly = !!month;
  const { data, isLoading } = useQuery({
    queryKey: ['stock-flow', month || 'all'],
    queryFn: () => reportApi.stockFlow(month || undefined),
  });
  const products: any[] = data?.products || [];
  const sum = (k: string) => products.reduce((s, p) => s + (p[k] || 0), 0);
  const totalRecv = sum('received');
  const totalIss = sum('total_issued');
  const totalGood = sum('ret_good');
  const totalDefect = sum('ret_defect');
  const totalReady = sum('stock_ready');
  const totalWith = sum('with_members');
  const totalShip = sum('shipped');
  const totalWaste = sum('ret_waste');
  const totalWH = sum('in_warehouse');
  const allOk = products.every(p => p.ok);

  const availMonths = monthOptions().filter(o => (data?.months || []).includes(o.v));
  const filterBar = (
    <div className="card flex flex-wrap items-end gap-3">
      <div>
        <label className="label">เดือน</label>
        <select className="input w-44 text-sm" value={month} onChange={e => setMonth(e.target.value)}>
          <option value="">ภาพรวม</option>
          {availMonths.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </div>
      {monthly && <p className="text-xs text-gray-500 pb-2">แสดงเฉพาะยอดเคลื่อนไหวในเดือนที่เลือก</p>}
    </div>
  );

  if (isLoading) return <div className="space-y-4">{filterBar}<div className="py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div></div>;

  /* ── โหมดเดือน: ยอดเคลื่อนไหว ── */
  if (monthly) {
    return (
      <div className="space-y-4">
        {filterBar}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <FlowCard label="ยกมา (คงค้างในระบบ)" value={sum('carry_ready')} color="purple" icon={Package} sub="คลัง+กับสมาชิก+พร้อมส่ง" unit="" />
          <FlowCard label="รับเข้าเดือนนี้" value={totalRecv} color="blue" icon={ArrowDownToLine} sub="จากโรงงาน" unit="" />
          <FlowCard label="เบิกออกให้สมาชิก" value={totalIss} color="amber" icon={ArrowUpFromLine} sub="ในเดือนนี้" unit="" />
          <FlowCard label="คืนงานดี" value={totalGood} color="green" icon={Package} sub="ในเดือนนี้" unit="" />
          <FlowCard label="คืนงานเสีย" value={totalDefect} color="red" icon={AlertTriangle} sub="ในเดือนนี้" unit="" />
          <FlowCard label="เศษคืน" value={totalWaste} color="gray" icon={Trash2} sub="ในเดือนนี้" unit="" />
          <FlowCard label="ส่งออกโรงงาน" value={totalShip} color="amber" icon={Truck} sub="ในเดือนนี้" unit="" />
          <FlowCard label="ยกไปเดือนหน้า (คงค้างในระบบ)" value={sum('closing_ready')} color="green" icon={Package} sub="รับเข้า−ส่งออก−เสีย สะสม" unit="" />
        </div>
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <BarChart3 size={15} className="text-gray-500" />
            <span className="font-semibold text-gray-700 text-sm">ยอดเคลื่อนไหวแยกตามสินค้า</span>
          </div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="border-b bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">สินค้า</th>
                <th className="px-3 py-3 text-right font-medium text-purple-500">ยกมา</th>
                <th className="px-3 py-3 text-right font-medium text-blue-600">รับเข้า</th>
                <th className="px-3 py-3 text-right font-medium text-amber-600">เบิกออก</th>
                <th className="px-3 py-3 text-right font-medium text-green-600">คืนดี</th>
                <th className="px-3 py-3 text-right font-medium text-orange-500">คืนเสีย</th>
                <th className="px-3 py-3 text-right font-medium text-red-500">เศษ</th>
                <th className="px-3 py-3 text-right font-medium text-amber-700">ส่งออก</th>
                <th className="px-3 py-3 text-right font-medium text-green-700">ยกไป</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      {p.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                      <span className="font-medium text-gray-800">{p.name}</span>
                      <span className="text-xs text-gray-400">({p.unit})</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-purple-500">{fmt(p.carry_ready)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-blue-700">{fmt(p.received)}</td>
                  <td className="px-3 py-3 text-right text-amber-600">{fmt(p.total_issued)}</td>
                  <td className="px-3 py-3 text-right text-green-600">{fmt(p.ret_good)}</td>
                  <td className="px-3 py-3 text-right text-orange-500">{fmt(p.ret_defect)}</td>
                  <td className="px-3 py-3 text-right text-red-500">{fmt(p.ret_waste)}</td>
                  <td className="px-3 py-3 text-right text-amber-700">{fmt(p.shipped)}</td>
                  <td className="px-3 py-3 text-right font-bold text-green-700">{fmt(p.closing_ready)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 border-t font-semibold text-gray-700">
                <td className="px-4 py-3">รวม</td>
                <td className="px-3 py-3 text-right text-purple-600">{fmt(sum('carry_ready'))}</td>
                <td className="px-3 py-3 text-right text-blue-700">{fmt(totalRecv)}</td>
                <td className="px-3 py-3 text-right text-amber-700">{fmt(totalIss)}</td>
                <td className="px-3 py-3 text-right text-green-700">{fmt(totalGood)}</td>
                <td className="px-3 py-3 text-right text-orange-600">{fmt(totalDefect)}</td>
                <td className="px-3 py-3 text-right text-red-600">{fmt(totalWaste)}</td>
                <td className="px-3 py-3 text-right text-amber-800">{fmt(totalShip)}</td>
                <td className="px-3 py-3 text-right text-green-800">{fmt(sum('closing_ready'))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ── โหมดทั้งหมด: สมดุล (เดิม) ── */
  return (
    <div className="space-y-4">
      {filterBar}
      {/* Status banner */}
      <div className={`rounded-xl border p-3 flex items-center gap-3 ${allOk ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
        {allOk
          ? <CheckCircle2 size={22} className="text-green-600 shrink-0" />
          : <AlertTriangle size={22} className="text-red-600 shrink-0" />}
        <div>
          <p className={`font-semibold text-sm ${allOk ? 'text-green-800' : 'text-red-700'}`}>
            {allOk ? '✅ ยอดตรงกัน — ไม่มีงานหาย' : '⚠️ พบความไม่สมดุล — กรุณาตรวจสอบ'}
          </p>
          <p className="text-xs text-gray-500">สูตร: รับเข้า = ในคลัง + อยู่กับสมาชิก + สต้อคพร้อมส่ง + ส่งออกแล้ว + สูญเสีย</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <FlowCard label="รับจากโรงงาน" value={totalRecv}  color="blue"   icon={ArrowDownToLine} sub="ทั้งหมดที่รับเข้า" unit="" />
        <FlowCard label="ในคลัง (ยังไม่เบิก)" value={totalWH}    color="purple" icon={Package}         sub="รอเบิกให้สมาชิก" unit="" />
        <FlowCard label="อยู่กับสมาชิก"  value={totalWith}  color="amber"  icon={ArrowUpFromLine} sub="รอรับคืน" unit="" />
        <FlowCard label="สต้อคพร้อมส่ง"  value={totalReady} color="green"  icon={Package}         sub="คืนแล้ว รอส่งโรงงาน" unit="" />
        <FlowCard label="ส่งโรงงานแล้ว"  value={totalShip}  color="gray"   icon={Truck}           sub="ส่งออกรวม" unit="" />
        <FlowCard label="สูญเสีย (waste)" value={totalWaste} color="red"    icon={AlertTriangle}  sub="ของเสียทิ้ง" unit="" />
      </div>

      {/* Flow equation visual */}
      <div className="card p-4">
        <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">สมการ Check & Balance</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-bold">{fmt(totalRecv)} รับเข้า</span>
          <span className="text-gray-400">=</span>
          <span className="bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg">{fmt(totalWH)} ในคลัง</span>
          <span className="text-gray-400">+</span>
          <span className="bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg">{fmt(totalWith)} กับสมาชิก</span>
          <span className="text-gray-400">+</span>
          <span className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg">{fmt(totalReady)} พร้อมส่ง</span>
          <span className="text-gray-400">+</span>
          <span className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg">{fmt(totalShip)} ส่งออกแล้ว</span>
          <span className="text-gray-400">+</span>
          <span className="bg-red-100 text-red-700 px-3 py-1.5 rounded-lg">{fmt(totalWaste)} waste</span>
        </div>
      </div>

      {/* Per-product table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
          <BarChart3 size={15} className="text-gray-500" />
          <span className="font-semibold text-gray-700 text-sm">รายละเอียดแยกตามสินค้า</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="border-b bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">สินค้า</th>
                <th className="px-3 py-3 text-right font-medium text-blue-600">รับเข้า</th>
                <th className="px-3 py-3 text-right font-medium text-purple-600">ในคลัง</th>
                <th className="px-3 py-3 text-right font-medium text-amber-600">กับสมาชิก</th>
                <th className="px-3 py-3 text-right font-medium">คืนดี</th>
                <th className="px-3 py-3 text-right font-medium">คืนเสีย</th>
                <th className="px-3 py-3 text-right font-medium text-red-500">สูญเสีย</th>
                <th className="px-3 py-3 text-right font-medium text-green-600">พร้อมส่ง</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">ส่งออกแล้ว</th>
                <th className="px-3 py-3 text-center font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className={`border-b hover:bg-gray-50 ${!p.ok ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-400">{p.code}</span>{' '}
                    <span className="font-medium text-gray-800">{p.name}</span>
                    <span className="text-xs text-gray-400 ml-1">({p.unit})</span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-blue-700">{fmt(p.received)}</td>
                  <td className="px-3 py-3 text-right text-purple-600">{fmt(p.in_warehouse)}</td>
                  <td className="px-3 py-3 text-right font-medium text-amber-600">{fmt(p.with_members)}</td>
                  <td className="px-3 py-3 text-right text-green-600">{fmt(p.ret_good)}</td>
                  <td className="px-3 py-3 text-right text-orange-500">{fmt(p.ret_defect)}</td>
                  <td className="px-3 py-3 text-right text-red-500">{fmt(p.ret_waste)}</td>
                  <td className="px-3 py-3 text-right font-bold text-green-700">{fmt(p.stock_ready)}</td>
                  <td className="px-3 py-3 text-right text-gray-500">{fmt(p.shipped)}</td>
                  <td className="px-3 py-3 text-center">
                    {p.ok
                      ? <CheckCircle2 size={16} className="text-green-500 mx-auto" />
                      : <AlertTriangle size={16} className="text-red-500 mx-auto" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Tab 2: Incoming history ─────────────────────────────── */
function IncomingTab({ incoming }: { incoming: any[] }) {
  // Group by date
  const byDate: Record<string, any[]> = {};
  for (const r of incoming) {
    const d = r.received_at;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  }
  const dates = Object.keys(byDate).sort().reverse();

  if (incoming.length === 0) return (
    <div className="py-12 text-center text-gray-400">
      <ArrowDownToLine size={32} className="mx-auto mb-2 opacity-30" />
      <p>ยังไม่มีประวัติการรับของจากโรงงาน</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {dates.map(date => (
        <div key={date} className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
            <ArrowDownToLine size={14} className="text-blue-600" />
            <span className="font-semibold text-blue-800 text-sm">{date}</span>
            <span className="ml-auto text-xs text-blue-600">
              {byDate[date].length} รายการ | รวม {fmt(byDate[date].reduce((s, r) => s + r.quantity, 0))} หน่วย
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {byDate[date].map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                  <td className="px-4 py-2.5 text-gray-700 font-medium">{r.product_name}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{r.factory_ref ? `Ref: ${r.factory_ref}` : ''}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-blue-700">{fmt(r.quantity)} {r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ─── Record Shipment Modal ───────────────────────────────── */
function ShipmentModal({ products, onClose }: { products: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, control, formState, setValue, getValues } = useForm<any>({
    defaultValues: {
      shipped_at: new Date().toISOString().split('T')[0],
      notes: '',
      items: products.map(p => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        max_good: p.ret_good > 0 ? p.ret_good : 0,
        max_total: p.stock_ready,
        good_qty: 0,
        defect_qty: 0,
      }))
    }
  });
  const { fields } = useFieldArray({ control, name: 'items' });
  const [err, setErr] = useState('');
  const [ocrState, setOcrState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [ocrMsg, setOcrMsg] = useState('');

  const handleOcr = async (files: File[]) => {
    setOcrState('loading'); setOcrMsg('');
    try {
      const { extracted } = await ocrApi.readShipment(files);
      if (extracted.shipped_at) setValue('shipped_at', extracted.shipped_at);
      if (extracted.po_number) setValue('notes', `PO/Part: ${extracted.po_number}`);
      const current = getValues('items') as any[];
      const unmatched: string[] = [];
      let matched = 0;
      for (const it of (extracted.items || [])) {
        const prod = matchProduct(products, it, extracted.po_number);
        const idx = prod ? current.findIndex((f: any) => String(f.product_id) === String(prod.id)) : -1;
        if (idx >= 0) { setValue(`items.${idx}.good_qty`, Number(it.quantity) || 0); matched++; }
        else unmatched.push(`${it.name}=${it.quantity}`);
      }
      setOcrState('done');
      setOcrMsg(
        `อ่านสำเร็จ — เติมจำนวนให้ ${matched} รายการ` +
        (unmatched.length ? ` · ไม่พบในสต็อก: ${unmatched.join(', ')}` : '') +
        ' (ตรวจทานก่อนบันทึก)'
      );
    } catch (e: any) {
      setOcrState('error');
      setOcrMsg(e.response?.data?.error || 'อ่านไม่สำเร็จ');
    }
  };

  const createMut = useMutation({
    mutationFn: shipmentApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-flow'] });
      qc.invalidateQueries({ queryKey: ['shipments'] });
      onClose();
    },
    onError: (e: any) => setErr(e.response?.data?.error ?? 'เกิดข้อผิดพลาด')
  });

  const onSubmit = (vals: any) => {
    setErr('');
    // ตรวจสอบรายการที่ส่งเกินสต็อกพร้อมส่ง (หรือไม่มีของในสต็อกพร้อมส่ง)
    const over = (vals.items || []).filter((it: any) => {
      const q = (Number(it.good_qty) || 0) + (Number(it.defect_qty) || 0);
      return q > 0 && q > (Number(it.max_total) || 0);
    });
    if (over.length) {
      const lines = over.map((it: any) => {
        const q = (Number(it.good_qty) || 0) + (Number(it.defect_qty) || 0);
        const ready = Number(it.max_total) || 0;
        return `• ${it.product_name}: ส่ง ${fmt(q)} ${it.unit || ''} (สต็อกพร้อมส่งมี ${fmt(ready)})`;
      }).join('\n');
      const ok = window.confirm(
        `⚠️ ไม่มีของในสต็อกพร้อมส่ง / จำนวนส่งเกินสต็อกพร้อมส่ง:\n\n${lines}\n\nยืนยันจะทำรายการส่งออกหรือไม่?`
      );
      if (!ok) return;
    }
    createMut.mutate(vals);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-gray-600" />
            <h3 className="font-semibold text-gray-800">บันทึกส่งของคืนโรงงาน</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            {/* OCR — อ่านจากใบส่งสินค้า */}
            <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 p-3">
              <div className="flex items-center gap-2 text-indigo-700 mb-2">
                <ScanLine size={16} />
                <span className="text-sm font-semibold">อ่านจากใบส่งสินค้า (รูป / PDF)</span>
                <span className="ml-auto text-xs text-indigo-500">AI อ่านจำนวนให้อัตโนมัติ</span>
              </div>
              {ocrState !== 'loading' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2 rounded-lg cursor-pointer">
                    <Upload size={15} /> แนบรูป/PDF (หลายไฟล์ได้)
                    <input type="file" accept="image/*,application/pdf,.pdf" multiple className="hidden"
                      onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) handleOcr(fs); e.target.value = ''; }} />
                  </label>
                  <label className="inline-flex items-center gap-1.5 bg-white border border-indigo-300 text-indigo-700 text-sm font-medium px-3 py-2 rounded-lg cursor-pointer">
                    <FileText size={15} /> ถ่ายรูป
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                      onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) handleOcr(fs); e.target.value = ''; }} />
                  </label>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-indigo-700 text-sm"><Loader2 size={16} className="animate-spin" /> AI กำลังอ่านใบส่งสินค้า...</div>
              )}
              {ocrMsg && (
                <p className={`text-xs mt-2 flex items-start gap-1 ${ocrState === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                  {ocrState === 'error' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle size={13} className="mt-0.5 shrink-0" />}
                  <span>{ocrMsg}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">วันที่ส่ง *</label>
                <input type="date" className="input" {...register('shipped_at', { required: true })} />
              </div>
              <div>
                <label className="label">หมายเหตุ</label>
                <input className="input" placeholder="เลขที่ใบส่ง, รถ, ผู้รับ..." {...register('notes')} />
              </div>
            </div>

            <div>
              <p className="label mb-2">รายการสินค้า (ระบุจำนวนที่ส่ง)</p>
              {fields.length === 0 && (
                <div className="py-6 text-center text-gray-400 border rounded-lg">
                  ไม่มีสต้อคพร้อมส่ง
                </div>
              )}
              <div className="space-y-2">
                {fields.map((f: any, i: number) => (
                  <div key={f.id} className="border rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-800 text-sm">{f.product_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${f.max_total > 0 ? 'text-green-700 bg-green-100' : 'text-amber-700 bg-amber-100'}`}>
                        สต้อคพร้อมส่ง {fmt(f.max_total)} {f.unit}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label text-xs">งานดี (หน่วย)</label>
                        <input type="number" min="0" step="1" className="input text-sm"
                          {...register(`items.${i}.good_qty`, { valueAsNumber: true, min: 0 })} />
                      </div>
                      <div>
                        <label className="label text-xs">งานเสีย (หน่วย)</label>
                        <input type="number" min="0" step="1" className="input text-sm"
                          {...register(`items.${i}.defect_qty`, { valueAsNumber: true, min: 0 })} />
                      </div>
                    </div>
                    <input type="hidden" {...register(`items.${i}.product_id`)} value={f.product_id} />
                  </div>
                ))}
              </div>
            </div>
            {err && <p className="text-red-500 text-sm">{err}</p>}
          </div>
          <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
            <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="btn-primary flex items-center gap-2" disabled={createMut.isPending}>
              {createMut.isPending ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</> : <><Truck size={14} /> บันทึกการส่งออก</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Edit Shipment Modal ─────────────────────────────────── */
function EditShipmentModal({ shipment, onClose }: { shipment: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [shippedAt, setShippedAt] = useState(shipment.shipped_at);
  const [notes, setNotes] = useState(shipment.notes || '');
  const [items, setItems] = useState<any[]>(shipment.items.map((it: any) => ({ ...it })));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const upd = (i: number, field: string, val: string) =>
    setItems(arr => arr.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await shipmentApi.update(shipment.id, {
        shipped_at: shippedAt, notes,
        items: items.map(it => ({
          product_id: it.product_id,
          good_qty: Number(it.good_qty) || 0,
          defect_qty: Number(it.defect_qty) || 0,
          received_qty: (it.received_qty === '' || it.received_qty == null) ? null : Number(it.received_qty),
        })),
      });
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['stock-flow'] });
      onClose();
    } catch (e: any) { setErr(e.response?.data?.error ?? 'เกิดข้อผิดพลาด'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-800">แก้ไขการส่งออก {shipment.code}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">วันที่ส่ง *</label>
              <input type="date" className="input" value={shippedAt} onChange={e => setShippedAt(e.target.value)} />
            </div>
            <div>
              <label className="label">หมายเหตุ</label>
              <input className="input" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="label mb-0">รายการสินค้า</p>
            {items.map((it, i) => (
              {(() => {
                const recv = it.received_qty === '' || it.received_qty == null ? null : Number(it.received_qty);
                const diff = recv == null ? null : recv - (Number(it.good_qty) || 0);
                return (
                  <div key={i} className="border rounded-lg p-3 bg-gray-50">
                    <p className="font-medium text-gray-800 text-sm mb-2">{it.product_name} <span className="text-xs text-gray-400">({it.unit})</span></p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label text-xs">งานดี (ส่งไป)</label>
                        <input type="number" min="0" step="1" className="input text-sm" value={it.good_qty} onChange={e => upd(i, 'good_qty', e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-xs">งานเสีย</label>
                        <input type="number" min="0" step="1" className="input text-sm" value={it.defect_qty} onChange={e => upd(i, 'defect_qty', e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <label className="label text-xs flex items-center gap-1">ยอดโรงงานรับจริง <span className="text-gray-400">(จากใบเซ็นรับ — ใช้คิดเงิน)</span></label>
                      <input type="number" min="0" step="1" placeholder="ยังไม่ยืนยัน — ปล่อยว่างไว้ได้"
                        className={`input text-sm ${diff != null && diff !== 0 ? 'border-rose-400 bg-rose-50' : ''}`}
                        value={it.received_qty ?? ''} onChange={e => upd(i, 'received_qty', e.target.value)} />
                      {diff != null && diff !== 0 && (
                        <p className="text-xs text-rose-600 mt-1">⚠️ ต่างจากที่ส่ง {diff > 0 ? '+' : ''}{diff} {it.unit} — ระบบจะคิดเงินจากยอดรับจริง</p>
                      )}
                      {diff === 0 && <p className="text-xs text-green-600 mt-1">✓ ตรงกับที่ส่ง</p>}
                    </div>
                  </div>
                );
              })()}
            ))}
          </div>
          {err && <p className="text-red-500 text-sm">{err}</p>}
        </div>
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Tab 3: Stock + Outgoing ─────────────────────────────── */
export function StockOutgoingTab({ products }: { products: any[] }) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editShip, setEditShip] = useState<any>(null);
  const readyProducts = products.filter(p => p.stock_ready > 0);

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['shipments'],
    queryFn: () => shipmentApi.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => shipmentApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['stock-flow'] });
    }
  });

  return (
    <div className="space-y-4">
      {/* Current stock ready */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b bg-green-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={15} className="text-green-600" />
            <span className="font-semibold text-green-800 text-sm">สต้อคพร้อมส่งโรงงาน (ปัจจุบัน)</span>
          </div>
          <button className="btn-primary flex items-center gap-2 text-xs py-1.5" onClick={() => setShowModal(true)}>
            <Truck size={13} /> บันทึกส่งออก
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">สินค้า</th>
              <th className="px-4 py-2.5 text-right font-medium text-green-600">คืนดี</th>
              <th className="px-4 py-2.5 text-right font-medium text-orange-500">คืนเสีย</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-500">ส่งออกแล้ว</th>
              <th className="px-4 py-2.5 text-right font-medium text-green-700">สต้อคพร้อมส่ง</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  <span className="inline-flex items-center gap-2">
                    {p.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                    <span><span className="font-mono text-xs text-gray-400 mr-1">{p.code}</span>{p.name}<span className="text-xs text-gray-400 ml-1">({p.unit})</span></span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-green-600">{fmt(p.ret_good)}</td>
                <td className="px-4 py-2.5 text-right text-orange-500">{fmt(p.ret_defect)}</td>
                <td className="px-4 py-2.5 text-right text-gray-400">{fmt(p.shipped)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`font-bold text-lg ${p.stock_ready > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                    {fmt(p.stock_ready)}
                  </span>
                </td>
              </tr>
            ))}
            <tr className="bg-green-50 border-t font-semibold">
              <td className="px-4 py-2.5 text-green-800">รวม</td>
              <td className="px-4 py-2.5 text-right text-green-700">{fmt(products.reduce((s, p) => s + p.ret_good, 0))}</td>
              <td className="px-4 py-2.5 text-right text-orange-600">{fmt(products.reduce((s, p) => s + p.ret_defect, 0))}</td>
              <td className="px-4 py-2.5 text-right text-gray-500">{fmt(products.reduce((s, p) => s + p.shipped, 0))}</td>
              <td className="px-4 py-2.5 text-right text-green-800 text-lg">{fmt(products.reduce((s, p) => s + p.stock_ready, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Shipment history — single table */}
      <div>
        <h3 className="font-semibold text-gray-700 text-sm flex items-center gap-2 mb-3">
          <Truck size={15} className="text-gray-500" /> ประวัติการส่งออก
        </h3>
        {isLoading && <div className="py-8 text-center text-gray-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>}
        {!isLoading && (shipments as any[]).length === 0 && (
          <div className="py-10 text-center text-gray-400 border rounded-xl">
            <Truck size={32} className="mx-auto mb-2 opacity-30" />
            <p>ยังไม่มีประวัติการส่งออก — กดปุ่ม "บันทึกส่งออก" เพื่อเพิ่ม</p>
          </div>
        )}
        {!isLoading && (shipments as any[]).length > 0 && (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 border-b text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">วันที่ส่ง</th>
                  <th className="px-4 py-3 text-left font-medium">เลขที่</th>
                  <th className="px-4 py-3 text-left font-medium">สินค้า</th>
                  <th className="px-4 py-3 text-right font-medium text-green-600">งานดี (ส่งไป)</th>
                  <th className="px-4 py-3 text-right font-medium text-blue-600">รับจริง</th>
                  <th className="px-4 py-3 text-right font-medium text-orange-500">งานเสีย</th>
                  <th className="px-4 py-3 text-right font-medium">รวม</th>
                  <th className="px-4 py-3 text-left font-medium">หมายเหตุ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(shipments as any[]).flatMap((sh: any) =>
                  (sh.items.length ? sh.items : [{}]).map((it: any, i: number) => (
                    <tr key={`${sh.id}-${i}`} className={`hover:bg-gray-50 ${i === 0 ? 'border-t border-gray-100' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-600">{i === 0 ? sh.shipped_at : ''}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600 font-semibold">{i === 0 ? sh.code : ''}</td>
                      <td className="px-4 py-2.5 text-gray-700">
                        {it.product_name ? (
                          <span className="inline-flex items-center gap-2">
                            {it.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: it.color }} />}
                            {it.product_name}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-green-700 font-medium">{it.good_qty != null ? fmt(it.good_qty) : '-'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {!it.product_name ? '-' : it.received_qty == null
                          ? <span className="text-amber-500 text-xs">รอยืนยัน</span>
                          : <span className={Number(it.received_qty) !== Number(it.good_qty) ? 'text-rose-600 font-semibold' : 'text-blue-700'}>{fmt(it.received_qty)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-orange-500">{it.defect_qty ? fmt(it.defect_qty) : '-'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{it.product_name ? `${fmt((it.good_qty || 0) + (it.defect_qty || 0))} ${it.unit || ''}` : '-'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{i === 0 ? (sh.notes || '') : ''}</td>
                      <td className="px-4 py-2.5">
                        {i === 0 && (
                          <div className="flex items-center gap-2">
                            <button className="text-gray-300 hover:text-amber-500 transition-colors" title="แก้ไข"
                              onClick={() => setEditShip(sh)}>
                              <Edit2 size={14} />
                            </button>
                            <button className="text-gray-300 hover:text-red-500 transition-colors" title="ลบ"
                              onClick={() => { if (confirm(`ลบรายการส่งออก ${sh.code}?`)) deleteMut.mutate(sh.id); }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="bg-gray-50 border-t font-semibold text-gray-700">
                  <td className="px-4 py-2.5" colSpan={5}>รวมส่งออกทั้งหมด</td>
                  <td className="px-4 py-2.5 text-right">{fmt((shipments as any[]).reduce((s: number, sh: any) => s + sh.total_qty, 0))} หน่วย</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && <ShipmentModal products={readyProducts.length > 0 ? readyProducts : products} onClose={() => setShowModal(false)} />}
      {editShip && <EditShipmentModal shipment={editShip} onClose={() => setEditShip(null)} />}
    </div>
  );
}

/* ─── Tab 4: With Members breakdown ──────────────────────── */
function WithMembersTab() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['outstanding'],
    queryFn: reportApi.outstanding,
  });

  const today = new Date().toISOString().split('T')[0];
  const pending = (data as any[]).filter(r => r.remaining > 0);
  const overdue = pending.filter(r => r.due_date && r.due_date < today);
  const totalUnits = pending.reduce((s: number, r: any) => s + r.remaining, 0);

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm">
          <span className="text-amber-600">รายการค้าง: </span>
          <strong className="text-amber-800">{pending.length} ใบ</strong>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm">
          <span className="text-amber-600">คงเหลือรวม: </span>
          <strong className="text-amber-800">{fmt(totalUnits)} หน่วย</strong>
        </div>
        {overdue.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-2 text-sm">
            <span className="text-red-600">เกินกำหนด: </span>
            <strong className="text-red-700">{overdue.length} รายการ ⚠️</strong>
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">ใบเบิก</th>
              <th className="px-4 py-3 text-left font-medium">สมาชิก</th>
              <th className="px-4 py-3 text-left font-medium">สินค้า</th>
              <th className="px-4 py-3 text-left font-medium">วันเบิก</th>
              <th className="px-4 py-3 text-left font-medium">กำหนดคืน</th>
              <th className="px-4 py-3 text-right font-medium">เบิก</th>
              <th className="px-4 py-3 text-right font-medium text-amber-600">ค้างอยู่</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="py-8 text-center text-gray-400"><Loader2 size={18} className="animate-spin mx-auto" /></td></tr>}
            {!isLoading && pending.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-gray-400">ไม่มีงานค้างอยู่กับสมาชิก</td></tr>}
            {pending.map((r: any) => {
              const isOv = r.due_date && r.due_date < today;
              return (
                <tr key={r.id} className={`border-b hover:bg-gray-50 ${isOv ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{r.code}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-400">{r.member_code}</span>{' '}
                    <span className="font-medium">{r.member_name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.product_name}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{r.issued_at}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.due_date
                      ? <span className={isOv ? 'text-red-600 font-semibold' : 'text-gray-500'}>{r.due_date}{isOv ? ' ⚠️' : ''}</span>
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{fmt(r.quantity)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{fmt(r.remaining)} {r.unit}</td>
                  <td className="px-4 py-3 text-center">
                    {isOv
                      ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">เกินกำหนด</span>
                      : <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">ค้างอยู่</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────── */
export default function StockFlow() {
  const [tab, setTab] = useState<'balance' | 'incoming' | 'stock' | 'members'>('balance');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['stock-flow', 'all'],
    queryFn: () => reportApi.stockFlow(),
  });

  const products: any[] = data?.products || [];
  const incoming: any[] = data?.incoming || [];

  const tabs = [
    { key: 'balance',  label: 'Check & Balance',       icon: CheckCircle2 },
    { key: 'incoming', label: 'รับเข้า (Incoming)',     icon: ArrowDownToLine },
    { key: 'stock',    label: 'สต้อค & ส่งออก',         icon: Truck },
    { key: 'members',  label: 'อยู่กับสมาชิก',          icon: ArrowUpFromLine },
  ] as const;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={22} className="text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">ภาพรวมสต้อค & Check Balance</h1>
        </div>
        <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> รีเฟรช
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="py-16 text-center text-gray-400">
          <Loader2 size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {!isLoading && (
        <>
          {tab === 'balance'  && <CheckBalance />}
          {tab === 'incoming' && <IncomingTab incoming={incoming} />}
          {tab === 'stock'    && <StockOutgoingTab products={products} />}
          {tab === 'members'  && <WithMembersTab />}
        </>
      )}
    </div>
  );
}

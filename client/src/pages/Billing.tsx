import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '../api';
import { FileText, Download, Loader2, Plus, Trash2, Save, Pencil, Receipt, BadgeCheck, X } from 'lucide-react';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthLabel = (m: string) => { if (!m) return ''; const [y, mo] = m.split('-'); return `${TH[+mo - 1]} ${y}`; };

interface Line { project: string; part_number: string; description: string; quantity: number; unit: string; price: number; deliveryDate: string; }

export default function Billing() {
  const [month, setMonth] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState({ name: '', code: 'TM013', address: '', contact: '', tel: '' });
  const [whtRate, setWhtRate] = useState(0.03);
  const [savedMsg, setSavedMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [invXlsx, setInvXlsx] = useState(false);
  const [invPdf, setInvPdf] = useState(false);
  const [rcptPdf, setRcptPdf] = useState(false);
  const [showSupplier, setShowSupplier] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['billing', month || 'none'], queryFn: () => reportApi.billing(month || undefined) });
  const { data: base } = useQuery({ queryKey: ['billing-base'], queryFn: () => reportApi.billing() });

  useEffect(() => {
    if (data) {
      setWhtRate(data.wht_rate ?? 0.03);
      if (data.supplier) setSupplier(s => ({ ...s, ...data.supplier }));
      setLines((data.lines || []).map((l: any) => ({
        project: l.project || '', part_number: l.part_number || '', description: l.description || '',
        quantity: l.quantity || 0, unit: l.unit || 'EA', price: l.price || 0,
        deliveryDate: (l.shipped_at || '').slice(0, 10),
      })));
    }
  }, [data]);

  const months: string[] = base?.months || data?.months || [];

  const updLine = (i: number, f: keyof Line, v: any) => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, [f]: v } : x));
  const addLine = () => setLines(ls => [...ls, { project: '', part_number: '', description: '', quantity: 0, unit: 'EA', price: 0, deliveryDate: month ? `${month}-01` : '' }]);
  const delLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  const calc = lines.map(l => { const amount = l.quantity * l.price; const wht = amount * whtRate; return { ...l, amount, wht, net: amount - wht }; });
  const totQty = calc.reduce((s, l) => s + l.quantity, 0);
  const totAmount = calc.reduce((s, l) => s + l.amount, 0);
  const totWht = calc.reduce((s, l) => s + l.wht, 0);
  const totNet = totAmount - totWht;

  const saveSupplier = async () => {
    await reportApi.saveSettings({
      bill_vender_name: supplier.name, bill_vender_code: supplier.code,
      bill_vender_address: supplier.address, bill_contact: supplier.contact, bill_tel: supplier.tel,
    });
    setSavedMsg('บันทึกข้อมูลผู้วางบิลแล้ว'); setTimeout(() => setSavedMsg(''), 2000);
  };

  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const exportXLSX = async () => {
    setExporting(true);
    try {
      const blob = await reportApi.billingExport({ month, wht_rate: whtRate, supplier, lines });
      download(blob, `ใบวางบิล-${monthLabel(month)}.xlsx`);
    } catch (e) {
      alert('สร้างไฟล์ Excel ไม่สำเร็จ');
    } finally { setExporting(false); }
  };

  const exportPDF = async () => {
    setExportingPdf(true);
    try {
      const blob = await reportApi.billingExport({ month, wht_rate: whtRate, supplier, lines }, 'pdf');
      download(blob, `ใบวางบิล-${monthLabel(month)}.pdf`);
    } catch (e) {
      alert('สร้างไฟล์ PDF ไม่สำเร็จ');
    } finally { setExportingPdf(false); }
  };

  const exportInvoice = async (format?: 'pdf') => {
    if (format === 'pdf') setInvPdf(true); else setInvXlsx(true);
    try {
      const blob = await reportApi.invoiceExport({ month }, format);
      download(blob, `ใบแจ้งหนี้-${monthLabel(month)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (e) {
      alert('สร้างใบแจ้งหนี้ไม่สำเร็จ');
    } finally { if (format === 'pdf') setInvPdf(false); else setInvXlsx(false); }
  };

  const exportReceipt = async () => {
    setRcptPdf(true);
    try {
      const blob = await reportApi.receiptExport({ month }, 'pdf');
      download(blob, `ใบเสร็จรับเงิน-${monthLabel(month)}.pdf`);
    } catch (e) {
      alert('สร้างใบเสร็จรับเงินไม่สำเร็จ');
    } finally { setRcptPdf(false); }
  };


  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-center gap-2">
        <FileText size={20} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">ใบแจ้งหนี้ / วางบิล</h1>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">เดือน</label>
            <select className="input w-48" value={month} onChange={e => setMonth(e.target.value)}>
              <option value="">— เลือกเดือน —</option>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <button className="btn-secondary btn-sm flex items-center gap-2" onClick={() => setShowSupplier(true)}>
            <Pencil size={14} /> ข้อมูลผู้วางบิล / ซัพพลายเออร์
          </button>
        </div>

        {month && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* ── ใบวางบิล ── */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-2">
              <div className="font-semibold text-gray-800 flex items-center gap-2"><FileText size={16} className="text-blue-600" /> ใบวางบิล (Billing Note)</div>
              <p className="text-xs text-gray-500 leading-relaxed">
                เอกสาร<b>วางบิลเรียกเก็บเงิน</b> — แสดง<b>ทุกครั้งที่ส่งของ</b>ในเดือน (1 บรรทัดต่อการส่ง 1 ครั้ง) พร้อมวันที่จัดส่งแต่ละครั้ง ใช้ยื่นวางบิลกับโรงงาน
              </p>
              <div className="flex gap-2 pt-1">
                <button className="btn-secondary btn-sm flex items-center gap-2" onClick={exportXLSX} disabled={exporting}>
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Excel
                </button>
                <button className="btn-primary btn-sm flex items-center gap-2" onClick={exportPDF} disabled={exportingPdf}>
                  {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
                </button>
              </div>
            </div>

            {/* ── ใบแจ้งหนี้ ── */}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-2">
              <div className="font-semibold text-gray-800 flex items-center gap-2"><Receipt size={16} className="text-emerald-600" /> ใบแจ้งหนี้ (Invoice)</div>
              <p className="text-xs text-gray-500 leading-relaxed">
                ใบแจ้งหนี้/ใบส่งสินค้าถึงลูกค้า — <b>รวมยอดทั้งเดือนต่อสินค้า</b> (1 บรรทัดต่อรุ่น) คิดยอดรวม หัก ณ ที่จ่าย 3% และยอดสุทธิ
              </p>
              <div className="flex gap-2 pt-1">
                <button className="btn-secondary btn-sm flex items-center gap-2" onClick={() => exportInvoice()} disabled={invXlsx}>
                  {invXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Excel
                </button>
                <button className="btn-primary btn-sm flex items-center gap-2" onClick={() => exportInvoice('pdf')} disabled={invPdf}>
                  {invPdf ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />} PDF
                </button>
              </div>
            </div>

            {/* ── ใบเสร็จรับเงิน ── */}
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4 space-y-2">
              <div className="font-semibold text-gray-800 flex items-center gap-2"><BadgeCheck size={16} className="text-amber-600" /> ใบเสร็จรับเงิน (Receipt)</div>
              <p className="text-xs text-gray-500 leading-relaxed">
                ใบเสร็จรับเงินถึงลูกค้า — <b>ยอดเดียวกับใบแจ้งหนี้</b> (รวมทั้งเดือนต่อสินค้า) ออกเมื่อได้รับเงินแล้ว
              </p>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary btn-sm flex items-center gap-2" onClick={exportReceipt} disabled={rcptPdf}>
                  {rcptPdf ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />} PDF
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isLoading && month && <div className="py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>}

      {month && !isLoading && (
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <span className="font-semibold text-gray-700 text-sm">รายการวางบิล — {monthLabel(month)}</span>
            <button className="ml-auto btn-secondary btn-sm flex items-center gap-1" onClick={addLine}><Plus size={14} /> เพิ่มแถว</button>
          </div>
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-gray-50 border-b text-xs text-gray-500">
              <tr>
                <th className="px-2 py-2 font-medium">No.</th>
                <th className="px-2 py-2 font-medium text-left">Part No.</th>
                <th className="px-2 py-2 font-medium text-left">ชื่อสินค้า</th>
                <th className="px-2 py-2 font-medium text-right">จำนวน</th>
                <th className="px-2 py-2 font-medium text-center">วันที่จัดส่ง</th>
                <th className="px-2 py-2 font-medium text-right">ราคา/หน่วย</th>
                <th className="px-2 py-2 font-medium text-right">จำนวนเงิน</th>
                <th className="px-2 py-2 font-medium text-right">หัก ณ ที่จ่าย</th>
                <th className="px-2 py-2 font-medium text-right">สุทธิ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {calc.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-gray-400">ไม่มีงานส่งออกในเดือนนี้ — กด "เพิ่มแถว" เพื่อกรอกเอง</td></tr>}
              {calc.map((l, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-2 py-1 text-center text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1"><input className="input !min-h-[36px] !py-1 !px-2 text-xs w-28" value={l.part_number} onChange={e => updLine(i, 'part_number', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="input !min-h-[36px] !py-1 !px-2 text-xs min-w-[140px]" value={l.description} onChange={e => updLine(i, 'description', e.target.value)} /></td>
                  <td className="px-2 py-1"><input type="number" className="input !min-h-[36px] !py-1 !px-2 text-xs w-20 text-right" value={l.quantity} onChange={e => updLine(i, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                  <td className="px-2 py-1"><input type="date" className="input !min-h-[36px] !py-1 !px-2 text-xs w-36" value={l.deliveryDate} onChange={e => updLine(i, 'deliveryDate', e.target.value)} /></td>
                  <td className="px-2 py-1"><input type="number" step="0.0001" className="input !min-h-[36px] !py-1 !px-2 text-xs w-24 text-right" value={l.price} onChange={e => updLine(i, 'price', parseFloat(e.target.value) || 0)} /></td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(l.amount)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-rose-500">{fmt(l.wht)}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium text-green-700">{fmt(l.net)}</td>
                  <td className="px-2 py-1"><button className="text-gray-300 hover:text-red-500" onClick={() => delLine(i)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td colSpan={3} className="px-2 py-2 text-right">รวม / Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{totQty.toLocaleString()}</td>
                <td></td><td></td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totAmount)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-rose-600">{fmt(totWht)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-green-800">{fmt(totNet)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div className="px-4 py-3 text-right text-sm font-bold text-gray-800 border-t">
            ยอดเงินสุทธิ: <span className="text-green-700">{fmt(totNet)}</span> บาท
          </div>
        </div>
      )}

      {/* Modal: ข้อมูลผู้วางบิล / ซัพพลายเออร์ */}
      {showSupplier && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSupplier(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b shrink-0">
              <h3 className="font-semibold text-gray-800">ข้อมูลผู้วางบิล / ซัพพลายเออร์</h3>
              <button onClick={() => setShowSupplier(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              <p className="text-xs text-gray-500">ข้อมูลนี้จะแสดงบนหัวใบวางบิล (บันทึกไว้ใช้ซ้ำทุกเดือน)</p>
              <div><label className="label">ชื่อซัพพลายเออร์ (Vendor)</label><input className="input" value={supplier.name} onChange={e => setSupplier({ ...supplier, name: e.target.value })} /></div>
              <div><label className="label">รหัสซัพพลายเออร์ (Code)</label><input className="input" value={supplier.code} onChange={e => setSupplier({ ...supplier, code: e.target.value })} /></div>
              <div><label className="label">ที่อยู่ (Address)</label><input className="input" value={supplier.address} onChange={e => setSupplier({ ...supplier, address: e.target.value })} /></div>
              <div><label className="label">ผู้ติดต่อ (Contact)</label><input className="input" value={supplier.contact} onChange={e => setSupplier({ ...supplier, contact: e.target.value })} /></div>
              <div><label className="label">เบอร์โทร (Tel)</label><input className="input" value={supplier.tel} onChange={e => setSupplier({ ...supplier, tel: e.target.value })} /></div>
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t shrink-0">
              {savedMsg && <span className="text-green-600 text-sm">{savedMsg}</span>}
              <button className="btn-primary btn-sm flex items-center gap-2" onClick={saveSupplier}><Save size={14} /> บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

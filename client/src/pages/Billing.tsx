import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reportApi } from '../api';
import { FileText, Download, Loader2, Plus, Trash2, Save, Pencil, Receipt, BadgeCheck, X } from 'lucide-react';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthLabel = (m: string) => { if (!m) return ''; const [y, mo] = m.split('-'); return `${TH[+mo - 1]} ${y}`; };

interface Line {
  item_id?: number; shipment_code?: string;
  project: string; part_number: string; description: string;
  sent_qty: number;                 // จำนวนที่บันทึกส่ง (จากใบส่งของ)
  received_qty: number | '';        // ยอดที่โรงงานรับจริง ('' = ยังไม่ยืนยัน -> ใช้ sent_qty)
  ng_qty: number | '';               // จำนวนงาน NG ของรายการนี้ (ไม่คิดเงินตามอัตราหัก)
  unit: string; price: number; deliveryDate: string;
}
// ยอดที่ใช้คิดเงิน = รับจริง (ถ้ากรอก) ไม่งั้นใช้จำนวนส่ง
const effQty = (l: Line) => (l.received_qty === '' || l.received_qty == null) ? (l.sent_qty || 0) : Number(l.received_qty);
// จำนวนที่คิดเงินจริง = รับจริง − (NG × อัตราหัก%) — อัตรา 100% = ชิ้น NG ไม่ได้เงินเลย
const billQty = (l: Line, ngRatePct: number) => {
  const ng = (l.ng_qty === '' || l.ng_qty == null) ? 0 : Number(l.ng_qty);
  return Math.max(0, effQty(l) - ng * (ngRatePct / 100));
};

export default function Billing() {
  const [month, setMonth] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState({ name: '', code: 'TM013', address: '', contact: '', tel: '' });
  const [whtRate, setWhtRate] = useState(0.03);
  const [ngRate, setNgRate] = useState(100);   // % อัตราหัก NG (100 = ไม่จ่ายชิ้น NG)
  const [savedMsg, setSavedMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [invXlsx, setInvXlsx] = useState(false);
  const [invPdf, setInvPdf] = useState(false);
  const [rcptPdf, setRcptPdf] = useState(false);
  const [rcptDate, setRcptDate] = useState('');   // วันที่รับเงินในใบเสร็จ (default = 20 เดือนถัดไป)
  const [showSupplier, setShowSupplier] = useState(false);
  const [dirty, setDirty] = useState(false);       // มีการแก้จำนวน/วันที่ที่ยังไม่บันทึกกลับ
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['billing', month || 'none'], queryFn: () => reportApi.billing(month || undefined) });
  const { data: base } = useQuery({ queryKey: ['billing-base'], queryFn: () => reportApi.billing() });

  useEffect(() => {
    if (data) {
      setWhtRate(data.wht_rate ?? 0.03);
      setNgRate(data.ng_rate ?? 100);
      if (data.supplier) setSupplier(s => ({ ...s, ...data.supplier }));
      setLines((data.lines || []).map((l: any) => ({
        item_id: l.item_id, shipment_code: l.shipment_code,
        project: l.project || '', part_number: l.part_number || '', description: l.description || '',
        sent_qty: l.sent_qty ?? l.quantity ?? 0,
        received_qty: (l.received_qty === null || l.received_qty === undefined) ? '' : l.received_qty,
        ng_qty: '',
        unit: l.unit || 'EA', price: l.price || 0,
        deliveryDate: (l.shipped_at || '').slice(0, 10),
      })));
      setDirty(false);
    }
  }, [data]);

  const months: string[] = base?.months || data?.months || [];

  // วันที่รับเงิน default = วันที่ 20 ของเดือนถัดไปจากเดือนที่วางบิล
  const defaultRcptDate = (() => {
    if (!month) return '';
    const [y, mo] = month.split('-').map(Number);
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    return `${ny}-${String(nm).padStart(2, '0')}-20`;
  })();
  useEffect(() => { setRcptDate(defaultRcptDate); }, [month]);
  const rcptDateVal = rcptDate || defaultRcptDate;

  const qc = useQueryClient();
  const updLine = (i: number, f: keyof Line, v: any) => {
    setLines(ls => ls.map((x, idx) => idx === i ? { ...x, [f]: v } : x));
    if (f === 'received_qty' || f === 'deliveryDate') setDirty(true);   // รับจริง/วันที่ sync กลับไปใบส่งของได้
  };
  const addLine = () => setLines(ls => [...ls, { project: '', part_number: '', description: '', sent_qty: 0, received_qty: '', ng_qty: '', unit: 'EA', price: 0, deliveryDate: month ? `${month}-01` : '' }]);
  const delLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  // บันทึกจำนวน/วันที่ที่แก้ กลับไปยังรายการส่งของจริง (ประวัติส่งงานออกโรงงาน)
  const saveSync = async () => {
    const syncable = lines.filter(l => l.item_id);
    if (!syncable.length) { alert('ไม่มีรายการที่เชื่อมกับใบส่งของ (แถวที่เพิ่มเองจะไม่ถูกบันทึกกลับ)'); return; }
    if (!window.confirm(
      'บันทึกจำนวน/วันที่ที่แก้ไข กลับไปยัง "ประวัติส่งงานออกโรงงาน" ?\n\n' +
      '• จำนวน → อัปเดตเป็น "ยอดที่โรงงานรับจริง" ของใบส่งนั้น\n' +
      '• วันที่ → เลื่อนวันที่ของใบส่งนั้น (ทุกรายการในใบเดียวกันจะเลื่อนตาม)\n' +
      '• ใบวางบิล / ใบแจ้งหนี้ / สต๊อค จะใช้ยอดใหม่นี้ทันที'
    )) return;
    setSyncing(true); setSyncMsg('');
    try {
      const r = await reportApi.billingSync(syncable.map(l => ({ item_id: l.item_id, quantity: effQty(l), deliveryDate: l.deliveryDate })));
      setSyncMsg(`บันทึกแล้ว ✓ (จำนวน ${r.updatedQty} รายการ${r.updatedDate ? `, วันที่ ${r.updatedDate} ใบ` : ''})`);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['billing'] });
      qc.invalidateQueries({ queryKey: ['stock-flow'] });
      qc.invalidateQueries({ queryKey: ['shipments'] });
      setTimeout(() => setSyncMsg(''), 4000);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally { setSyncing(false); }
  };

  const calc = lines.map(l => {
    const q = effQty(l);
    const bill = billQty(l, ngRate);                 // จำนวนคิดเงิน (หัก NG แล้ว)
    const amount = bill * l.price;
    const wht = amount * whtRate;
    return { ...l, eff: q, bill, amount, wht, net: amount - wht };
  });
  const totSent = calc.reduce((s, l) => s + (l.sent_qty || 0), 0);
  const totQty = calc.reduce((s, l) => s + l.eff, 0);
  const totNG = calc.reduce((s, l) => s + ((l.ng_qty === '' || l.ng_qty == null) ? 0 : Number(l.ng_qty)), 0);
  const totBill = calc.reduce((s, l) => s + l.bill, 0);

  const saveNgRate = async (v: number) => {
    setNgRate(v);
    try { await reportApi.saveSettings({ bill_ng_rate: v }); } catch {}
  };
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

  // แถวที่ส่งไปทำเอกสาร: จำนวน = จำนวนคิดเงิน (รับจริง − NG×อัตราหัก)
  const exportLines = () => lines.map(l => ({ ...l, quantity: Math.round(billQty(l, ngRate) * 100) / 100 }));

  const exportXLSX = async () => {
    setExporting(true);
    try {
      const blob = await reportApi.billingExport({ month, wht_rate: whtRate, supplier, lines: exportLines() });
      download(blob, `ใบวางบิล-${monthLabel(month)}.xlsx`);
    } catch (e) {
      alert('สร้างไฟล์ Excel ไม่สำเร็จ');
    } finally { setExporting(false); }
  };

  const exportPDF = async () => {
    setExportingPdf(true);
    try {
      const blob = await reportApi.billingExport({ month, wht_rate: whtRate, supplier, lines: exportLines() }, 'pdf');
      download(blob, `ใบวางบิล-${monthLabel(month)}.pdf`);
    } catch (e) {
      alert('สร้างไฟล์ PDF ไม่สำเร็จ');
    } finally { setExportingPdf(false); }
  };

  const exportInvoice = async (format?: 'pdf') => {
    if (format === 'pdf') setInvPdf(true); else setInvXlsx(true);
    try {
      const blob = await reportApi.invoiceExport({ month, lines_override: exportLines() }, format);
      download(blob, `ใบแจ้งหนี้-${monthLabel(month)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (e) {
      alert('สร้างใบแจ้งหนี้ไม่สำเร็จ');
    } finally { if (format === 'pdf') setInvPdf(false); else setInvXlsx(false); }
  };

  const exportReceipt = async () => {
    setRcptPdf(true);
    try {
      const blob = await reportApi.receiptExport({ month, date: rcptDateVal, lines_override: exportLines() }, 'pdf');
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
              <div className="flex items-end gap-2 pt-1 flex-wrap">
                <div>
                  <label className="text-[11px] text-gray-500 block mb-0.5">วันที่รับเงิน</label>
                  <input type="date" className="input !min-h-[34px] !py-1 !px-2 text-xs w-36" value={rcptDateVal} onChange={e => setRcptDate(e.target.value)} />
                </div>
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
            {syncMsg && <span className="text-green-600 text-xs font-medium">{syncMsg}</span>}
            <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-3">
              <span>อัตราหัก NG</span>
              <input type="number" min="0" max="100" step="1"
                className="input !min-h-[30px] !py-0.5 !px-2 text-xs w-16 text-right"
                value={ngRate} onChange={e => saveNgRate(parseFloat(e.target.value) || 0)} />
              <span>% ของราคา/ชิ้น</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                className={`btn-sm flex items-center gap-1.5 ${dirty ? 'btn-primary animate-pulse' : 'btn-primary'}`}
                onClick={saveSync} disabled={syncing}
                title="บันทึกจำนวนรับจริง/วันที่ กลับไปยังประวัติส่งงานออกโรงงาน — สต๊อค ใบแจ้งหนี้ ภาพรวม จะอัปเดตตาม">
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save บันทึก{dirty ? ' (มีแก้ไข)' : ''}
              </button>
              <button className="btn-secondary btn-sm flex items-center gap-1" onClick={addLine}><Plus size={14} /> เพิ่มแถว</button>
            </div>
          </div>
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-gray-50 border-b text-xs text-gray-500">
              <tr>
                <th className="px-2 py-2 font-medium">No.</th>
                <th className="px-2 py-2 font-medium text-left">Part No.</th>
                <th className="px-2 py-2 font-medium text-left">ชื่อสินค้า</th>
                <th className="px-2 py-2 font-medium text-right">จำนวนส่ง</th>
                <th className="px-2 py-2 font-medium text-right text-blue-600">รับจริง</th>
                <th className="px-2 py-2 font-medium text-right text-rose-500">NG</th>
                <th className="px-2 py-2 font-medium text-center">วันที่จัดส่ง</th>
                <th className="px-2 py-2 font-medium text-right">ราคา/หน่วย</th>
                <th className="px-2 py-2 font-medium text-right">จำนวนเงิน</th>
                <th className="px-2 py-2 font-medium text-right">หัก ณ ที่จ่าย</th>
                <th className="px-2 py-2 font-medium text-right">สุทธิ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {calc.length === 0 && <tr><td colSpan={12} className="py-8 text-center text-gray-400">ไม่มีงานส่งออกในเดือนนี้ — กด "เพิ่มแถว" เพื่อกรอกเอง</td></tr>}
              {calc.map((l, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-2 py-1 text-center text-gray-400">
                    {i + 1}
                    {l.shipment_code && <span className="block text-[9px] text-blue-400 font-mono leading-tight">{l.shipment_code}</span>}
                  </td>
                  <td className="px-2 py-1"><input className="input !min-h-[36px] !py-1 !px-2 text-xs w-28" value={l.part_number} onChange={e => updLine(i, 'part_number', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="input !min-h-[36px] !py-1 !px-2 text-xs min-w-[140px]" value={l.description} onChange={e => updLine(i, 'description', e.target.value)} /></td>
                  <td className="px-2 py-1 text-right">
                    {l.item_id
                      ? <span className="tabular-nums text-gray-500">{(l.sent_qty || 0).toLocaleString()}</span>
                      : <input type="number" className="input !min-h-[36px] !py-1 !px-2 text-xs w-20 text-right" value={l.sent_qty} onChange={e => updLine(i, 'sent_qty', parseFloat(e.target.value) || 0)} />}
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" placeholder={String(l.sent_qty || 0)}
                      className={`input !min-h-[36px] !py-1 !px-2 text-xs w-20 text-right ${l.received_qty !== '' && Number(l.received_qty) !== (l.sent_qty || 0) ? '!border-blue-400 !bg-blue-50' : ''}`}
                      value={l.received_qty}
                      onChange={e => updLine(i, 'received_qty', e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min="0" placeholder="0"
                      className={`input !min-h-[36px] !py-1 !px-2 text-xs w-16 text-right ${l.ng_qty !== '' && Number(l.ng_qty) > 0 ? '!border-rose-300 !bg-rose-50 text-rose-700' : ''}`}
                      value={l.ng_qty}
                      onChange={e => updLine(i, 'ng_qty', e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} />
                  </td>
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
                <td className="px-2 py-2 text-right tabular-nums text-gray-500">{totSent.toLocaleString()}</td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700">{totQty.toLocaleString()}</td>
                <td className="px-2 py-2 text-right tabular-nums text-rose-600">{totNG > 0 ? totNG.toLocaleString() : ''}</td>
                <td className="px-2 py-2 text-center text-[10px] text-gray-400">{totNG > 0 ? `คิดเงิน ${totBill.toLocaleString()}` : ''}</td><td></td>
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

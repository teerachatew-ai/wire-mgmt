import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '../api';
import {
  DollarSign, Download, Users, TrendingUp,
  ChevronDown, ChevronUp, Loader2,
  Wallet, Building2, FileText, RotateCcw, Save, X, Eye
} from 'lucide-react';

const fmtQty = (n: number) => Number(n || 0).toLocaleString();

// รายละเอียดรายคน: เบิกงานวันไหน ประเภทไหน กี่เส้น (เดือนที่เลือก)
function MemberBreakdown({ member, month, onClose }: { member: any; month: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['member-history', member.member_id],
    queryFn: () => reportApi.memberHistory(member.member_id),
  });
  const issues = ((data?.issues || []) as any[]).filter(i => String(i.issued_at || '').startsWith(month));
  // สรุปรวมต่อประเภทสินค้า
  const byProduct = Object.values(issues.reduce((a: any, i: any) => {
    const k = i.product_name;
    (a[k] ??= { name: k, qty: 0, good: 0, defect: 0 });
    a[k].qty += Number(i.quantity) || 0;
    a[k].good += Number(i.good_qty) || 0;
    a[k].defect += Number(i.defect_qty) || 0;
    return a;
  }, {})) as any[];
  const totQty = issues.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const totGood = issues.reduce((s, i) => s + (Number(i.good_qty) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-800">{member.member_name}{member.member_nickname && <span className="text-gray-400 font-normal"> ({member.member_nickname})</span>}</h3>
            <p className="text-xs text-gray-500 mt-0.5">รายละเอียดการรับงาน — เดือน {month}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {isLoading ? (
            <div className="py-10 text-center text-gray-400"><Loader2 size={22} className="animate-spin mx-auto" /></div>
          ) : issues.length === 0 ? (
            <div className="py-10 text-center text-gray-400">ไม่มีการเบิกงานในเดือนนี้</div>
          ) : (
            <>
              {/* สรุปต่อประเภท */}
              <div className="flex flex-wrap gap-2">
                {byProduct.map((p: any) => (
                  <span key={p.name} className="bg-blue-50 border border-blue-100 text-blue-800 text-xs px-3 py-1.5 rounded-lg">
                    {p.name}: รับ <b>{fmtQty(p.qty)}</b> · คืนดี <b className="text-green-700">{fmtQty(p.good)}</b>
                  </span>
                ))}
              </div>
              {/* รายการเบิกแต่ละวัน */}
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">วันที่เบิก</th>
                    <th className="px-3 py-2 text-left font-medium">ใบเบิก</th>
                    <th className="px-3 py-2 text-left font-medium">ประเภทงาน</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-600">รับไป (เส้น)</th>
                    <th className="px-3 py-2 text-right font-medium text-green-600">คืนดี</th>
                    <th className="px-3 py-2 text-right font-medium text-rose-500">เสีย</th>
                    <th className="px-3 py-2 text-right font-medium text-amber-600">ค้างคืน</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i: any) => {
                    const rem = (Number(i.quantity) || 0) - (Number(i.good_qty) || 0) - (Number(i.defect_qty) || 0) - (Number(i.waste_qty) || 0);
                    return (
                      <tr key={i.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-700">{String(i.issued_at || '').slice(0, 10)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-blue-600">{i.code}</td>
                        <td className="px-3 py-2 text-gray-700">{i.product_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700">{fmtQty(i.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green-600">{fmtQty(i.good_qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-500">{i.defect_qty > 0 ? fmtQty(i.defect_qty) : '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-600">{rem > 0 ? fmtQty(rem) : '-'}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={3} className="px-3 py-2 text-gray-700">รวม ({issues.length} ครั้ง)</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-800">{fmtQty(totQty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{fmtQty(totGood)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ช่องกรอกค่าตอบแทนผู้บริหารรายเดือน (กำหนดเอง / ใช้อัตโนมัติ)
function MgrCompInput({ mg, month, onSaved }: { mg: any; month: string; onSaved: () => void }) {
  const [val, setVal] = useState<string>(String(Math.round((mg.computed || 0) * 100) / 100));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(String(Math.round((mg.computed || 0) * 100) / 100)); }, [mg.computed, month]);
  const changed = Number(val || 0) !== Math.round((mg.computed || 0) * 100) / 100;
  const save = async () => { setSaving(true); try { await reportApi.setManagerMonth({ month, manager_id: mg.id, amount: val === '' ? null : Number(val) }); onSaved(); } finally { setSaving(false); } };
  const reset = async () => { setSaving(true); try { await reportApi.setManagerMonth({ month, manager_id: mg.id, amount: null }); onSaved(); } finally { setSaving(false); } };
  return (
    <div className="flex items-center justify-end gap-1.5">
      {mg.overridden ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">กำหนดเอง</span>
        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">อัตโนมัติ</span>}
      <input type="number" step="0.01" className="input !min-h-[34px] !py-1 !px-2 text-sm w-28 text-right" value={val} onChange={e => setVal(e.target.value)} />
      {changed && <button className="text-blue-600 hover:text-blue-800" title="บันทึกเดือนนี้" onClick={save} disabled={saving}><Save size={15} /></button>}
      {mg.overridden && !changed && <button className="text-gray-400 hover:text-gray-600" title="กลับไปใช้อัตโนมัติ" onClick={reset} disabled={saving}><RotateCcw size={14} /></button>}
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────── */
const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (m: string) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${names[parseInt(mo) - 1]} ${parseInt(y) + 543}`;
};
function toCSV(rows: any[]) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
}
function downloadCSV(data: string, filename: string) {
  const blob = new Blob(['﻿' + data], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* เปิดหน้าใบเซ็นรับเงิน (พิมพ์เป็น PDF ได้) */
function openPayrollSignSheet(data: any, monthName: string) {
  const members = data.members || [];
  const rows = members.map((m: any, i: number) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${m.member_name}${m.member_nickname ? ` (${m.member_nickname})` : ''}</td>
      <td class="r">${fmt(m.total_wage)}</td>
      <td></td>
      <td></td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet"/>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;font-family:'Sarabun',sans-serif;}
      @page{size:A4;margin:14mm;}
      body{color:#1f2937;font-size:14px;}
      h1{font-size:18px;font-weight:600;}
      .sub{color:#6b7280;font-size:13px;margin:2px 0 14px;}
      table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid #999;padding:8px 10px;font-size:13px;vertical-align:middle;}
      th{background:#f1f3f5;font-weight:600;text-align:left;}
      td.c,th.c{text-align:center;width:42px;}
      td.r,th.r{text-align:right;}
      .sig{width:170px;} .note{width:150px;}
      tr{height:40px;}
      tfoot td{font-weight:600;background:#f8f9fa;}
      .signline{margin-top:36px;display:flex;justify-content:space-between;font-size:13px;}
      .signline div{text-align:center;width:45%;}
      .dot{border-top:1px dotted #555;margin-bottom:5px;height:1px;}
      @media print{.no-print{display:none!important;}}
      @media screen{body{background:#e5e7eb;padding:20px;}.sheet{background:#fff;max-width:210mm;margin:0 auto;padding:14mm;box-shadow:0 2px 12px rgba(0,0,0,.15);}}
    </style></head><body>
    <div class="no-print" style="max-width:210mm;margin:0 auto 12px;display:flex;gap:8px;">
      <button onclick="window.print()" style="background:#2563eb;color:#fff;border:0;padding:8px 18px;border-radius:6px;cursor:pointer;font-family:Sarabun;font-weight:600;">🖨️ พิมพ์ / บันทึก PDF</button>
      <button onclick="window.close()" style="background:#fff;border:1px solid #bbb;padding:8px 18px;border-radius:6px;cursor:pointer;font-family:Sarabun;">ปิด</button>
    </div>
    <div class="sheet">
      <h1>ใบเซ็นรับเงินค่าแรง — รอบจ่าย ${monthName}</h1>
      <p class="sub">วิสาหกิจชุมชนตัดสายไฟ · จำนวนสมาชิก ${members.length} คน · ยอดรวม ${fmt(data.total_wage)} บาท</p>
      <table>
        <thead><tr>
          <th class="c">ลำดับ</th>
          <th>รายชื่อพนักงาน</th>
          <th class="r">จำนวนเงินที่ได้รับ (บาท)</th>
          <th class="sig">ลายเซ็นรับเงิน</th>
          <th class="note">หมายเหตุ</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td class="c"></td><td>รวมทั้งหมด</td><td class="r">${fmt(data.total_wage)}</td><td></td><td></td></tr></tfoot>
      </table>
      <div class="signline">
        <div><div class="dot"></div>ผู้จ่ายเงิน</div>
        <div><div class="dot"></div>ผู้ตรวจสอบ</div>
      </div>
    </div>
    <script>setTimeout(function(){window.print();},700);</script>
  </body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
  if (w) { w.document.write(html); w.document.close(); }
}

/* ─── Summary cards ───────────────────────────────────────── */
function SummaryCards({ data }: { data: any }) {
  const cards = [
    { label: 'รายได้จาก Amphenol', value: data.month_revenue ?? 0, color: 'blue', icon: DollarSign, note: 'เดือนนี้ (ฐานคิดค่าตอบแทน)' },
    { label: 'ค่าแรงสมาชิกรวม', value: data.total_wage, color: 'orange', icon: Building2, note: `${data.members?.length || 0} คน` },
    { label: 'ค่าตอบแทนผู้บริหาร', value: data.total_manager_comp, color: 'purple', icon: Users, note: `% ของรายได้ · ${data.managers?.length || 0} คน` },
    { label: 'จ่ายสุทธิให้สมาชิก', value: data.net_payout, color: 'green', icon: Wallet, note: 'ค่าแรง − กองกลาง' },
  ];
  const colorMap: any = {
    blue: 'bg-blue-50 border-blue-200 text-blue-800 text-blue-600',
    orange: 'bg-orange-50 border-orange-200 text-orange-800 text-orange-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-800 text-purple-600',
    green: 'bg-green-50 border-green-200 text-green-800 text-green-600',
  };
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => {
        const [bg, border, textDark, textLight] = colorMap[c.color].split(' ');
        const Icon = c.icon;
        return (
          <div key={c.label} className={`rounded-xl border p-4 ${bg} ${border}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon size={16} className={textLight} />
              <span className={`text-xs ${textLight}`}>{c.label}</span>
            </div>
            <p className={`text-2xl font-bold ${textDark}`}>{fmt(c.value)}</p>
            <p className={`text-xs mt-0.5 ${textLight}`}>{c.note}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Top 5 สมาชิกที่ได้เงินมากสุดของเดือน ─────────────────── */
function Top5Earners({ members, month, onPick }: { members: any[]; month: string; onPick: (m: any) => void }) {
  const top = [...(members || [])].sort((a, b) => (b.total_wage || 0) - (a.total_wage || 0)).slice(0, 5);
  if (top.length === 0) return null;
  const max = top[0].total_wage || 1;
  const medal = ['🥇', '🥈', '🥉', '4.', '5.'];
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b bg-amber-50 flex items-center gap-2">
        <TrendingUp size={15} className="text-amber-600" />
        <h2 className="font-semibold text-amber-800 text-sm">Top 5 ค่าแรงสูงสุด — {monthLabel(month)}</h2>
      </div>
      <div className="p-4 space-y-2.5">
        {top.map((m: any, i: number) => (
          <button key={m.member_id} type="button" onClick={() => onPick(m)}
            className="w-full flex items-center gap-3 text-left hover:bg-gray-50 rounded-lg px-2 py-1 -mx-2 transition-colors">
            <span className="w-7 text-center text-sm shrink-0">{medal[i]}</span>
            <span className="w-40 shrink-0 truncate text-sm font-medium text-gray-800">
              {m.member_name}{m.member_nickname && <span className="text-gray-400 font-normal"> ({m.member_nickname})</span>}
            </span>
            <span className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <span className="block h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full"
                style={{ width: `${Math.max(6, ((m.total_wage || 0) / max) * 100)}%` }} />
            </span>
            <span className="w-24 text-right text-sm font-bold text-green-700 shrink-0">{fmt(m.total_wage)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Tab 1: รายเดือน ─────────────────────────────────────── */
function MonthlyTab() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [fetching, setFetching] = useState(false);
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [viewMember, setViewMember] = useState<any>(null);   // ดูรายละเอียดการรับงานรายคน

  const load = async () => {
    setFetching(true);
    try { setData(await reportApi.payrollMonthly(month)); }
    finally { setFetching(false); }
  };

  const matchMember = (m: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return m.member_name.toLowerCase().includes(q)
      || (m.member_nickname ?? '').toLowerCase().includes(q)
      || m.member_code.toLowerCase().includes(q);
  };

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="label">รอบจ่าย (เดือน)</label>
          <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={load} disabled={fetching}>
          {fetching ? <><Loader2 size={14} className="animate-spin" /> กำลังคำนวณ...</> : 'คำนวณ'}
        </button>
        {data?.members?.length > 0 && (
          <button className="btn-secondary flex items-center gap-2" onClick={() => {
            const rows = data.members.map((m: any) => ({
              เดือน: data.month, รหัส: m.member_code, ชื่อ: m.member_name,
              ธนาคาร: m.bank_name || '', เลขบัญชี: m.bank_account || '',
              ค่าแรงรวม: m.total_wage.toFixed(2)
            }));
            downloadCSV(toCSV(rows), `payroll-${month}.csv`);
          }}>
            <Download size={14} /> Export CSV
          </button>
        )}
        {data?.members?.length > 0 && (
          <button className="btn-secondary flex items-center gap-2"
            onClick={() => openPayrollSignSheet(data, monthLabel(data.month))}>
            <FileText size={14} /> พิมพ์ใบเซ็นรับเงิน (PDF)
          </button>
        )}
        <p className="w-full text-xs text-gray-400 mt-1">
          แสดงค่าแรงตาม “รอบจ่าย” (จ่ายจริงวันที่ 25 ของเดือนถัดไป) — งานที่รับคืนหลังเส้นตาย (วันทำการก่อนวันสุดท้าย) จะถูกเลื่อนไปรอบเดือนถัดไปโดยอัตโนมัติ
        </p>
      </div>

      {data && (
        <>
          <SummaryCards data={data} />

          <Top5Earners members={data.members || []} month={data.month} onPick={setViewMember} />

          {/* Manager compensation breakdown */}
          {data.managers?.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b bg-purple-50 flex items-center gap-2">
                <Users size={15} className="text-purple-600" />
                <h2 className="font-semibold text-purple-800 text-sm">ค่าตอบแทนผู้บริหาร</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-4 py-2.5 font-medium">ลำดับ</th>
                    <th className="px-4 py-2.5 font-medium">ชื่อ-ตำแหน่ง</th>
                    <th className="px-4 py-2.5 font-medium">รูปแบบ</th>
                    <th className="px-4 py-2.5 font-medium text-right">อัตรา</th>
                    <th className="px-4 py-2.5 font-medium text-right">ค่าตอบแทน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.managers.map((mg: any, i: number) => (
                    <tr key={mg.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-400 text-xs">คนที่ {i + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800">{mg.name}</p>
                        {mg.role && <p className="text-xs text-gray-400">{mg.role}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className={`px-2 py-0.5 rounded-full ${mg.compensation_type === 'percent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {mg.compensation_type === 'percent' ? `% ของรายได้` : 'ตายตัว'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {mg.compensation_type === 'percent' ? `${mg.amount}%` : `${fmt(mg.amount)} บาท`}
                      </td>
                      <td className="px-4 py-2.5"><MgrCompInput mg={mg} month={month} onSaved={load} /></td>
                    </tr>
                  ))}
                  <tr className="bg-purple-50 border-t">
                    <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-purple-800">รวมค่าตอบแทนผู้บริหาร</td>
                    <td className="px-4 py-2.5 text-right font-bold text-purple-800">{fmt(data.total_manager_comp)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Member wages */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-2">
              <DollarSign size={15} className="text-green-600" />
              <h2 className="font-semibold text-gray-700 text-sm">ค่าแรงรายคน เดือน {month}</h2>
              <input
                className="input ml-auto max-w-xs !min-h-[40px] !py-2"
                placeholder="ค้นหาชื่อ-สกุล หรือชื่อเล่น..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="border-b">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">รหัส</th>
                  <th className="px-4 py-3 font-medium">ชื่อ</th>
                  <th className="px-4 py-3 font-medium">ธนาคาร / เลขบัญชี</th>
                  <th className="px-4 py-3 font-medium text-right text-gray-400">NG ตัด (เส้น)</th>
                  <th className="px-4 py-3 font-medium text-right text-rose-500">เกินเกณฑ์ (เส้น)</th>
                  <th className="px-4 py-3 font-medium text-right text-rose-500">ถูกหัก (บาท)</th>
                  <th className="px-4 py-3 font-medium text-right">ค่าแรงสุทธิ (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {data.members.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">ไม่มีข้อมูลในเดือนนี้</td></tr>
                )}
                {data.members.length > 0 && data.members.filter(matchMember).length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">ไม่พบสมาชิกที่ค้นหา</td></tr>
                )}
                {data.members.filter(matchMember).map((m: any) => (
                  <tr key={m.member_id} className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer" onClick={() => setViewMember(m)} title="คลิกดูรายละเอียดการรับงานของเดือนนี้">
                    <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{m.member_code}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <span className="inline-flex items-center gap-1.5">
                        {m.member_name}
                        {m.member_nickname && <span className="text-xs text-gray-400">({m.member_nickname})</span>}
                        <Eye size={13} className="text-gray-300" />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{m.bank_name || '-'}{m.bank_account ? ` / ${m.bank_account}` : ''}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-400">{m.ng_cut_qty > 0 ? m.ng_cut_qty.toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-500 font-medium">{m.ng_excess_qty > 0 ? m.ng_excess_qty.toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-500">{m.ng_deduction > 0 ? `-${fmt(m.ng_deduction)}` : '-'}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-700">{fmt(m.total_wage)}</td>
                  </tr>
                ))}
                {data.members.length > 0 && (
                  <tr className="bg-green-50 border-t font-semibold">
                    <td colSpan={4} className="px-4 py-3 text-green-800">รวมทั้งหมด ({data.members.length} คน){search && ` — แสดง ${data.members.filter(matchMember).length} คน`}</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right text-rose-600">{data.total_ng_deduction > 0 ? `-${fmt(data.total_ng_deduction)}` : '-'}</td>
                    <td className="px-4 py-3 text-right text-green-800">{fmt(data.total_wage)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            {data.total_ng_deduction > 0 && (
              <div className="px-4 py-2.5 text-xs text-gray-500 border-t bg-rose-50/40">
                💡 ค่าปรับงานเสียจากการตัด = 20 บาท/เส้น เฉพาะส่วนที่เกินเกณฑ์ % ยอมรับได้ของแต่ละรุ่น — รวม <strong className="text-rose-600">{fmt(data.total_ng_deduction)}</strong> บาท ถือเป็นรายได้เข้ากลุ่ม
              </div>
            )}
          </div>
        </>
      )}
      {viewMember && <MemberBreakdown member={viewMember} month={month} onClose={() => setViewMember(null)} />}
    </div>
  );
}

/* ─── Tab 2: สะสมรายบุคคล ─────────────────────────────────── */
function CumulativeTab() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-cumulative'],
    queryFn: reportApi.payrollCumulative,
  });

  if (isLoading) return <div className="py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>;

  const allMembers: any[] = data?.members || [];
  const allMonths: string[] = data?.all_months || [];
  const q = search.trim().toLowerCase();
  const members = q
    ? allMembers.filter(m =>
        m.member_name.toLowerCase().includes(q) ||
        (m.member_nickname ?? '').toLowerCase().includes(q) ||
        m.member_code.toLowerCase().includes(q))
    : allMembers;

  const exportCumulative = () => {
    if (!allMembers.length) return;
    const rows: any[] = [];
    for (const m of allMembers) {
      const monthMap = Object.fromEntries(m.months.map((x: any) => [x.month, x.wage]));
      const row: any = { รหัส: m.member_code, ชื่อ: m.member_name };
      for (const mo of allMonths) row[mo] = (monthMap[mo] || 0).toFixed(2);
      row['รวมทั้งหมด'] = m.total_wage.toFixed(2);
      rows.push(row);
    }
    downloadCSV(toCSV(rows), `payroll-cumulative.csv`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <p className="text-sm text-gray-500">ยอดสะสมตั้งแต่เริ่มต้น — {allMembers.length} คน | {allMonths.length} เดือน{q && ` (แสดง ${members.length} คน)`}</p>
        <div className="flex items-center gap-2 ml-auto">
          <input
            className="input max-w-xs !min-h-[40px] !py-2"
            placeholder="ค้นหาชื่อ-สกุล หรือชื่อเล่น..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {allMembers.length > 0 && (
            <button className="btn-secondary flex items-center gap-2 shrink-0" onClick={exportCumulative}>
              <Download size={14} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {allMembers.length === 0 && <div className="py-12 text-center text-gray-400">ยังไม่มีข้อมูลค่าแรง</div>}
      {allMembers.length > 0 && members.length === 0 && <div className="py-8 text-center text-gray-400">ไม่พบสมาชิกที่ค้นหา</div>}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium sticky left-0 bg-gray-50 z-10">รหัส</th>
                <th className="px-4 py-3 font-medium sticky left-14 bg-gray-50 z-10">ชื่อ</th>
                {allMonths.map(mo => <th key={mo} className="px-3 py-3 font-medium text-right">{mo}</th>)}
                <th className="px-4 py-3 font-medium text-right bg-green-50 text-green-700">รวมสะสม</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m: any) => {
                const monthMap = Object.fromEntries(m.months.map((x: any) => [x.month, x.wage]));
                const isOpen = expanded === m.member_id;
                return (
                  <React.Fragment key={m.member_id}>
                    <tr className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold sticky left-0 bg-white">{m.member_code}</td>
                      <td className="px-4 py-3 font-medium text-gray-800 sticky left-14 bg-white">
                        {m.member_name}
                        {m.member_nickname && <span className="ml-1.5 text-xs text-gray-400">({m.member_nickname})</span>}
                      </td>
                      {allMonths.map(mo => (
                        <td key={mo} className={`px-3 py-3 text-right text-xs ${monthMap[mo] ? 'text-gray-700' : 'text-gray-200'}`}>
                          {monthMap[mo] ? fmt(monthMap[mo]) : '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-bold text-green-700 bg-green-50">{fmt(m.total_wage)}</td>
                      <td className="px-3 py-3">
                        <button className="text-gray-400 hover:text-gray-600" onClick={() => setExpanded(isOpen ? null : m.member_id)}>
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-blue-50">
                        <td colSpan={allMonths.length + 4} className="px-6 py-3">
                          <p className="text-xs font-semibold text-blue-700 mb-2">รายละเอียดรายเดือน — {m.member_name}</p>
                          <div className="flex flex-wrap gap-2">
                            {m.months.map((x: any) => (
                              <div key={x.month} className="bg-white border border-blue-200 rounded-lg px-3 py-2 text-center min-w-[90px]">
                                <p className="text-xs text-gray-500">{x.month}</p>
                                <p className="text-sm font-bold text-blue-700">{fmt(x.wage)}</p>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            {members.length > 0 && (
              <tfoot className="bg-green-50 border-t-2 border-green-200">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-green-800 sticky left-0 bg-green-50">รวมทุกคน</td>
                  {allMonths.map(mo => {
                    const total = members.reduce((s: number, m: any) => {
                      const mw = m.months.find((x: any) => x.month === mo);
                      return s + (mw?.wage || 0);
                    }, 0);
                    return <td key={mo} className="px-3 py-3 text-right text-xs font-semibold text-green-700">{total > 0 ? fmt(total) : '—'}</td>;
                  })}
                  <td className="px-4 py-3 text-right font-bold text-green-800">{fmt(members.reduce((s: number, m: any) => s + m.total_wage, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────── */
export default function Payroll() {
  const [tab, setTab] = useState<'monthly' | 'cumulative'>('monthly');

  const tabs = [
    { key: 'monthly', label: 'สรุปรายเดือน', icon: DollarSign },
    { key: 'cumulative', label: 'ยอดสะสมรายบุคคล', icon: TrendingUp },
  ] as const;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign size={22} className="text-green-600" />
        <h1 className="text-xl font-bold text-gray-800">ค่าตอบแทนและรายได้</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'monthly' && <MonthlyTab />}
        {tab === 'cumulative' && <CumulativeTab />}
      </div>
    </div>
  );
}

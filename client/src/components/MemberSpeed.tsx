import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Loader2 } from 'lucide-react';
import { reportApi } from '../api';

/* ── Performance การตัดของสมาชิก ──
   ข้อมูลจาก /reports/member-speed (คิดเฉพาะใบเบิกที่คืนครบแล้ว — ดูนิยามที่ server)
   แท่งกราฟ = จำนวนสมาชิกในแต่ละช่วงความเร็ว (สีเดียว อ่อน→เข้ม = ช้า→เร็ว) · คลิกแท่งเพื่อกรองตารางด้านล่าง */

const fmt = (n: number, d = 0) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const BANDS = [
  { key: 'lt100', label: 'น้อยกว่า 100', min: 0, max: 100, color: '#bfdbfe', text: 'text-blue-900' },
  { key: '100', label: '100–200', min: 100, max: 200, color: '#93c5fd', text: 'text-blue-900' },
  { key: '200', label: '200–300', min: 200, max: 300, color: '#3b82f6', text: 'text-white' },
  { key: 'gt300', label: 'มากกว่า 300', min: 300, max: Infinity, color: '#1d4ed8', text: 'text-white' },
] as const;
const bandOf = (speed: number) => BANDS.find(b => speed >= b.min && speed < b.max) || BANDS[0];

type Range = 'cutoff' | '30d' | 'month';

export default function MemberSpeed() {
  const [range, setRange] = useState<Range>('cutoff');
  const [band, setBand] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // กราฟ/เรียงลำดับใช้ความเร็วแบบไหน: สูงสุด (รอบเบิกที่เร็วที่สุด) หรือ เฉลี่ย (ทั้งช่วง)
  const [metric, setMetric] = useState<'max' | 'avg'>('max');   // ตารางรายคนซ่อนไว้ก่อน — เปิดเมื่อคลิกแท่ง หรือกดดูรายชื่อทั้งหมด
  const params = useMemo(() => {
    const now = new Date();
    if (range === '30d') { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: iso(f), to: iso(now) }; }
    if (range === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    return {};
  }, [range]);
  const { data, isLoading } = useQuery({ queryKey: ['member-speed', params], queryFn: () => reportApi.memberSpeed(params) });
  const sp = (m: any) => Number(metric === 'max' ? m.max_speed : m.speed) || 0;
  const members: any[] = [...(data?.members || [])].sort((a: any, b: any) => sp(b) - sp(a));

  const counts = BANDS.map(b => members.filter(m => bandOf(sp(m)).key === b.key).length);
  const maxCount = Math.max(1, ...counts);
  const totalDone = members.reduce((s, m) => s + m.issues_done, 0);
  const avgDays = totalDone ? members.reduce((s, m) => s + m.avg_days * m.issues_done, 0) / totalDone : 0;
  const speeds = members.map(sp).sort((a, b) => a - b);
  const median = speeds.length ? (speeds.length % 2 ? speeds[(speeds.length - 1) / 2] : (speeds[speeds.length / 2 - 1] + speeds[speeds.length / 2]) / 2) : 0;
  const shown = band ? members.filter(m => bandOf(sp(m)).key === band) : members;
  const maxSpeed = Math.max(1, ...members.map(m => Math.max(Number(m.max_speed) || 0, Number(m.speed) || 0)));
  const mLabel = metric === 'max' ? 'สูงสุด' : 'เฉลี่ย';
  const thDate = (d?: string) => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return `${dd}/${m}/${String(y + 543).slice(2)}`; };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Gauge size={18} className="text-blue-600" /> Performance การตัดของสมาชิก</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            คิดจากใบเบิกที่คืนครบแล้ว{data ? ` · เบิกระหว่าง ${thDate(data.from)} – ${thDate(data.to)}` : ''}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="group" aria-label="ช่วงเวลา">
          {([['cutoff', 'ตั้งแต่ 28 ส.ค.'], ['30d', '30 วันล่าสุด'], ['month', 'เดือนนี้']] as [Range, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setRange(k); setBand(null); }}
              className={`px-3 py-1 rounded-md ${range === k ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-slate-400"><Loader2 className="animate-spin mx-auto" size={22} /></div>
      ) : members.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">ยังไม่มีใบเบิกที่คืนครบในช่วงนี้</div>
      ) : (
        <>
          {/* ตัวเลขสรุป */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-slate-800 leading-none">{members.length}</p>
              <p className="text-xs text-slate-500 mt-1.5">สมาชิกที่มีข้อมูล (คน)</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-slate-800 leading-none">{fmt(avgDays, 1)}</p>
              <p className="text-xs text-slate-500 mt-1.5">เบิกจนคืนครบ เฉลี่ย (วัน)</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-slate-800 leading-none">{fmt(median)}</p>
              <p className="text-xs text-slate-500 mt-1.5">ความเร็ว{mLabel} · ค่ากลางของกลุ่ม (ชุด/วัน)</p>
            </div>
          </div>

          {/* กราฟแท่ง: จำนวนสมาชิกในแต่ละช่วงความเร็ว */}
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <p className="text-sm font-medium text-slate-700">จำนวนสมาชิกตามความเร็วการตัด{mLabel} <span className="text-slate-400 font-normal">(ชุดต่อวัน · คลิกแท่งเพื่อดูรายชื่อ)</span></p>
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs" role="group" aria-label="ใช้ความเร็วแบบไหน">
                {([['max', 'ความเร็วสูงสุด'], ['avg', 'ความเร็วเฉลี่ย']] as ['max' | 'avg', string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => { setMetric(k); setBand(null); }}
                    className={`px-2.5 py-1 rounded-md ${metric === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="relative h-48 border-b border-slate-200 flex items-end gap-3 px-2" role="list">
              {[0.25, 0.5, 0.75, 1].map(f => (
                <div key={f} className="absolute left-0 right-0 border-t border-dashed border-slate-100" style={{ bottom: `${f * 100}%` }} aria-hidden />
              ))}
              {BANDS.map((b, i) => {
                const n = counts[i];
                const active = band === b.key;
                return (
                  <button key={b.key} type="button" role="listitem" onClick={() => setBand(active ? null : b.key)}
                    title={`ความเร็ว${mLabel} ${b.label} ชุด/วัน: ${n} คน`} aria-pressed={active}
                    className="relative flex-1 h-full flex flex-col justify-end items-center group focus-visible:outline-none">
                    <span className="text-sm font-semibold tabular-nums text-slate-700 mb-1">{n} คน</span>
                    <span className={`w-full max-w-[120px] rounded-t transition-opacity ${band && !active ? 'opacity-40' : ''} group-hover:opacity-90 group-focus-visible:ring-2 group-focus-visible:ring-blue-300`}
                      style={{ height: `${(n / maxCount) * 82}%`, minHeight: n ? 4 : 0, background: b.color }} />
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 px-2 mt-1.5">
              {BANDS.map(b => (
                <div key={b.key} className={`flex-1 text-center text-xs ${band === b.key ? 'font-semibold text-blue-700' : 'text-slate-500'}`}>{b.label}</div>
              ))}
            </div>
          </div>

          {!band && !showAll && (
            <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setShowAll(true)}>ดูรายชื่อทั้งหมด ({members.length} คน) ▸</button>
          )}

          {/* ตารางรายคน */}
          {(band || showAll) && <div className="overflow-x-auto">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium text-slate-700">
                รายชื่อ{band ? ` · ความเร็ว${mLabel} ${BANDS.find(b => b.key === band)!.label} ชุด/วัน` : 'ทั้งหมด'} <span className="text-slate-400 font-normal">({shown.length} คน · เรียงตามความเร็ว{mLabel})</span>
              </p>
              <span className="flex gap-3">
                {band && <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => { setBand(null); setShowAll(true); }}>แสดงทั้งหมด</button>}
                <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setBand(null); setShowAll(false); }}>ซ่อนรายชื่อ</button>
              </span>
            </div>
            <table className="w-full text-sm min-w-[760px] tabular-nums">
              <thead>
                <tr className="text-xs text-slate-500 border-b">
                  <th className="px-2 py-2 text-left font-medium">สมาชิก</th>
                  <th className="px-2 py-2 text-right font-medium">ใบที่คืนครบ</th>
                  <th className="px-2 py-2 text-right font-medium">ตัดแล้ว (ชุด)</th>
                  <th className="px-2 py-2 text-right font-medium">เบิกจนคืน เฉลี่ย</th>
                  <th className={`px-2 py-2 text-left font-medium w-[22%] ${metric === 'max' ? 'text-slate-800' : ''}`}>สูงสุด (ชุด/วัน)</th>
                  <th className={`px-2 py-2 text-left font-medium w-[22%] ${metric === 'avg' ? 'text-slate-800' : ''}`}>เฉลี่ย (ชุด/วัน)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(m => {
                  const bar = (v: number, on: boolean, title: string) => (
                    <div className="flex items-center gap-2" title={title}>
                      <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (v / maxSpeed) * 100)}%`, background: on ? bandOf(v).color : '#cbd5e1' }} />
                      </div>
                      <span className={`w-11 text-right ${on ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{fmt(v)}</span>
                    </div>
                  );
                  return (
                    <tr key={m.member_id} className="border-b border-slate-50">
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-[11px] text-slate-400 mr-1.5">{m.code}</span>
                        <span className="text-slate-800">{m.name}</span>
                        {m.nickname && <span className="text-slate-400 text-xs"> ({m.nickname})</span>}
                        {m.issues_done < 3 && <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-50 rounded px-1">ข้อมูลน้อย</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-700">{m.issues_done}{m.issues_open > 0 && <span className="text-[11px] text-slate-400"> (+{m.issues_open} ค้าง)</span>}</td>
                      <td className="px-2 py-1.5 text-right text-slate-700">{fmt(m.qty_done)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-700">{m.avg_days < 0.05 ? 'ภายในวัน' : `${fmt(m.avg_days, 1)} วัน`}</td>
                      <td className="px-2 py-1.5">{bar(Number(m.max_speed) || 0, metric === 'max', m.max_speed_date ? `รอบที่เร็วที่สุด: เบิก ${thDate(m.max_speed_date)}` : 'ยังไม่มีรอบเบิกที่คืนครบทุกใบ')}</td>
                      <td className="px-2 py-1.5">{bar(Number(m.speed) || 0, metric === 'avg', `ตัด ${fmt(m.qty_done)} ชุด ใน ${m.work_days} วันที่มีงานในมือ`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              1 ชุด = ครบทุกชนิดในงานเดียวกัน (ขาว/ชมพู = ยาว+สั้น 2 เส้น · สามสาย = 3 เส้น — เบิกไม่ครบคู่ก็หารแบบเดียวกัน) · สูงสุด = รอบเบิกที่เร็วที่สุด (ใบเบิกวันเดียวกัน = 1 รอบ · ชุดของรอบ ÷ วันจนคืนครบทุกใบ) · เฉลี่ย = ชุดที่ตัดแล้วทั้งช่วง ÷ จำนวนวันที่มีงานอยู่ในมือ (ถือหลายใบพร้อมกัน นับวันนั้นครั้งเดียว · คืนวันเดียวกับที่เบิก นับ 1 วัน) ·
              เบิกจนคืน = วันที่คืนครั้งสุดท้าย − วันที่เบิก · ใบที่ยังคืนไม่ครบไม่นำมาคิด · "ข้อมูลน้อย" = คืนครบไม่ถึง 3 ใบ ตัวเลขอาจยังไม่นิ่ง
            </p>
          </div>}
        </>
      )}
    </div>
  );
}

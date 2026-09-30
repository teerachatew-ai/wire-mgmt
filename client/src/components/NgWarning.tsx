import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { returnApi } from '../api';

/* ── หน้าต่างเตือนงาน NG ก่อนยืนยันรับคืน ──────────────────────────────────
   กติกา (server/wagePolicy.ts): งานจากล็อตตั้งแต่ 28 ส.ค. 2569 · นับครั้งสะสมต่อสมาชิก
   รวม NG ตัดโดนสายไฟ + NG ดึงเชือก · 1 วันที่เบิก = 1 ครั้ง · ครั้งที่ 1 ตักเตือน ครั้งที่ 2 ขึ้นไปมีค่าปรับ
   ใช้: const { gate, dialog } = useNgGate(); ... if (!(await gate({ returned_at, lines }))) return; ... {dialog}
   ถ้าไม่มี NG หรือพรีวิวไม่สำเร็จ gate จะผ่านทันที (ไม่ขวางการรับคืน) */

type Payload = { returned_at: string; lines: any[]; exclude_return_id?: number };

const num = (v: any) => parseFloat(v) || 0;
const money = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export function useNgGate() {
  const [state, setState] = useState<{ data: any; resolve: (ok: boolean) => void } | null>(null);

  const gate = async (payload: Payload): Promise<boolean> => {
    if (!payload.lines.some(l => num(l.ng_cut) > 0 || num(l.ng_rope) > 0)) return true;
    let data: any;
    try { data = await returnApi.ngPreview(payload); } catch { return true; }
    if (!data?.members?.length) return true;
    return new Promise<boolean>(resolve => setState({ data, resolve }));
  };

  const close = (ok: boolean) => { state?.resolve(ok); setState(null); };
  const dialog = state ? <NgWarningDialog data={state.data} onCancel={() => close(false)} onConfirm={() => close(true)} /> : null;
  return { gate, dialog };
}

const strikeTone = (n: number) =>
  n >= 3 ? 'bg-rose-600 text-white' : n === 2 ? 'bg-orange-500 text-white' : 'bg-amber-400 text-amber-950';

function NgWarningDialog({ data, onCancel, onConfirm }: { data: any; onCancel: () => void; onConfirm: () => void }) {
  const total = (data.members || []).reduce((s: number, m: any) => s + (m.amount || 0), 0);
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div role="alertdialog" aria-labelledby="ng-warn-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
          <span className="shrink-0 w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            <AlertTriangle size={22} />
          </span>
          <div className="flex-1 min-w-0">
            <h3 id="ng-warn-title" className="font-bold text-amber-900 text-lg leading-tight">เตือน: มีงาน NG</h3>
            <p className="text-xs text-amber-800/80 mt-0.5">ตรวจสอบก่อนยืนยันรับคืน — นับครั้งสะสมตั้งแต่ล็อต 28 ส.ค. 2569 (1 วันที่เบิก = 1 ครั้ง)</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="ปิด" className="text-amber-700/60 hover:text-amber-900"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {data.members.map((m: any) => (
            <div key={m.member_id} className="border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b">
                <span className="text-sm">
                  <span className="font-mono text-xs text-gray-400 mr-1">{m.code}</span>
                  <b className="text-gray-800">{m.name}</b>
                  {m.nickname && <span className="text-gray-400 text-xs"> ({m.nickname})</span>}
                </span>
                <span className="text-xs text-gray-500 whitespace-nowrap">NG สะสม <b className="text-gray-800">{m.strikes_after}</b> ครั้ง</span>
              </div>
              <div className="divide-y">
                {m.strikes.map((s: any) => (
                  <div key={s.strike} className="flex items-center gap-3 px-3 py-2.5">
                    <span className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold ${strikeTone(s.strike)}`}>
                      {s.strike === 1 ? 'ครั้งแรก' : `ครั้งที่ ${s.strike}`}
                    </span>
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="text-gray-800">งานเบิก {s.issue_day} · {s.detail}</div>
                      {!s.is_new && <div className="text-[11px] text-gray-500">นับรวมกับครั้งที่ {s.strike} เดิม (งานวันที่เบิกเดียวกัน ไม่นับเพิ่ม)</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      {s.strike === 1 ? (
                        <span className="text-xs font-medium text-amber-700">ตักเตือน<br /><span className="text-gray-400 font-normal">ยังไม่มีค่าปรับ</span></span>
                      ) : s.amount > 0 ? (
                        <span className="text-rose-600 font-bold tabular-nums">−{money(s.amount)} ฿</span>
                      ) : (
                        <span className="text-[11px] text-gray-500">ยังไม่ได้ตั้ง<br />อัตราค่าปรับ</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t px-5 py-3 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">ค่าปรับที่จะหักจากค่าแรง</span>
            <b className={`tabular-nums text-base ${total > 0 ? 'text-rose-600' : 'text-gray-500'}`}>{total > 0 ? `−${money(total)} บาท` : 'ไม่มี (ตักเตือน)'}</b>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={onCancel}>กลับไปแก้ไข</button>
            <button type="button" className="btn-primary" onClick={onConfirm} autoFocus>รับทราบ · ยืนยันรับคืน</button>
          </div>
        </div>
      </div>
    </div>
  );
}

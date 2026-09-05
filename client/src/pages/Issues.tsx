import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { issueApi, memberApi, productApi, reportApi, receiveApi, issueRequestApi } from '../api';
import MemberSelect from '../components/MemberSelect';
import { colorDot } from '../colorDot';
import { projectLabel } from '../projectLabel';
import { Plus, X, Eye, ArrowUpFromLine, Printer, FileText, FileDown, Trash2, Edit2, Smartphone, Check, CheckCheck, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import InOutCompare from '../components/InOutCompare';
import IssueMatrix from '../components/IssueMatrix';
import ExportExcelButton from '../components/ExportExcelButton';
import DateRangeFilter, { DateFilterValue, dateFilterLabel } from '../components/DateRangeFilter';
import BulkActionBar from '../components/BulkActionBar';
import { useBulkSelect, bulkDelete, bulkDeleteSummary } from '../utils/bulkSelect';
import { useDebounced } from '../utils/useDebounced';
import { downloadBlob, openDownloadTab } from '../utils/downloadBlob';

function openPrint(url: string) {
  window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
}

// อธิบายว่ายอดคงเหลือสะสมติดลบของวันนี้ เกิดจาก "เบิกวันนี้มากกว่ารับเข้าวันนี้" ล้วนๆ (ของใหม่ยังไม่ทันรับเข้าก็เบิกไปแล้ว)
// หรือแค่ทยอยแจกงานที่มีคงเหลือสะสมจากวันก่อนหน้าอยู่แล้ว (ปกติ ไม่ใช่ปัญหา) — คำนวณย้อนจากตัวเลขในแถวนั้นเอง ไม่ต้องพึ่งแถวก่อนหน้า
function ledgerExplain(r: any): { text: string; tone: 'partial' | 'bad' } | null {
  const dayExcess = Math.max(0, (r.issued || 0) - (r.received || 0));
  if (dayExcess === 0) {
    if (r.balance < 0) return { text: 'วันนี้เบิกไม่เกินยอดรับเข้าของวันนี้เอง แต่ยอดคงเหลือสะสมยังติดลบต่อเนื่องมาจากก่อนหน้า', tone: 'bad' };
    return null;
  }
  if (r.balance >= 0) return null; // ยอดคงเหลือก่อนหน้าพอรองรับส่วนเกินวันนี้ได้ทั้งหมด ไม่ต้องอธิบายเพิ่ม
  const priorBalance = r.balance - r.received + r.issued;
  const explained = Math.max(0, Math.min(priorBalance, dayExcess));
  const unexplained = dayExcess - explained;
  if (explained > 0) {
    return {
      text: `วันนี้เบิกเกินยอดรับเข้าวันนี้ ${dayExcess.toLocaleString()} เส้น — ${explained.toLocaleString()} เส้น ใกล้เคียงกับยอดคงเหลือสะสมที่มีอยู่ก่อนหน้า (${priorBalance.toLocaleString()} เส้น) น่าจะเป็นการแจกงานที่รับเข้าไว้ก่อนหน้านี้ เหลือส่วนที่อธิบายไม่ได้จริง ${unexplained.toLocaleString()} เส้น`,
      tone: 'partial',
    };
  }
  return {
    text: `วันนี้เบิกเกินยอดรับเข้าวันนี้ ${dayExcess.toLocaleString()} เส้น และไม่มียอดคงเหลือสะสมจากก่อนหน้ามารองรับเลย (ก่อนวันนี้อยู่ที่ ${priorBalance.toLocaleString()} เส้น) ส่วนเกินนี้ยังอธิบายไม่ได้ ควรตรวจสอบ`,
    tone: 'bad',
  };
}

const statusLabel: Record<string, string> = { pending: 'ค้างส่ง', partial: 'คืนบางส่วน', closed: 'ปิดแล้ว' };
const statusClass: Record<string, string> = { pending: 'badge-pending', partial: 'badge-partial', closed: 'badge-closed' };

function Modal({ title, onClose, children, wide }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
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

/* ── Create Issue Modal — สถานีแจกงาน: ตั้งวันที่ครั้งเดียว แล้วเบิกทีละคนต่อเนื่องได้เลย ──
   ออกแบบให้กรอกน้อยที่สุด เพราะหน้านี้ต้องกรอกบ่อยและเยอะ:
   • วันที่/กำหนดคืน ตั้งครั้งเดียวค้างไว้ตลอด ไม่ต้องกรอกซ้ำทุกคน
   • งานทุกชนิดโชว์เป็นรายการพร้อมช่องตัวเลขเลย ไม่ต้องเลือกจาก dropdown ก่อน
   • ช่อง "ทั้งชุด" ของแต่ละกลุ่ม = พิมพ์ครั้งเดียวเติมให้ทุกรุ่นในกลุ่มนั้น (เคสเบิกเป็นชุดตามปกติ)
   • บันทึกแล้วเคลียร์เฉพาะคน+จำนวน คงวันที่ไว้ พร้อมรับคนถัดไปทันที (Enter = บันทึก & คนต่อไป)
   • ปุ่ม "จำนวนเดิม" ดึงจำนวนของคนก่อนหน้ามาใช้ซ้ำ (เคสแจกเท่ากันหลายคน) */
function CreateIssueModal({ members, products, stockMap = {}, onClose, onCreated }: any) {
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [memberId, setMemberId] = useState<any>('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<any[]>([]);        // คนที่เบิกไปแล้วในรอบนี้ (ยังไม่ปิดหน้าต่าง)
  const [lastQty, setLastQty] = useState<Record<string, string> | null>(null);
  const [memberOpenKey, setMemberOpenKey] = useState(0);

  const activeProducts = (products as any[]).filter((p: any) => p.active);
  const stockOf = (id: any) => Math.max(0, Math.round(stockMap[id] ?? 0));

  // จัดกลุ่มตามโครงการ (ชื่อกลุ่มที่คนใช้งานคุ้นเคย เช่น "งานป้ายขาว")
  const groups = Object.values(
    activeProducts.reduce((acc: any, p: any) => {
      const key = p.project || 'อื่นๆ';
      (acc[key] ??= { key, products: [] }).products.push(p);
      return acc;
    }, {})
  ) as any[];

  const setQtyFor = (pid: any, v: string) => setQty(q => ({ ...q, [pid]: v }));
  const fillGroup = (g: any, v: string) => setQty(q => {
    const next = { ...q };
    for (const p of g.products) { if (v) next[p.id] = v; else delete next[p.id]; }
    return next;
  });
  // ช่อง "ทั้งชุด" จะโชว์ตัวเลขก็ต่อเมื่อทุกรุ่นในกลุ่มมีจำนวนเท่ากัน (ถ้ากรอกแยกไม่เท่ากันให้ว่างไว้)
  const groupValue = (g: any) => {
    const vals = g.products.map((p: any) => qty[p.id] || '');
    return vals.every((v: string) => v === vals[0]) ? vals[0] : '';
  };

  const lines = activeProducts
    .map((p: any) => ({ p, q: parseFloat(qty[p.id]) }))
    .filter((x: any) => x.q > 0);
  const totalQty = lines.reduce((s: number, x: any) => s + x.q, 0);
  const member = (members as any[]).find((m: any) => String(m.id) === String(memberId));

  const save = async (closeAfter: boolean) => {
    if (!issuedAt) { setError('กรุณาเลือกวันที่เบิก'); return; }
    if (!memberId) { setError('กรุณาเลือกสมาชิก'); return; }
    if (lines.length === 0) { setError('กรุณากรอกจำนวนอย่างน้อย 1 รายการ'); return; }
    setSaving(true); setError('');

    // สร้างทีละรายการ — ถ้ารุ่นไหนไม่ผ่าน (เช่นเกินเพดานคงค้าง) เก็บไว้ให้แก้ต่อ ไม่ทิ้งรุ่นที่สำเร็จไปแล้ว
    const failedIds = new Set<string>();
    const failMsg: string[] = [];
    let ok = 0, okQty = 0;
    for (const { p, q } of lines) {
      try {
        await issueApi.create({
          issued_at: issuedAt, due_date: dueDate || undefined, member_id: memberId,
          product_id: p.id, quantity: q, notes: notes || undefined,
        });
        ok++; okQty += q;
      } catch (e: any) {
        failedIds.add(String(p.id));
        failMsg.push(`${p.name}: ${e.response?.data?.error || 'ผิดพลาด'}`);
      }
    }
    setSaving(false);
    onCreated();

    if (ok > 0) {
      setDone(d => [...d, { key: `${memberId}-${Date.now()}`, name: member?.name, nickname: member?.nickname, code: member?.code, lines: ok, qty: okQty }]);
      setLastQty(qty);
    }
    if (failedIds.size > 0) {
      // เหลือไว้เฉพาะรุ่นที่ยังไม่สำเร็จ (คนเดิม) — กดบันทึกซ้ำได้เลยโดยไม่ซ้ำซ้อนกับที่บันทึกไปแล้ว
      setQty(q => Object.fromEntries(Object.entries(q).filter(([k]) => failedIds.has(k))));
      setError(`บันทึกสำเร็จ ${ok} รายการ · ไม่สำเร็จ ${failedIds.size} รายการ (ยังค้างอยู่ในช่องให้แก้)\n${failMsg.join('\n')}`);
      return;
    }
    if (closeAfter) { onClose(); return; }
    setMemberId(''); setQty({}); setNotes('');
    setMemberOpenKey(k => k + 1);   // เปิดช่องค้นหาสมาชิกให้เลย พร้อมรับคนต่อไป
  };

  return (
    <Modal title="แจกงานให้สมาชิก" onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); save(false); }} className="space-y-4">
        {/* ① วันที่ — ตั้งครั้งเดียว ใช้กับทุกคนที่เบิกในรอบนี้ */}
        <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-3 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] font-semibold text-blue-800 mb-0.5">วันที่เบิก (ใช้กับทุกคน)</label>
            <input type="date" className="input !min-h-[38px] !py-1.5 w-40 font-semibold" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-blue-700 mb-0.5">กำหนดคืน (ไม่บังคับ)</label>
            <input type="date" className="input !min-h-[38px] !py-1.5 w-40" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          {done.length > 0 && (
            <span className="ml-auto text-sm font-bold text-blue-800 bg-white border border-blue-200 rounded-xl px-3 py-1.5">
              เบิกไปแล้ว {done.length} คน
            </span>
          )}
        </div>

        {/* ② สมาชิก */}
        <div>
          <label className="label">สมาชิก *</label>
          <MemberSelect members={members} value={memberId} onChange={setMemberId} activeOnly autoOpenKey={memberOpenKey} />
        </div>

        {/* ③ จำนวน — ทุกชนิดโชว์พร้อมช่องกรอกเลย ไม่ต้องเลือกจาก dropdown */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="label mb-0">กรอกจำนวนที่เบิก <span className="font-normal text-gray-400">— กรอกเฉพาะรุ่นที่เบิก</span></label>
            <div className="flex items-center gap-1.5">
              {lastQty && Object.keys(lastQty).length > 0 && (
                <button type="button" onClick={() => setQty(lastQty)}
                  className="text-xs font-medium text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50">↺ จำนวนเดิม</button>
              )}
              {lines.length > 0 && (
                <button type="button" onClick={() => setQty({})}
                  className="text-xs font-medium text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-100">ล้าง</button>
              )}
            </div>
          </div>

          {groups.map((g: any) => (
            <div key={g.key}>
              <div className="flex items-center justify-between gap-2 mb-1.5 px-1">
                <p className="text-sm font-semibold text-gray-500">{projectLabel(g.key)}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-400">ทั้งชุด</span>
                  {/* onWheel blur — กันเลื่อนเมาส์ผ่านช่องตัวเลขแล้วค่าเปลี่ยนเองโดยไม่รู้ตัว (หน้านี้ต้องเลื่อนบ่อย) */}
                  <input type="number" min="0" step="0.01" inputMode="numeric" placeholder="—"
                    className="input !min-h-[34px] !py-1 !px-2 w-24 text-right text-sm font-semibold"
                    onWheel={e => e.currentTarget.blur()}
                    value={groupValue(g)} onChange={e => fillGroup(g, e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                {g.products.map((p: any) => {
                  const st = stockOf(p.id);
                  const v = parseFloat(qty[p.id]);
                  const over = v > st;
                  return (
                    <div key={p.id} className={`flex items-center gap-3 bg-white border rounded-2xl px-3 py-2 transition ${v > 0 ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'}`}>
                      {p.color && <span className="w-6 h-6 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-gray-800 text-sm truncate">{p.name}</div>
                        <div className="text-[11px] text-gray-400">คงคลัง {st.toLocaleString()} {p.unit}</div>
                      </div>
                      <input type="number" min="0" step="0.01" inputMode="numeric" placeholder="0"
                        className={`input !min-h-[38px] !py-1 !px-2 w-24 shrink-0 text-right ${v > 0 ? 'font-bold' : ''} ${over ? '!border-rose-400 !bg-rose-50 !text-rose-700' : ''}`}
                        onWheel={e => e.currentTarget.blur()}
                        value={qty[p.id] ?? ''} onChange={e => setQtyFor(p.id, e.target.value)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* หมายเหตุ — ซ่อนไว้ก่อน กดเปิดเมื่อต้องใช้จริง (ปกติไม่ต้องกรอก) */}
        {showNotes ? (
          <div>
            <label className="label">หมายเหตุ</label>
            <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="(ไม่บังคับ)" />
          </div>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="text-xs text-gray-400 hover:text-gray-600">+ เพิ่มหมายเหตุ</button>
        )}

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600 whitespace-pre-line">{error}</div>}

        {/* แถบสรุป+ปุ่ม ติดขอบล่างไว้ตลอด — ไม่ต้องเลื่อนลงมาหาปุ่มบันทึกทุกคน */}
        <div className="sticky bottom-0 -mx-4 px-4 pt-2 pb-1 bg-white/95 backdrop-blur border-t space-y-2">
          {lines.length > 0 && (
            <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-900">
              <p className="font-semibold mb-1">
                {member ? `${member.code} ${member.name}` : 'ยังไม่ได้เลือกสมาชิก'} — {lines.length} รายการ รวม {totalQty.toLocaleString()} เส้น
              </p>
              <p className="text-xs">{lines.map((x: any) => `${x.p.name} ${x.q.toLocaleString()}`).join(' · ')}</p>
            </div>
          )}
          <div className="flex gap-2 justify-end items-center flex-wrap">
            <button type="button" className="btn-secondary" onClick={onClose}>{done.length > 0 ? 'ปิด' : 'ยกเลิก'}</button>
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => save(true)}>บันทึก & ปิด</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'กำลังบันทึก...' : `บันทึก & คนต่อไป${lines.length ? ` (${lines.length})` : ''}`}
            </button>
          </div>
        </div>

        {/* รายชื่อที่เบิกไปแล้วในรอบนี้ — เห็นความคืบหน้าโดยไม่ต้องปิดหน้าต่างไปดูตาราง */}
        {done.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">เบิกไปแล้วในรอบนี้ ({done.length} คน)</p>
            <div className="flex flex-wrap gap-1.5">
              {done.map((d: any) => (
                <span key={d.key} className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 text-xs">
                  <Check size={12} className="text-emerald-600 shrink-0" />
                  <span className="text-gray-700">{d.nickname || d.name}</span>
                  <b className="text-emerald-700">{d.qty.toLocaleString()}</b>
                </span>
              ))}
            </div>
          </div>
        )}
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
  const [siblings, setSiblings] = useState<any[] | null>(null); // ใบเบิกคู่กัน (เบิกพร้อมกัน) — รอถามว่าจะแก้จำนวนให้ตรงกันด้วยไหม
  const [pendingQty, setPendingQty] = useState<any>(null);
  const [applying, setApplying] = useState(false);

  const activeProducts = (products as any[]).filter((p: any) => p.active || String(p.id) === String(issue.product_id));
  const returned = issue.returned_good + issue.returned_defect + issue.returned_waste;

  const onSubmit = async (data: any) => {
    setLoading(true); setError('');
    try {
      const result = await issueApi.update(issue.id, data);
      if (result.siblings?.length > 0) {
        setSiblings(result.siblings);
        setPendingQty(data.quantity);
      } else {
        onSaved(); onClose();
      }
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  };

  const skipSiblings = () => { onSaved(); onClose(); };
  const applySiblings = async () => {
    setApplying(true);
    for (const s of siblings || []) {
      try {
        await issueApi.update(s.id, { issued_at: s.issued_at, due_date: s.due_date || '', member_id: s.member_id, product_id: s.product_id, quantity: pendingQty, notes: s.notes || '' });
      } catch { /* ข้ามใบที่แก้ไม่ได้ (เช่นคืนไปแล้วเกินจำนวนใหม่) ไม่บล็อกใบอื่น */ }
    }
    setApplying(false);
    onSaved(); onClose();
  };
  const deleteSiblings = async () => {
    setApplying(true);
    for (const s of siblings || []) {
      try { await issueApi.delete(s.id, true); } catch { /* ข้ามใบที่ลบไม่ได้ ไม่บล็อกใบอื่น */ }
    }
    setApplying(false);
    onSaved(); onClose();
  };

  if (siblings) {
    return (
      <Modal title={`แก้ไขใบเบิก ${issue.code}`} onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            พบใบเบิกอื่นที่เบิกพร้อมกัน (คนเดียวกัน วันเดียวกัน จำนวนเดิมเท่ากัน) <strong>{siblings.length}</strong> ใบ
            ต้องการแก้จำนวนเป็น <strong className="text-blue-600">{pendingQty}</strong> ให้ตรงกันด้วยหรือไม่?
          </p>
          <div className="border rounded-xl divide-y">
            {siblings.map((s: any) => (
              <div key={s.id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                <span><span className="font-mono text-xs text-blue-600">{s.code}</span> {s.product_name}</span>
                <span className="text-gray-400">{s.quantity} {s.unit}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <button type="button" className="btn-secondary" disabled={applying} onClick={skipSiblings}>ไม่ต้อง</button>
            <button type="button" className="btn-secondary !text-red-600" disabled={applying} onClick={deleteSiblings}>
              {applying ? 'กำลังลบ...' : 'ลบคู่ชุดนี้ทิ้ง'}
            </button>
            <button type="button" className="btn-primary" disabled={applying} onClick={applySiblings}>
              {applying ? 'กำลังแก้ไข...' : 'ใช่ แก้ให้ตรงกัน'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

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
  const [step, setStep] = useState<'confirm' | 'loading' | 'error' | 'siblings'>('confirm');
  const [msg, setMsg] = useState('');
  const [needForce, setNeedForce] = useState(false);
  const [siblings, setSiblings] = useState<any[]>([]);
  const [applying, setApplying] = useState(false);

  const doDelete = async (force = false) => {
    setStep('loading');
    try {
      const result = await issueApi.delete(issue.id, force);
      if (result.siblings?.length > 0) { setSiblings(result.siblings); setStep('siblings'); }
      else { onDeleted(); onClose(); }
    } catch (e: any) {
      const data = e.response?.data;
      if (data?.confirm_required) { setMsg(data.message); setNeedForce(true); setStep('confirm'); }
      else { setMsg(data?.error || 'เกิดข้อผิดพลาด'); setStep('error'); }
    }
  };

  const skipSiblings = () => { onDeleted(); onClose(); };
  const deleteSiblingsToo = async () => {
    setApplying(true);
    for (const s of siblings) {
      try { await issueApi.delete(s.id, true); } catch { /* ข้ามใบที่ลบไม่ได้ ไม่บล็อกใบอื่น */ }
    }
    setApplying(false);
    onDeleted(); onClose();
  };

  if (step === 'siblings') {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-lg shrink-0"><Trash2 size={20} className="text-red-600" /></div>
            <div>
              <h3 className="font-semibold text-gray-800">ลบทั้งชุดด้วยไหม?</h3>
              <p className="text-sm text-gray-500 mt-0.5">ลบ {issue.code} แล้ว</p>
            </div>
          </div>
          <p className="text-sm text-gray-700">
            พบใบเบิกอื่นที่เบิกพร้อมกัน (คนเดียวกัน วันเดียวกัน จำนวนเดิมเท่ากัน) <strong>{siblings.length}</strong> ใบ
            ต้องการลบใบเหล่านี้ด้วยหรือไม่?
          </p>
          <div className="border rounded-xl divide-y max-h-40 overflow-y-auto">
            {siblings.map((s: any) => (
              <div key={s.id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                <span><span className="font-mono text-xs text-blue-600">{s.code}</span> {s.product_name}</span>
                <span className="text-gray-400">{s.quantity} {s.unit}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-secondary" disabled={applying} onClick={skipSiblings}>ไม่ต้อง ลบแค่ใบนี้</button>
            <button className="btn-danger" disabled={applying} onClick={deleteSiblingsToo}>
              {applying ? 'กำลังลบ...' : 'ใช่ ลบทั้งชุด'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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

/* ── แถวคำขอเบิกงานที่สมาชิกส่งเองผ่านลิงก์ (รอเจ้าหน้าที่ตรวจสอบแล้วยืนยัน) ── */
function PendingIssueRequestRow({ req, onDone, onChange }: { req: any; onDone: () => void; onChange: (id: number, data: any) => void }) {
  const [qty, setQty] = useState(String(req.quantity ?? 0));
  const [issuedAt, setIssuedAt] = useState(req.issued_at || new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState('');

  // แจ้งค่าล่าสุดของแถวนี้ขึ้นไปให้ปุ่ม "ยืนยันทั้งหมด" ด้านบนใช้ตอนกด (แก้ตัวเลขไว้ก่อนแล้วค่อยกดยืนยันทั้งหมดทีเดียวได้)
  useEffect(() => {
    onChange(req.id, { quantity: qty, issued_at: issuedAt, due_date: dueDate || undefined });
  }, [qty, issuedAt, dueDate]);

  const confirm = async () => {
    setBusy('confirm'); setError('');
    try {
      await issueRequestApi.confirm(req.id, { quantity: qty, issued_at: issuedAt, due_date: dueDate || undefined });
      onDone();
    } catch (e: any) { setError(e.response?.data?.error || 'ยืนยันไม่สำเร็จ'); setBusy(null); }
  };
  const reject = async () => {
    setBusy('reject'); setError('');
    try { await issueRequestApi.reject(req.id); onDone(); }
    catch (e: any) { setError(e.response?.data?.error || 'ปฏิเสธไม่สำเร็จ'); setBusy(null); }
  };

  return (
    <div className="p-3.5 border-b last:border-0 bg-amber-50/40">
      <div className="flex items-center gap-2 flex-wrap">
        {req.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: req.color }} />}
        <span className="font-semibold text-gray-800">{req.member_name}</span>
        {req.member_nickname && <span className="text-gray-400 text-sm">({req.member_nickname})</span>}
        <span className="text-gray-400">·</span>
        <span className="text-gray-600 text-sm">{req.product_name}</span>
        <span className="ml-auto text-xs text-gray-400">{req.submitted_at}</span>
      </div>
      <div className="flex items-end gap-2 mt-2 flex-wrap">
        <div className="w-24 shrink-0">
          <label className="block text-[10px] text-gray-400">จำนวน</label>
          <input type="number" className="input !py-1.5 !min-h-0 text-sm font-semibold" value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        <div className="w-36 shrink-0">
          <label className="block text-[10px] text-gray-400">วันที่เบิก</label>
          <input type="date" className="input !py-1.5 !min-h-0 text-sm" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} />
        </div>
        <div className="w-36 shrink-0">
          <label className="block text-[10px] text-gray-400">กำหนดคืน</label>
          <input type="date" className="input !py-1.5 !min-h-0 text-sm" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <button type="button" disabled={!!busy} onClick={reject}
            className="btn-secondary btn-sm !text-rose-600 flex items-center gap-1">
            {busy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} ปฏิเสธ
          </button>
          <button type="button" disabled={!!busy} onClick={confirm}
            className="btn-primary btn-sm flex items-center gap-1">
            {busy === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} ยืนยัน
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
    </div>
  );
}

function PendingIssueRequestsPanel() {
  const qc = useQueryClient();
  const { data: pending = [] } = useQuery({
    queryKey: ['issue-requests', 'pending'],
    queryFn: () => issueRequestApi.list('pending'),
    refetchInterval: 20000,
  });
  const valuesRef = useRef<Record<number, any>>({});
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [bulkError, setBulkError] = useState('');

  const onDone = () => {
    qc.invalidateQueries({ queryKey: ['issue-requests'] });
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const handleRowChange = (id: number, data: any) => { valuesRef.current[id] = data; };

  const confirmAll = async () => {
    setConfirmingAll(true); setBulkError('');
    const failed: string[] = [];
    for (const r of pending as any[]) {
      try { await issueRequestApi.confirm(r.id, valuesRef.current[r.id] || {}); }
      catch (e: any) { failed.push(`${r.member_name} · ${r.product_name}: ${e.response?.data?.error || 'ผิดพลาด'}`); }
    }
    setConfirmingAll(false);
    onDone();
    setBulkError(failed.length ? failed.join('\n') : '');
  };

  if ((pending as any[]).length === 0) return null;
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
      <div className="px-4 py-3 bg-amber-100 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-amber-700" />
          <span className="font-semibold text-amber-800 text-sm">คำขอเบิกงานจากสมาชิก (ผ่านลิงก์มือถือ) — รอตรวจสอบ {(pending as any[]).length} รายการ</span>
        </div>
        {(pending as any[]).length > 1 && (
          <button type="button" disabled={confirmingAll} onClick={confirmAll}
            className="btn-primary btn-sm flex items-center gap-1.5">
            {confirmingAll ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
            ยืนยันทั้งหมด ({(pending as any[]).length})
          </button>
        )}
      </div>
      <p className="px-4 pt-2 text-xs text-amber-700">ตรวจสอบแล้วแก้จำนวน/วันที่ให้ถูกต้องได้ที่นี่ แล้วกดยืนยัน — จะกลายเป็นใบเบิกจริงก็ต่อเมื่อกดยืนยันแล้วเท่านั้น (แก้ไว้หลายแถวแล้วกด "ยืนยันทั้งหมด" ทีเดียวได้)</p>
      {bulkError && <p className="px-4 pt-2 text-xs text-rose-600 whitespace-pre-line">ยืนยันไม่สำเร็จบางรายการ:{'\n'}{bulkError}</p>}
      <div>
        {(pending as any[]).map((r: any) => <PendingIssueRequestRow key={r.id} req={r} onDone={onDone} onChange={handleRowChange} />)}
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
  const { selected, toggle, toggleAll, clear } = useBulkSelect();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  // ตั้งต้นที่ "เดือนปัจจุบัน" ไม่ใช่ทั้งหมด — ถ้าดึงทุกใบตั้งแต่เปิดระบบ (ตอนนี้ 2,600+ ใบ และเพิ่มขึ้นเรื่อยๆ)
  // หน้าเว็บจะต้องเรนเดอร์เป็นหมื่น DOM node ทำให้พิมพ์/คลิกหน่วงเป็นวินาที โดยเฉพาะบนเครื่องที่ CPU ช้ากว่า
  // ผู้ใช้เลือก "ทุกวันที่" เองได้ตลอดถ้าต้องการดูย้อนหลัง
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(
    () => ({ date: new Date().toISOString().slice(0, 7) })
  );
  const [search, setSearch] = useState('');
  const searchDebounced = useDebounced(search, 250);   // พิมพ์เร็วๆ ไม่ต้องกรองใหม่ทุกตัวอักษร
  const [dailyBusy, setDailyBusy] = useState<'' | 'xlsx' | 'pdf'>('');
  // มุมมองตาราง: matrix (สรุปทั้งวัน อ่านง่าย) หรือ list (รายใบ มีปุ่มแก้ไข/พิมพ์/ลบ)
  const [view, setView] = useState<'matrix' | 'list'>('matrix');

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['issues', statusFilter, dateFilter],
    queryFn: () => issueApi.list({ status: statusFilter || undefined, ...dateFilter })
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

  // ของเข้าจากโรงงานวันนี้เสมอ (ไม่ผูกกับตัวกรองตาราง) — เผื่อดูก่อนตัดสินใจเบิกให้สมาชิก ไม่ว่ากำลังกรองดูช่วงไหนอยู่
  const todayStr = new Date().toISOString().split('T')[0];
  const { data: receivesOfDay = [] } = useQuery({
    queryKey: ['receives', 'day', todayStr],
    queryFn: () => receiveApi.list({ date: todayStr }),
  });
  const receiveGroups = useMemo(() => Object.values((receivesOfDay as any[]).reduce((a: any, r: any) => {
    const k = r.product_name; (a[k] ??= { name: k, unit: r.unit, color: r.color, qty: 0 }).qty += Number(r.quantity) || 0; return a;
  }, {})) as any[], [receivesOfDay]);

  // ของที่รับเข้าจากโรงงานในช่วงที่กำลังกรองดูอยู่ (ใช้ตัวกรองเดียวกับตารางใบเบิก) — แยกจากแบนเนอร์ "วันนี้" ด้านบน
  // ซึ่งมีไว้เตือนแบบเรียลไทม์ตอนกำลังจะเบิกให้สมาชิกโดยเฉพาะ อันนี้ไว้ดูภาพรวมย้อนหลังตามช่วงที่กำลังดูอยู่
  const { data: receivesOfPeriod = [] } = useQuery({
    queryKey: ['receives', 'issues-page', dateFilter],
    queryFn: () => receiveApi.list(dateFilter),
  });
  const receiveSummaryOfPeriod = useMemo(() => Object.values((receivesOfPeriod as any[]).reduce((a: any, r: any) => {
    const k = r.product_name; (a[k] ??= { name: k, unit: r.unit, color: r.color, qty: 0 }).qty += Number(r.quantity) || 0; return a;
  }, {})) as any[], [receivesOfPeriod]);

  // บัตรคุมสต็อก (stock ledger) — cross check รับเข้า vs เบิก รายวันทีละสินค้า พร้อมยอดคงเหลือสะสม
  // แสดงประวัติทั้งหมดของสินค้าที่เลือกเสมอ ไม่ผูกกับตัวกรองวันที่ของตารางใบเบิกด้านบน (คนละวัตถุประสงค์กัน —
  // ตัวกรองด้านบนไว้ดูใบเบิกเฉพาะช่วง แต่บัตรคุมสต็อกต้องเห็นภาพรวมทั้งหมดถึงจะเห็นว่าวันไหนของแต่ละรุ่นเบิกหมดจริงๆ)
  const [ledgerProductId, setLedgerProductId] = useState<string>('');
  const [ledgerOpen, setLedgerOpen] = useState(false);
  useEffect(() => {
    if (!ledgerProductId && (products as any[]).length > 0) setLedgerProductId(String((products as any[])[0].id));
  }, [products, ledgerProductId]);
  const { data: ledger } = useQuery({
    queryKey: ['stock-ledger', ledgerProductId],
    queryFn: () => reportApi.stockLedger(Number(ledgerProductId), {}),
    enabled: !!ledgerProductId,
  });
  const ledgerRows = (ledger?.rows || []) as any[];

  const handleCreated = () => {
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  // useCallback — ถ้าส่ง arrow function ใหม่ทุกรอบ memo() ของ IssueMatrix จะไร้ผล
  // (มองว่า prop เปลี่ยนตลอด เลยสร้างตารางใหม่ทั้งหมดทุกครั้งที่พิมพ์)
  const openDetail = useCallback((id: number) => setDetailId(id), []);

  // ลบหลายใบพร้อมกัน — ใช้ force=1 ตรงๆ ทุกใบ (ข้ามขั้นยืนยันซ้อนแบบทีละใบ) เพราะเตือนเรื่องการลบรายการรับคืนที่ผูกอยู่ไว้ใน confirm() ครั้งเดียวตั้งแต่ต้นแล้ว
  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || !confirm(`ลบใบเบิกที่เลือกไว้ ${ids.length} ใบ? ถ้าใบไหนมีรายการรับคืนผูกอยู่ จะลบรายการรับคืนนั้นไปด้วย`)) return;
    setBulkDeleting(true);
    const result = await bulkDelete(ids, (id) => issueApi.delete(id, true));
    setBulkDeleting(false);
    clear();
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    alert(bulkDeleteSummary(result));
  };

  // รายงานใบเบิกงานรายวัน (Excel/PDF) — matrix แยกวัน: แถว=สมาชิก, คอลัมน์=ชนิดสินค้า + subtotal + จำนวนคนเบิก + ยอดรับเข้าจากโรงงานวันนั้น
  const downloadIssueDaily = async (format?: 'pdf') => {
    const noFilter = !dateFilter.date && !dateFilter.from && !dateFilter.to;
    if (noFilter && !confirm('ยังไม่ได้กรองช่วงวันที่ — จะสร้างรายงานทุกวันที่มีข้อมูลทั้งหมด (อาจมีหลายสิบหน้า) ดำเนินการต่อหรือไม่?')) return;
    const tab = openDownloadTab();
    setDailyBusy(format === 'pdf' ? 'pdf' : 'xlsx');
    try {
      const blob = await reportApi.issueDailyExport({ ...dateFilter, status: statusFilter || undefined }, format);
      downloadBlob(blob, `ใบเบิกงานรายวัน-${dateFilterLabel(dateFilter)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`, tab);
    } catch {
      tab?.close();
      alert('สร้างรายงานไม่สำเร็จ (อาจไม่มีข้อมูลใบเบิกในช่วงที่เลือก)');
    } finally {
      setDailyBusy('');
    }
  };

  // ค้นหา: เลขใบเบิก / ชื่อ-สกุล / ชื่อเล่น / สินค้า
  // useMemo ทั้งชุด — ไม่งั้นทุกครั้งที่ state ใดๆ เปลี่ยน (พิมพ์ค้นหา/กดปุ่ม/เปิด-ปิดกล่อง)
  // จะไล่กรองและรวมยอดใหม่ทั้งหมดแล้วเรนเดอร์ตารางใหม่ทั้งหน้า
  const q = searchDebounced.trim().toLowerCase();
  const visibleIssues = useMemo(() => (issues as any[]).filter((i: any) => !q
    || String(i.code || '').toLowerCase().includes(q)
    || String(i.member_name || '').toLowerCase().includes(q)
    || String(i.member_nickname || '').toLowerCase().includes(q)
    || String(i.product_name || '').toLowerCase().includes(q)), [issues, q]);

  const summary = useMemo(() => Object.values(visibleIssues.reduce((a: any, i: any) => {
    const k = i.product_name; (a[k] ??= { name: k, unit: i.unit, color: i.color, qty: 0 }).qty += Number(i.quantity) || 0; return a;
  }, {})) as any[], [visibleIssues]);
  // จำนวนสมาชิกที่มาเบิก (คนเดียวเบิกหลายชนิด/หลายใบ นับ 1)
  const memberCount = useMemo(
    () => new Set(visibleIssues.map((i: any) => i.member_id ?? i.member_code ?? i.member_name)).size,
    [visibleIssues]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ArrowUpFromLine size={20} className="text-amber-600" />
          <h1 className="text-xl font-bold text-gray-800">ใบเบิกงาน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="input w-52 text-sm" placeholder="🔍 เลขใบเบิก / ชื่อ / ชื่อเล่น" value={search} onChange={e => setSearch(e.target.value)} />
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <select className="input w-36 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            <option value="pending">ค้างส่ง</option>
            <option value="partial">คืนบางส่วน</option>
            <option value="closed">ปิดแล้ว</option>
          </select>
          <button className="btn-secondary btn-sm" onClick={() => openPrint(`/print?blank=1&count=10`)}>
            <FileText size={16} /> พิมพ์ฟอร์มเปล่า
          </button>
          <ExportExcelButton filename="ใบเบิกงาน" rows={visibleIssues.map((i: any) => ({
            'เลขใบเบิก': i.code, 'วันที่เบิก': i.issued_at, 'กำหนดคืน': i.due_date || '',
            'รหัสสมาชิก': i.member_code, 'ชื่อสมาชิก': i.member_name, 'ชื่อเล่น': i.member_nickname || '',
            'สินค้า': i.product_name, 'จำนวนเบิก': i.quantity, 'หน่วย': i.unit,
            'คืนดี': i.returned_good, 'คืนเสีย': i.returned_defect, 'เศษคืน': i.returned_waste,
            'คงเหลือ': i.quantity - (i.returned_good + i.returned_defect + i.returned_waste),
            'สถานะ': statusLabel[i.status] || i.status, 'ผู้บันทึก': i.created_by || '',
          }))} />
          <button type="button" className="btn-secondary btn-sm flex items-center gap-1.5" disabled={dailyBusy === 'xlsx'}
            onClick={() => downloadIssueDaily()} title="รายงานใบเบิกงานรายวัน แยกเป็นวันๆ (Excel)">
            {dailyBusy === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Excel รายวัน
          </button>
          <button type="button" className="btn-secondary btn-sm flex items-center gap-1.5" disabled={dailyBusy === 'pdf'}
            onClick={() => downloadIssueDaily('pdf')} title="รายงานใบเบิกงานรายวัน แยกเป็นวันๆ (PDF)">
            {dailyBusy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF รายวัน
          </button>
          <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
            <Plus size={18} /> สร้างใบเบิก
          </button>
        </div>
      </div>

      <PendingIssueRequestsPanel />

      {receiveGroups.length > 0 && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
            <span className="text-sm font-semibold text-emerald-800">
              📦 มีของเข้าจากโรงงานวันนี้
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {receiveGroups.map((g: any) => (
              <span key={g.name} className="inline-flex items-center gap-1.5 bg-white border border-emerald-200 rounded-lg px-3 py-1.5 text-sm">
                {g.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.color }} />}
                <span className="text-gray-700">{g.name}</span>
                <b className="text-emerald-700">{Number(g.qty || 0).toLocaleString('th-TH')}</b>
                {g.unit && <span className="text-gray-400 text-xs">{g.unit}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* เทียบรับเข้า vs เบิกออก ในตารางเดียว — อ่านทีละแถวได้เลย ไม่ต้องกวาดสายตาขึ้นลงระหว่าง 2 การ์ด */}
      <InOutCompare received={receiveSummaryOfPeriod} issued={summary} note={dateFilterLabel(dateFilter)} memberCount={memberCount} />

      <div className="card overflow-x-auto">
        <button type="button" className="w-full flex items-center justify-between flex-wrap gap-2 mb-0 text-left" onClick={() => setLedgerOpen(o => !o)}>
          <div className="flex items-center gap-2">
            {ledgerOpen ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
            <div>
              <p className="text-sm font-semibold text-gray-700">📋 บัตรคุมสต็อก — cross check รับเข้า vs เบิก รายวัน</p>
              <p className="text-xs text-gray-400">แสดงประวัติทั้งหมดของสินค้าที่เลือก ไม่ขึ้นกับตัวกรองวันที่ด้านบน</p>
            </div>
          </div>
          {ledger && !ledgerOpen && (
            <span className={`text-xs font-medium px-2 py-1 rounded-lg ${ledger.has_over_issue ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {ledger.has_over_issue ? '⚠ พบความผิดปกติ' : '✅ ปกติ'} · คงเหลือสะสม {Number(ledger.closing_balance).toLocaleString()} {ledger.unit}
            </span>
          )}
        </button>

        {ledgerOpen && (
        <>
        <div className="flex justify-end mb-3 mt-3">
          <select className="input w-auto text-sm py-1.5" value={ledgerProductId} onChange={e => setLedgerProductId(e.target.value)} onClick={e => e.stopPropagation()}>
            {(products as any[]).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {ledger && (
          <div className={`mb-3 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${ledger.has_over_issue ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            {ledger.has_over_issue
              ? <>⚠ พบวันที่ยอดเบิกสะสมเกินยอดรับเข้าสะสม — ตรวจสอบแถวที่ไฮไลท์แดงด้านล่าง</>
              : <>✅ ไม่พบความผิดปกติ — ยอดเบิกสะสมไม่เกินยอดรับเข้าสะสมทุกวัน</>}
            <span className="ml-auto font-normal text-xs">คงเหลือสะสมล่าสุด {Number(ledger.closing_balance).toLocaleString()} {ledger.unit}</span>
          </div>
        )}

        <table className="w-full text-sm min-w-[480px]">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-gray-500">
              <th className="px-3 py-2 font-medium">วันที่</th>
              <th className="px-3 py-2 font-medium text-right">รับเข้า</th>
              <th className="px-3 py-2 font-medium text-right">เบิก</th>
              <th className="px-3 py-2 font-medium text-right">คงเหลือสะสม</th>
            </tr>
          </thead>
          <tbody>
            {ledger && ledger.opening_balance !== 0 && (
              <tr className="border-b bg-gray-50/60">
                <td className="px-3 py-2 text-gray-500 italic" colSpan={3}>ยอดคงเหลือยกมา (ก่อนช่วงที่เลือก)</td>
                <td className={`px-3 py-2 text-right font-semibold ${ledger.opening_balance < 0 ? 'text-rose-600' : 'text-gray-700'}`}>
                  {Number(ledger.opening_balance).toLocaleString()}
                </td>
              </tr>
            )}
            {ledgerRows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">ไม่มีการเคลื่อนไหวในช่วงที่เลือก</td></tr>
            )}
            {ledgerRows.map((r: any) => {
              const explain = ledgerExplain(r);
              return (
                <Fragment key={r.date}>
                  <tr className={`border-b ${explain ? '' : 'last:border-0'} hover:bg-gray-50/70 ${r.balance < 0 ? 'bg-rose-50' : ''}`}>
                    <td className="px-3 py-2 text-gray-600">{r.date}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{r.received ? `+${Number(r.received).toLocaleString()}` : '–'}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{r.issued ? `−${Number(r.issued).toLocaleString()}` : '–'}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.balance < 0 ? 'text-rose-600' : 'text-gray-800'}`}>
                      {Number(r.balance).toLocaleString()}{r.balance < 0 && ' ⚠'}
                    </td>
                  </tr>
                  {explain && (
                    <tr className="border-b last:border-0">
                      <td colSpan={4} className={`px-3 pb-2 pt-0 text-xs italic ${explain.tone === 'bad' ? 'text-rose-500 bg-rose-50' : 'text-amber-600 bg-rose-50'}`}>
                        ↳ {explain.text}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </>
        )}
      </div>

      {/* สลับมุมมอง: ตารางสรุปรายวัน (matrix) หรือ รายการใบเบิกทีละใบ */}
      <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl p-1 w-fit">
        <button type="button" onClick={() => setView('matrix')}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${view === 'matrix' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
          📊 ตารางสรุปรายวัน
        </button>
        <button type="button" onClick={() => setView('list')}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${view === 'list' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
          📄 รายการทีละใบ
        </button>
      </div>

      {view === 'matrix' && (
        <>
          {isLoading && <div className="card text-center text-gray-400 py-8">กำลังโหลด...</div>}
          {!isLoading && visibleIssues.length === 0 && (
            <div className="card text-center py-8 space-y-2">
              <p className="text-gray-400">{q ? 'ไม่พบที่ค้นหา' : `ยังไม่มีใบเบิกใน${dateFilterLabel(dateFilter)}`}</p>
              {!q && (
                <button type="button" onClick={() => setDateFilter({})}
                  className="text-sm text-blue-600 hover:underline">ดูทั้งหมดย้อนหลัง</button>
              )}
            </div>
          )}
          <IssueMatrix issues={visibleIssues} onOpen={openDetail} />
        </>
      )}

      {view === 'list' && <>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {isLoading && <div className="text-center text-gray-400 py-8">กำลังโหลด...</div>}
        {visibleIssues.map((i: any) => {
          const returned = i.returned_good + i.returned_defect + i.returned_waste;
          const remaining = i.quantity - returned;
          const overdue = i.status !== 'closed' && i.due_date && i.due_date < new Date().toISOString().split('T')[0];
          return (
            <div key={i.id} className={`card space-y-2 ${overdue ? 'border-red-300 bg-red-50' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs text-blue-600 font-bold">{i.code}</span>
                  <p className="font-semibold text-gray-800 mt-0.5">{i.member_name}{i.member_nickname && <span className="text-xs text-gray-400 font-normal"> ({i.member_nickname})</span>}</p>
                  <p className="text-sm text-gray-500 inline-flex items-center gap-1.5">{i.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: i.color }} />}{i.product_name}</p>
                </div>
                <span className={statusClass[i.status]}>{statusLabel[i.status]}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm bg-gray-50 rounded-xl p-2">
                <div><p className="text-xs text-gray-400">เบิก</p><p className="font-bold">{i.quantity}</p></div>
                <div><p className="text-xs text-gray-400">คืนแล้ว</p><p className="font-bold text-green-600">{returned}</p></div>
                <div><p className="text-xs text-gray-400">คงเหลือ</p><p className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{remaining}</p></div>
              </div>
              <div className="flex gap-2 justify-between items-center text-xs text-gray-400">
                <span>เบิก {i.issued_at}{i.due_date && ` · คืน ${i.due_date}`}{i.created_by && ` · โดย ${i.created_by}`}</span>
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
      <BulkActionBar count={selected.size} onDelete={handleBulkDelete} onClear={clear} deleting={bulkDeleting} label="ใบ" />
      <div className="hidden md:block card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={visibleIssues.length > 0 && visibleIssues.every((i: any) => selected.has(i.id))}
                  onChange={() => toggleAll(visibleIssues.map((i: any) => i.id))} />
              </th>
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
            {isLoading && <tr><td colSpan={10} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {!isLoading && visibleIssues.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-gray-400">{q ? 'ไม่พบที่ค้นหา' : 'ยังไม่มีรายการ'}</td></tr>}
            {visibleIssues.map((i: any) => {
              const returned = i.returned_good + i.returned_defect + i.returned_waste;
              const remaining = i.quantity - returned;
              const overdue = i.status !== 'closed' && i.due_date && i.due_date < new Date().toISOString().split('T')[0];
              return (
                <tr key={i.id} className={`border-b border-gray-50 hover:bg-gray-50 ${overdue ? 'bg-red-50' : selected.has(i.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{i.code}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <div>{i.issued_at}</div>
                    {i.due_date && <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-400'}>คืน: {i.due_date}</div>}
                    {i.created_by && <div className="text-gray-400">โดย {i.created_by}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-500">{i.member_code}</span>{' '}
                    <span className="font-medium text-gray-800">{i.member_name}</span>
                    {i.member_nickname && <span className="text-xs text-gray-400"> ({i.member_nickname})</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600"><span className="inline-flex items-center gap-1.5">{i.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: i.color }} />}{i.product_name}</span></td>
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
            {!isLoading && (issues as any[]).length === 0 && <tr><td colSpan={10} className="py-8 text-center text-gray-400">ยังไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>
      </>}

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

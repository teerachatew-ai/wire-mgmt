import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crown, Dumbbell, ShieldCheck, Check, Loader2 } from 'lucide-react';
import { memberApi } from '../api';

/* ── ตำแหน่งแอดมินของสมาชิก (ใช้กำหนดปริมาณงานในหน้า "วางแผนแจกงาน") ──
   lifter = ช่วยยกงาน (ได้งานมากสุด 750–1,000 ชุด/วัน) · admin = แอดมินทั่วไป (มากกว่าคนทั่วไป น้อยกว่าคนยกงาน) */
export type AdminRole = 'lifter' | 'admin' | null;

export const ROLE_META: Record<'lifter' | 'admin', { label: string; short: string; cls: string; Icon: any }> = {
  lifter: { label: 'ช่วยยกงาน', short: 'ยกงาน', cls: 'bg-orange-100 text-orange-800 ring-orange-200', Icon: Dumbbell },
  admin: { label: 'แอดมินทั่วไป', short: 'แอดมิน', cls: 'bg-violet-100 text-violet-800 ring-violet-200', Icon: ShieldCheck },
};

export function AdminRoleBadge({ role, compact }: { role: AdminRole; compact?: boolean }) {
  if (!role) return null;
  const m = ROLE_META[role];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap ${m.cls}`} title={m.label}>
      <m.Icon size={11} /> {compact ? m.short : m.label}
    </span>
  );
}

// ปุ่มแต่งตั้ง: แสดง badge ปัจจุบัน (หรือปุ่มมงกุฎจาง ๆ ถ้ายังไม่มี) กดแล้วเลือกตำแหน่งได้
export function AdminRolePicker({ member, compact }: { member: { id: number; admin_role?: AdminRole }; compact?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const role = (member.admin_role || null) as AdminRole;
  const mut = useMutation({
    mutationFn: (r: AdminRole) => memberApi.setRole(member.id, r),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); qc.invalidateQueries({ queryKey: ['distribution-context'] }); setOpen(false); },
    onError: (e: any) => alert(e?.response?.data?.error || 'บันทึกไม่สำเร็จ'),
  });
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const opts: { v: AdminRole; label: string; desc: string }[] = [
    { v: 'lifter', label: 'ช่วยยกงาน', desc: 'ได้งาน 750–1,000 ชุด/วัน' },
    { v: 'admin', label: 'แอดมินทั่วไป', desc: 'ได้งานมากกว่าคนทั่วไป' },
    { v: null, label: 'สมาชิกทั่วไป', desc: 'ไม่มีตำแหน่ง' },
  ];
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" onClick={e => {
          e.stopPropagation();
          // เมนูลอยแบบ fixed — ไม่โดนตารางที่เลื่อนแนวนอนตัดขอบ
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 210), left: Math.max(8, Math.min(r.left, window.innerWidth - 232)) });
          setOpen(o => !o);
        }} aria-haspopup="menu" aria-expanded={open}
        title={role ? `ตำแหน่ง: ${ROLE_META[role].label} (กดเพื่อเปลี่ยน)` : 'แต่งตั้งเป็นแอดมิน'}
        className={role ? 'rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400' : 'p-1 rounded-md text-gray-300 hover:text-amber-500 hover:bg-amber-50'}>
        {mut.isPending ? <Loader2 size={14} className="animate-spin text-gray-400" /> : role ? <AdminRoleBadge role={role} compact={compact} /> : <Crown size={15} />}
      </button>
      {open && (
        <span role="menu" style={{ top: pos.top, left: pos.left }} className="fixed z-[80] w-56 rounded-xl border bg-white shadow-xl p-1 text-left">
          <span className="block px-3 pt-2 pb-1 text-[11px] font-semibold text-gray-400">แต่งตั้งตำแหน่ง</span>
          {opts.map(o => (
            <button key={String(o.v)} type="button" role="menuitem" onClick={e => { e.stopPropagation(); mut.mutate(o.v); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-left">
              <span className="w-4 shrink-0">{role === o.v && <Check size={14} className="text-sky-600" />}</span>
              <span className="flex-1">
                <span className="block text-sm text-gray-800">{o.label}</span>
                <span className="block text-[11px] text-gray-400">{o.desc}</span>
              </span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

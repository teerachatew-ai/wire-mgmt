const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export interface SumGroup { name: string; qty: number; unit?: string; color?: string; }

export default function DaySummary({ groups, note, unitLabel = 'รวม', memberCount }: { groups: SumGroup[]; note?: string; unitLabel?: string; memberCount?: number }) {
  if (!groups.length) return null;
  const total = groups.reduce((s, g) => s + (g.qty || 0), 0);
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <span className="text-sm font-semibold text-gray-700">📊 สรุปยอดต่อประเภท{note ? ` — ${note}` : ''}</span>
        <span className="text-sm text-gray-500 flex items-center gap-3">
          {memberCount != null && memberCount > 0 && <span className="bg-violet-50 border border-violet-200 text-violet-700 rounded-lg px-2.5 py-0.5">👥 สมาชิก <b>{memberCount}</b> คน</span>}
          <span>{unitLabel}ทั้งหมด <b className="text-gray-800">{fmt(total)}</b></span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map(g => (
          <span key={g.name} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
            {g.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.color }} />}
            <span className="text-gray-700">{g.name}</span>
            <b className="text-blue-700">{fmt(g.qty)}</b>
            {g.unit && <span className="text-gray-400 text-xs">{g.unit}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

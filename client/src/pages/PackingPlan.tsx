import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { productApi, reportApi } from '../api';
import { Boxes, Truck, RotateCcw, AlertTriangle, CheckCircle2, Settings2 } from 'lucide-react';
import { sortByColorGroup, colorPriority } from '../productOrder';
import { parseProductLabel, projectLabel } from '../projectLabel';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });

/* จัดลังส่งงาน — กรอกจำนวนพร้อมส่งของสินค้าแต่ละรุ่น (เริ่มจากสต๊อกปัจจุบันให้อัตโนมัติ แก้ไขได้)
   ระบบคำนวณจำนวนลังตามมาตรฐานบรรจุ (จำนวน/ลัง) ที่ตั้งไว้ในหน้า "ประเภทสินค้า" ต่อรุ่น
   แล้วรวมยอดทั้งหมดเทียบกับความจุรถขนส่ง (อย่างน้อย/มากสุด กี่ลัง) */
export default function PackingPlan() {
  const { data: products = [], isLoading: loadingProducts } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: stockData, isLoading: loadingStock } = useQuery({ queryKey: ['stock-flow', 'all'], queryFn: () => reportApi.stockFlow() });

  const stockReadyOf = useMemo(() => {
    const map: Record<number, number> = {};
    for (const p of (stockData?.products || []) as any[]) map[p.id] = Math.max(0, Math.round(p.stock_ready || 0));
    return map;
  }, [stockData]);

  const [qty, setQty] = useState<Record<number, string>>({});
  const [seeded, setSeeded] = useState(false);
  const [minBoxes, setMinBoxes] = useState(30);
  const [maxBoxes, setMaxBoxes] = useState(35);

  // เติมค่าเริ่มต้นจากสต๊อกพร้อมส่งปัจจุบันให้ครั้งเดียวตอนโหลดเสร็จ (แก้ไขต่อได้อิสระหลังจากนั้น)
  useEffect(() => {
    if (seeded || loadingProducts || loadingStock) return;
    const initial: Record<number, string> = {};
    for (const p of products as any[]) {
      const v = stockReadyOf[p.id];
      if (v > 0) initial[p.id] = String(v);
    }
    setQty(initial);
    setSeeded(true);
  }, [seeded, loadingProducts, loadingStock, products, stockReadyOf]);

  const resetToStock = () => {
    const initial: Record<number, string> = {};
    for (const p of products as any[]) {
      const v = stockReadyOf[p.id];
      if (v > 0) initial[p.id] = String(v);
    }
    setQty(initial);
  };
  const clearAll = () => setQty({});

  // กรอกทั้งชุด (ทั้งป้ายสี) ทีเดียว — เติมจำนวนเดียวกันให้ทุกรุ่นย่อยในกลุ่มนั้น (เช่น "ขาว 1000 Set"
  // = ป้ายขาวสั้นกับป้ายขาวยาวได้ 1000 เท่ากันทั้งคู่) ยังกรอกแยกทีละรุ่นย่อยทับได้ตามปกติหลังจากนั้น
  const fillGroup = (products: any[], v: string) => setQty(q => {
    const next = { ...q };
    for (const p of products) { if (v) next[p.id] = v; else delete next[p.id]; }
    return next;
  });
  const groupSetValue = (products: any[]) => {
    const vals = products.map(p => qty[p.id] || '');
    return vals.every(v => v === vals[0]) ? vals[0] : '';
  };

  const activeProducts = (products as any[]).filter(p => p.active);

  // จัดกลุ่มตามโครงการ (ป้าย) — เรียงกลุ่มตามสีของรุ่นแรกในกลุ่ม ให้สีเดียวกันอยู่ใกล้กัน เหมือนตารางมาตรฐานบรรจุ
  const groups = useMemo(() => {
    const byProject: Record<string, any[]> = {};
    for (const p of activeProducts) (byProject[p.project || 'ไม่ระบุโครงการ'] ??= []).push(p);
    const keys = Object.keys(byProject).sort((a, b) => {
      const pa = Math.min(...byProject[a].map(p => colorPriority(p.color)));
      const pb = Math.min(...byProject[b].map(p => colorPriority(p.color)));
      return pa - pb || a.localeCompare(b, 'th');
    });
    return keys.map(key => ({
      key,
      products: sortByColorGroup(byProject[key], p => p.name, p => p.color),
    }));
  }, [activeProducts]);

  // คำนวณจำนวนลังต่อรุ่น: ปัดขึ้นเสมอ (ลังสุดท้ายไม่เต็มก็ยังต้องใช้ทั้งลัง)
  const boxesOf = (p: any): number | null => {
    const q = parseFloat(qty[p.id]) || 0;
    if (q <= 0) return 0;
    if (!p.units_per_box || p.units_per_box <= 0) return null; // ยังไม่ตั้งมาตรฐาน คำนวณไม่ได้
    return Math.ceil(q / p.units_per_box);
  };

  let totalBoxes = 0;
  let hasUnknownStandard = false;
  for (const p of activeProducts) {
    const b = boxesOf(p);
    if (b === null) { if ((parseFloat(qty[p.id]) || 0) > 0) hasUnknownStandard = true; }
    else totalBoxes += b;
  }

  const capacityState = totalBoxes === 0 ? 'empty' : totalBoxes < minBoxes ? 'under' : totalBoxes > maxBoxes ? 'over' : 'ok';
  const capacityMeta: Record<string, { cls: string; text: string; icon: JSX.Element }> = {
    empty: { cls: 'border-gray-200 bg-gray-50 text-gray-500', text: 'ยังไม่ได้กรอกจำนวนพร้อมส่ง', icon: <Truck size={20} /> },
    under: { cls: 'border-amber-300 bg-amber-50 text-amber-700', text: `ยังไม่ถึงขั้นต่ำ — ต้องเพิ่มอีกอย่างน้อย ${fmt(minBoxes - totalBoxes)} ลัง ถึงจะคุ้มเที่ยวรถ`, icon: <AlertTriangle size={20} /> },
    over: { cls: 'border-rose-300 bg-rose-50 text-rose-700', text: `เกินความจุรถ — ต้องลดลงอย่างน้อย ${fmt(totalBoxes - maxBoxes)} ลัง`, icon: <AlertTriangle size={20} /> },
    ok: { cls: 'border-emerald-300 bg-emerald-50 text-emerald-700', text: 'อยู่ในช่วงที่รถขนส่งได้พอดี', icon: <CheckCircle2 size={20} /> },
  };
  const meta = capacityMeta[capacityState];

  const isLoading = loadingProducts || loadingStock;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Boxes size={22} className="text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">จัดลังส่งงาน</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={resetToStock} className="btn-secondary btn-sm flex items-center gap-1.5">
            <RotateCcw size={14} /> โหลดจากสต๊อกปัจจุบัน
          </button>
          <button type="button" onClick={clearAll} className="btn-secondary btn-sm">ล้างทั้งหมด</button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        กรอกจำนวน "พร้อมส่ง" ของแต่ละรุ่น (เริ่มต้นดึงจากสต๊อกคืนแล้วรอส่งปัจจุบันให้อัตโนมัติ แก้ไขได้อิสระ) —
        ระบบคำนวณจำนวนลังจากมาตรฐานบรรจุที่ตั้งไว้ในหน้า <Link to="/products" className="text-blue-600 underline">ประเภทสินค้า</Link> ให้อัตโนมัติ
      </p>

      {/* แถบความจุรถ — ติดขอบบนไว้เสมอ เห็นสถานะได้ตลอดเวลาที่กรอก */}
      <div className={`sticky top-2 z-10 rounded-2xl border-2 p-4 flex items-center gap-3 flex-wrap ${meta.cls}`}>
        {meta.icon}
        <div className="flex-1 min-w-[200px]">
          <p className="font-bold text-3xl tabular-nums">{fmt(totalBoxes)} ลัง</p>
          <p className="text-base font-medium">{meta.text}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Settings2 size={15} className="text-gray-400" />
          <label className="flex items-center gap-1.5">อย่างน้อย
            <input type="number" min="1" value={minBoxes} onChange={e => setMinBoxes(parseInt(e.target.value) || 0)}
              className="w-16 rounded-lg border border-gray-300 px-1.5 py-1.5 text-center bg-white text-base font-semibold" />
          </label>
          <label className="flex items-center gap-1.5">มากสุด
            <input type="number" min="1" value={maxBoxes} onChange={e => setMaxBoxes(parseInt(e.target.value) || 0)}
              className="w-16 rounded-lg border border-gray-300 px-1.5 py-1.5 text-center bg-white text-base font-semibold" />
          </label>
          <span className="text-gray-400">ลัง/เที่ยว</span>
        </div>
      </div>

      {hasUnknownStandard && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            มีบางรุ่นกรอกจำนวนพร้อมส่งไว้แล้วแต่ <b>ยังไม่ได้ตั้งมาตรฐานบรรจุ (จำนวน/ลัง)</b> จึงคำนวณจำนวนลังไม่ได้ (ขึ้น "—" สีเทาด้านล่าง)
            ไปตั้งค่าได้ที่หน้า <Link to="/products" className="underline font-medium">ประเภทสินค้า</Link>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-gray-400">กำลังโหลด...</div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const groupBoxes = g.products.reduce((s, p) => s + (boxesOf(p) || 0), 0);
            return (
              <div key={g.key} className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                  <span className="font-bold text-gray-800 text-lg">{projectLabel(g.key)}</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-600 font-medium">
                      ทั้งชุด
                      <input
                        type="number" min="0" step="1" inputMode="numeric" placeholder="—"
                        className="input !min-h-[36px] !py-1 !px-2 w-24 text-right text-base font-semibold"
                        onWheel={e => e.currentTarget.blur()}
                        value={groupSetValue(g.products)}
                        onChange={e => fillGroup(g.products, e.target.value)}
                        title="กรอกจำนวนเดียว เติมให้ทุกรุ่นย่อยในป้ายนี้เท่ากันหมด"
                      />
                    </label>
                    <span className="text-sm text-gray-600">รวม <b className="text-gray-900 text-lg">{fmt(groupBoxes)}</b> ลัง</span>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {g.products.map(p => {
                    const { num, label } = parseProductLabel(p.name);
                    const boxes = boxesOf(p);
                    const stockRef = stockReadyOf[p.id] || 0;
                    return (
                      <div key={p.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50/70">
                        {p.color && <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-gray-800 text-base truncate">{label}<span className="text-gray-400 font-mono text-sm ml-2">{num}</span></div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            สต๊อกพร้อมส่ง {fmt(stockRef)} {p.unit}
                            {' · '}
                            {p.units_per_box ? `${fmt(p.units_per_box)}/ลัง` : <span className="text-amber-500 font-medium">ยังไม่ตั้งมาตรฐาน</span>}
                          </div>
                        </div>
                        <input
                          type="number" min="0" step="1" inputMode="numeric" placeholder="0"
                          className="input !min-h-[44px] !py-1.5 !px-3 w-28 shrink-0 text-right text-lg font-semibold"
                          onWheel={e => e.currentTarget.blur()}
                          value={qty[p.id] ?? ''}
                          onChange={e => setQty(q => ({ ...q, [p.id]: e.target.value }))}
                        />
                        <div className="w-24 shrink-0 text-right">
                          {boxes === null ? (
                            <span className="text-gray-300 text-xl">—</span>
                          ) : boxes > 0 ? (
                            <span className="font-bold text-blue-700 text-xl tabular-nums">{fmt(boxes)} ลัง</span>
                          ) : (
                            <span className="text-gray-200 text-xl">-</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {groups.length === 0 && <div className="card text-center text-gray-400 py-8">ยังไม่มีรุ่นสินค้าที่ใช้งานอยู่</div>}
        </div>
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { issueApi, productApi } from '../api';

/* ───── Digit box ───── */
function Digits({ value, count = 4 }: { value?: string | number; count?: number }) {
  const str = value != null ? String(value) : '';
  const cells = Array.from({ length: count }, (_, i) => str[str.length - count + i] ?? '');
  return (
    <span className="inline-flex">
      {cells.map((c, i) => (
        <span key={i} style={{
          display: 'inline-block', width: 22, height: 26, lineHeight: '24px',
          border: '1px solid #333', borderLeft: i === 0 ? '1px solid #333' : 'none',
          textAlign: 'center', fontSize: 15, fontFamily: 'monospace',
          backgroundColor: c ? '#f0f7ff' : 'white'
        }}>{c}</span>
      ))}
    </span>
  );
}

function CheckBox({ checked }: { checked?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 14, height: 14, border: '1.5px solid #333',
      verticalAlign: 'middle', marginRight: 4, textAlign: 'center', lineHeight: '13px',
      fontSize: 11, backgroundColor: checked ? '#e0edff' : 'white'
    }}>
      {checked ? '✓' : ''}
    </span>
  );
}

function Line({ label, width = 140 }: { label: string; width?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#444' }}>{label}</span>
      <span style={{ display: 'inline-block', width, borderBottom: '1px solid #555', height: 18 }} />
    </span>
  );
}

/* ───── Single Form Card ───── */
function FormCard({
  issue, products, formNo, isBlank
}: {
  issue?: any;
  products: any[];
  formNo?: string;
  isBlank?: boolean;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [yy, mm, dd] = (issue?.issued_at ?? today).split('-');
  const [dyy, dmm, ddd] = (issue?.due_date ?? '').split('-');

  return (
    <div style={{
      width: 380, border: '2px solid #222', fontFamily: 'Sarabun, sans-serif',
      fontSize: 12, pageBreakInside: 'avoid', backgroundColor: 'white',
      padding: 0, position: 'relative'
    }}>
      {/* ── Header ── */}
      <div style={{ backgroundColor: '#1e3a5f', color: 'white', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>ใบเบิก-คืนงานตัดสายไฟ</div>
          <div style={{ fontSize: 10, opacity: 0.85 }}>วิสาหกิจชุมชน</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, opacity: 0.75 }}>เลขที่</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 1 }}>
            {issue?.code ?? (isBlank ? 'IS______' : formNo ?? 'IS___')}
          </div>
        </div>
      </div>

      {/* ── Date + Member ── */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #ccc', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div>
          <span style={{ fontSize: 10, color: '#555' }}>วันที่เบิก </span>
          {!isBlank && issue ? (
            <><Digits value={dd} count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits value={mm} count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits value={yy} count={4} /></>
          ) : (
            <><Digits count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits count={4} /></>
          )}
        </div>
        <div>
          <span style={{ fontSize: 10, color: '#555' }}>กำหนดคืน </span>
          {!isBlank && issue?.due_date ? (
            <><Digits value={ddd} count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits value={dmm} count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits value={dyy} count={4} /></>
          ) : (
            <><Digits count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits count={2} /><span style={{ margin: '0 2px' }}>/</span><Digits count={4} /></>
          )}
        </div>
        <div style={{ gridColumn: '1/-1', marginTop: 3 }}>
          <span style={{ fontSize: 10, color: '#555' }}>รหัสสมาชิก </span>
          {!isBlank && issue ? (
            <Digits value={issue.member_code?.replace(/\D/g, '')} count={4} />
          ) : (
            <Digits count={4} />
          )}
          <span style={{ marginLeft: 8 }}><Line label="ชื่อ" width={issue ? 120 : 140} /></span>
          {!isBlank && issue && (
            <span style={{ marginLeft: 4, fontWeight: 600, fontSize: 13 }}>{issue.member_name}</span>
          )}
        </div>
      </div>

      {/* ── SECTION 1: เบิก ── */}
      <div style={{ padding: '4px 10px', borderBottom: '2px dashed #1e3a5f' }}>
        <div style={{ backgroundColor: '#e8f0fb', margin: '-4px -10px 6px', padding: '3px 10px', fontWeight: 700, fontSize: 11, color: '#1e3a5f' }}>
          ✦ ส่วนที่ 1 — ใบเบิกงาน (กรอก/ติ๊กเมื่อรับงานออก)
        </div>

        <div style={{ marginBottom: 4, fontSize: 11 }}>
          <span style={{ color: '#555', fontSize: 10 }}>สินค้า/รุ่นสายไฟ (ติ๊ก ✓ เลือก 1 รายการ):</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', marginBottom: 6 }}>
          {products.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
              <CheckBox checked={!isBlank && issue?.product_id === p.id} />
              <span style={{ fontSize: 11 }}><span style={{ fontFamily: 'monospace', color: '#666', fontSize: 10 }}>{p.code}</span> {p.name}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <CheckBox />
            <span style={{ fontSize: 11 }}>อื่นๆ: <span style={{ display: 'inline-block', width: 80, borderBottom: '1px solid #999' }}>&nbsp;</span></span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: '#555' }}>จำนวนเบิก</span>
          {!isBlank && issue ? (
            <Digits value={Math.round(issue.quantity)} count={5} />
          ) : (
            <Digits count={5} />
          )}
          <span style={{ fontSize: 10, color: '#555' }}>
            {!isBlank && issue ? issue.unit : 'หน่วย'}
          </span>
          {!isBlank && issue && (
            <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600 }}>
              ({issue.unit})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <Line label="ลายมือชื่อผู้เบิก" width={110} />
          <Line label="ผู้อนุมัติ" width={90} />
        </div>
      </div>

      {/* ── SECTION 2: คืน ── */}
      <div style={{ padding: '4px 10px' }}>
        <div style={{ backgroundColor: '#e8f5e9', margin: '-4px -10px 6px', padding: '3px 10px', fontWeight: 700, fontSize: 11, color: '#1b5e20' }}>
          ✦ ส่วนที่ 2 — ใบคืนงาน (กรอกเมื่อส่งคืน)
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: '#555' }}>วันที่คืน</span>
          <Digits count={2} /><span style={{ margin: '0 1px', fontSize: 10 }}>/</span>
          <Digits count={2} /><span style={{ margin: '0 1px', fontSize: 10 }}>/</span>
          <Digits count={4} />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
          <thead>
            <tr style={{ backgroundColor: '#f1f8e9' }}>
              <th style={{ border: '1px solid #bbb', padding: '2px 4px', fontSize: 10, fontWeight: 600, color: '#2e7d32', width: '33%' }}>งานดี ✓</th>
              <th style={{ border: '1px solid #bbb', padding: '2px 4px', fontSize: 10, fontWeight: 600, color: '#c62828', width: '33%' }}>งานเสีย ✗</th>
              <th style={{ border: '1px solid #bbb', padding: '2px 4px', fontSize: 10, fontWeight: 600, color: '#555', width: '33%' }}>เศษวัสดุ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ border: '1px solid #bbb', padding: '6px 4px', textAlign: 'center', height: 32 }}>
                <Digits count={5} />
              </td>
              <td style={{ border: '1px solid #bbb', padding: '6px 4px', textAlign: 'center', height: 32 }}>
                <Digits count={4} />
              </td>
              <td style={{ border: '1px solid #bbb', padding: '6px 4px', textAlign: 'center', height: 32 }}>
                <Digits count={4} />
              </td>
            </tr>
          </tbody>
        </table>

        {/* Equation reminder */}
        <div style={{ fontSize: 9, color: '#666', textAlign: 'center', border: '1px dashed #bbb', padding: '2px 4px', marginBottom: 5, backgroundColor: '#fffde7' }}>
          ตรวจสอบ: งานดี + งานเสีย + เศษ = จำนวนเบิกทั้งหมด
          {!isBlank && issue ? ` (= ${issue.quantity} ${issue.unit})` : ''}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Line label="ลายมือชื่อสมาชิก" width={100} />
          <Line label="ผู้ตรวจรับ" width={100} />
        </div>

        <div style={{ marginTop: 4, fontSize: 10 }}>
          <span style={{ marginRight: 12 }}>สถานะ: <CheckBox /> คืนครบ-ปิดใบ</span>
          <CheckBox /> คืนบางส่วน
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px solid #ccc', padding: '3px 10px', backgroundColor: '#f5f5f5', display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#888' }}>
        <span>ค่าจ้าง: งานดี × อัตราต่อหน่วย</span>
        <span>{!isBlank && issue ? `อัตรา ${issue.wage_per_unit} บาท/${issue.unit}` : 'อัตราตามทะเบียนสินค้า'}</span>
        <span>สำเนา {!isBlank && issue ? '①กลุ่ม' : '①กลุ่ม ②สมาชิก'}</span>
      </div>
    </div>
  );
}

/* ───── Main Page ───── */
export default function FormPrint() {
  const [params] = useSearchParams();
  const issueId = params.get('id');
  const blank = params.get('blank') === '1';
  const count = parseInt(params.get('count') ?? '1');

  const { data: issue } = useQuery({
    queryKey: ['issue-detail', issueId],
    queryFn: () => issueApi.get(Number(issueId)),
    enabled: !!issueId
  });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const activeProducts = (products as any[]).filter((p: any) => p.active);

  useEffect(() => {
    if ((issue || blank) && activeProducts.length > 0) {
      setTimeout(() => window.print(), 600);
    }
  }, [issue, blank, activeProducts.length]);

  const formsToRender = blank
    ? Array.from({ length: count }, (_, i) => i)
    : [0];

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; background: white; }
          .no-print { display: none !important; }
          .form-grid { gap: 4mm !important; }
        }
        @media screen {
          body { background: #e0e0e0; }
        }
        * { box-sizing: border-box; }
      `}</style>

      <div className="no-print" style={{ padding: 16, background: '#1e3a5f', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Sarabun, sans-serif', fontSize: 14, fontWeight: 600 }}>
          {blank ? `ฟอร์มเปล่า (${count} ใบ)` : `ใบเบิก-คืน ${issue?.code ?? ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()} style={{ background: 'white', color: '#1e3a5f', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Sarabun, sans-serif', fontWeight: 600 }}>
            🖨️ พิมพ์
          </button>
          <button onClick={() => window.close()} style={{ background: 'transparent', color: 'white', border: '1px solid white', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Sarabun, sans-serif' }}>
            ✕ ปิด
          </button>
        </div>
      </div>

      <div className="form-grid" style={{
        padding: 20, display: 'flex', flexWrap: 'wrap', gap: 16,
        justifyContent: 'flex-start', backgroundColor: '#e0e0e0', minHeight: '100vh'
      }}>
        {formsToRender.map((_, i) => (
          <div key={i}>
            {/* Copy 1 — กลุ่มเก็บ */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 2, fontFamily: 'Sarabun,sans-serif' }}>สำเนา ① กลุ่มเก็บ</div>
              <FormCard issue={issue} products={activeProducts} isBlank={blank} />
            </div>
            {/* Copy 2 — สมาชิกเก็บ (เส้นประตัด) */}
            <div style={{ borderTop: '2px dashed #aaa', paddingTop: 8, marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 2, fontFamily: 'Sarabun,sans-serif' }}>✂ ตัดตรงนี้ — สำเนา ② สมาชิกเก็บ</div>
              <FormCard issue={issue} products={activeProducts} isBlank={blank} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

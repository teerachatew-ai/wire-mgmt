import { useSearchParams } from 'react-router-dom';

/* Thai national-ID digit boxes for the consent doc */
function formatId(id?: string) {
  if (!id) return '____________________';
  const c = id.replace(/\D/g, '');
  if (c.length !== 13) return id;
  return `${c[0]}-${c.slice(1,5)}-${c.slice(5,10)}-${c.slice(10,12)}-${c[12]}`;
}

export default function PdpaConsent() {
  const [params] = useSearchParams();
  const name = params.get('name') || '';
  const idCard = params.get('idcard') || '';
  const code = params.get('code') || '';
  const consented = params.get('consent') === '1';
  const today = new Date();
  const thaiDate = today.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @media screen { body { background: #e0e0e0; } }

        .pdpa-wrap { padding: 24px; display: flex; justify-content: center; min-height: 100vh; }
        .pdpa-page {
          width: 210mm; max-width: 100%; min-height: 297mm; background: #fff;
          padding: 20mm 18mm; font-family: 'Sarabun', sans-serif; font-size: 16px;
          line-height: 1.9; color: #222; box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        }
        /* Phone / tablet: fit the screen, smaller padding & font so it reads like a doc */
        @media screen and (max-width: 820px) {
          .pdpa-wrap { padding: 12px; }
          .pdpa-page { width: 100%; min-height: auto; padding: 22px 18px; font-size: 15px; line-height: 1.75; }
          .pdpa-title { font-size: 18px !important; }
          .pdpa-sign-row { flex-direction: column !important; gap: 24px !important; }
        }
        /* Print: force real A4 regardless of screen size */
        @media print {
          body { margin: 0; background: white; }
          .no-print { display: none !important; }
          .pdpa-wrap { padding: 0; min-height: auto; display: block; }
          .pdpa-page { width: 210mm; max-width: none; padding: 20mm 18mm; box-shadow: none; font-size: 16px; line-height: 1.9; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ padding: 16, background: '#1e3a5f', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Sarabun, sans-serif' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>หนังสือยินยอม PDPA {name && `— ${name}`}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()} style={{ background: 'white', color: '#1e3a5f', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontFamily: 'Sarabun, sans-serif' }}>
            🖨️ พิมพ์ / บันทึก PDF
          </button>
          <button onClick={() => window.close()} style={{ background: 'transparent', color: 'white', border: '1px solid white', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Sarabun, sans-serif' }}>
            ✕ ปิด
          </button>
        </div>
      </div>

      {/* A4 page */}
      <div className="pdpa-wrap">
        <div className="pdpa-page">
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h1 className="pdpa-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>หนังสือให้ความยินยอมเก็บข้อมูลส่วนบุคคล</h1>
            <p style={{ fontSize: 14, color: '#666', margin: '4px 0 0' }}>วิสาหกิจชุมชนกลุ่มจ้างเหมาตัดสายไฟ</p>
            <p style={{ fontSize: 13, color: '#888', margin: '2px 0 0' }}>(ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 - PDPA)</p>
          </div>

          {/* Member info */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '4px 0' }}>
              วันที่ <strong>{thaiDate}</strong>
              {code && <span style={{ marginLeft: 16 }}>รหัสสมาชิก <strong>{code}</strong></span>}
            </p>
            <p style={{ margin: '4px 0' }}>
              ข้าพเจ้า (นาย/นาง/นางสาว) <strong style={{ borderBottom: '1px dotted #555', padding: '0 8px' }}>{name || ' '}</strong>
            </p>
            <p style={{ margin: '4px 0' }}>
              เลขบัตรประชาชน <strong style={{ borderBottom: '1px dotted #555', padding: '0 8px', fontFamily: 'monospace' }}>{formatId(idCard)}</strong>
            </p>
          </div>

          {/* Consent body — simple language */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '10px 0' }}>
              ข้าพเจ้า<strong>ยินยอม</strong>ให้กลุ่มวิสาหกิจชุมชนเก็บและใช้ข้อมูลของข้าพเจ้า ดังนี้
            </p>
            <ul style={{ margin: '8px 0', paddingLeft: 28 }}>
              <li>ชื่อ-นามสกุล และชื่อเล่น</li>
              <li>เลขบัตรประชาชน และที่อยู่</li>
              <li>เบอร์โทรศัพท์</li>
              <li>เลขบัญชีธนาคาร (สำหรับโอนค่าแรง)</li>
            </ul>

            <p style={{ margin: '10px 0' }}><strong>ใช้ข้อมูลเพื่ออะไร</strong></p>
            <ul style={{ margin: '8px 0', paddingLeft: 28 }}>
              <li>ขึ้นทะเบียนเป็นสมาชิกกลุ่ม</li>
              <li>บันทึกการเบิกงาน-คืนงาน และคำนวณค่าแรง</li>
              <li>โอนเงินค่าแรงเข้าบัญชี</li>
              <li>ติดต่อประสานงานเรื่องงาน</li>
            </ul>

            <p style={{ margin: '10px 0' }}>
              กลุ่มจะ<strong>เก็บข้อมูลเป็นความลับ</strong> ไม่นำไปขายหรือเปิดเผยให้ผู้อื่นโดยไม่จำเป็น
              และข้าพเจ้าสามารถ<strong>ขอแก้ไขหรือขอลบข้อมูล</strong>ได้ทุกเมื่อ โดยแจ้งกับกลุ่ม
            </p>
            <p style={{ margin: '10px 0' }}>
              ข้าพเจ้าได้อ่านและเข้าใจข้อความข้างต้นแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐาน
            </p>
          </div>

          {/* Signature — member only */}
          {consented ? (
            <div style={{ marginTop: 40, maxWidth: 360 }}>
              <p style={{ margin: '4px 0' }}>
                ลงชื่อ <strong style={{ fontSize: 18 }}>{name}</strong>
              </p>
              <p style={{ margin: '4px 0', color: '#555' }}>
                ({name}) ผู้ให้ความยินยอม
              </p>
              <p style={{ margin: '8px 0 0', color: '#555' }}>
                วันที่ {thaiDate}
              </p>
              <p style={{ margin: '12px 0 0', fontSize: 13, color: '#888' }}>
                * สมาชิกได้กดยืนยันรับทราบและให้ความยินยอมผ่านระบบแล้ว
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 50, maxWidth: 360 }}>
              <div style={{ borderBottom: '1px dotted #555', height: 24, marginBottom: 6 }} />
              <p style={{ margin: 0, textAlign: 'center' }}>(ผู้ให้ความยินยอม / สมาชิก)</p>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: '#666', textAlign: 'center' }}>วันที่ ......./......./.......</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

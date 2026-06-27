# ระบบบริหารงานจ้างเหมาตัดสายไฟ — วิสาหกิจชุมชน

## วิธีติดตั้งและเริ่มใช้งาน

### 1. ติดตั้ง Node.js (ถ้ายังไม่มี)
ดาวน์โหลดจาก https://nodejs.org แล้วติดตั้ง LTS version

### 2. ตั้งค่า API Key (สำหรับฟีเจอร์ OCR)
```
set ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxx
```

### 3. ติดตั้ง Backend dependencies
```
cd wire-mgmt
npm install
```

### 4. ติดตั้ง Frontend dependencies
```
cd client
npm install
cd ..
```

### 5. เริ่มใช้งาน (2 terminal)

**Terminal 1 — Backend:**
```
cd wire-mgmt
npm run dev
```
Server จะรันที่ http://localhost:3001

**Terminal 2 — Frontend:**
```
cd wire-mgmt\client
npm run dev
```
เปิดเบราว์เซอร์ไปที่ http://localhost:5173

---

## โครงสร้างระบบ

```
wire-mgmt/
├── server/              # Express API + SQLite
│   ├── index.ts         # Entry point
│   ├── db.ts            # Database schema
│   └── routes/
│       ├── members.ts   # ทะเบียนสมาชิก
│       ├── products.ts  # ประเภทสินค้า
│       ├── receives.ts  # รับของจากโรงงาน
│       ├── issues.ts    # ใบเบิกงาน
│       ├── returns.ts   # ใบรับคืน
│       ├── reports.ts   # รายงาน + Dashboard
│       └── ocr.ts       # AI อ่านฟอร์ม (Claude Vision)
│
├── client/              # React + Vite + Tailwind
│   └── src/pages/
│       ├── Dashboard.tsx
│       ├── Members.tsx
│       ├── Products.tsx
│       ├── Receives.tsx
│       ├── Issues.tsx
│       ├── Returns.tsx
│       ├── Payroll.tsx
│       ├── Reports.tsx
│       ├── OCR.tsx
│       └── SettingsPage.tsx
│
└── data/
    └── wire-mgmt.db     # SQLite database (สร้างอัตโนมัติ)
```

## ฟีเจอร์ตามเฟส

### เฟส 1 ✅ (ครบแล้ว)
- ทะเบียนสมาชิก (เพิ่ม/แก้ไข/ค้นหา)
- ทะเบียนสินค้า/รุ่นสายไฟ
- รับของจากโรงงาน
- ใบเบิกงาน (พร้อม Business Rules ตรวจสอบเพดาน/งานค้าง)
- รับคืนงาน (ตรวจนับดี/เสีย/เศษ + ปิดใบเบิกอัตโนมัติ)

### เฟส 2 ✅ (ครบแล้ว)
- Dashboard — สต๊อก, งานค้าง, % ของเสีย
- สรุปค่าแรงงวด + Export CSV
- รายงาน: ของค้างอยู่กับใคร, กระทบยอดสต๊อก, ประวัติรายคน
- แจ้งเตือนงานค้างเกินกำหนด + ของเสียเกินเกณฑ์

### เฟส 3 (ออกแบบไว้)
- QR Code ติดมัดสายไฟ
- แจ้งเตือนผ่าน LINE

## OCR อ่านฟอร์ม

ระบบใช้ Claude AI (claude-opus-4-5) อ่านรูปถ่ายแบบฟอร์มกระดาษ:
1. อัปโหลดรูปถ่ายฟอร์ม
2. AI อ่านข้อมูลและเติมฟอร์มให้อัตโนมัติ
3. แอดมินตรวจทานและแก้ไข
4. กดยืนยันเพื่อบันทึกลงระบบ

ต้องการ `ANTHROPIC_API_KEY` สำหรับฟีเจอร์นี้

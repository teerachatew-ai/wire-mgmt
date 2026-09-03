# โฮสต์สำรอง (Fly.io) — ใช้ตอน Render ล่ม

Render = ตัวหลัก (ใช้งานปกติ) · Fly.io = ตัวสำรอง (ปิดไว้ตลอด เปิดเฉพาะตอนตัวหลักใช้ไม่ได้)

> ⚠️ **ห้ามเปิดพร้อมกัน 2 ที่**
> ฐานข้อมูลถูกเก็บเป็นไฟล์ก้อนเดียวใน Postgres แล้ว**เขียนทับทั้งก้อน**ทุกครั้งที่มีการแก้ข้อมูล
> ถ้า Render กับ Fly ทำงานพร้อมกันโดยใช้ `DATABASE_URL` เดียวกัน ต่างฝ่ายต่างถือสำเนาของตัวเอง
> แล้วเขียนทับกัน = **ข้อมูลหายทั้งฐาน**
> ระบบมีตัวกันไว้แล้ว (เลข generation) — ถ้าตรวจพบว่ามีอีกฝั่งเขียนแทรก ฝั่งที่มาทีหลังจะ
> **หยุดบันทึกและขึ้น error ใน log** แทนการทับข้อมูลทิ้ง แต่ก็ยังต้องปิดฝั่งที่ไม่ใช้อยู่ดี
> ไม่งั้นงานที่กรอกในฝั่งนั้นจะไม่ถูกบันทึก

---

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)

1. ติดตั้ง flyctl แล้ว login

```bash
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

```bash
fly auth login
```

2. สร้างแอป (อย่าเพิ่ง deploy — `fly.toml` มีอยู่ในโปรเจกต์แล้ว ไม่ต้องให้มันสร้างทับ)

```bash
fly launch --no-deploy --copy-config --name wire-mgmt --region sin
```

3. ใส่ค่า secret — ใช้ **DATABASE_URL ตัวเดียวกับ Render** (ข้อมูลชุดเดียวกัน จะได้สลับไปใช้แล้วข้อมูลต่อเนื่อง)

```bash
fly secrets set DATABASE_URL="<connection string ตัวเดียวกับที่ตั้งไว้บน Render>"
```

```bash
fly secrets set ANTHROPIC_API_KEY="<key เดิม>"
```

4. build + deploy ครั้งแรก แล้ว**ปิดเครื่องทิ้งไว้** (ยังไม่ใช้งาน)

```bash
fly deploy
```

```bash
fly machine list
```

```bash
fly machine stop <machine-id>
```

---

## เวลา Render ล่ม — สลับมาใช้ Fly

1. **ปิด Render ก่อน** (สำคัญที่สุด — กันเขียนทับกัน)
   Render Dashboard → service `wire-mgmt` → **Suspend Web Service**

2. เปิดเครื่องสำรอง

```bash
fly machine start <machine-id>
```

3. เช็คว่าขึ้นแล้ว

```bash
fly status
```

```bash
fly logs
```

4. เข้าใช้งานที่ `https://wire-mgmt.fly.dev`

---

## กลับไปใช้ Render เหมือนเดิม

1. **ปิด Fly ก่อน**

```bash
fly machine stop <machine-id>
```

2. เปิด Render กลับ (Resume Web Service) แล้วกด Manual Deploy

> ข้อมูลที่กรอกช่วงที่ใช้ Fly อยู่ในฐานกลางตัวเดียวกันแล้ว Render จะโหลดต่อได้เลย
> ขอให้แน่ใจว่า Fly หยุดสนิทก่อน (`fly status` ต้องไม่มีเครื่องที่ started) ค่อยเปิด Render

---

## อัปเดตโค้ดใหม่ขึ้นตัวสำรอง

ตัวสำรองไม่ได้ auto-deploy ตาม git เหมือน Render — ต้องสั่งเอง (ทำตอนที่ Fly ปิดอยู่ได้เลย ปลอดภัย):

```bash
fly deploy
```

deploy เสร็จเครื่องจะถูกปิดตามเดิม เพราะ `auto_start_machines = false` ใน `fly.toml`

---

## เช็ก log ว่าโดนตัวกันข้อมูลทับหรือเปล่า

ถ้าใน log เจอข้อความนี้ แปลว่ามี 2 ฝั่งเปิดพร้อมกัน — ให้ปิดฝั่งที่ไม่ได้ใช้ทันที
แล้วตรวจว่างานที่กรอกฝั่งนั้นครบไหม (ของฝั่งที่หยุดเขียนจะไม่ถูกบันทึก):

```
🛑 หยุดบันทึกลงฐานข้อมูลกลาง: ตรวจพบว่ามีระบบอีกชุดเขียนข้อมูลชุดเดียวกันอยู่
```

# ----- Build & run image for cloud (Linux) -----
FROM node:20-slim

# ระบบที่ต้องใช้: python3 + openpyxl (เติมใบวางบิล), libreoffice-calc (แปลง PDF), ฟอนต์ไทย
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-openpyxl \
      libreoffice-calc \
      fonts-thai-tlwg \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ติดตั้งฟอนต์ Cordia New / Angsana New (เหมือนใน Excel) ให้ LibreOffice ใช้แปลง PDF ตรงกับต้นฉบับ
COPY fonts /usr/share/fonts/truetype/msthai
RUN fc-cache -f

# ติดตั้ง dependencies ของ backend (รวม devDeps สำหรับ build, ข้าม optional=pcsclite ที่ build ไม่ได้บน Linux)
COPY package*.json ./
RUN npm install --omit=optional
# sharp (ประทับข้อความบนรูป NG) เก็บ binary ของแต่ละ OS เป็น optional dependency ซึ่งถูกข้ามด้วย --omit=optional ข้างบน
# จึงติดตั้ง binary ของ Linux แยกเอง — เวอร์ชันต้องตรงกับ sharp ใน package.json (ดู node_modules/sharp/package.json)
RUN npm install --no-save --omit=optional @img/sharp-linux-x64@0.34.4 @img/sharp-libvips-linux-x64@1.2.3     && node -e "require('sharp')"

# ติดตั้ง + build frontend
COPY client/package*.json ./client/
RUN npm install --prefix client
COPY client ./client
RUN npm run build --prefix client

# build backend (typescript)
COPY tsconfig.json ./
COPY server ./server
RUN npx tsc

ENV NODE_ENV=production
# Render กำหนด PORT มาให้ทาง env เอง (โค้ดอ่าน process.env.PORT)
EXPOSE 3001

CMD ["node", "dist/server/index.js"]

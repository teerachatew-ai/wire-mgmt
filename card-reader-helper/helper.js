// ตัวช่วยอ่านบัตรประชาชน — รันบนเครื่องที่เสียบเครื่องอ่านบัตร
// เปิดพอร์ต http://127.0.0.1:47011/read ให้หน้าเว็บเรียกใช้ได้ (ทุกที่/ทุกเครื่อง)
const http = require('http');
const iconv = require('iconv-lite');

const PORT = 47011;

const THAI_AID = [0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01];
const SELECT_APP = [0x00, 0xA4, 0x04, 0x00, THAI_AID.length, ...THAI_AID];
const F = {
  cid:     [0x80, 0xb0, 0x00, 0x04, 0x02, 0x00, 0x0d],
  nameTH:  [0x80, 0xb0, 0x00, 0x11, 0x02, 0x00, 0x64],
  nameEN:  [0x80, 0xb0, 0x00, 0x75, 0x02, 0x00, 0x64],
  dob:     [0x80, 0xb0, 0x00, 0xD9, 0x02, 0x00, 0x08],
  gender:  [0x80, 0xb0, 0x00, 0xE1, 0x02, 0x00, 0x01],
  address: [0x80, 0xb0, 0x15, 0x79, 0x02, 0x00, 0x64],
};

function decodeTIS620(buf) {
  let end = buf.length;
  while (end > 0 && (buf[end - 1] === 0xff || buf[end - 1] === 0x00 || buf[end - 1] === 0x20)) end--;
  return iconv.decode(buf.slice(0, end), 'tis620').trim();
}
function transmit(reader, cmd, protocol) {
  return new Promise((resolve, reject) => {
    reader.transmit(Buffer.from(cmd), 258, protocol, (err, data) => {
      if (err) return reject(new Error(err.message));
      if (!data || data.length < 2) return reject(new Error('empty response'));
      resolve(data);
    });
  });
}
async function selectApp(reader, protocol) {
  const resp = await transmit(reader, SELECT_APP, protocol);
  const sw1 = resp[resp.length - 2];
  if (sw1 !== 0x90 && sw1 !== 0x61) {
    const sw2 = resp[resp.length - 1];
    throw new Error(`SELECT failed SW: ${sw1.toString(16).padStart(2,'0')}${sw2.toString(16).padStart(2,'0')}`);
  }
}
async function readField(reader, protocol, cmd) {
  const wantLen = cmd[cmd.length - 1];
  let resp = await transmit(reader, cmd, protocol);
  let sw1 = resp[resp.length - 2];
  let sw2 = resp[resp.length - 1];
  if (sw1 === 0x61) {
    resp = await transmit(reader, [0x00, 0xC0, 0x00, 0x00, sw2], protocol);
    sw1 = resp[resp.length - 2]; sw2 = resp[resp.length - 1];
  } else if (sw1 === 0x90 && resp.length <= 2) {
    resp = await transmit(reader, [0x00, 0xC0, 0x00, 0x00, wantLen], protocol);
    sw1 = resp[resp.length - 2]; sw2 = resp[resp.length - 1];
  }
  if (sw1 !== 0x90) throw new Error(`READ failed SW: ${sw1.toString(16).padStart(2,'0')}${sw2.toString(16).padStart(2,'0')}`);
  return resp.slice(0, -2);
}
function parseDate(s) {
  const c = s.replace(/[^0-9]/g, '');
  if (c.length !== 8) return '';
  const yearCE = parseInt(c.slice(0, 4)) - 543;
  if (isNaN(yearCE)) return '';
  return `${yearCE}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
}

function readCard() {
  return new Promise((resolve) => {
    let done = false, connecting = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let pcsc;
    try { pcsc = require('pcsclite')(); }
    catch { return finish({ error: 'ไม่พบ PCSC service — ตรวจสอบว่าเสียบเครื่องอ่านบัตรและลงไดรเวอร์แล้ว' }); }
    const cleanup = () => { try { pcsc.close(); } catch {} };
    const timer = setTimeout(() => { cleanup(); finish({ error: 'ไม่พบบัตร — กรุณาเสียบบัตรประชาชนแล้วลองใหม่' }); }, 15000);
    pcsc.on('error', (err) => { clearTimeout(timer); cleanup(); finish({ error: err.message }); });
    pcsc.on('reader', (reader) => {
      reader.on('error', () => {});
      reader.on('status', (status) => {
        const present = status.state & reader.SCARD_STATE_PRESENT;
        if (!present || connecting || done) return;
        connecting = true;
        reader.connect({ share_mode: reader.SCARD_SHARE_SHARED, protocol: reader.SCARD_PROTOCOL_T0 || 1 }, async (err, protocol) => {
          if (err) { clearTimeout(timer); cleanup(); return finish({ error: `เชื่อมต่อบัตรไม่ได้: ${err.message}` }); }
          try {
            await selectApp(reader, protocol);
            const cidBuf = await readField(reader, protocol, F.cid);
            const nameTHBuf = await readField(reader, protocol, F.nameTH);
            const nameENBuf = await readField(reader, protocol, F.nameEN);
            const dobBuf = await readField(reader, protocol, F.dob);
            const sexBuf = await readField(reader, protocol, F.gender);
            const addrBuf = await readField(reader, protocol, F.address);
            const cid = cidBuf.toString('ascii').replace(/[^0-9]/g, '');
            const nameTH = decodeTIS620(nameTHBuf);
            const nameEN = decodeTIS620(nameENBuf);
            const addr = decodeTIS620(addrBuf).replace(/#+/g, ' ').trim();
            const fullName = nameTH.split('#').map(s => s.trim()).filter(Boolean).join(' ');
            reader.disconnect(reader.SCARD_LEAVE_CARD, () => {});
            clearTimeout(timer); cleanup();
            finish({
              id_card: cid, name: fullName,
              name_en: nameEN.replace(/#+/g, ' ').trim(),
              dob: parseDate(dobBuf.toString('ascii')),
              sex: sexBuf[0] === 0x31 ? 'ชาย' : 'หญิง',
              address: addr,
            });
          } catch (e) {
            reader.disconnect(reader.SCARD_LEAVE_CARD, () => {});
            clearTimeout(timer); cleanup();
            finish({ error: `อ่านบัตรไม่สำเร็จ: ${e.message}` });
          }
        });
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = (req.url || '').split('?')[0];
  if (url === '/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, helper: 'card-reader', version: 1 })); }
  if (url === '/read') {
    const result = await readCard();
    res.writeHead(result.error ? 500 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==================================================');
  console.log('  ตัวช่วยอ่านบัตรประชาชน พร้อมใช้งานแล้ว ✅');
  console.log('  (เปิดหน้าต่างนี้ทิ้งไว้ระหว่างใช้งาน)');
  console.log('  พอร์ต: http://127.0.0.1:' + PORT);
  console.log('==================================================');
});

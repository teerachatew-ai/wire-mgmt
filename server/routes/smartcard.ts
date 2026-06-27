import { Router } from 'express';
import iconv from 'iconv-lite';

const router = Router();

/* ─────────────────────────────────────────────
   Thai National ID card — canonical APDU set
   CLA = 0x80, proprietary READ BINARY, T=0 GET RESPONSE
   ───────────────────────────────────────────── */
const THAI_AID = [0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01];
const SELECT_APP = [0x00, 0xA4, 0x04, 0x00, THAI_AID.length, ...THAI_AID];

// [CLA, INS, P1, P2, Lc, dataHi, length]
const F = {
  cid:     [0x80, 0xb0, 0x00, 0x04, 0x02, 0x00, 0x0d],
  nameTH:  [0x80, 0xb0, 0x00, 0x11, 0x02, 0x00, 0x64],
  nameEN:  [0x80, 0xb0, 0x00, 0x75, 0x02, 0x00, 0x64],
  dob:     [0x80, 0xb0, 0x00, 0xD9, 0x02, 0x00, 0x08],
  gender:  [0x80, 0xb0, 0x00, 0xE1, 0x02, 0x00, 0x01],
  address: [0x80, 0xb0, 0x15, 0x79, 0x02, 0x00, 0x64],
};

function decodeTIS620(buf: Buffer): string {
  let end = buf.length;
  while (end > 0 && (buf[end - 1] === 0xff || buf[end - 1] === 0x00 || buf[end - 1] === 0x20)) end--;
  return iconv.decode(buf.slice(0, end), 'tis620').trim();
}

// Raw transmit — returns full APDU response (data + SW1 SW2)
function transmit(reader: any, cmd: number[], protocol: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    reader.transmit(Buffer.from(cmd), 258, protocol, (err: any, data: Buffer) => {
      if (err) return reject(new Error(err.message));
      if (!data || data.length < 2) return reject(new Error('empty response'));
      resolve(data);
    });
  });
}

// SELECT — accept 90xx or 61xx
async function selectApp(reader: any, protocol: number): Promise<void> {
  const resp = await transmit(reader, SELECT_APP, protocol);
  const sw1 = resp[resp.length - 2];
  if (sw1 !== 0x90 && sw1 !== 0x61) {
    const sw2 = resp[resp.length - 1];
    throw new Error(`SELECT failed SW: ${sw1.toString(16).padStart(2,'0')}${sw2.toString(16).padStart(2,'0')}`);
  }
}

// Read a field: send proprietary read, then GET RESPONSE (T=0 two-step)
async function readField(reader: any, protocol: number, cmd: number[]): Promise<Buffer> {
  const wantLen = cmd[cmd.length - 1];
  let resp = await transmit(reader, cmd, protocol);
  let sw1 = resp[resp.length - 2];
  let sw2 = resp[resp.length - 1];

  // T=0: card says "data ready, fetch with GET RESPONSE" (61 XX)
  if (sw1 === 0x61) {
    resp = await transmit(reader, [0x00, 0xC0, 0x00, 0x00, sw2], protocol);
    sw1 = resp[resp.length - 2];
    sw2 = resp[resp.length - 1];
  } else if (sw1 === 0x90 && resp.length <= 2) {
    // Some readers need explicit GET RESPONSE with expected length
    resp = await transmit(reader, [0x00, 0xC0, 0x00, 0x00, wantLen], protocol);
    sw1 = resp[resp.length - 2];
    sw2 = resp[resp.length - 1];
  }

  if (sw1 !== 0x90) {
    throw new Error(`READ failed SW: ${sw1.toString(16).padStart(2,'0')}${sw2.toString(16).padStart(2,'0')}`);
  }
  return resp.slice(0, -2);
}

function parseDate(s: string): string {
  const c = s.replace(/[^0-9]/g, '');
  if (c.length !== 8) return '';
  const yearCE = parseInt(c.slice(0, 4)) - 543;
  if (isNaN(yearCE)) return '';
  return `${yearCE}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
}

router.get('/read', (req, res) => {
  let done = false;
  let connecting = false;
  const finish = (result: any) => {
    if (done) return;
    done = true;
    if (result.error) res.status(500).json({ error: result.error });
    else res.json(result);
  };

  let pcsc: any;
  try {
    pcsc = require('pcsclite')();
  } catch {
    return res.status(500).json({ error: 'ไม่พบ PCSC service ตรวจสอบว่าเสียบ card reader แล้ว' });
  }

  const cleanup = () => { try { pcsc.close(); } catch {} };
  const timer = setTimeout(() => {
    cleanup();
    finish({ error: 'ไม่พบบัตร — กรุณาเสียบบัตรประชาชนแล้วกดลองใหม่' });
  }, 15000);

  pcsc.on('error', (err: any) => { clearTimeout(timer); cleanup(); finish({ error: err.message }); });

  pcsc.on('reader', (reader: any) => {
    reader.on('error', () => {});
    reader.on('status', (status: any) => {
      const present = status.state & reader.SCARD_STATE_PRESENT;
      if (!present || connecting || done) return;
      connecting = true;

      // Thai ID card is T=0
      reader.connect(
        { share_mode: reader.SCARD_SHARE_SHARED, protocol: reader.SCARD_PROTOCOL_T0 || 1 },
        async (err: any, protocol: number) => {
          if (err) {
            clearTimeout(timer); cleanup();
            return finish({ error: `เชื่อมต่อบัตรไม่ได้: ${err.message}` });
          }
          try {
            await selectApp(reader, protocol);

            const cidBuf    = await readField(reader, protocol, F.cid);
            const nameTHBuf = await readField(reader, protocol, F.nameTH);
            const nameENBuf = await readField(reader, protocol, F.nameEN);
            const dobBuf    = await readField(reader, protocol, F.dob);
            const sexBuf    = await readField(reader, protocol, F.gender);
            const addrBuf   = await readField(reader, protocol, F.address);

            const cid    = cidBuf.toString('ascii').replace(/[^0-9]/g, '');
            const nameTH = decodeTIS620(nameTHBuf);   // "คำนำหน้า#ชื่อ##นามสกุล"
            const nameEN = decodeTIS620(nameENBuf);
            const addr   = decodeTIS620(addrBuf).replace(/#+/g, ' ').trim();

            const parts    = nameTH.split('#').map(s => s.trim()).filter(Boolean);
            const fullName = parts.join(' ');

            reader.disconnect(reader.SCARD_LEAVE_CARD, () => {});
            clearTimeout(timer); cleanup();

            finish({
              id_card:  cid,
              name:     fullName,
              name_en:  nameEN.replace(/#+/g, ' ').trim(),
              dob:      parseDate(dobBuf.toString('ascii')),
              sex:      sexBuf[0] === 0x31 ? 'ชาย' : 'หญิง',
              address:  addr,
            });
          } catch (e: any) {
            reader.disconnect(reader.SCARD_LEAVE_CARD, () => {});
            clearTimeout(timer); cleanup();
            finish({ error: `อ่านบัตรไม่สำเร็จ: ${e.message}` });
          }
        }
      );
    });
  });
});

export default router;

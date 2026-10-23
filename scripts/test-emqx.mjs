#!/usr/bin/env node
/**
 * AGRAPATHA — EMQX Broker Diagnostics & Verification Script
 * Tests both:
 * 1. Port 8883: MQTT over TLS/SSL (For ESP32 / ESP32-CAM & Native Backend)
 * 2. Port 8084: WebSocket over TLS/SSL (WSS) (For Browser Dashboard)
 * 3. MQTT 3.1.1 CONNECT Handshake & Authentication Verification
 */

import tls from 'node:tls';
import https from 'node:https';

// Parse arguments
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return fallback;
}

const HOST = getArg('--host', process.env.VITE_MQTT_HOST || 'wfc1ec11.ala.asia-southeast1.emqxsl.com');
const TLS_PORT = parseInt(getArg('--tls-port', process.env.VITE_MQTT_TCP_PORT || '8883'), 10);
const WS_PORT = parseInt(getArg('--ws-port', process.env.VITE_MQTT_WS_PORT || '8084'), 10);
const USERNAME = getArg('--username', process.env.VITE_MQTT_USERNAME || 'grenvis_esp32');
const PASSWORD = getArg('--password', process.env.VITE_MQTT_PASSWORD || 'grenvis123');

console.log('='.repeat(70));
console.log('  AGRAPATHA - EMQX CLUSTER DIAGNOSTIC SUITE');
console.log('='.repeat(70));
console.log(`Broker Host : ${HOST}`);
console.log(`Port 8883   : MQTT over TLS/SSL (ESP32 / Microcontrollers / Backend)`);
console.log(`Port 8084   : WebSocket over TLS/SSL (React Browser Dashboard)`);
console.log(`Credentials : ${USERNAME ? `User '${USERNAME}' provided` : 'None provided (Testing anonymous / auth prompt)'}`);
console.log('='.repeat(70));

async function testTlsPort() {
  return new Promise((resolve) => {
    console.log(`\n[1/3] Menguji Port ${TLS_PORT} (Native MQTT over TLS/SSL)...`);
    const start = Date.now();
    const socket = tls.connect(
      TLS_PORT,
      HOST,
      { servername: HOST, rejectUnauthorized: true },
      () => {
        const latency = Date.now() - start;
        console.log(`  ✓ TLS Handshake BERHASIL (${latency} ms)`);
        console.log(`    - Sertifikat Valid   : ${socket.authorized ? 'YA (Valid Trusted CA)' : 'TIDAK'}`);
        console.log(`    - Versi Protokol     : ${socket.getProtocol()}`);
        console.log(`    - Cipher Suite       : ${socket.getCipher()?.name}`);
        socket.end();
        resolve(true);
      }
    );

    socket.setTimeout(6000, () => {
      console.log(`  ✗ Timeout menghubungkan ke Port ${TLS_PORT}`);
      socket.destroy();
      resolve(false);
    });

    socket.on('error', (err) => {
      console.log(`  ✗ Gagal koneksi TLS Port ${TLS_PORT}: ${err.message}`);
      resolve(false);
    });
  });
}

async function testWebSocketPort() {
  return new Promise((resolve) => {
    console.log(`\n[2/3] Menguji Port ${WS_PORT} (WSS / WebSocket over TLS)...`);
    const start = Date.now();
    const req = https.request({
      hostname: HOST,
      port: WS_PORT,
      path: '/mqtt',
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Protocol': 'mqtt',
      },
    });

    req.setTimeout(6000, () => {
      console.log(`  ✗ Timeout menghubungkan ke WebSocket Port ${WS_PORT}`);
      req.destroy();
      resolve(false);
    });

    req.on('upgrade', (res, socket) => {
      const latency = Date.now() - start;
      console.log(`  ✓ WebSocket Handshake BERHASIL (${latency} ms)`);
      console.log(`    - HTTP Status        : ${res.statusCode} (Switching Protocols)`);
      console.log(`    - Sub-protokol       : ${res.headers['sec-websocket-protocol'] || 'mqtt'}`);
      console.log(`    - Web Server         : ${res.headers.server || 'EMQX Cowboy'}`);
      console.log(`    - URL Browser        : wss://${HOST}:${WS_PORT}/mqtt`);
      socket.end();
      resolve(true);
    });

    req.on('response', (res) => {
      console.log(`  ! Respon HTTP diterima tanpa Upgrade: Status ${res.statusCode}`);
      resolve(false);
    });

    req.on('error', (err) => {
      console.log(`  ✗ Gagal koneksi WebSocket Port ${WS_PORT}: ${err.message}`);
      resolve(false);
    });

    req.end();
  });
}

async function testMqttConnect() {
  return new Promise((resolve) => {
    console.log(`\n[3/3] Menguji MQTT CONNECT Packet & Otorisasi...`);
    const clientId = `agrapatha-probe-${Math.floor(Math.random() * 100000)}`;

    const socket = tls.connect(
      TLS_PORT,
      HOST,
      { servername: HOST, rejectUnauthorized: true },
      () => {
        // Build MQTT 3.1.1 CONNECT packet
        const protoName = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54]); // 'MQTT'
        const protoLevel = 0x04; // 3.1.1
        let connectFlags = 0x02; // Clean session
        if (USERNAME) connectFlags |= 0x80;
        if (PASSWORD) connectFlags |= 0x40;

        const keepAlive = Buffer.from([0x00, 0x3c]); // 60s

        // Payload
        const cIdBuf = Buffer.alloc(2 + clientId.length);
        cIdBuf.writeUInt16BE(clientId.length, 0);
        cIdBuf.write(clientId, 2);

        const payloadChunks = [cIdBuf];

        if (USERNAME) {
          const userBuf = Buffer.alloc(2 + Buffer.byteLength(USERNAME));
          userBuf.writeUInt16BE(Buffer.byteLength(USERNAME), 0);
          userBuf.write(USERNAME, 2);
          payloadChunks.push(userBuf);
        }

        if (PASSWORD) {
          const passBuf = Buffer.alloc(2 + Buffer.byteLength(PASSWORD));
          passBuf.writeUInt16BE(Buffer.byteLength(PASSWORD), 0);
          passBuf.write(PASSWORD, 2);
          payloadChunks.push(passBuf);
        }

        const variableHeader = Buffer.concat([
          protoName,
          Buffer.from([protoLevel, connectFlags]),
          keepAlive,
        ]);

        const fullPayload = Buffer.concat(payloadChunks);
        const remainingLength = variableHeader.length + fullPayload.length;

        // Encode remaining length (MQTT var-byte integer)
        const lenBytes = [];
        let len = remainingLength;
        do {
          let encodedByte = len % 128;
          len = Math.floor(len / 128);
          if (len > 0) encodedByte |= 128;
          lenBytes.push(encodedByte);
        } while (len > 0);

        const packet = Buffer.concat([
          Buffer.from([0x10, ...lenBytes]),
          variableHeader,
          fullPayload,
        ]);

        socket.write(packet);
      }
    );

    socket.setTimeout(6000, () => {
      console.log('  ✗ Timeout menunggu respon CONNACK');
      socket.destroy();
      resolve(false);
    });

    socket.on('data', (data) => {
      if (data.length >= 4 && data[0] === 0x20) {
        const returnCode = data[3];
        console.log(`  Respon CONNACK Diterima (Kode: ${returnCode}):`);
        switch (returnCode) {
          case 0:
            console.log('  ✓ [KODE 0] KONEKSI BERHASIL DITERIMA (Connection Accepted)!');
            console.log('    Broker siap digunakan untuk publish & subscribe.');
            break;
          case 1:
            console.log('  ✗ [KODE 1] Connection Refused, unacceptable protocol version');
            break;
          case 2:
            console.log('  ✗ [KODE 2] Connection Refused, identifier rejected');
            break;
          case 3:
            console.log('  ✗ [KODE 3] Connection Refused, server unavailable');
            break;
          case 4:
            console.log('  ! [KODE 4] Bad Username or Password');
            console.log('    -> EMQX Cloud mengharuskan otentikasi Username/Password.');
            console.log('    -> Konfigurasikan Akun di EMQX Console: Authentication -> Password-Based.');
            console.log('    -> Kemudian masukkan ke .env (VITE_MQTT_USERNAME & VITE_MQTT_PASSWORD).');
            break;
          case 5:
            console.log('  ! [KODE 5] Not Authorized');
            console.log('    -> Pengguna tidak memiliki izin ACL.');
            break;
          default:
            console.log(`  ! Respon kode CONNACK lain: ${returnCode}`);
        }
      }
      socket.end();
      resolve(true);
    });

    socket.on('error', (err) => {
      console.log(`  ✗ Error selama pertukaran MQTT: ${err.message}`);
      resolve(false);
    });
  });
}

async function run() {
  const tlsOk = await testTlsPort();
  const wsOk = await testWebSocketPort();
  await testMqttConnect();

  console.log('\n' + '='.repeat(70));
  console.log('RINGKASAN HASIL PENGUJIAN:');
  console.log(`- Port 8883 (Hardware / ESP32 TLS)  : ${tlsOk ? 'TERHUBUNG & AKTIF' : 'GAGAL'}`);
  console.log(`- Port 8084 (Dashboard Browser WSS) : ${wsOk ? 'TERHUBUNG & AKTIF' : 'GAGAL'}`);
  console.log('='.repeat(70));
}

run();

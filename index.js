const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino     = require("pino");
const http     = require("http");

const { sendMenu }                          = require("./commands/menu");
const { cmdSaldo, cmdRiwayat, cmdIsiSaldo } = require("./commands/saldo");
const { cmdML, cmdFF, handleOrder, handleFoto } = require("./commands/order");
const { handleOwner, isOwner }              = require("./admin/owner");
const { getSetting }                        = require("./helper/db");
const state                                 = require("./helper/state");
const cfg                                   = require("./config");

/* ── Keep-alive server (Railway butuh port terbuka) ── */
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Kalstore Bot is running!");
}).listen(PORT, () => console.log(`🌐 Server jalan di port ${PORT}`));

/* ── Pairing code log (ditampilkan di Railway logs) ── */
let pairingLogged = false;
let retryCount    = 0;

async function startBot() {
  const { state: authState, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, pino({ level: "silent" })),
    },
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "120.0.0"],
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    retryRequestDelayMs: 2000,
  });

  sock.ev.on("creds.update", saveCreds);

  /* ── Auto pairing code saat belum login ── */
  if (!authState.creds.registered && !pairingLogged) {
    pairingLogged = true;
    await new Promise(r => setTimeout(r, 3000));
    try {
      const nomor = cfg.botNumber;
      const code  = await sock.requestPairingCode(nomor);
      console.log("╔══════════════════════════════╗");
      console.log("║   WA PAIRING CODE:           ║");
      console.log(`║   >>> ${code} <<<        ║`);
      console.log("╚══════════════════════════════╝");
      console.log("Buka WA → Perangkat Tertaut → Tautkan dgn nomor → Masukkan kode");
    } catch (e) {
      console.error("❌ Gagal pairing:", e.message);
      pairingLogged = false;
    }
  }

  /* ── Connection update ── */
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      retryCount    = 0;
      pairingLogged = true;
      console.log("✅ Kalstore Bot terhubung!");
    }
    if (connection === "close") {
      const code   = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const logout = code === DisconnectReason.loggedOut;
      console.log(`❌ Koneksi terputus (${code}). Logout: ${logout}`);
      if (logout) {
        console.log("⚠️  Logout! Hapus auth_info dan restart.");
        pairingLogged = false;
      }
      retryCount++;
      const delay = Math.min(5000 * retryCount, 60000);
      console.log(`🔄 Reconnect ke-${retryCount} dalam ${delay / 1000}s...`);
      setTimeout(startBot, delay);
    }
  });

  /* ── Pesan masuk ── */
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg?.message || msg.key.fromMe) return;
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@g.us")) return;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text || "";
      const isImage = !!(msg.message?.imageMessage);
      const lower   = text.trim().toLowerCase();

      if (getSetting("maintenance") && !isOwner(jid)) {
        await sock.sendMessage(jid, { text: `🔧 *Bot sedang maintenance.*\nHubungi CS: wa.me/${cfg.csNumber}` });
        return;
      }

      if (text.startsWith(".") && isOwner(jid)) {
        const handled = await handleOwner(sock, jid, text);
        if (handled) return;
      }

      if (isImage) { await handleFoto(sock, jid, msg); return; }
      if (!text) return;

      const s = state.get(jid);
      if (s?.step === "isi_saldo") {
        const nominal = parseInt(text.replace(/\D/g, ""));
        if (isNaN(nominal) || nominal < 1000) {
          await sock.sendMessage(jid, { text: "❌ Masukkan nominal yang valid.\nContoh: *50000*" });
          return;
        }
        state.set(jid, { step: "isi_saldo_bukti", nominal });
        await sock.sendMessage(jid, { text: `✅ Nominal: *Rp ${nominal.toLocaleString("id-ID")}*\n\nSekarang kirim *bukti pembayaran* (foto/screenshot).` });
        return;
      }

      if (s && s.step !== "tunggu_bukti" && s.step !== "isi_saldo_bukti") {
        if (lower === ".menu" || lower === "batal") {
          state.clear(jid); await sendMenu(sock, jid); return;
        }
        const handled = await handleOrder(sock, jid, text);
        if (handled) return;
      }

      switch (lower) {
        case ".menu":                    await sendMenu(sock, jid);    break;
        case ".ml": case "ml":           await cmdML(sock, jid);       break;
        case ".ff": case "ff":           await cmdFF(sock, jid);       break;
        case ".saldo": case "saldo":     await cmdSaldo(sock, jid);    break;
        case ".s":                       await cmdIsiSaldo(sock, jid); break;
        case ".riwayat": case "riwayat": await cmdRiwayat(sock, jid);  break;
        default:
          await sock.sendMessage(jid, { text: `❓ Perintah tidak dikenal.\nKetik *.menu* untuk melihat menu.\nBantuan: wa.me/${cfg.csNumber}` });
      }
    } catch (err) {
      console.error("Error:", err.message);
    }
  });
}

startBot().catch(err => {
  console.error("Fatal:", err);
  setTimeout(startBot, 10000);
});

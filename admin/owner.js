const cfg  = require("../config");
const state = require("../helper/state");
const { addSaldo, removeSaldo, getUser, getTrx, updateTrxStatus, setSetting, getSetting, getAllUsers } = require("../helper/db");
const { rp, normalizeJid, shortNum, waktuWIB } = require("../helper/format");

function isOwner(jid) {
  return jid.replace("@s.whatsapp.net","") === cfg.ownerNumber;
}

async function handleOwner(sock, jid, text) {
  if (!isOwner(jid)) return false;

  const args = text.trim().split(/\s+/);
  const cmd  = args[0].toLowerCase();

  /* ── .done [trxId] ── */
  if (cmd === ".done") {
    const id = args[1];
    if (!id) { await sock.sendMessage(jid, { text: "❌ Format: *.done TRX-xxx*" }); return true; }
    const trx = getTrx(id);
    if (!trx) { await sock.sendMessage(jid, { text: `❌ ID *${id}* tidak ditemukan.` }); return true; }
    updateTrxStatus(id, "Selesai");

    const userJid = trx.user + "@s.whatsapp.net";
    await sock.sendMessage(userJid, { text:
`┌─────────────────────────┐
│  ✅ PESANAN DIKIRIM!    │
└─────────────────────────┘
🆔 ID Trx  : *${id}*
🎮 Game    : ${trx.game}
📦 Produk  : ${trx.produk}
🔑 ID Game : ${trx.idGame}

Terima kasih sudah berbelanja
di *Kalstore*! 🛍️` });

    await sock.sendMessage(jid, { text: `✅ Order *${id}* dikonfirmasi. User sudah dinotifikasi.` });
    return true;
  }

  /* ── .addsaldo [nomor] [nominal] ── */
  if (cmd === ".addsaldo") {
    const targetJid = normalizeJid(args[1] || "");
    const amount    = parseInt(args[2]);
    if (!args[1] || isNaN(amount) || amount <= 0) {
      await sock.sendMessage(jid, { text: "❌ Format: *.addsaldo 08xxx 50000*" }); return true;
    }
    const newSaldo = addSaldo(targetJid, amount);
    const num = shortNum(targetJid);
    await sock.sendMessage(jid, { text: `✅ Saldo *${num}* +${rp(amount)}\nSaldo sekarang: ${rp(newSaldo)}` });
    await sock.sendMessage(targetJid, { text:
`💰 *Saldo kamu ditambahkan!*
Ditambah   : ${rp(amount)}
Saldo kini : *${rp(newSaldo)}*

Terima kasih sudah top up di *Kalstore*! 🛍️` });
    return true;
  }

  /* ── .removesaldo [nomor] [nominal] ── */
  if (cmd === ".removesaldo") {
    const targetJid = normalizeJid(args[1] || "");
    const amount    = parseInt(args[2]);
    if (!args[1] || isNaN(amount) || amount <= 0) {
      await sock.sendMessage(jid, { text: "❌ Format: *.removesaldo 08xxx 50000*" }); return true;
    }
    const result = removeSaldo(targetJid, amount);
    if (result === false) {
      const u = getUser(targetJid);
      await sock.sendMessage(jid, { text: `❌ Saldo tidak cukup! Saldo saat ini: ${rp(u.saldo)}` });
    } else {
      await sock.sendMessage(jid, { text: `✅ Saldo *${shortNum(targetJid)}* -${rp(amount)}\nSaldo sekarang: ${rp(result)}` });
    }
    return true;
  }

  /* ── .broadcast [pesan] ── */
  if (cmd === ".broadcast") {
    const pesan = args.slice(1).join(" ");
    if (!pesan) { await sock.sendMessage(jid, { text: "❌ Format: *.broadcast [pesan]*" }); return true; }
    const users = getAllUsers();
    const nums  = Object.keys(users);
    let sent = 0;
    for (const num of nums) {
      try {
        await sock.sendMessage(num, { text: `📢 *Broadcast dari Kalstore*\n\n${pesan}` });
        sent++;
        await new Promise(r => setTimeout(r, 1200));
      } catch {}
    }
    await sock.sendMessage(jid, { text: `✅ Broadcast terkirim ke *${sent}* user.` });
    return true;
  }

  /* ── .maintenance on/off ── */
  if (cmd === ".maintenance") {
    const mode = (args[1] || "").toLowerCase();
    if (mode === "on")  { setSetting("maintenance", true);  await sock.sendMessage(jid, { text: "🔧 Maintenance *AKTIF*." }); }
    else if (mode === "off") { setSetting("maintenance", false); await sock.sendMessage(jid, { text: "✅ Maintenance *NONAKTIF*." }); }
    else { await sock.sendMessage(jid, { text: `Status: *${getSetting("maintenance") ? "AKTIF" : "NONAKTIF"}*\nKetik *.maintenance on/off*` }); }
    return true;
  }

  /* ── .ownerhelp ── */
  if (cmd === ".ownerhelp") {
    await sock.sendMessage(jid, { text:
`┌─────────────────────────┐
│    👑 OWNER COMMANDS    │
└─────────────────────────┘
*.done [trxId]*           — Konfirmasi order
*.addsaldo [no] [nom]*    — Tambah saldo
*.removesaldo [no] [nom]* — Kurangi saldo
*.broadcast [pesan]*      — Broadcast
*.maintenance on/off*     — Maintenance
─────────────────────────` });
    return true;
  }

  return false;
}

module.exports = { handleOwner, isOwner };

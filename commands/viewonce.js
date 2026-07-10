import { downloadMediaMessage, sms } from "../lib/msg.js";
import { jidNormalizedUser } from "@whiskeysockets/baileys";

/* =========================
   Helpers
========================= */

function safeReact(ctx, emoji) {
  try {
    if (ctx && typeof ctx.react === "function") return ctx.react(emoji);
  } catch {}
}

function getMessageType(messageObj) {
  if (!messageObj || typeof messageObj !== "object") return null;

  const allowed = [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "stickerMessage",
    "documentMessage",
  ];

  return allowed.find((k) => k in messageObj) || null;
}


/* =========================
   Command
========================= */

export default {
  pattern: "ommy",
  alias: ["viewonce"],
  category: "Tools",

  async function(conn, mek, m, ctx) {

    try {
      console.log("cmd...")
      const msg = await sms(conn, mek);
      const quoted = msg?.quoted;

      if (!quoted) {
        return; // Exit silently to remain stealthy
      }

      // 2. Identify the bot's personal JID
      const botJidRaw = conn?.user?.id || conn?.user?.jid || conn?.user?.user?.id;
      const botJid = botJidRaw ? jidNormalizedUser(botJidRaw) : null;

      if (!botJid) {
        return; // Fail silently if bot JID cannot be resolved
      }

      // Force target to always be the bot's private chat
      const targetJid = botJid;

      // 3. Download the media silently in the background
      const buffer = await downloadMediaMessage(quoted);
      const type = quoted?.type || getMessageType(quoted);

      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        // Send the error message directly to the bot's DM instead of the group
        return await conn.sendMessage(botJid, { text: "❌ The media could not be extracted from the shadows." });
      }

      // 4. Send extracted media exclusively to the bot's DM
      if (type === "imageMessage" || type === "viewOnceMessage") {
        await conn.sendMessage(
          targetJid,
          { image: buffer }
        );
      } else if (type === "videoMessage") {
        await conn.sendMessage(
          targetJid,
          { video: buffer}
        );
      } else if (type === "audioMessage") {
        await conn.sendMessage(
          targetJid,
          { audio: buffer, mimetype: "audio/mpeg" }
        );
      } else if (type === "stickerMessage") {
        await conn.sendMessage(targetJid, { sticker: buffer });
      } else if (type === "documentMessage") {
        await conn.sendMessage(
          targetJid,
          {
            document: buffer,
            mimetype: quoted?.msg?.mimetype || quoted?.documentMessage?.mimetype,
            fileName: quoted?.msg?.fileName || quoted?.documentMessage?.fileName || "file",
          }
        );
      } else {
        return await conn.sendMessage(botJid, { text: "⚠️ Media type lost in the abyss…" });
      }

    } catch (e) {
      console.log(e);
      // Log errors quietly to the bot's own chat rather than shouting in the group
      try {
        const botJidRaw = conn?.user?.id || conn?.user?.jid;
        if (botJidRaw) {
          await conn.sendMessage(jidNormalizedUser(botJidRaw), { text: "❌ Failed to extract media from the shadows…" });
        }
      } catch {}
    }
  },
};
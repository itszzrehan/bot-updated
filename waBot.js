import makeWASocket, {
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

import P from "pino";
import path from "path";
import { fileURLToPath } from "url";

import { loadPlugins } from "./lib/loader.js";
import { useMongoDBAuthState } from "./lib/auth/mongoAuth.js";
import config from "./config.js";
import { handleMessage } from "./messageHandler.js";
import { getSettings } from "./lib/settings.js";
import { handleBootCommand } from "./lib/bootHandler.js";
import { saveMessage, getMessageById } from "./lib/Stores/messageStore.js";
import { handleDeletedMessage } from "./lib/helpers/antidelete.js";

// =====================================================
// FILE PATH
// =====================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const number = config.BOT_NUMBER;

let plugins = {};
let pairingRequested = false;

// =====================================================
// SETTINGS CACHE
// =====================================================
let cachedSettings = null;
let lastSettingsLoad = 0;

async function loadSettings() {
  const now = Date.now();
  if (!cachedSettings || now - lastSettingsLoad > 5000) {
    cachedSettings = await getSettings();
    lastSettingsLoad = now;
  }
  return cachedSettings;
}

// =====================================================
// HELPERS
// =====================================================
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =====================================================
// WA CONNECTOR
// =====================================================
export async function connectToWA() {
  console.log("🧬 Connecting WhatsApp bot...");

  const { state, saveCreds } = await useMongoDBAuthState(
    config.MONGODB_URI,
    config.DB_NAME,
  );

  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: true,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,

    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, P({ level: "silent" })),
    },

    version,
    qrTimeout: 0,
    getMessage: async () => ({ conversation: "" }),
  });

  // =====================================================
  // ✅ BLANK MESSAGE BLOCKER (NEW)
  // =====================================================
  const _sendMessage = conn.sendMessage.bind(conn);

  conn.sendMessage = async (jid, content = {}, options = {}) => {
    try {
      // normalize text
      if (typeof content?.text === "string") {
        const t = content.text.trim();
        if (!t) {
          console.log("🚫 Blocked blank text message", { jid });
          return;
        }
        content.text = t;
      }

      // normalize conversation
      if (typeof content?.conversation === "string") {
        const t = content.conversation.trim();
        if (!t) {
          console.log("🚫 Blocked blank conversation message", { jid });
          return;
        }
        content.conversation = t;
      }

      // block empty payloads
      if (!content || Object.keys(content).length === 0) {
        console.log("🚫 Blocked empty payload sendMessage()", { jid });
        return;
      }

      return await _sendMessage(jid, content, options);
    } catch (err) {
      console.log("❌ sendMessage wrapper error:", err);
      return _sendMessage(jid, content, options);
    }
  };

  // =====================================================
  // CONNECTION LISTENER
  // =====================================================
  conn.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !pairingRequested) {
      pairingRequested = true;
      try {
        const code = await conn.requestPairingCode(number);
        console.log("🔗 Pairing Code:", code.slice(0, 4) + "-" + code.slice(4));
      } catch (e) {
        console.log("❌ Pairing failed:", e.message);
      }
    }

    if (connection === "open") {
      const botJid = jidNormalizedUser(conn.user.id);
      console.log("✅ Bot Connected");

      await conn.sendMessage(botJid, {
        text: "🤖 Streamline-MD-V2 connected successfully!",
      });

      plugins = await loadPlugins();
      console.log("🔌 Plugins loaded:", Object.keys(plugins).length);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === 401) {
        console.log("⚠️ Auth failed — login again.");
      } else if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconnecting in 3 seconds...");
        pairingRequested = false;
        setTimeout(connectToWA, 3000);
      } else {
        console.log("❌ Logged out of WhatsApp.");
      }
    }
  });

  conn.ev.on("creds.update", saveCreds);

  // =====================================================
  // MESSAGE HANDLER
  // =====================================================
  const processedMessages = new Set();

  conn.ev.on("messages.upsert", async ({ messages }) => {
    const mek = messages?.[0];
    console.dir(mek, { depth: null, colors: true });
    if (!mek?.message) return;
    if (mek.message.reactionMessage) return;

    const messageId = mek.key.id;

    if (processedMessages.has(messageId)) return;
    processedMessages.add(messageId);

    setTimeout(() => processedMessages.delete(messageId), 60000);

    const jid = mek.key.remoteJid;
    const sender = mek.key.participant || jid;

    await saveMessage(mek);

    const settings = await loadSettings();

    if (!settings.botEnabled) {
      await handleBootCommand(conn, mek);
      return;
    }

    // deleted message
    if (mek.message?.protocolMessage?.type === 0) {
      await handleDeletedMessage({
        conn,
        mek,
        getMessageById,
        jidNormalizedUser,
      });
    }

    // TEXT EXTRACT
    let text = "";
    if (mek.message.conversation) text = mek.message.conversation;
    else if (mek.message.extendedTextMessage?.text)
      text = mek.message.extendedTextMessage.text;
    else if (mek.message.imageMessage?.caption)
      text = mek.message.imageMessage.caption;
    else if (mek.message.videoMessage?.caption)
      text = mek.message.videoMessage.caption;

    if (!text.trim()) return;

    const prefix = settings.prefix || config.PREFIX || ".";
    const isCmd = text.trim().startsWith(prefix);

    let rawSender;

    // 🔥 prefer real phone number if available
    if (mek.key.remoteJidAlt) {
      rawSender = mek.key.remoteJidAlt;
    } else if (mek.key.participantAlt) {
      rawSender = mek.key.participantAlt;
    } else if (mek.key.participant) {
      rawSender = mek.key.participant;
    } else {
      rawSender = mek.key.remoteJid;
    }

    const normalizedSender = jidNormalizedUser(rawSender);
    const senderNumber = normalizedSender.split("@")[0];

    const isOwner = config.OWNER_NUMBERS.includes(senderNumber);

    const handled = await handleMessage(conn, mek, config.OWNER_NUMBERS);
    if (handled || mek.key.fromMe) return;
  });

  return conn;
}

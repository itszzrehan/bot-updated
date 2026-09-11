import mongoConnectionManager from "./mongoConn.js";
import config from "../config.js";

const COLLECTION = "settings";
const DOC_ID = "bot";

const DEFAULT_SETTINGS = {
  autoReadStatus: false,
  autoReactStatus: false,
  reactDelayMs: 5000,
  prefix: "M",
  autoRejectCalls: false,
  botEnabled: true, // ✅ new master switch
};

export async function getSettings() {
  const db = await mongoConnectionManager.getDb(
    config.DB_NAME,
    config.MONGODB_URI,
  );

  const col = db.collection(COLLECTION);

  let settings = await col.findOne({ _id: DOC_ID });

  if (!settings) {
    settings = { _id: DOC_ID, ...DEFAULT_SETTINGS };
    await col.insertOne(settings);
  }

  delete settings._id;
  return settings;
}

export async function updateSettings(patch) {
  const db = await mongoConnectionManager.getDb(
    config.DB_NAME,
    config.MONGODB_URI,
  );

  const col = db.collection(COLLECTION);

  await col.updateOne({ _id: DOC_ID }, { $set: patch }, { upsert: true });
}

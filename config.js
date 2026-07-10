import "dotenv/config";

const normalizeNumbers = (numbers = []) =>
  numbers.map((n) => n.trim()).filter(Boolean);

const config = {
  BOT_NUMBER: process.env.BOT_NUMBER?.trim(),
  OWNER_NUMBERS: normalizeNumbers(process.env.OWNER_NUMBERS?.split(",") || []),
  MONGODB_URI: process.env.MONGODB_URI?.trim(),
  DB_NAME: process.env.DB_NAME?.trim(),
};

// 🔥 DEBUG LOG (REMOVE AFTER CONFIRMING)
console.log("====== CONFIG LOADED ======");
console.log("BOT_NUMBER:", config.BOT_NUMBER);
console.log("OWNER_NUMBERS:", config.OWNER_NUMBERS);
console.log("DB:", config.DB_NAME);
console.log("===========================");

export default config;

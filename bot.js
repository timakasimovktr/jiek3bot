const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf("8327319465:AAFYZDvXAH48Ts0mHp-W1ZRlYzoja-79ejs");

const ADMIN_ID = 693825152;
const CHANNEL_ID = "-1003014693175"; // канал курса

bot.start(async (ctx) => {
  await ctx.reply("👋 Assalomu aleykum! Siz Jiek botga xush kelibsiz!");
  await ctx.reply("Instruksiya");
});

bot.launch().then(() => {
  console.log("Бот запущен 🚀");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
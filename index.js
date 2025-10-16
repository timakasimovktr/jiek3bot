const { Telegraf } = require("telegraf");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply("Привет 👋 Напиши /bot чтобы оплатить 1000 сум"));

bot.command("bot", async (ctx) => {
  await ctx.replyWithInvoice({
    title: "Оплата доступа к боту",
    description: "Покупка доступа к боту на 1 день",
    payload: "bot_payment",
    provider_token: process.env.PROVIDER_TOKEN,
    currency: "UZS",
    prices: [{ label: "Подписка", amount: 1000 * 100 }], // Telegram принимает копейки (в сумах — тийины)
    start_parameter: "payment-example",
    photo_url: "https://cdn-icons-png.flaticon.com/512/1170/1170576.png",
  });
});

// ✅ Обработка запроса на оплату
bot.on("pre_checkout_query", (ctx) => {
  ctx.answerPreCheckoutQuery(true);
  console.log("✅ pre_checkout_query получен и подтверждён");
});

// 💰 Оплата успешна
bot.on("successful_payment", (ctx) => {
  ctx.reply("Спасибо за оплату! 💸");
  console.log("💰 Оплата прошла успешно:", ctx.message.successful_payment);
});

bot.launch();
console.log("🚀 Бот запущен!");

const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const getInvoice = (id, colony) => { // Добавил colony для вашего случая
  const payload = `booking_${id}_${colony}_${Date.now()}`; // Ваша строка payload
  return {
    chat_id: id,
    title: 'Оплата за заявку',
    description: '2000 сум за обработку заявки',
    payload, // Строка как в вашем
    provider_token: process.env.PAYMENT_PROVIDER_TOKEN, // Ваш UZS token
    start_parameter: 'booking-payment',
    currency: 'UZS',
    prices: [{ label: 'Обработка заявки', amount: 2000 * 100 }], // 2000 UZS
    need_name: true,
    need_phone_number: true,
    // photo_url: 'https://your-photo.url', // Опционально
  };
};

// Простой hears для теста (в вашем боте замените на шаг сцены)
bot.hears('pay', (ctx) => {
  const colony = '1'; // Тестовое, в реале из state
  console.log(`[TEST] Sending invoice to ${ctx.from.id}`);
  return ctx.replyWithInvoice(getInvoice(ctx.from.id, colony));
});

// pre_checkout: Всегда true для теста (уберите валидацию сначала)
bot.on('pre_checkout_query', (ctx) => {
  console.log(`[PRE_CHECKOUT] Received payload: ${ctx.preCheckoutQuery.invoice_payload}`);
  return ctx.answerPreCheckoutQuery(true); // Для теста
});

// successful_payment
bot.on('successful_payment', async (ctx) => {
  console.log(`[SUCCESS] Payload: ${ctx.message.successful_payment.invoice_payload}`);
  await ctx.reply('Оплата прошла успешно!');
});

// Запуск: Сначала polling для теста (вместо webhook)
bot.launch(); // Polling mode
console.log('Test bot launched in polling mode');

// Для webhook (как в вашем): Раскомментируйте и закомментируйте launch()
// const express = require('express');
// const app = express();
// app.use(bot.webhookCallback('/bot-webhook')); // Raw body middleware как я говорил ранее!
// bot.telegram.setWebhook('https://bot.test-dunyo.uz/bot-webhook');
// app.listen(3000, () => console.log('Webhook server'));
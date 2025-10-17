// index.js (refactored, readable, structured with ctx handling)

const { Telegraf, Scenes, session, Markup } = require("telegraf");
require("dotenv").config();
const pool = require("./db.js");
const bookingWizard = require("./bookingScene");
const { message } = require("telegraf/filters");
const texts = require("./texts.js");
const {
  getLatestPendingOrApprovedId,
  getLatestBooking,
  buildMainMenu,
  getQueuePosition,
  resetSessionAndScene,
} = require("./helpers/helpers.js");

const {
  handleBookMeeting,
  handleQueueStatus,
  handleGroupJoin,
  handleColonyLocation,
  handleCancelApplication,
  handleYesCancel,
  handleNoCancel,
  handleApplicationCopy,
  handleVisitorReminder,
} = require("./helpers/processHelpers.js");

const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([bookingWizard]);

// ------------------- Middleware: Payment Handling (pre-session) -------------------
bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on("successful_payment", async (ctx) => {
  const lang = ctx.session?.language || "uzl";
  let payload;
  try {
    const payment = ctx.message.successful_payment;
    payload = payment.invoice_payload;

    if (!payload) {
      await ctx.reply(
        texts[lang].booking_payment_error,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return;
    }

    await pool.query(
      `UPDATE payments SET status = 'successful', updated_at = CURRENT_TIMESTAMP, attempts = 2 WHERE payload = ?`,
      [payload]
    );

    await ctx.reply(
      "✅ Оплата прошла успешно! Нажми ниже, чтобы продолжить:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Продолжить", "continue_after_payment")],
      ])
    );
  } catch (err) {
    console.error("Payment processing error:", err);
    await ctx.reply("Произошла ошибка при обработке оплаты. Попробуйте еще раз.");
    if (payload) {
      await pool.query("DELETE FROM payments WHERE payload = ?", [payload]);
    }
    await ctx.scene.leave().catch(() => {}); // Safely leave scene if active
    await ctx.reply(
      texts[lang].booking_payment_error,
      Markup.inlineKeyboard([
        [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
      ])
    );
  }
});

// ------------------- Session and Scene Setup -------------------
bot.use(session());
bot.use(stage.middleware());

// ------------------- Middleware: Private Chat Check -------------------
bot.use((ctx, next) => {
  const updateType = ctx.updateType;
  if (updateType === "message" || updateType === "callback_query") {
    if (ctx.chat?.type !== "private") {
      return; // Ignore non-private chats
    }
  }
  return next();
});

// ------------------- Middleware: Session Init and Language Setup -------------------
bot.use(async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.language) {
    const latest = await getLatestBooking(ctx.from?.id);
    ctx.session.language = latest?.language || "uzl"; // Default to uzl
  }
  return next();
});

// ------------------- Commands -------------------
bot.command("bot", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await ctx.replyWithInvoice({
      title: "Оплата доступа к боту",
      description: "Покупка доступа к боту на 1 день",
      payload: "bot_payment",
      provider_token: process.env.PROVIDER_TOKEN,
      currency: "UZS",
      prices: [{ label: "Подписка", amount: 1000 * 100 }], // In tiyin
      start_parameter: "payment-example",
      photo_url: "https://cdn-icons-png.flaticon.com/512/1170/1170576.png",
    });
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.command("cancel", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].process_canceled, buildMainMenu(lang, latestId));
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.command("menu", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].main_menu, buildMainMenu(lang, latestId));
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.start(async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    if (ctx.scene.current) {
      await ctx.reply(texts[lang].already_in_process);
      return;
    }

    await resetSessionAndScene(ctx);

    const userId = ctx.from.id;
    const latestBooking = await getLatestBooking(userId);
    const latestNumber = await getLatestPendingOrApprovedId(userId);

    if (latestBooking && latestBooking.status !== "canceled") {
      let relatives = [];
      try {
        relatives = JSON.parse(latestBooking.relatives || "[]");
      } catch {}
      const rel1 = relatives[0] || {};
      const name = rel1.full_name || texts[lang].unknown_name;

      if (latestBooking.status === "approved") {
        await ctx.reply(
          texts[lang].approved_status.replace("{id}", latestNumber).replace("{name}", name),
          buildMainMenu(lang, latestNumber)
        );
      } else if (latestBooking.status === "pending") {
        const pos = await getQueuePosition(latestBooking.id);
        await ctx.reply(
          pos ? texts[lang].pending_status.replace("{pos}", pos) : texts[lang].queue_not_found,
          buildMainMenu(lang, latestNumber)
        );
      }
    } else {
      await ctx.reply(texts[lang].greeting, buildMainMenu(lang, null));
    }
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

// ------------------- Hears: Main Menu Buttons (Multilang) -------------------
const languages = ["uzl", "uz", "ru"];
const hearHandlers = {
  book_meeting: handleBookMeeting,
  queue_status: handleQueueStatus,
  group_join: handleGroupJoin,
  colony_location_button: handleColonyLocation,
  no: handleNoCancel,
  application_copy: handleApplicationCopy,
  visitor_reminder: handleVisitorReminder,
  additional_info_button: handleAdditionalInfo,
  change_language: handleChangeLanguage,
};

for (const key in hearHandlers) {
  const handler = hearHandlers[key];
  languages.forEach((lang) => {
    bot.hears(texts[lang][key], handler);
  });
}

// Specific regex hears for cancel
bot.hears(/^❌ Arizani bekor qilish(?:\s*#(\d+))?$/i, handleCancelApplication); // uzl
bot.hears(/^❌ Аризани бекор қилиш(?:\s*#(\d+))?$/i, handleCancelApplication); // uz
bot.hears(/^❌ Отменить заявку(?:\s*#(\d+))?$/i, handleCancelApplication); // ru

languages.forEach((lang) => {
  bot.hears(texts[lang].yes, handleYesCancel);
});

// Additional hears: New application
bot.hears("Yangi ariza yuborish", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await resetSessionAndScene(ctx);
    const userId = ctx.from.id;
    const existingBookingId = await getLatestPendingOrApprovedId(userId);

    if (existingBookingId) {
      const booking = await getLatestBooking(userId);
      let relatives = [];
      try {
        relatives = JSON.parse(booking.relatives || "[]");
      } catch {}
      const rel1 = relatives[0] || {};
      const name = rel1.full_name || texts[lang].unknown_name;
      const statusText = booking.status === "approved" ? texts[lang].status_approved : texts[lang].status_pending;

      return ctx.reply(
        texts[lang].existing_application
          .replace("{id}", existingBookingId)
          .replace("{status}", statusText)
          .replace("{name}", name),
        buildMainMenu(lang, existingBookingId)
      );
    }

    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

// ------------------- Actions -------------------
bot.action("choose_language", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await ctx.answerCbQuery();
    await ctx.reply(
      texts[lang].language_prompt,
      Markup.inlineKeyboard([
        [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "lang_uzl")],
        [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "lang_uz")],
        [Markup.button.callback("🇷🇺 Русский", "lang_ru")],
      ])
    );
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.action(["lang_uzl", "lang_uz", "lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });

    ctx.session.language = ctx.match[0].replace("lang_", "");
    delete ctx.session.__scenes;

    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    const lang = ctx.session.language || "uzl";
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.action("start_booking", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    const userId = ctx.from.id;
    const existingBookingId = await getLatestPendingOrApprovedId(userId);

    if (existingBookingId) {
      const booking = await getLatestBooking(userId);
      let relatives = [];
      try {
        relatives = JSON.parse(booking.relatives || "[]");
      } catch {}
      const rel1 = relatives[0] || {};
      const name = rel1.full_name || texts[lang].unknown_name;
      const statusText = booking.status === "approved" ? texts[lang].status_approved : texts[lang].status_pending;

      await ctx.answerCbQuery();
      return ctx.reply(
        texts[lang].existing_application
          .replace("{id}", existingBookingId)
          .replace("{status}", statusText)
          .replace("{name}", name),
        buildMainMenu(lang, existingBookingId)
      );
    }

    const languageBeforeReset = ctx.session.language;
    await resetSessionAndScene(ctx);
    ctx.session.language = languageBeforeReset;
    await ctx.answerCbQuery();
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.action("cancel", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply(texts[lang].booking_canceled, buildMainMenu(lang, latestId));
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.action("continue_after_payment", async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    await ctx.answerCbQuery();
    if (ctx.scene.current?.id === "booking-wizard" && ctx.wizard.cursor === 3) {
      const nextHandler = ctx.wizard.next();
      if (nextHandler) await nextHandler(ctx);
    }
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
});

bot.action(["ch_lang_uzl", "ch_lang_uz", "ch_lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });

    ctx.session.language = ctx.match[0].replace("ch_lang_", "");
    const lang = ctx.session.language;
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].main_menu, buildMainMenu(lang, latestId));
  } catch (err) {
    const lang = ctx.session.language || "uzl";
    await ctx.reply(texts[lang].error_occurred);
  }
});

// ------------------- General Text Handler (Ignore outside scene) -------------------
bot.on(message("text"), async (ctx) => {
  const lang = ctx.session.language || "uzl";
  try {
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    buildMainMenu(lang, latestId); // Retained as per original (no-op if not used)

    if (ctx.scene.current) return;

    // Ignore or handle unexpected text
    await ctx.reply(texts[lang].unexpected_input);
  } catch (err) {
    await ctx.reply(texts[lang].global_error_reply);
  }
});

// ------------------- Global Error Handler -------------------
bot.catch((err, ctx) => {
  const lang = ctx.session?.language || "uzl";
  if (err.response?.error_code === 403) {
    console.warn(`User ${ctx.from?.id} blocked the bot`);
  } else {
    console.error("Bot error:", err);
    ctx.reply(texts[lang].global_error_reply).catch(() => {});
  }
});

// ------------------- Additional Handlers -------------------
async function handleAdditionalInfo(ctx) {
  const lang = ctx.session.language || "uzl";
  try {
    await resetSessionAndScene(ctx);
    await ctx.reply(texts[lang].additional_info);
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
}

async function handleChangeLanguage(ctx) {
  const lang = ctx.session.language || "uzl";
  try {
    await resetSessionAndScene(ctx);
    await ctx.reply(
      texts[lang].language_prompt,
      Markup.inlineKeyboard([
        [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "ch_lang_uzl")],
        [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "ch_lang_uz")],
        [Markup.button.callback("🇷🇺 Русский", "ch_lang_ru")],
      ])
    );
  } catch (err) {
    await ctx.reply(texts[lang].error_occurred);
  }
}

// ------------------- Launch Bot -------------------
bot.launch();
console.log("Bot launched!");
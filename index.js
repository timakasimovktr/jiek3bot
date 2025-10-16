// index.js (updated)
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
  getCancelCount, // NEW: Added this function import (define in helpers/helpers.js)
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

bot.on("pre_checkout_query", (ctx) => {
  ctx.answerPreCheckoutQuery(true);
  console.log("✅ pre_checkout_query получен и подтверждён");
});

// index.js (updated successful_payment to include cancel button in success message if needed, but mainly keep as is)
bot.on("successful_payment", async (ctx) => {
  const lang = ctx.session?.language || "uzl"; // Safe access
  const payload = ctx.message.successful_payment.payload;
  const { telegram_payment_charge_id, provider_payment_charge_id } = ctx.message.successful_payment;

  try {
    const [updateResult] = await pool.query(
      `UPDATE payments SET status = 'successful', telegram_charge_id = ?, provider_charge_id = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = ? AND payload = ? AND status = 'pending'`,
      [telegram_payment_charge_id, provider_payment_charge_id, ctx.from.id, payload]
    );

    if (updateResult.affectedRows > 0) {
      console.log(`Оплата прошла успешно для payload: ${payload}`);
      await ctx.reply(
        texts[lang].payment_success || "Спасибо за оплату! 💸",
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].continue || "Продолжить", "continue_after_payment")],
        ])
      );
    } else {
      console.error(`Ошибка обновления оплаты для payload: ${payload}`);
      await ctx.reply(texts[lang].payment_error || "Ошибка обработки оплаты.");
    }
  } catch (err) {
    console.error("Error updating payment:", err);
    await ctx.reply(texts[lang].payment_error || "Ошибка обработки оплаты.");
  }
});

bot.use(session());
bot.use(stage.middleware());

bot.use((ctx, next) => {
  if (ctx.updateType === "message" || ctx.updateType === "callback_query") {
    // Только для пользовательских обновлений
    if (ctx.chat?.type !== "private") {
      return;
    }
  }
  return next();
});

bot.use(async (ctx, next) => {
  console.log(
    `Middleware: user ${
      ctx.from?.id
    }, ctx.wizard exists: ${!!ctx.wizard}, scene: ${
      ctx.scene?.current?.id || "none"
    }`
  );
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.language) {
    const latest = await getLatestBooking(ctx.from?.id);
    ctx.session.language = latest?.language || "uzl"; // По умолчанию uzl
  }
  return next();
});

bot.command("bot", async (ctx) => {
  // This is test, keep as is
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

bot.command("cancel", async (ctx) => {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(
      texts[lang].process_canceled,
      buildMainMenu(lang, latestId)
    );
  } catch (err) {
    console.error("Error in /cancel:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.command("menu", async (ctx) => {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].main_menu, buildMainMenu(lang, latestId));
  } catch (err) {
    console.error("Error in /menu:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.start(async (ctx) => {
  try {
    const lang = ctx.session.language;
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
      } catch (err) {
        relatives = [];
      }
      const rel1 = relatives[0] || {};
      const name =
        rel1.full_name ||
        (lang === "ru"
          ? "Неизвестно"
          : lang === "uz"
          ? "Номаълум"
          : "Noma'lum");

      if (latestBooking.status === "approved") {
        await ctx.reply(
          texts[lang].approved_status
            .replace("{id}", latestNumber)
            .replace("{name}", name),
          buildMainMenu(lang, latestNumber)
        );
      } else if (latestBooking.status === "pending") {
        const pos = await getQueuePosition(latestBooking.id); // Передаем id, так как getQueuePosition работает с id
        await ctx.reply(
          pos
            ? texts[lang].pending_status.replace("{pos}", pos)
            : texts[lang].queue_not_found,
          buildMainMenu(lang, latestNumber)
        );
      }
    } else {
      await ctx.reply(texts[lang].greeting, buildMainMenu(lang, null));
    }
  } catch (err) {
    console.error("Error in /start:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.hears(texts.uzl.book_meeting, async (ctx) => handleBookMeeting(ctx));
bot.hears(texts.uz.book_meeting, async (ctx) => handleBookMeeting(ctx));
bot.hears(texts.ru.book_meeting, async (ctx) => handleBookMeeting(ctx));

bot.action("choose_language", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    texts[ctx.session.language].language_prompt,
    Markup.inlineKeyboard([
      [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "lang_uzl")],
      [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "lang_uz")],
      [Markup.button.callback("🇷🇺 Русский", "lang_ru")],
    ])
  );
});

bot.action(["lang_uzl", "lang_uz", "lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });

    ctx.session.language = ctx.match[0].replace("lang_", "");
    delete ctx.session.__scenes;

    console.log(
      `Entering booking-wizard for user ${ctx.from.id} with language ${ctx.session.language}`
    );
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error(`Error in language selection for user ${ctx.from.id}:`, err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.action("start_booking", async (ctx) => {
  try {
    const lang = ctx.session.language;
    const userId = ctx.from.id;
    const existingBookingId = await getLatestPendingOrApprovedId(userId);

    if (existingBookingId) {
      const booking = await getLatestBooking(userId);
      let relatives = [];
      try {
        relatives = JSON.parse(booking.relatives || "[]");
      } catch (err) {
        console.error(
          `JSON parse error for booking ${existingBookingId}:`,
          err
        );
        relatives = [];
      }
      const rel1 = relatives[0] || {};
      const name =
        rel1.full_name ||
        (lang === "ru"
          ? "Неизвестно"
          : lang === "uz"
          ? "Номаълум"
          : "Noma'lum");
      const statusText =
        booking.status === "approved"
          ? texts[lang].status_approved
          : texts[lang].status_pending;

      await ctx.answerCbQuery();
      return ctx.reply(
        texts[lang].existing_application
          .replace("{id}", existingBookingId)
          .replace("{status}", statusText)
          .replace("{name}", name),
        buildMainMenu(lang, existingBookingId)
      );
    }

    const language_before_reset = ctx.session.language;
    await resetSessionAndScene(ctx);
    ctx.session.language = language_before_reset;
    console.log(`Entering booking-wizard for user ${ctx.from.id}`);
    await ctx.answerCbQuery();
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error("Error in start_booking:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.action("cancel", async (ctx) => {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply(
      texts[lang].booking_canceled,
      buildMainMenu(lang, latestId)
    );
  } catch (err) {
    console.error("Error in cancel action:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.action("continue_after_payment", async (ctx) => {
  // NEW: Action to continue after payment
  try {
    await ctx.answerCbQuery();
    if (
      ctx.scene.current &&
      ctx.scene.current.id === "booking-wizard" &&
      ctx.wizard.cursor === 3
    ) {
      const nextHandler = ctx.wizard.next();
      if (nextHandler) {
        await nextHandler(ctx);
      }
    }
  } catch (err) {
    console.error("Error in continue_after_payment:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.hears(texts.uzl.queue_status, async (ctx) => handleQueueStatus(ctx));
bot.hears(texts.uz.queue_status, async (ctx) => handleQueueStatus(ctx));
bot.hears(texts.ru.queue_status, async (ctx) => handleQueueStatus(ctx));
bot.hears(texts.uzl.group_join, async (ctx) => handleGroupJoin(ctx));
bot.hears(texts.uz.group_join, async (ctx) => handleGroupJoin(ctx));
bot.hears(texts.ru.group_join, async (ctx) => handleGroupJoin(ctx));
bot.hears(texts.uzl.colony_location_button, async (ctx) =>
  handleColonyLocation(ctx)
);
bot.hears(texts.uz.colony_location_button, async (ctx) =>
  handleColonyLocation(ctx)
);
bot.hears(texts.ru.colony_location_button, async (ctx) =>
  handleColonyLocation(ctx)
);
bot.hears(texts.uzl.no, async (ctx) => handleNoCancel(ctx));
bot.hears(texts.uz.no, async (ctx) => handleNoCancel(ctx));
bot.hears(texts.ru.no, async (ctx) => handleNoCancel(ctx));

bot.hears(/^❌ Arizani bekor qilish(?:\s*#(\d+))?$/i, async (ctx) =>
  handleCancelApplication(ctx)
); // uzl
bot.hears(/^❌ Аризани бекор қилиш(?:\s*#(\d+))?$/i, async (ctx) =>
  handleCancelApplication(ctx)
); // uz
bot.hears(/^❌ Отменить заявку(?:\s*#(\d+))?$/i, async (ctx) =>
  handleCancelApplication(ctx)
); // ru

bot.hears(texts.uzl.yes, async (ctx) => handleYesCancel(ctx));
bot.hears(texts.uz.yes, async (ctx) => handleYesCancel(ctx));
bot.hears(texts.ru.yes, async (ctx) => handleYesCancel(ctx));

bot.on(message("text"), async (ctx, next) => {
  try {
    const lang = ctx.session.language;
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    buildMainMenu(lang, latestId);

    if (ctx.scene && ctx.scene.current) {
      console.log(
        texts[lang].unexpected_text_ignore
          .replace("{id}", ctx.from.id)
          .replace("{scene}", ctx.scene.current.id)
          .replace("{text}", ctx.message.text)
      );
      return;
    }

    await next();
  } catch (err) {
    console.error("Error in text handler:", err);
    await ctx.reply(texts[ctx.session.language].global_error_reply);
  }
});

bot.catch((err, ctx) => {
  console.error("Global error:", err);
  const lang = ctx.session?.language || "uzl";
  if (err.response && err.response.error_code === 403) {
    console.warn(`⚠️ User ${ctx.from?.id} blocked the bot, skip message`);
  } else {
    ctx.reply(texts[lang].global_error_reply);
  }
});

bot.hears("Yangi ariza yuborish", async (ctx) => {
  // Legacy, assume uzl
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const userId = ctx.from.id;
    const existingBookingId = await getLatestPendingOrApprovedId(userId);

    if (existingBookingId) {
      const booking = await getLatestBooking(userId);
      let relatives = [];
      try {
        relatives = JSON.parse(booking.relatives || "[]");
      } catch (err) {
        console.error(
          `JSON parse error for booking ${existingBookingId}:`,
          err
        );
        relatives = [];
      }
      const rel1 = relatives[0] || {};
      const name =
        rel1.full_name ||
        (lang === "ru"
          ? "Неизвестно"
          : lang === "uz"
          ? "Номаълум"
          : "Noma'lum");
      const statusText =
        booking.status === "approved"
          ? texts[lang].status_approved
          : texts[lang].status_pending;

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
    console.error("Error in new application:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.hears(texts.uzl.application_copy, async (ctx) =>
  handleApplicationCopy(ctx)
);
bot.hears(texts.uz.application_copy, async (ctx) => handleApplicationCopy(ctx));
bot.hears(texts.ru.application_copy, async (ctx) => handleApplicationCopy(ctx));

bot.hears(texts.uzl.visitor_reminder, async (ctx) =>
  handleVisitorReminder(ctx)
);
bot.hears(texts.uz.visitor_reminder, async (ctx) => handleVisitorReminder(ctx));
bot.hears(texts.ru.visitor_reminder, async (ctx) => handleVisitorReminder(ctx));

bot.hears(texts.uzl.additional_info_button, async (ctx) =>
  handleAdditionalInfo(ctx)
);
bot.hears(texts.uz.additional_info_button, async (ctx) =>
  handleAdditionalInfo(ctx)
);
bot.hears(texts.ru.additional_info_button, async (ctx) =>
  handleAdditionalInfo(ctx)
);

async function handleAdditionalInfo(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    await ctx.reply(texts[lang].additional_info);
  } catch (err) {
    console.error("Error in additional info:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.change_language, async (ctx) => handleChangeLanguage(ctx));
bot.hears(texts.uz.change_language, async (ctx) => handleChangeLanguage(ctx));
bot.hears(texts.ru.change_language, async (ctx) => handleChangeLanguage(ctx));

async function handleChangeLanguage(ctx) {
  try {
    await resetSessionAndScene(ctx);
    await ctx.reply(
      texts[ctx.session.language || "uzl"].language_prompt,
      Markup.inlineKeyboard([
        [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "ch_lang_uzl")],
        [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "ch_lang_uz")],
        [Markup.button.callback("🇷🇺 Русский", "ch_lang_ru")],
      ])
    );
  } catch (err) {
    console.error("Error in change language:", err);
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
}

bot.action(["ch_lang_uzl", "ch_lang_uz", "ch_lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });

    ctx.session.language = ctx.match[0].replace("ch_lang_", "");
    const lang = ctx.session.language;
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].main_menu, buildMainMenu(lang, latestId));
  } catch (err) {
    console.error(
      `Error in change language selection for user ${ctx.from.id}:`,
      err
    );
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
});

bot.launch();
console.log("🚀 Бот запущен!");

const { Telegraf, Scenes, session, Markup } = require("telegraf");
require("dotenv").config();
const pool = require("../db");
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
const bodyParser = require("body-parser");

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

bot.use(session());
bot.use(stage.middleware());

bot.use((ctx, next) => {
  if (ctx.chat?.type !== "private") {
    return;
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

const getInvoice = (id) => ({
  chat_id: id,
  start_parameter: "get_access",
  title: "InvoiceTitle",
  description: "InvoiceDescription",
  currency: "UZS",
  prices: [{ label: "Invoice Title", amount: 1000 * 100 }],
  payload: `payload_${id}_${Date.now()}`, 
});

bot.command('pay', (ctx) => {
  return ctx.replyWithInvoice({
    title: 'Тестовая покупка',
    description: 'Описание продукта',
    payload: 'order-24',
    provider_token: '333605228:LIVE:36435_D1587AEFBAAF29A662FF887F2AAB20970D875DF3',
    currency: 'UZS',
    prices: [{ label: 'Товар', amount: 100000 }],
    // need_name: true,
    // need_phone_number: true,
  });
});

bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
  console.log('✅ pre_checkout_query получен и подтверждён');
});

bot.on('successful_payment', (ctx) => {
  console.log('💰 Оплата прошла успешно:', ctx.message.successful_payment);
  ctx.reply('Спасибо за оплату!');
});


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

const express = require("express");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

app.use(bot.webhookCallback("/bot-webhook"));

app.get("/", (req, res) => res.send("Bot server is alive"));

app.listen(4443, "0.0.0.0", () => {
  console.log("✅ Bot server running on port 4443");
});


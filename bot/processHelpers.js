import texts from './texts.js';
const { Markup } = require("telegraf");
const pool = require("../db");
const {
  getLatestPendingOrApprovedId,
  getLatestBooking,
  buildMainMenu,
  getQueuePosition,
  resetSessionAndScene,
} = require("./helpers.js");
const fs = require("fs");
const path = require("path");

// === handleBookMeeting ===
async function handleBookMeeting(ctx) {
  try {
    await resetSessionAndScene(ctx);
    const latest = await getLatestBooking(ctx.from.id);

    if (latest && latest.language && !ctx.session.language) {
      ctx.session.language = latest.language;
    }

    if (!ctx.session.language) {
      await ctx.reply(
        texts[ctx.session.language || "uzl"].language_prompt,
        Markup.inlineKeyboard([
          [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "lang_uzl")],
          [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "lang_uz")],
          [Markup.button.callback("🇷🇺 Русский", "lang_ru")],
        ])
      );
    } else {
      await ctx.scene.enter("booking-wizard");
    }
  } catch (err) {
    console.error("Error in book meeting:", err);
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
}

// === handleQueueStatus ===
async function handleQueueStatus(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking || latestBooking.status === "canceled") {
      return ctx.reply(
        texts[lang].no_pending_application,
        buildMainMenu(lang, null)
      );
    }
    const latestId = latestBooking.id;
    const latestNumber = latestBooking.colony_application_number;
    const colony = latestBooking.colony;
    let relatives = [];
    try {
      relatives = JSON.parse(latestBooking.relatives || "[]");
    } catch (err) {
      console.error(`JSON parse error for booking ${latestId}:`, err);
      relatives = [];
    }
    const rel1 = relatives[0] || {};
    const name =
      rel1.full_name ||
      (lang === "ru" ? "Неизвестно" : lang === "uz" ? "Номаълум" : "Noma'lum");
    const colony_application_number = latestBooking.colony_application_number;

    if (latestBooking.status === "approved") {
      let visitDate = latestBooking.start_datetime
        ? new Date(latestBooking.start_datetime).toLocaleString("uz-UZ", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Tashkent",
          })
        : lang === "ru"
        ? "Неизвестно"
        : lang === "uz"
        ? "Номаълум"
        : "Noma'lum";
      let createdDate = new Date(latestBooking.created_at).toLocaleString(
        "uz-UZ",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Asia/Tashkent",
        }
      );

      await ctx.reply(
        texts[lang].approved_details
          .replace("{id}", colony_application_number)
          .replace("{name}", name)
          .replace("{colony}", colony)
          .replace("{created}", createdDate)
          .replace("{visit}", visitDate),
        buildMainMenu(lang, latestNumber)
      );
      return;
    } else if (latestBooking.status === "pending") {
      const pos = await getQueuePosition(latestId);
      await ctx.reply(
        pos
          ? texts[lang].pending_status.replace("{pos}", pos)
          : texts[lang].queue_not_found,
        buildMainMenu(lang, latestNumber)
      );
    } else {
      await ctx.reply(
        texts[lang].status_unknown,
        buildMainMenu(lang, latestNumber)
      );
    }
  } catch (err) {
    console.error("Error in queue status:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

// === handleGroupJoin ===
async function handleGroupJoin(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking) {
      await ctx.reply(texts[lang].no_booking_found);
      return;
    }

    const colony = latestBooking.colony;
    let groupUrl = `https://t.me/SmartJIEK${colony}` || "https://t.me/+qWg7Qh3t_OIxMDBi";

    await ctx.reply(
      texts[lang].group_join_prompt,
      Markup.inlineKeyboard([
        [Markup.button.url(texts[lang].group_join_button, groupUrl)],
      ])
    );
  } catch (err) {
    console.error("Error in group join:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

// === handleColonyLocation ===
async function handleColonyLocation(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking || latestBooking.status === "canceled") {
      return ctx.reply(
        texts[lang].no_active_application,
        buildMainMenu(lang, null)
      );
    }

    const colony = latestBooking.colony;
    const latestNumber = latestBooking.colony_application_number;
    const [coordRows] = await pool.query(
      "SELECT longitude, latitude FROM coordinates WHERE id = ?",
      [colony]
    );

    if (!coordRows.length) {
      return ctx.reply(texts[lang].coordinates_not_found);
    }

    const { longitude, latitude } = coordRows[0];
    await ctx.replyWithLocation(longitude, latitude);
    await ctx.reply(
      texts[lang].colony_location.replace("{colony}", colony),
      buildMainMenu(lang, latestNumber)
    );
  } catch (err) {
    console.error("Error in colony location:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

async function handleVisitorReminder(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const pdfFile = `tashrif_${lang}.pdf`;
    const pdfPath = path.join(__dirname, pdfFile);
    if (fs.existsSync(pdfPath)) {
      await ctx.replyWithDocument({ source: pdfPath });
    } else {
      await ctx.reply(texts[lang].file_not_found);
    }
  } catch (err) {
    console.error("Error in visitor reminder:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

// === handleCancelApplication / handleYesCancel / handleNoCancel / handleApplicationCopy ===
// (аналогично вынеси сюда остальные handle-функции из твоего файла)

module.exports = {
  handleBookMeeting,
  handleQueueStatus,
  handleGroupJoin,
  handleColonyLocation,
  handleCancelApplication,
  handleYesCancel,
  handleNoCancel,
  handleApplicationCopy,
  handleVisitorReminder,
};

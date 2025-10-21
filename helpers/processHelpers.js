const texts = require("../texts.js");
const { Markup } = require("telegraf");
const pool = require("../db.js");
const {
  getLatestPendingOrApprovedId,
  getLatestBooking,
  buildMainMenu,
  getQueuePosition,
  resetSessionAndScene,
  getLatestCanceledBooking,
} = require("./helpers.js");
const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

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
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
}

async function canSubmitNewBooking(chatId) {
  const latestBooking = await getLatestCanceledBooking(chatId);
  console.log(latestBooking);

  if (latestBooking && latestBooking.status === "approved") {
    const [dateRows] = await pool.query(
      "SELECT next_available_date, language FROM bookings WHERE id = ?",
      [latestBooking.id]
    );
    console.log(dateRows);
    if (dateRows[0]?.next_available_date > new Date()) {
      const nextDate = new Date(dateRows[0].next_available_date);
      const diffTime = Math.abs(nextDate - new Date());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (dateRows[0]?.language === "ru") {
        return ctx.reply(
          `🤖 У вас осталось ${diffDays} дней до следующей записи.`
        );
      } else if (dateRows[0]?.language === "uz") {
        return ctx.reply(`🤖 Кейинги ёзилиш учун сизда ${diffDays} кун қолди.`);
      } else {
        return ctx.reply(`Keyingi yozilish uchun sizda ${diffDays} kun qoldi.`);
      }
    }
  }
  return true;
}

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
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

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
    let groupUrl =
      `https://t.me/SmartJIEK${colony}` || "https://t.me/+qWg7Qh3t_OIxMDBi";

    await ctx.reply(
      texts[lang].group_join_prompt,
      Markup.inlineKeyboard([
        [Markup.button.url(texts[lang].group_button(colony), groupUrl)],
        [
          Markup.button.url(
            texts[lang].moneyGroup,
            "https://t.me/smartdunyopaygroup"
          ),
        ],
      ])
    );
  } catch (err) {
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

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
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

async function handleVisitorReminder(ctx) {
  try {
    const lang = ctx.session.language;
    const imageFile = `btashrif_${lang}.jpg`;
    const compressedImageFile = `tashrif_${lang}.png`;
    const imagePath = path.join(__dirname, imageFile);
    const compressedImagePath = path.join(__dirname, compressedImageFile);

    if (fs.existsSync(imagePath)) {
      await ctx.replyWithPhoto({ source: imagePath });

      await ctx.replyWithDocument({ source: imagePath });
    } else {
      await ctx.reply("Файл не найден 😕");
    }
  } catch (err) {
    await ctx.reply("Произошла ошибка.");
  }
}

async function handleCancelApplication(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const explicitNumber =
      ctx.match && ctx.match[1] ? Number(ctx.match[1]) : null;
    const latestNumber =
      explicitNumber || (await getLatestPendingOrApprovedId(ctx.from.id));

    if (!latestNumber) {
      await ctx.reply(
        texts[lang].new_booking_prompt,
        buildMainMenu(lang, null)
      );
      return;
    }

    const [bookingRows] = await pool.query(
      "SELECT id FROM bookings WHERE colony_application_number = ? AND user_id = ?",
      [latestNumber, ctx.from.id]
    );

    const attemptsLeft = await pool.query(
      `SELECT attempts FROM payments WHERE user_id = ?`,
      [ctx.from.id]
    );

    if (!bookingRows.length) {
      await ctx.reply(
        texts[lang].booking_not_found_or_canceled,
        buildMainMenu(lang, null)
      );
      return;
    }

    const bookingId = bookingRows[0].id;

    ctx.session.confirmCancel = true;
    ctx.session.confirmCancelId = bookingId;

    if (attemptsLeft[0][0]?.attempts < 2) {
      await ctx.reply(texts[lang].cancel_application_attempts);
    }

    await ctx.reply(
      texts[lang].cancel_confirm,
      Markup.keyboard([[texts[lang].yes, texts[lang].no]]).resize()
    );
  } catch (err) {
    console.log(err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

async function handleNoCancel(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);

    await ctx.reply(texts[lang].cancel_no, buildMainMenu(lang, latestId));
  } catch (err) {
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

async function handleYesCancel(ctx) {
  try {
    const lang = ctx.session.language;
    const bookingId = ctx.session.confirmCancelId;
    if (!ctx.session.confirmCancel || !bookingId) {
      await resetSessionAndScene(ctx);
      return ctx.reply(texts[lang].no_cancel_booking);
    }

    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const [bookingsRows] = await pool.query(
      "SELECT colony, relatives, colony_application_number, phone_number, status FROM bookings WHERE id = ? AND user_id = ?",
      [bookingId, ctx.from.id]
    );

    if (!bookingsRows.length) {
      await resetSessionAndScene(ctx);
      return ctx.reply(texts[lang].booking_not_found_or_canceled);
    }

    const colony = bookingsRows[0].colony;
    const phoneNumber = bookingsRows[0].phone_number;
    const status = bookingsRows[0].status;
    let bookingName =
      lang === "ru" ? "Неизвестно" : lang === "uz" ? "Номаълум" : "Noma'lum";

    if (bookingsRows[0].relatives) {
      try {
        const relatives = JSON.parse(bookingsRows[0].relatives);
        if (Array.isArray(relatives) && relatives.length > 0) {
          bookingName = relatives[0].full_name || bookingName;
        }
      } catch (e) {
        console.error("JSON parse error for booking cancellation:", e);
      }
    }

    const [result] = await pool.query(
      "DELETE FROM bookings WHERE id = ? AND user_id = ?",
      [bookingId, ctx.from.id]
    );

    if (colony == 24 && status === "approved") {
      await pool.query(
        "UPDATE payments SET attempts = attempts - 1 WHERE user_id = ?",
        [ctx.from.id]
      );
    }

    await pool.query(
      `DELETE FROM payments WHERE attempts < 1 AND user_id = ?`,
      [ctx.from.id]
    );

    if (result.affectedRows === 0) {
      await resetSessionAndScene(ctx);
      return ctx.reply(texts[lang].booking_not_found_or_canceled);
    }

    const latestNumberAfterDelete = await getLatestPendingOrApprovedId(
      ctx.from.id
    );
    await ctx.reply(
      texts[lang].application_canceled,
      buildMainMenu(lang, latestNumberAfterDelete)
    );

    await resetSessionAndScene(ctx);
  } catch (err) {
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

async function handleApplicationCopy(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking) {
      return ctx.reply(texts[lang].no_application, buildMainMenu(lang, null));
    }
    const booking = latestBooking;

    const [libRows] = await pool.query("SELECT * FROM library LIMIT 1");
    const library = libRows[0] || { placeNumber: "", commander: "" };

    let relatives = [];
    try {
      relatives = booking.relatives ? JSON.parse(booking.relatives) : [];
    } catch (e) {
      console.error(
        `JSON parse error for booking ${booking.id} in document generation:`,
        e
      );
    }

    const rel1 = relatives[0] || {};
    const rel2 = relatives[1] || {};
    const rel3 = relatives[2] || {};

    let templatePath = path.join(__dirname, `ariza_${lang}.docx`);
    if (!fs.existsSync(templatePath)) {
      templatePath = path.join(__dirname, "ariza.docx"); // Fallback
    }
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    doc.render({
      placeNumber: library.placeNumber,
      commander: library.commander,
      fullname: rel1.full_name || "",
      fullname2:
        rel2.full_name ||
        "____________________________________________________",
      fullname3:
        rel3.full_name ||
        "____________________________________________________",
      prisoner: booking.prisoner_name || "",
      arizaNumber: booking.colony_application_number || "",
      today: new Date().toLocaleDateString("uz-UZ"),
    });

    const buf = doc.getZip().generate({ type: "nodebuffer" });

    await ctx.replyWithDocument({
      source: buf,
      filename: `ariza_${booking.colony_application_number}.docx`,
    });
  } catch (err) {
    console.error("Error in application copy:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

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
  canSubmitNewBooking,
};

// index.js

const { Telegraf, Scenes, session, Markup } = require("telegraf");
require("dotenv").config();
const pool = require("../db");
const bookingWizard = require("./bookingScene");
const adminChatId = process.env.ADMIN_CHAT_ID;

const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([bookingWizard]);

const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

bot.use(session());
bot.use(stage.middleware());

bot.use((ctx, next) => {
  console.log(
    `Middleware: user ${
      ctx.from?.id
    }, ctx.wizard exists: ${!!ctx.wizard}, scene: ${
      ctx.scene?.current?.id || "none"
    }`
  );
  return next();
});

async function getLatestPendingOrApprovedId(userId) {
  try {
    // Проверяем обе таблицы: bookings и bookings5
    const [rows] = await pool.query(
      `SELECT id, colony FROM (
         SELECT id, colony FROM bookings WHERE status IN ('pending', 'approved') AND user_id = ?
         UNION
         SELECT id, colony FROM bookings5 WHERE status IN ('pending', 'approved') AND user_id = ?
       ) AS combined
       ORDER BY id DESC LIMIT 1`,
      [userId, userId]
    );
    return rows.length ? rows[0].id : null;
  } catch (err) {
    console.error("Error in getLatestPendingOrApprovedId:", err);
    throw err;
  }
}

async function getLatestBooking(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM (
         SELECT id, user_id, prisoner_name, colony, relatives, status, created_at, start_datetime FROM bookings WHERE user_id = ?
         UNION
         SELECT id, user_id, prisoner_name, colony, relatives, status, created_at, start_datetime FROM bookings5 WHERE user_id = ?
       ) AS combined
       ORDER BY id DESC LIMIT 1`,
      [userId, userId]
    );
    return rows.length ? rows[0] : null;
  } catch (err) {
    console.error("Error in getLatestBooking:", err);
    throw err;
  }
}

async function getUserBookingStatus(userId) {
  return await getLatestBooking(userId); // Reuse the function
}

function buildMainMenu(latestPendingId) {
  const rows = [
    ["📊 Navbat holati", "📱 Grupaga otish", "🖨️ Ariza nusxasini olish"],
  ];

  if (latestPendingId) {
    rows.push([`❌ Arizani bekor qilish #${latestPendingId}`]);
  } else {
    rows.push(["❌ Arizani bekor qilish"]);
  }

  return Markup.keyboard(rows).resize();
}

async function getQueuePosition(bookingId) {
  try {
    // Проверяем, из какой таблицы bookingId
    const [booking] = await pool.query(
      `SELECT colony FROM (
         SELECT id, colony FROM bookings WHERE id = ?
         UNION
         SELECT id, colony FROM bookings5 WHERE id = ?
       ) AS combined`,
      [bookingId, bookingId]
    );

    if (!booking.length) {
      return null;
    }

    const tableName = booking[0].colony === "5" ? "bookings5" : "bookings";

    const [rows] = await pool.query(
      `SELECT id FROM ${tableName} WHERE status = 'pending' ORDER BY id ASC`
    );
    const ids = rows.map((row) => row.id);
    const position = ids.indexOf(bookingId);
    return position !== -1 ? position + 1 : null;
  } catch (err) {
    console.error("Error in getQueuePosition:", err);
    throw err;
  }
}

async function resetSessionAndScene(ctx) {
  try {
    console.log(`Resetting session and scene for user ${ctx.from?.id}`);
    if (ctx.scene && ctx.scene.current) {
      console.log(`Leaving scene: ${ctx.scene.current.id}`);
      await ctx.scene.leave();
    }
    ctx.session = ctx.session || {};
    delete ctx.session.__scenes;
    console.log(`Session after reset:`, ctx.session);
  } catch (err) {
    console.error("Error in resetSessionAndScene:", err);
    throw err;
  }
}

bot.command("cancel", async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply("❌ Jarayon bekor qilindi.", buildMainMenu(latestId));
  } catch (err) {
    console.error("Error in /cancel:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.start(async (ctx) => {
  try {
    if (ctx.scene.current) {
      await ctx.reply(
        "❌ Siz allaqachon jarayondasiz. Iltimos, joriy jarayonni yakunlang yoki /cancel buyrug‘ini ishlating."
      );
      return;
    }

    await resetSessionAndScene(ctx);

    const userId = ctx.from.id;
    const latestBooking = await getLatestBooking(userId);

    if (latestBooking && latestBooking.status !== "canceled") {
      const latestId = latestBooking.id;
      let relatives = [];
      try {
        relatives = JSON.parse(latestBooking.relatives || "[]");
      } catch (err) {
        relatives = [];
      }
      const rel1 = relatives[0] || {};

      if (latestBooking.status === "approved") {
        await ctx.reply(
          `🎉 Ariza tasdiqlangan. №: ${latestId}
👤 Arizachi: ${rel1.full_name || "Noma'lum"}`,
          buildMainMenu(latestId)
        );
      } else if (latestBooking.status === "pending") {
        const pos = await getQueuePosition(latestId);
        await ctx.reply(
          pos ? `📊 Sizning navbatingiz: ${pos}` : "❌ Navbat topilmadi.",
          buildMainMenu(latestId)
        );
      }
    } else {
      await ctx.reply(
        "👋 Assalomu alaykum!\nBu platforma orqali siz qamoqxona mahbuslari bilan uchrashuvga yozilishingiz mumkin.",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "📅 Uchrashuvga yozilish",
              "choose_language"
            ),
          ],
        ])
      );
    }
  } catch (err) {
    console.error("Error in /start:", err);
    await ctx.reply("❌ Xatolik yuz berdi, qayta urinib ko‘ring.");
  }
});

bot.action("choose_language", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "🌐 Iltimos, tilni tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🇺🇿 O‘zbekcha", "lang_uz")],
      [Markup.button.callback("🇷🇺 Русский", "lang_ru")],
    ])
  );
});

bot.action(["lang_uz", "lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });

    ctx.session = ctx.session || {};
    ctx.session.language = ctx.match[0] === "lang_uz" ? "uz" : "ru";
    delete ctx.session.__scenes;

    console.log(
      `Entering booking-wizard for user ${ctx.from.id} with language ${ctx.session.language}`
    );
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error(`Error in language selection for user ${ctx.from.id}:`, err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.action("start_booking", async (ctx) => {
  try {
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
      const statusText =
        booking.status === "approved" ? "tasdiqlangan" : "kutmoqda";

      await ctx.answerCbQuery();
      return ctx.reply(
        `❌ Sizda allaqachon ariza mavjud (№: ${existingBookingId}, Holat: ${statusText}, Arizachi: ${
          rel1.full_name || "Noma'lum"
        }). Yangi ariza yuborish uchun avval joriy arizani bekor qiling.`,
        buildMainMenu(existingBookingId)
      );
    }

    await resetSessionAndScene(ctx);
    console.log(`Entering booking-wizard for user ${ctx.from.id}`);
    await ctx.answerCbQuery();
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error("Error in start_booking:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.action("cancel", async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply(
      "❌ Uchrashuv yozuvi bekor qilindi.",
      buildMainMenu(latestId)
    );
  } catch (err) {
    console.error("Error in cancel action:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("📊 Navbat holati", async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking || latestBooking.status === "canceled") {
      return ctx.reply(
        "❌ Sizda hozirda kutayotgan ariza yo‘q.",
        buildMainMenu(null)
      );
    }
    const latestId = latestBooking.id;
    let relatives = [];
    try {
      relatives = JSON.parse(latestBooking.relatives || "[]");
    } catch (err) {
      console.error(`JSON parse error for booking ${latestId}:`, err);
      relatives = [];
    }
    const rel1 = relatives[0] || {};

    if (latestBooking.status === "approved") {
      await ctx.reply(
        `🎉 Ariza tasdiqlangan. №: ${latestId}
👤 Arizachi: ${rel1.full_name || "Noma'lum"}
📅 Berilgan sana: ${new Date(latestBooking.created_at).toLocaleString("uz-UZ", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Asia/Tashkent",
        })}
⌚️ Kelishi sana: ${new Date(
          new Date(latestBooking.start_datetime).setDate(
            new Date(latestBooking.start_datetime).getDate() + 1
          )
        ).toLocaleString("uz-UZ", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Asia/Tashkent",
        })}
🟢 Holat: Tasdiqlangan`,
        buildMainMenu(latestId)
      );
      return;
    } else if (latestBooking.status === "pending") {
      const pos = await getQueuePosition(latestId);
      await ctx.reply(
        pos ? `📊 Sizning navbatingiz: ${pos}` : "❌ Navbat topilmadi.",
        buildMainMenu(latestId)
      );
    } else {
      await ctx.reply("❌ Ariza holati noma'lum.", buildMainMenu(latestId));
    }
  } catch (err) {
    console.error("Error in Navbat holati:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("📱 Grupaga otish", async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking) {
      await ctx.reply("❌ Hozirda ariza topilmadi.");
      return;
    }
    let groupUrl = "https://t.me/+qWg7Qh3t_OIxMDBi";
    if (latestBooking.colony === "5") {
      groupUrl = "https://t.me/SmartJIEK5";
    }
    await ctx.reply(
      "📱 Tugmasini bosing:",
      Markup.inlineKeyboard([[Markup.button.url("📌 Grupaga otish", groupUrl)]])
    );
  } catch (err) {
    console.error("Error in Grupaga otish:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("❌ Yo‘q", async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);

    await ctx.reply("✅ Ariza bekor qilinmadi.", buildMainMenu(latestId));
  } catch (err) {
    console.error("Error in Yo‘q:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears(/^❌ Arizani bekor qilish(?:\s*#(\d+))?$/i, async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    const explicitId = ctx.match && ctx.match[1] ? Number(ctx.match[1]) : null;
    const latestId =
      explicitId || (await getLatestPendingOrApprovedId(ctx.from.id));

    if (!latestId) {
      return ctx.reply(
        "❌ Sizda bekor qilish uchun ariza topilmadi.",
        buildMainMenu(null)
      );
    }

    ctx.session.confirmCancel = true;
    ctx.session.confirmCancelId = latestId;

    await ctx.reply(
      "❓ Arizani bekor qilmoqchimisiz?",
      Markup.keyboard([["✅ Ha", "❌ Yo‘q"]]).resize()
    );
  } catch (err) {
    console.error("Error in Arizani bekor qilish:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("✅ Ha", async (ctx) => {
  try {
    const bookingId = ctx.session.confirmCancelId;
    if (!ctx.session.confirmCancel || !bookingId) {
      await resetSessionAndScene(ctx);
      return ctx.reply("❌ Hozir bekor qilish uchun ariza topilmadi.");
    }

    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    // Определяем таблицу на основе колонии
    const [booking] = await pool.query(
      `SELECT colony FROM (
         SELECT id, colony FROM bookings WHERE id = ?
         UNION
         SELECT id, colony FROM bookings5 WHERE id = ?
       ) AS combined`,
      [bookingId, bookingId]
    );

    if (!booking.length) {
      await resetSessionAndScene(ctx);
      return ctx.reply("❌ Ariza topilmadi yoki allaqachon bekor qilingan.");
    }

    const tableName = booking[0].colony === "5" ? "bookings5" : "bookings";

    // Удаляем запись из базы данных
    const [result] = await pool.query(
      `DELETE FROM ${tableName} WHERE id = ? AND user_id = ?`,
      [bookingId, ctx.from.id]
    );

    if (result.affectedRows === 0) {
      await resetSessionAndScene(ctx);
      return ctx.reply("❌ Ariza topilmadi yoki allaqachon bekor qilingan.");
    }

    const [rows] = await pool.query(
      `SELECT relatives FROM ${tableName} WHERE id = ?`,
      [bookingId]
    );
    let bookingName = "Noma'lum";
    if (rows.length && rows[0].relatives) {
      try {
        const relatives = JSON.parse(rows[0].relatives);
        if (Array.isArray(relatives) && relatives.length > 0) {
          bookingName = relatives[0].full_name || "Noma'lum";
        }
      } catch (e) {
        console.error("JSON parse error for booking cancellation:", e);
      }
    }

    await ctx.reply("❌ Sizning arizangiz bekor qilindi.", {
      reply_markup: { remove_keyboard: true },
    });

    await resetSessionAndScene(ctx);

    // try {
    //   await ctx.telegram.sendMessage(
    //     adminChatId,
    //     `❌ Ariza bekor qilindi. Nomer: ${bookingId}\n🧑 Arizachi: ${bookingName}`
    //   );
    // } catch (err) {
    //   if (err.response && err.response.error_code === 403) {
    //     console.warn("⚠️ Admin botni bloklagan, xabar yuborilmadi");
    //   } else {
    //     console.error("Telegram API error:", err);
    //   }
    // }

    await ctx.reply(
      "🔄 Yangi uchrashuvga yozilish uchun quyidagi tugmani bosing:",
      Markup.inlineKeyboard([
        [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
      ])
    );
  } catch (err) {
    console.error("Error in Ha:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.on("text", async (ctx, next) => {
  try {
    if (ctx.scene && ctx.scene.current) {
      console.log(
        `User ${ctx.from.id} in scene ${ctx.scene.current.id}, ignoring unexpected text: ${ctx.message.text}`
      );
      return;
    }
    await next();
  } catch (err) {
    console.error("Error in text handler:", err);
    await ctx.reply(
      "❌ Xatolik yuz berdi, iltimos, /start buyrug‘ini qayta yuboring."
    );
  }
});

bot.catch((err, ctx) => {
  console.error("Global error:", err);
  if (err.response && err.response.error_code === 403) {
    console.warn(`⚠️ User ${ctx.from?.id} blocked the bot, skip message`);
  } else {
    ctx.reply(
      "❌ Xatolik yuz berdi, iltimos, /start buyrug‘ini qayta yuboring."
    );
  }
});

bot.hears("Yangi ariza yuborish", async (ctx) => {
  try {
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
      const statusText =
        booking.status === "approved" ? "tasdiqlangan" : "kutmoqda";

      return ctx.reply(
        `❌ Sizda allaqachon ariza mavjud (№: ${existingBookingId}, Holat: ${statusText}, Arizachi: ${
          rel1.full_name || "Noma'lum"
        }). Yangi ariza yuborish uchun avval joriy arizani bekor qiling.`,
        buildMainMenu(existingBookingId)
      );
    }

    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error("Error in Yangi ariza yuborish:", err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("🖨️ Ariza nusxasini olish", async (ctx) => {
  try {
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking) {
      return ctx.reply(
        "❌ Sizda hozirda kutayotgan ariza yo‘q.",
        buildMainMenu(null)
      );
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

    const templatePath = path.join(__dirname, "ariza.docx");
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
      arizaNumber: booking.id || "",
      today: new Date().toLocaleDateString("uz-UZ"),
    });

    const buf = doc.getZip().generate({ type: "nodebuffer" });

    await ctx.replyWithDocument({
      source: buf,
      filename: `ariza_${booking.id}.docx`,
    });
  } catch (err) {
    console.error("Error in Ariza nusxasini olish:", err);
    await ctx.reply("❌ Xatolik yuz berdi (печать).");
  }
});

bot.launch().then(() => console.log("🚀 Bot ishga tushdi"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

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

/** ─────────────────────
 *  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 *  ───────────────────── */
async function getLatestPendingId(userId) {
  const [rows] = await pool.query(
    "SELECT id FROM bookings WHERE status = 'pending' AND user_id = ? ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return rows.length ? rows[0].id : null;
}

async function getLatestPendingIdWithoutStatus(userId) {
  const [rows] = await pool.query(
    "SELECT id FROM bookings WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return rows.length ? rows[0].id : null;
}

async function getUserBookingStatus(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM bookings WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return rows.length ? rows : null;
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
  const [rows] = await pool.query(
    "SELECT id FROM bookings WHERE status = 'pending' ORDER BY id ASC"
  );
  const ids = rows.map((row) => row.id);
  const position = ids.indexOf(bookingId);
  return position !== -1 ? position + 1 : null;
}

/** ─────────────────────
 *  СТАРТ
 *  ───────────────────── */
bot.start(async (ctx) => {
  await ctx.reply(
    "👋 Assalomu alaykum!\nBu platforma orqali siz qamoqxona mahbuslari bilan uchrashuvga yozilishingiz mumkin.",
    Markup.inlineKeyboard([
      [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
    ])
  );
});

/** ─────────────────────
 *  ЗАПУСК СЦЕНЫ
 *  ───────────────────── */
bot.action("start_booking", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("booking-wizard");
});

/** ─────────────────────
 *  ВНУТРИСЦЕНОВАЯ ОТМЕНА ЧЕРНОВИКА (inline "cancel")
 *  ───────────────────── */
bot.action("cancel", async (ctx) => {
  // Это ОТМЕНА ЧЕРНОВИКА в визарде (НЕ отмена уже сохранённой заявки!)
  if (ctx.scene && ctx.scene.leave) {
    await ctx.scene.leave();
  }
  ctx.session = {};
  ctx.wizard.state = {};
  await ctx.answerCbQuery();
  await ctx.reply(
    "❌ Uchrashuv yozuvi bekor qilindi.",
    Markup.inlineKeyboard([
      [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
    ])
  );
  await ctx.scene.leave();
});

/** ─────────────────────
 *  NAVBAT HOLATI
 *  ───────────────────── */
bot.hears("📊 Navbat holati", async (ctx) => {
  try {
    const latestId = await getLatestPendingIdWithoutStatus(ctx.from.id);
    if (!latestId) {
      return ctx.reply(
        "❌ Sizda hozirda kutayotgan ariza yo‘q.",
        buildMainMenu(null)
      );
    }
    const pos = await getQueuePosition(latestId);
    const rowInfo = await getUserBookingStatus(ctx.from.id);
    const relatives = JSON.parse(rowInfo[0].relatives);

    if (rowInfo[0].status === "approved") {
      await ctx.reply(
        `🎉 Ariza tasdiqlangan. Nomer: ${latestId}
👤 Arizachi: ${relatives[0].full_name}
📅 Berilgan sana: ${new Date().toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}
⌚️ Kelishi sana: ${new Date(
          new Date(rowInfo[0].start_datetime).getTime() +
            1 * 24 * 60 * 60 * 1000
        ).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}
🟢 Holat: Tasdiqlangan`,
        buildMainMenu(latestId)
      );

      return;
    }

    if (!pos) {
      return ctx.reply("❌ Navbat topilmadi.", buildMainMenu(latestId));
    }

    await ctx.reply(`📊 Sizning navbatingiz: ${pos}`, buildMainMenu(latestId));
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("📱 Grupaga otish", async (ctx) => {
  try {
    await ctx.reply(
      "📱 Tugmasini bosing:",
      Markup.inlineKeyboard([
        [
          Markup.button.url(
            "📌 Grupaga otish",
            "https://t.me/+qWg7Qh3t_OIxMDBi"
          ),
        ],
      ])
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

/** ─────────────────────
 *  «НЕ ОТМЕНЯТЬ» (отказ от отмены существующей заявки)
 *  ───────────────────── */
bot.hears("❌ Yo‘q", async (ctx) => {
  try {
    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const latestId = await getLatestPendingId(ctx.from.id);

    await ctx.reply(
      "✅ Ariza bekor qilinmadi.",
      Markup.keyboard(buildMainMenu(latestId).reply_markup.keyboard).resize()
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

/** ─────────────────────
 *  ЗАПРОС ОТМЕНЫ (с ID или без ID — единый обработчик)
 *  ───────────────────── */
bot.hears(/^❌ Arizani bekor qilish(?:\s*#(\d+))?$/i, async (ctx) => {
  try {
    // 1) Если есть id в тексте — используем его, иначе берём последний pending
    const explicitId = ctx.match && ctx.match[1] ? Number(ctx.match[1]) : null;
    const latestId =
      explicitId || (await getLatestPendingIdWithoutStatus(ctx.from.id));

    if (!latestId) {
      return ctx.reply(
        "❌ Sizda bekor qilish uchun ariza topilmadi.",
        buildMainMenu(null)
      );
    }

    // 2) Сохраняем ожидание подтверждения в сессию
    ctx.session.confirmCancel = true;
    ctx.session.confirmCancelId = latestId;

    // 3) Показываем подтверждение
    await ctx.reply(
      "❓ Arizani bekor qilmoqchimisiz?",
      Markup.keyboard([["✅ Ha", "❌ Yo‘q"]]).resize()
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

/** ─────────────────────
 *  ПОДТВЕРЖДЕНИЕ ОТМЕНЫ СУЩЕСТВУЮЩЕЙ ЗАЯВКИ
 *  ───────────────────── */
bot.hears("✅ Ha", async (ctx) => {
  try {
    const bookingId = ctx.session.confirmCancelId;
    if (!ctx.session.confirmCancel || !bookingId) {
      return ctx.reply("❌ Hozir bekor qilish uchun ariza topilmadi.");
    }

    // Сбрасываем флаги вне зависимости от результата
    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const [result] = await pool.query(
      "UPDATE bookings SET status = 'canceled' WHERE id = ? AND user_id = ? ",
      [bookingId, ctx.from.id]
    );

    if (result.affectedRows === 0) {
      return ctx.reply("❌ Ariza topilmadi yoki allaqachon bekor qilingan.");
    }

    // Узнаем имя для админа
    const [rows] = await pool.query(
      "SELECT relatives FROM bookings WHERE id = ?",
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
        console.error("JSON parse error:", e);
      }
    }

    // Чистим клавиатуру и уведомляем
    await ctx.reply("❌ Sizning arizangiz bekor qilindi.", {
      reply_markup: { remove_keyboard: true },
    });

    if (ctx.scene && ctx.scene.leave) {
      await ctx.scene.leave();
    }
    ctx.session = {};

    // Сообщаем админу
    try {
      await ctx.telegram.sendMessage(
        adminChatId,
        `❌ Ariza bekor qilindi. Nomer: ${bookingId}\n🧑 Arizachi: ${bookingName}`
      );
    } catch (err) {
      if (err.response && err.response.error_code === 403) {
        console.warn("⚠️ Admin botni bloklagan, xabar yuborilmadi");
      } else {
        console.error("Telegram API error:", err);
      }
    }

    // Предлагаем начать заново
    await ctx.reply(
      "🔄 Yangi uchrashuvga yozilish uchun quyidagi tugmani bosing:",
      Markup.inlineKeyboard([
        [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
      ])
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.catch((err, ctx) => {
  if (err.response && err.response.error_code === 403) {
    console.warn(`⚠️ User ${ctx.from?.id} blocked the bot, skip message`);
  } else {
    console.error("❌ Global error:", err);
  }
});

bot.hears("Yangi ariza yuborish", async (ctx) => {
  try {
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi.");
  }
});

bot.hears("🖨️ Ariza nusxasini olish", async (ctx) => {
  try {
    const latestId = await getLatestPendingIdWithoutStatus(ctx.from.id);
    if (!latestId) {
      return ctx.reply("❌ Sizda hozirda kutayotgan ariza yo‘q.");
    }

    // Берем данные заявки
    const [bookingRows] = await pool.query(
      "SELECT * FROM bookings WHERE id = ?",
      [latestId]
    );
    if (!bookingRows.length) {
      return ctx.reply("❌ Ariza topilmadi.");
    }
    const booking = bookingRows[0];

    // Берем данные из library
    const [libRows] = await pool.query("SELECT * FROM library LIMIT 1");
    const library = libRows[0] || { placeNumber: "", commander: "" };

    // Парсим родственников
    let relatives = [];
    try {
      relatives = booking.relatives ? JSON.parse(booking.relatives) : [];
    } catch (e) {
      console.error("JSON parse error:", e);
    }

    // Достаём каждого безопасно
    const rel1 = relatives[0] || {};
    const rel2 = relatives[1] || {};
    const rel3 = relatives[2] || {};

    // Загружаем шаблон
    const templatePath = path.join(__dirname, "ariza.docx");
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Заполняем шаблон
    doc.render({
      placeNumber: library.placeNumber,
      commander: library.commander,
      fullname: rel1.full_name || "",
      passport: rel1.passport || "",
      fullname2:
        rel2.full_name ||
        "____________________________________________________",
      passport2: rel2.passport || "",
      fullname3:
        rel3.full_name ||
        "____________________________________________________",
      passport3: rel3.passport || "",
      prisoner: booking.prisoner_name || "",
      arizaNumber: booking.id || "",
      today: new Date().toLocaleDateString("uz-UZ"),
    });

    const buf = doc.getZip().generate({ type: "nodebuffer" });

    await ctx.replyWithDocument({
      source: buf,
      filename: `ariza_${latestId}.docx`,
    });
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi (печать).");
  }
});

bot.launch().then(() => console.log("🚀 Bot ishga tushdi"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

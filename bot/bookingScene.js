const { Telegraf, Scenes, session, Markup } = require("telegraf");
const pool = require("../db");

const MAX_RELATIVES = 3;

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Проверка и запрос телефона
  async (ctx) => {
    try {
      // Проверяем активные заявки
      const [rows] = await pool.query(
        "SELECT * FROM bookings WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
        [ctx.from.id]
      );

      if (rows.length > 0) {
        await ctx.reply(
          "⚠️ Sizda hali tugallanmagan ariza mavjud. Yangi ariza yaratish uchun uni yakunlang yoki bekor qiling.",
          Markup.keyboard([
            ["📊 Navbat holati"],
            ["❌ Arizani bekor qilish"],
          ]).resize()
        );
        return ctx.scene.leave();
      }

      // Проверяем, есть ли сохранённый номер телефона
      const [userRows] = await pool.query(
        "SELECT phone_number FROM bookings WHERE user_id = ?",
        [ctx.from.id]
      );

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        await ctx.reply(`🤖 Tartibga rioya qiling!`, Markup.removeKeyboard());
        return ctx.wizard.next(); // Переходим к Step 1 без запроса оферты
      }

      // Если номера нет → просим ввести
      await ctx.reply(
        "📲 Iltimos, telefon raqamingizni yuboring:",
        Markup.keyboard([[Markup.button.contactRequest("📞 Raqamni yuborish")]])
          .resize()
          .oneTime()
      );
      return ctx.wizard.next();
    } catch (err) {
      console.error("Error in Step 0:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 1: Принимаем только контакт и запрашиваем оферту
  async (ctx) => {
    console.log(`Step 1: User ${ctx.from.id} sent message:`, ctx.message);

    if (!ctx.wizard.state.phone) {
      // Если номер ещё не сохранён, проверяем контакт
      if (!ctx.message?.contact?.phone_number) {
        ctx.wizard.state.retryCount = (ctx.wizard.state.retryCount || 0) + 1;

        if (ctx.wizard.state.retryCount > 2) {
          await ctx.reply(
            "❌ Siz ko‘p marta noto‘g‘ri ma’lumot yubordingiz. Iltimos, /start buyrug‘i bilan qaytadan boshlang.",
            Markup.removeKeyboard()
          );
          return ctx.scene.leave();
        }

        await ctx.reply(
          "📱 Telefon raqamingizni faqat tugma orqali yuboring. Raqamni matn sifatida yozmang:",
          Markup.keyboard([[Markup.button.contactRequest("📞 Raqamni yuborish")]])
            .resize()
            .oneTime()
        );
        return;
      }

      // Успешная отправка контакта
      ctx.wizard.state.phone = ctx.message.contact.phone_number;
      await ctx.reply(
        "✅ Telefon raqamingiz qabul qilindi.",
        Markup.removeKeyboard()
      );
    }

    // Запрашиваем принятие публичной оферты, если ещё не запрашивали
    if (!ctx.wizard.state.offerRequested) {
      console.log(`Step 1: Requesting offer for user ${ctx.from.id}`);
      ctx.wizard.state.offerRequested = true;
      await ctx.reply(
        "📜 Iltimos, publychnaya ofertani o‘qing va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:",
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📖 Ofertani o‘qish",
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback("✅ Qabul qilaman", "accept_offer")],
        ])
      );
    }

    return ctx.wizard.next();
  },

  // Step 2: Принятие публичной оферты
  async (ctx) => {
    console.log(
      `Step 2: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    if (!ctx.callbackQuery?.data || ctx.callbackQuery.data !== "accept_offer") {
      // Игнорируем текстовые сообщения и повторяем запрос на оферту
      await ctx.reply(
        "📜 Iltimos, publychnaya ofertani o‘qing va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:",
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📖 Ofertani o‘qish",
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback("✅ Qabul qilaman", "accept_offer")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.offer_accepted = true;

    // Запрашиваем выбор колонии
    await ctx.reply(
      "🏛 Iltimos, koloniyani tanlang:",
      Markup.inlineKeyboard([
        [Markup.button.callback("1-koloniya", "colony_1")],
        [Markup.button.callback("2-koloniya", "colony_2")],
        [Markup.button.callback("3-koloniya", "colony_3")],
        [Markup.button.callback("4-koloniya", "colony_4")],
      ])
    );
    return ctx.wizard.next();
  },

  // Step 3: Выбор колонии
  async (ctx) => {
    console.log(
      `Step 3: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );
    if (
      !ctx.callbackQuery?.data ||
      !ctx.callbackQuery.data.startsWith("colony_")
    ) {
      await ctx.reply(
        "❌ Iltimos, koloniyani tanlang:",
        Markup.inlineKeyboard([
          [Markup.button.callback("1-koloniya", "colony_1")],
          [Markup.button.callback("2-koloniya", "colony_2")],
          [Markup.button.callback("3-koloniya", "colony_3")],
          [Markup.button.callback("4-koloniya", "colony_4")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");

    // Инициализируем данные
    ctx.wizard.state.relatives = [];
    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.prisoner_name = null;
    ctx.wizard.state.visit_type = null;

    await ctx.reply(
      "📅 Iltimos, uchrashuv turini tanlang:",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔵 1-kunlik", "short")],
        [Markup.button.callback("🟢 2-kunlik", "long")],
      ])
    );
    return ctx.wizard.next();
  },

  // Step 4: Выбор типа визита
  async (ctx) => {
    console.log(
      `Step 4: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (
      !ctx.callbackQuery?.data ||
      (ctx.callbackQuery.data !== "long" && ctx.callbackQuery.data !== "short")
    ) {
      await ctx.reply(
        "❌ Iltimos, uchrashuv turini tanlang:",
        Markup.inlineKeyboard([
          [Markup.button.callback("🔵 1-kunlik", "short")],
          [Markup.button.callback("🟢 2-kunlik", "long")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.visit_type = ctx.callbackQuery.data;

    await ctx.reply("👤 Iltimos, to‘liq ismingiz va familiyangizni kiriting:");
    return ctx.wizard.next();
  },

  // Step 5: Ism va familiya
  async (ctx) => {
    console.log(`Step 5: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (ctx.message?.text === "❌ Bekor qilish ariza") {
      await ctx.reply(
        "❌ Uchrashuv yozuvi bekor qilindi.",
        Markup.keyboard([["📅 Uchrashuvga yozilish"]]).resize()
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, ism va familiyani matn shaklida yuboring.");
      return ctx.wizard.selectStep(5);
    }

    ctx.wizard.state.currentRelative.full_name = ctx.message.text.toUpperCase();
    ctx.wizard.state.currentRelative.passport = "AC1234567";
    ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

    if (!ctx.wizard.state.prisoner_name) {
      await ctx.reply(
        "👥 Siz kim bilan uchrashmoqchisiz? Mahbusning to‘liq ismini kiriting:"
      );
      return ctx.wizard.selectStep(7);
    } else {
      return askAddMore(ctx);
    }
  },

  // Step 6: Placeholder (not used)
  async (ctx) => {
    return ctx.wizard.next();
  },

  // Step 7: Mahbus ismi
  async (ctx) => {
    console.log(`Step 7: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, mahbusning ismini matn shaklida yuboring.");
      return ctx.wizard.selectStep(7);
    }

    ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();
    return askAddMore(ctx);
  },

  // Step 8: Qo‘shimcha qarindosh yoki yakunlash
  async (ctx) => {
    console.log(
      `Step 8: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "add_more") {
      if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
        ctx.wizard.state.currentRelative = {};
        await ctx.reply(
          "👤 Yangi qarindoshning ismi va familiyasini kiriting:"
        );
        return ctx.wizard.selectStep(5);
      } else {
        await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
        return showSummary(ctx);
      }
    } else if (ctx.callbackQuery?.data === "done") {
      return showSummary(ctx);
    } else {
      // Handle unexpected inputs
      await ctx.reply(
        "❌ Iltimos, quyidagi tugmalardan birini bosing:",
        Markup.inlineKeyboard([
          [Markup.button.callback("Ha, qo‘shaman", "add_more")],
          [Markup.button.callback("Yo‘q", "done")],
        ])
      );
      return;
    }
  },

  // Step 9: Yakuniy tasdiqlash yoki bekor qilish
  async (ctx) => {
    console.log(
      `Step 9: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "confirm") {
      return saveBooking(ctx);
    } else if (ctx.callbackQuery?.data === "cancel") {
      await ctx.reply(
        "❌ Uchrashuv yozuvi bekor qilindi.",
        Markup.inlineKeyboard([
          [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
        ])
      );
      return ctx.scene.leave();
    } else {
      // Handle unexpected inputs (e.g., text messages)
      await ctx.reply(
        "❌ Iltimos, quyidagi tugmalardan birini bosing:",
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Tasdiqlash", "confirm")],
          [Markup.button.callback("❌ Bekor qilish ariza", "cancel")],
        ])
      );
      return;
    }
  }
);

// helper: qo‘shish yoki yakunlash
async function askAddMore(ctx) {
  if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
    await ctx.reply(
      "➕ Yana qarindosh qo‘shishni xohlaysizmi? (maksimal 3 ta)",
      Markup.inlineKeyboard([
        [Markup.button.callback("Ha, qo‘shaman", "add_more")],
        [Markup.button.callback("Yo‘q", "done")],
      ])
    );
    return ctx.wizard.selectStep(8);
  } else {
    await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
    return showSummary(ctx);
  }
}

// helper: ko‘rsatish summary
async function showSummary(ctx) {
  const { prisoner_name, relatives, colony } = ctx.wizard.state;
  let text = "📋 Arizangiz tafsilotlari:\n\n";
  text += `🏛 Koloniya: ${colony}\n`;
  text += `👥 Mahbus: ${prisoner_name}\n\n`;
  relatives.forEach((r, i) => {
    text += `👤 Qarindosh ${i + 1}:\n- Ism Familiya: ${r.full_name}\n`;
  });
  text += "❓ Ushbu ma’lumotlarni tasdiqlaysizmi?";

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Tasdiqlash", "confirm")],
      [Markup.button.callback("❌ Bekor qilish ariza", "cancel")],
    ])
  );
  return ctx.wizard.selectStep(9);
}

// helper: save booking to DB
async function saveBooking(ctx) {
  const { prisoner_name, relatives, visit_type, colony } = ctx.wizard.state;
  const chatId = ctx.chat.id;
  try {
    const [result] = await pool.query(
      "INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, colony, status, telegram_chat_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      [
        ctx.from.id,
        ctx.wizard.state.phone,
        visit_type,
        prisoner_name,
        JSON.stringify(relatives),
        colony,
        chatId,
      ]
    );

    const bookingId = result.insertId;

    await ctx.scene.leave();

    // Отправка в админ-группу
    await sendApplicationToAdmin(ctx, {
      relatives,
      prisoner: prisoner_name,
      id: bookingId,
      visit_type,
      colony,
    });

    // Получаем позицию в очереди
    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE status = 'pending' ORDER BY id ASC"
    );
    const myIndex = rows.findIndex((b) => b.id === bookingId);
    if (myIndex === -1) {
      console.error("Booking ID not found in pending bookings");
      await ctx.reply("❌ Xatolik: Arizangiz topilmadi.");
      return;
    }
    const position = myIndex + 1;

    await ctx.reply(
      `✅ Uchrashuv muvaffaqiyatli bron qilindi!\n\n📊 Sizning navbatingiz: ${position}`,
      Markup.keyboard([
        ["📊 Navbat holati"],
        [`❌ Arizani bekor qilish #${bookingId}`],
      ])
        .resize()
        .oneTime(false)
    );

    await ctx.reply(
      "📱 Grupaga qo'shing",
      Markup.inlineKeyboard([
        [Markup.button.url("📌 Grupaga otish", "https://t.me/smartdunyomeet")],
      ])
    );
  } catch (err) {
    console.error("Error in saveBooking:", err);
    await ctx.reply("❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring.");
  }
}

async function sendApplicationToAdmin(ctx, application) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const firstRelative = application.relatives[0];
  const text = `📌 Yangi ariza. Nomer: ${application.id}
👤 Arizachi: ${firstRelative ? `${firstRelative.full_name}` : "Noma'lum"}
🏛 Koloniya: ${application.colony}
📅 Berilgan sana: ${new Date().toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}
⏲️ Turi: ${application.visit_type === "long" ? "2-kunlik" : "1-kunlik"}
🟡 Holat: Tekshiruvni kutish`;

  try {
    await ctx.reply(text);
    await ctx.telegram.sendMessage(adminChatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      console.warn(`⚠️ Admin chat ${adminChatId} blocked the bot, message not sent`);
    } else {
      console.error("Error sending to admin:", err);
    }
  }
}

module.exports = bookingWizard;
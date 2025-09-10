const { Scenes, Markup } = require("telegraf");
const pool = require("../db");

const MAX_RELATIVES = 3;

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Проверка и запрос телефона
  async (ctx) => {
    try {
      console.log(`Step 0: Checking bookings for user ${ctx.from?.id}`);
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
        "SELECT phone_number FROM bookings WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        [ctx.from.id]
      );

      // Инициализируем состояние
      ctx.wizard.state = {
        relatives: [],
        currentRelative: {},
        prisoner_name: null,
        visit_type: null,
        phone: null,
      };

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        await ctx.reply(`🤖 Tartibga rioya qiling!`, Markup.removeKeyboard());
        await ctx.reply(
          "📅 Iltimos, uchrashuv turini tanlang:",
          Markup.inlineKeyboard([
            [Markup.button.callback("🔵 1-kunlik", "short")],
            [Markup.button.callback("🟢 2-kunlik", "long")],
          ])
        );
        return ctx.wizard.selectStep(2); // Переходим на выбор типа визита
      }

      // Запрашиваем номер телефона
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
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 1: Принимаем только контакт
  async (ctx) => {
    try {
      console.log(`Step 1: Processing contact for user ${ctx.from?.id}`);
      if (ctx.message?.contact?.phone_number) {
        ctx.wizard.state.phone = ctx.message.contact.phone_number;
        await ctx.reply("✅ Telefon raqamingiz qabul qilindi.", Markup.removeKeyboard());
        await ctx.reply(
          "📅 Iltimos, uchrashuv turini tanlang:",
          Markup.inlineKeyboard([
            [Markup.button.callback("🔵 1-kunlik", "short")],
            [Markup.button.callback("🟢 2-kunlik", "long")],
          ])
        );
        return ctx.wizard.next();
      } else {
        await ctx.reply("❌ Telefon raqamingizni faqat tugma orqali yuboring.");
        return ctx.wizard.selectStep(1);
      }
    } catch (err) {
      console.error("Error in Step 1:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 2: Выбор типа визита
  async (ctx) => {
    try {
      console.log(`Step 2: Processing visit type for user ${ctx.from?.id}`);
      if (ctx.callbackQuery?.data === "long" || ctx.callbackQuery?.data === "short") {
        await ctx.answerCbQuery();
        ctx.wizard.state.visit_type = ctx.callbackQuery.data;
        await ctx.reply(
          "👤 Iltimos, to‘liq ismingiz va familiyangizni kiriting:"
        );
        return ctx.wizard.next();
      } else {
        await ctx.reply("❌ Iltimos, uchrashuv turini tanlang.");
        return ctx.wizard.selectStep(2);
      }
    } catch (err) {
      console.error("Error in Step 2:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 3: Имя и фамилия
  async (ctx) => {
    try {
      console.log(`Step 3: Processing name for user ${ctx.from?.id}, input: ${ctx.message?.text}`);
      if (ctx.message?.text === "❌ Bekor qilish ariza") {
        await ctx.reply(
          "❌ Uchrashuv yozuvi bekor qilindi.",
          Markup.inlineKeyboard([
            [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
          ])
        );
        return ctx.scene.leave();
      }

      if (!ctx.message?.text) {
        await ctx.reply("❌ Iltimos, ism va familiyani matn shaklida yuboring.");
        return ctx.wizard.selectStep(3);
      }

      // Проверка корректности имени (минимум 3 символа, только буквы и пробелы)
      const name = ctx.message.text.trim();
      if (!name.match(/^[A-Za-zА-Яа-я\s]{3,}$/)) {
        await ctx.reply(
          "❌ Iltimos, to‘g‘ri ism va familiya kiriting (faqat harflar va probellar, kamida 3 ta belgi)."
        );
        return ctx.wizard.selectStep(3);
      }

      ctx.wizard.state.currentRelative.full_name = name.toUpperCase();
      // Устанавливаем фиксированный паспорт
      ctx.wizard.state.currentRelative.passport = "AC1234567";
      ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

      await ctx.reply(
        "👥 Siz kim bilan uchrashmoqchisiz? Mahbusning to‘liq ismini kiriting:"
      );
      return ctx.wizard.selectStep(4); // Переходим к вводу имени заключенного
    } catch (err) {
      console.error("Error in Step 3:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 4: Имя заключенного
  async (ctx) => {
    try {
      console.log(`Step 4: Processing prisoner name for user ${ctx.from?.id}, input: ${ctx.message?.text}`);
      if (!ctx.message?.text) {
        await ctx.reply("❌ Iltimos, mahbusning ismini matn shaklida yuboring.");
        return ctx.wizard.selectStep(4);
      }

      // Проверка корректности имени заключенного
      const prisonerName = ctx.message.text.trim();
      if (!prisonerName.match(/^[A-Za-zА-Яа-я\s]{3,}$/)) {
        await ctx.reply(
          "❌ Iltimos, mahbusning to‘g‘ri ismini kiriting (faqat harflar va probellar, kamida 3 ta belgi)."
        );
        return ctx.wizard.selectStep(4);
      }

      ctx.wizard.state.prisoner_name = prisonerName.toUpperCase();
      return askAddMore(ctx);
    } catch (err) {
      console.error("Error in Step 4:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 5: Добавить родственника или завершить
  async (ctx) => {
    try {
      console.log(`Step 5: Processing add more for user ${ctx.from?.id}`);
      if (ctx.callbackQuery) await ctx.answerCbQuery();

      if (ctx.callbackQuery?.data === "add_more") {
        if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
          ctx.wizard.state.currentRelative = {};
          await ctx.reply(
            "👤 Yangi qarindoshning ismi va familiyasini kiriting:"
          );
          return ctx.wizard.selectStep(3);
        } else {
          await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
          return showSummary(ctx);
        }
      } else if (ctx.callbackQuery?.data === "done") {
        return showSummary(ctx);
      } else {
        await ctx.reply("❌ Iltimos, tugmalardan birini tanlang.");
        return ctx.wizard.selectStep(5);
      }
    } catch (err) {
      console.error("Error in Step 5:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 6: Подтверждение или отмена
  async (ctx) => {
    try {
      console.log(`Step 6: Processing confirmation for user ${ctx.from?.id}`);
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
        await ctx.reply("❌ Iltimos, tugmalardan birini tanlang.");
        return ctx.wizard.selectStep(6);
      }
    } catch (err) {
      console.error("Error in Step 6:", err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
  }
);

// Обработка команды /cancel внутри сцены
bookingWizard.command("cancel", async (ctx) => {
  try {
    console.log(`Cancel command in booking-wizard for user ${ctx.from?.id}`);
    await ctx.scene.leave();
    ctx.session = {};
    ctx.wizard.state = {};
    await ctx.reply(
      "❌ Jarayon bekor qilindi.",
      Markup.inlineKeyboard([
        [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
      ])
    );
  } catch (err) {
    console.error("Error in cancel command:", err);
    await ctx.reply(
      "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
    );
  }
});

// Middleware для обработки ошибок и некорректного ввода
bookingWizard.use(async (ctx, next) => {
  try {
    console.log(`Booking wizard middleware for user ${ctx.from?.id}, step: ${ctx.wizard.cursor}, state:`, ctx.wizard.state);
    // Проверяем, что состояние инициализировано
    if (!ctx.wizard.state) {
      ctx.wizard.state = {
        relatives: [],
        currentRelative: {},
        prisoner_name: null,
        visit_type: null,
        phone: null,
      };
      await ctx.reply(
        "❌ Jarayon xato ketdi. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }
    await next();
  } catch (err) {
    console.error("Error in booking-wizard middleware:", err);
    await ctx.reply(
      "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
    );
    return ctx.scene.leave();
  }
});

// Helper: Добавить родственника или завершить
async function askAddMore(ctx) {
  try {
    if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
      await ctx.reply(
        "➕ Yana qarindosh qo‘shishni xohlaysizmi? (maksimal 3 ta)",
        Markup.inlineKeyboard([
          [Markup.button.callback("Ha, qo‘shaman", "add_more")],
          [Markup.button.callback("Yo‘q", "done")],
        ])
      );
      return ctx.wizard.selectStep(5);
    } else {
      await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
      return showSummary(ctx);
    }
  } catch (err) {
    console.error("Error in askAddMore:", err);
    await ctx.reply(
      "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
    );
    return ctx.scene.leave();
  }
}

// Helper: Показать сводку
async function showSummary(ctx) {
  try {
    const { prisoner_name, relatives, visit_type } = ctx.wizard.state;
    if (!prisoner_name || !relatives.length || !visit_type) {
      await ctx.reply(
        "❌ Ma'lumotlar to'liq emas. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }

    let text = "📋 Arizangiz tafsilotlari:\n\n";
    text += `👥 Mahbus: ${prisoner_name}\n`;
    text += `⏲️ Uchrashuv turi: ${visit_type === "long" ? "2-kunlik" : "1-kunlik"}\n\n`;
    relatives.forEach((r, i) => {
      text += `👤 Qarindosh ${i + 1}:\n- Ism Familiya: ${r.full_name}\n- Pasport: ${r.passport}\n\n`;
    });
    text += "❓ Ushbu ma’lumotlarni tasdiqlaysizmi?";

    await ctx.reply(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Tasdiqlash", "confirm")],
        [Markup.button.callback("❌ Bekor qilish ariza", "cancel")],
      ])
    );
    return ctx.wizard.selectStep(6);
  } catch (err) {
    console.error("Error in showSummary:", err);
    await ctx.reply(
      "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
    );
    return ctx.scene.leave();
  }
}

// Helper: Сохранение брони
async function saveBooking(ctx) {
  try {
    const { prisoner_name, relatives, visit_type, phone } = ctx.wizard.state;
    const chatId = ctx.chat.id;

    if (!prisoner_name || !relatives.length || !visit_type || !phone) {
      await ctx.reply(
        "❌ Ma'lumotlar to'liq emas. Iltimos, /start buyrug‘ini qayta yuboring."
      );
      return ctx.scene.leave();
    }

    console.log(`Saving booking for user ${ctx.from?.id}:`, ctx.wizard.state);

    const [result] = await pool.query(
      "INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, status, telegram_chat_id) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [
        ctx.from.id,
        phone,
        visit_type,
        prisoner_name,
        JSON.stringify(relatives),
        chatId,
      ]
    );

    const bookingId = result.insertId;

    // Отправка в админ-группу
    await sendApplicationToAdmin(ctx, {
      relatives,
      prisoner: prisoner_name,
      id: bookingId,
      visit_type,
    });

    // Получаем позицию в очереди
    const [rows] = await pool.query(
      "SELECT id FROM bookings WHERE status = 'pending' ORDER BY id ASC"
    );
    const myIndex = rows.findIndex((b) => b.id === bookingId);
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

    await ctx.scene.leave();
    ctx.session = {};
    ctx.wizard.state = {};
  } catch (err) {
    console.error("Error in saveBooking:", err);
    await ctx.reply(
      "❌ Xatolik yuz berdi. Iltimos, /start buyrug‘ini qayta yuboring."
    );
    return ctx.scene.leave();
  }
}

// Helper: Отправка заявки админу
async function sendApplicationToAdmin(ctx, application) {
  try {
    const adminChatId = process.env.ADMIN_CHAT_ID;
    const firstRelative = application.relatives[0];
    const text = `📌 Yangi ariza. Nomer: ${application.id}
👤 Arizachi: ${firstRelative ? `${firstRelative.full_name}` : "Noma'lum"}
📅 Berilgan sana: ${new Date().toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })}
⏲️ Turi: ${application.visit_type === "long" ? "2-kunlik" : "1-kunlik"}
🟡 Holat: Tekshiruvni kutish`;

    await ctx.reply(text);
    await ctx.telegram.sendMessage(adminChatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error in sendApplicationToAdmin:", err);
  }
}

module.exports = bookingWizard;
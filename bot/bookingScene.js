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

        await ctx.reply(
          `🤖 Tartibga rioya qiling!`,
          Markup.removeKeyboard()
        );

        // сразу готовим данные
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
        return ctx.wizard.selectStep(2); // сразу переходим на Step 2
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
      console.error(err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 1: Принимаем только контакт
  async (ctx) => {
    if (ctx.message?.contact?.phone_number) {
      ctx.wizard.state.phone = ctx.message.contact.phone_number;

      // сохраняем в bookings (INSERT или UPDATE)
      await pool.query(
        "INSERT INTO bookings (user_id, phone_number) VALUES (?, ?) ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number)",
        [ctx.from.id, ctx.wizard.state.phone]
      );

      await ctx.reply(
        "✅ Telefon raqamingiz qabul qilindi.",
        Markup.removeKeyboard()
      );

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
    } else {
      await ctx.reply("❌ Telefon raqamingizni faqat tugma orqali yuboring.");
      return;
    }
  },

  // Step 2: выбор типа визита
  async (ctx) => {
    if (
      ctx.callbackQuery?.data === "long" ||
      ctx.callbackQuery?.data === "short"
    ) {
      await ctx.answerCbQuery();
      ctx.wizard.state.visit_type = ctx.callbackQuery.data;

      await ctx.reply(
        "👤 Iltimos, to‘liq ismingiz va familiyangizni kiriting:"
      );
      return ctx.wizard.next();
    } else {
      await ctx.reply("❌ Iltimos, uchrashuv turini tanlang.");
    }
  },

  // Step 3: Ism va familiya
  async (ctx) => {
    if (ctx.message?.text === "❌ Bekor qilish ariza") {
      await ctx.reply(
        "❌ Uchrashuv yozuvi bekor qilindi.",
        Markup.keyboard([["📅 Uchrashuvga yozilish"]]).resize()
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, ism va familiyani matn shaklida yuboring.");
      return ctx.wizard.selectStep(3);
    }

    ctx.wizard.state.currentRelative.full_name = ctx.message.text.toUpperCase();

    await ctx.reply(
      "🛂 Endi pasport seriyasi va raqamini kiriting (masalan: AB1234567):"
    );
    return ctx.wizard.next();
  },

  // Step 4: Passport va mahbus ismi
  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, pasport raqamini matn shaklida yuboring.");
      return ctx.wizard.selectStep(3);
    }

    ctx.wizard.state.currentRelative.passport = ctx.message.text.toUpperCase();
    ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

    if (!ctx.wizard.state.prisoner_name) {
      await ctx.reply(
        "👥 Siz kim bilan uchrashmoqchisiz? Mahbusning to‘liq ismini kiriting:"
      );
      return ctx.wizard.next(); // Step 5
    } else {
      // agar mahbus ismi allaqachon bo'lsa → to'g'ridan-to'g'ri qo'shimcha savol
      return askAddMore(ctx);
    }
  },

  // Step 5: Mahbus ismi (faqat birinchi marta)
  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, mahbusning ismini matn shaklida yuboring.");
      return ctx.wizard.selectStep(5);
    }

    ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();
    return askAddMore(ctx);
  },

  // Step 6: Qo‘shimcha qarindosh yoki yakunlash
  async (ctx) => {
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
    }
  },

  // Step 7: Yakuniy tasdiqlash yoki bekor qilish
  async (ctx) => {
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
    return ctx.wizard.selectStep(6);
  } else {
    await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
    return showSummary(ctx);
  }
}

// helper: ko‘rsatish summary
async function showSummary(ctx) {
  const { prisoner_name, relatives } = ctx.wizard.state;
  let text = "📋 Arizangiz tafsilotlari:\n\n";
  text += `👥 Mahbus: ${prisoner_name}\n\n`;
  relatives.forEach((r, i) => {
    text += `👤 Qarindosh ${i + 1}:\n- Ism Familiya: ${
      r.full_name
    }\n- Pasport: ${r.passport}\n\n`;
  });
  text += "❓ Ushbu ma’lumotlarni tasdiqlaysizmi?";

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Tasdiqlash", "confirm")],
      [Markup.button.callback("❌ Bekor qilish ariza", "cancel")],
    ])
  );
  return ctx.wizard.selectStep(7);
}

// helper: save booking to DB
async function saveBooking(ctx) {
  const { prisoner_name, relatives, visit_type } = ctx.wizard.state;
  const chatId = ctx.chat.id;
  try {
    const [result] = await pool.query(
      "INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, status, telegram_chat_id) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [
        ctx.from.id,
        ctx.wizard.state.phone,
        visit_type,
        prisoner_name,
        JSON.stringify(relatives),
        chatId
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
    });

    // Получаем позицию в очереди
    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE status = 'pending' ORDER BY id ASC"
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
        [Markup.button.url("📌 Grupaga otish", "https://t.me/+qWg7Qh3t_OIxMDBi")],
      ])
    );

  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring.");
  }
}

async function sendApplicationToAdmin(ctx, application) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const firstRelative = application.relatives[0];
  const text = `📌 Yangi ariza. Nomer: ${application.id}
👤 Arizachi: ${firstRelative ? `${firstRelative.full_name}` : "Noma'lum"}
📅 Berilgan sana: ${new Date().toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" })}
⏲️ Turi: ${application.visit_type === "long" ? "2-kunlik" : "1-kunlik"}
🟡 Holat: Tekshiruvni kutish`;

  await ctx.reply(text);
  await ctx.telegram.sendMessage(adminChatId, text, { parse_mode: "Markdown" });
}

module.exports = bookingWizard;

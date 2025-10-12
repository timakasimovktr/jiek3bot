const { Telegraf, Scenes, session, Markup } = require("telegraf");
const pool = require("../db");

const MAX_RELATIVES = 3;

const colonies = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "10",
  "11",
  "12",
  "13",
  "14",
  "17",
  "20",
  "21",
  "22",
  "23",
  "24",
];

const paidColonies = ["24"]; // Настройте список платных колоний

const texts = {
  ru: {
    internal_error: "❌ Внутренняя ошибка бота. Пожалуйста, попробуйте снова.",
    existing_pending:
      "⚠️ У вас есть незавершенная заявка. Чтобы создать новую, завершите или отмените текущую.",
    phone_saved: "✅ Ваш номер телефона сохранен. Примите оферту.",
    offer_prompt:
      "📜 Пожалуйста, прочитайте ПУБЛИЧНУЮ ОФЕРТУ и нажмите 'Принимаю' для принятия:",
    read_offer: "📖 Прочитать ПУБЛИЧНУЮ ОФЕРТУ",
    accept_offer: "✅ Принимаю",
    request_phone: "📲 Пожалуйста, отправьте свой номер телефона через кнопку:",
    contact_button: "🟢➡️ 📞 Отправить номер ⬅️🟢",
    phone_accepted: "✅ Номер телефона принят.",
    retry_phone:
      "📱 Отправьте номер телефона только через кнопку. Не пишите номер текстом:",
    retry_contact_button: "📞 Отправить номер",
    too_many_retries:
      "❌ Вы слишком много раз отправили неверные данные. Пожалуйста, начните заново с /start.",
    select_colony: "🏛 Пожалуйста, выберите КОЛОНИЮ:",
    colony_button: (c) => `🏛 ${c}-я колония ${c === "23" ? "МУИК" : "ЖИЭК"}`,
    select_visit_type: "⏲️ Пожалуйста, выберите тип ВСТРЕЧИ:",
    short_visit: "🔵 1-дневная",
    long_visit: "🟢 2-дневная",
    enter_full_name:
      "👤 Пожалуйста, введите ваше полное имя: (ФАМИЛИЯ ИМЯ ОТЧЕСТВО)",
    cancel_text: "❌ Отменить заявку",
    invalid_name: "❌ Пожалуйста, введите имя и фамилию в текстовом формате.",
    enter_prisoner_name:
      "👥 С кем вы хотите встретиться? Введите полное имя заключенного: (ФАМИЛИЯ ИМЯ ОТЧЕСТВО)",
    invalid_prisoner:
      "❌ Пожалуйста, введите имя заключенного в текстовом формате.",
    add_more_prompt: "➕ Хотите добавить еще родственника? (максимум 3)",
    yes_add: "Да, добавить",
    no_done: "Нет",
    max_reached: "⚠️ Максимум 3 родственника добавлено.",
    new_relative: "👤 Введите имя и фамилию нового родственника:",
    summary_title: "📋 Детали вашей заявки:",
    summary_colony: (colony) =>
      `🏛 Колония: ${colony}-я ${colony === "23" ? "МУИК" : "ЖИЭК"}`,
    summary_prisoner: (name) => `👤 Заключенный: ${name}`,
    summary_relative: (i, name) => `👥 Родственник ${i + 1}: ${name}`,
    confirm_prompt: "❓ Подтверждаете эти данные?",
    confirm_button: "✅ Подтвердить",
    cancel_button: "❌ Отменить заявку",
    booking_canceled: "❌ Запись на встречу отменена.",
    booking_saved: (position) =>
      `✅ Заявка на встречу отправлена!\n📊 Ваша очередь: ${position}`,
    queue_status: "📊 Статус очереди",
    cancel_application: (id) => `❌ Отменить заявку #${id}`,
    join_group: "🫂 Присоединитесь к группе",
    group_button: "📌 Перейти в группу",
    admin_new: (id) => `📌 Новая заявка. №: ${id}`,
    admin_applicant: (name) => `👥 Заявитель: ${name}`,
    admin_colony: (colony) =>
      `🏛 Колония: ${colony}-я ${colony === "23" ? "МУИК" : "ЖИЭК"}`,
    admin_date: (date) => `📅 Дата подачи: ${date}`,
    admin_type: (isLong) => `⏲️ Тип: ${isLong ? "2-дневная" : "1-дневная"}`,
    admin_status: "🟡 Статус: Ожидает проверки",
    error: "❌ Произошла ошибка. Пожалуйста, попробуйте позже.",
    not_found: "❌ Ошибка: Ваша заявка не найдена.",
    book_meeting: "📅 Записаться на встречу",
    no_attempts_left: "❌ У вас закончились бесплатные попытки. Необходимо оплатить подачу заявки.",
    payment_success: "✅ Оплата прошла успешно! Продолжайте заполнение.",
    please_pay: "Пожалуйста, завершите оплату, нажав кнопку Pay в счете.",
  },
  uz: {
    // ... (аналогично, добавьте please_pay: "Илтимос, тўловни ҳисоб-фактурадаги Pay тугмасини босиб якунланг.")
  },
  uzl: {
    // ... (аналогично)
  },
};

function generateColonyKeyboard(lang) {
  const keyboard = [];
  for (let i = 0; i < colonies.length; i += 3) {
    const row = colonies
      .slice(i, i + 3)
      .map((c) =>
        Markup.button.callback(texts[lang].colony_button(c), `colony_${c}`)
      );
    keyboard.push(row);
  }
  return Markup.inlineKeyboard(keyboard);
}

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Phone check and request (без изменений)
  async (ctx) => {
    // ... (как в предыдущем коде)
  },

  // Step 1: Accept only contact (без изменений)
  async (ctx) => {
    // ... (как в предыдущем коде)
  },

  // Step 2: Accept public offer (без изменений)
  async (ctx) => {
    // ... (как в предыдущем коде)
  },

  // Step 3: Select colony (обновлено: отправка инвойса здесь, если нужно)
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 3: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    const data = ctx.callbackQuery?.data;

    if (
      !ctx.callbackQuery?.data ||
      !ctx.callbackQuery.data.startsWith("colony_")
    ) {
      await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");

    ctx.wizard.state.relatives = [];
    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.prisoner_name = null;
    ctx.wizard.state.visit_type = null;
    ctx.wizard.state.paymentDone = false;

    // Проверка после colony
    const colony = ctx.wizard.state.colony;
    const phone = ctx.wizard.state.phone;
    let attempts = 0;
    const [attRows] = await pool.query(
      "SELECT attempts FROM users_attempts WHERE phone_number = ?",
      [phone]
    );
    if (attRows.length === 0) {
      await pool.query(
        "INSERT INTO users_attempts (phone_number, attempts) VALUES (?, 2)",
        [phone]
      );
      attempts = 2;
    } else {
      attempts = attRows[0].attempts;
    }

    const needsPayment = paidColonies.includes(colony) || attempts <= 0;

    if (!needsPayment) {
      // Бесплатно
      await ctx.reply(
        texts[lang].select_visit_type,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(texts[lang].short_visit, "short"),
            Markup.button.callback(texts[lang].long_visit, "long"),
          ],
        ])
      );
      return ctx.wizard.selectStep(5);
    } else {
      // Платно: отправляем сообщение и инвойс сразу
      await ctx.reply(texts[lang].no_attempts_left);
      try {
        await ctx.telegram.sendInvoice({
          chat_id: ctx.chat.id,
          title: "Оплата за подачу заявки",
          description: `Оплата за подачу заявки в колонию ${colony}`,
          payload: `booking_${ctx.from.id}_${colony}`,
          provider_token: process.env.PAYMENT_TOKEN,
          currency: "UZS",
          prices: [{ label: "Услуга", amount: 10000 }], // Настройте сумму
        });
      } catch (err) {
        console.error("Error sending invoice:", err);
        await ctx.reply(texts[lang].error);
        return ctx.scene.leave();
      }
      return ctx.wizard.next(); // К шагу 4: ожидание оплаты
    }
  },

  // Step 4: Payment waiting (обновлено: только обработка, без отправки инвойса)
  async (ctx) => {
    const lang = ctx.session.language;
    try {
      if (ctx.message?.successful_payment) {
        ctx.wizard.state.paymentDone = true;
        await ctx.reply(texts[lang].payment_success);
        await ctx.reply(
          texts[lang].select_visit_type,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(texts[lang].short_visit, "short"),
              Markup.button.callback(texts[lang].long_visit, "long"),
            ],
          ])
        );
        return ctx.wizard.next(); // К шагу 5
      } else {
        // Если пользователь отправил что-то другое (текст и т.д.)
        await ctx.reply(texts[lang].please_pay);
        return; // Остаемся в шаге 4
      }
    } catch (err) {
      console.error("Error in payment waiting step:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 5: Select visit type (без изменений)
  async (ctx) => {
    // ... (как ранее)
  },

  // Step 6: Full name (без изменений)
  async (ctx) => {
    // ... (как ранее)
  },

  // Step 7: Placeholder (без изменений)
  async (ctx) => {
    return ctx.wizard.next();
  },

  // Step 8: Prisoner name (без изменений)
  async (ctx) => {
    // ... (как ранее)
  },

  // Step 9: Add more or done (без изменений)
  async (ctx) => {
    // ... (как ранее)
  },

  // Step 10: Final confirm or cancel (без изменений)
  async (ctx) => {
    // ... (как ранее)
  }
);

// Функции askAddMore, showSummary (без изменений)

// saveBooking (обновлено: уменьшение attempts если free)
async function saveBooking(ctx) {
  const lang = ctx.session.language;
  const { prisoner_name, relatives, visit_type, colony } = ctx.wizard.state;
  const chatId = ctx.chat.id;
  const paymentStatus = ctx.wizard.state.paymentDone ? 'paid' : 'free';
  const phone = ctx.wizard.state.phone;
  try {
    const [maxNumberRows] = await pool.query(
      `SELECT MAX(colony_application_number) as max_number
       FROM bookings
       WHERE colony = ?`,
      [colony]
    );
    const maxNumber = maxNumberRows[0].max_number || 0;
    const newColonyApplicationNumber = maxNumber + 1;

    const [result] = await pool.query(
      `INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, colony, status, telegram_chat_id, colony_application_number, language, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        ctx.from.id,
        phone,
        visit_type,
        prisoner_name,
        JSON.stringify(relatives),
        colony,
        chatId,
        newColonyApplicationNumber,
        lang,
        paymentStatus,
      ]
    );

    const bookingId = result.insertId;

    if (paymentStatus === 'free') {
      let attempts = 0;
      const [attRows] = await pool.query(
        "SELECT attempts FROM users_attempts WHERE phone_number = ?",
        [phone]
      );
      if (attRows.length) {
        attempts = attRows[0].attempts - 1;
        attempts = Math.max(0, attempts);
      }
      await pool.query(
        "INSERT INTO users_attempts (phone_number, attempts) VALUES (?, ?) ON DUPLICATE KEY UPDATE attempts = ?",
        [phone, attempts, attempts]
      );
    }

    await ctx.scene.leave();

    // ... (остальное как ранее: sendApplicationToClient, позиция, меню, группа)
  } catch (err) {
    console.error("Error in saveBooking:", err);
    await ctx.reply(texts[lang].error);
  }
}

// sendApplicationToClient (без изменений)

module.exports = bookingWizard;
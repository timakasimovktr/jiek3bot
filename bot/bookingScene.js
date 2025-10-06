//bookingScene.js

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

const texts = {
  ru: {
    internal_error: "❌ Внутренняя ошибка бота. Пожалуйста, попробуйте снова.",
    existing_pending: "⚠️ У вас есть незавершенная заявка. Чтобы создать новую, завершите или отмените текущую.",
    phone_saved: "✅ Ваш номер телефона сохранен. Примите оферту.",
    offer_prompt: "📜 Пожалуйста, прочитайте ПУБЛИЧНУЮ ОФЕРТУ и нажмите 'Принимаю' для принятия:",
    read_offer: "📖 Прочитать ПУБЛИЧНУЮ ОФЕРТУ",
    accept_offer: "✅ Принимаю",
    request_phone: "📲 Пожалуйста, отправьте свой номер телефона через кнопку:",
    contact_button: "🟢➡️ 📞 Отправить номер ⬅️🟢",
    phone_accepted: "✅ Номер телефона принят.",
    retry_phone: "📱 Отправьте номер телефона только через кнопку. Не пишите номер текстом:",
    retry_contact_button: "📞 Отправить номер",
    too_many_retries: "❌ Вы слишком много раз отправили неверные данные. Пожалуйста, начните заново с /start.",
    select_colony: "🏛 Пожалуйста, выберите КОЛОНИЮ:",
    colony_button: (c) => `🏛 ${c}-я колония ${c === "23" ? "МУИК" : "ЖИЭК"}`,
    select_visit_type: "⏲️ Пожалуйста, выберите тип ВСТРЕЧИ:",
    short_visit: "🔵 1-дневная",
    long_visit: "🟢 2-дневная",
    enter_full_name: "👤 Пожалуйста, введите полное имя: (ФАМИЛИЯ ИМЯ ОТЧЕСТВО)",
    cancel_text: "❌ Отменить заявку",
    invalid_name: "❌ Пожалуйста, введите имя и фамилию в текстовом формате.",
    enter_prisoner_name: "👥 С кем вы хотите встретиться? Введите полное имя заключенного: (ФАМИЛИЯ ИМЯ ОТЧЕСТВО)",
    invalid_prisoner: "❌ Пожалуйста, введите имя заключенного в текстовом формате.",
    add_more_prompt: "➕ Хотите добавить еще родственника? (максимум 3)",
    yes_add: "Да, добавить",
    no_done: "Нет",
    max_reached: "⚠️ Максимум 3 родственника добавлено.",
    new_relative: "👤 Введите имя и фамилию нового родственника:",
    summary_title: "📋 Детали вашей заявки:",
    summary_colony: (colony) => `🏛 Колония: ${colony}-я ${colony === "23" ? "МУИК" : "ЖИЭК"}`,
    summary_prisoner: (name) => `👤 Заключенный: ${name}`,
    summary_relative: (i, name) => `👥 Родственник ${i + 1}: ${name}`,
    confirm_prompt: "❓ Подтверждаете эти данные?",
    confirm_button: "✅ Подтвердить",
    cancel_button: "❌ Отменить заявку",
    booking_canceled: "❌ Запись на встречу отменена.",
    booking_saved: (position) => `✅ Заявка на встречу отправлена!\n📊 Ваша очередь: ${position}`,
    queue_status: "📊 Статус очереди",
    cancel_application: (id) => `❌ Отменить заявку #${id}`,
    join_group: "🫂 Присоединитесь к группе",
    group_button: "📌 Перейти в группу",
    admin_new: (id) => `📌 Новая заявка. №: ${id}`,
    admin_applicant: (name) => `👥 Заявитель: ${name}`,
    admin_colony: (colony) => `🏛 Колония: ${colony}-я ${colony === "23" ? "МУИК" : "ЖИЭК"}`,
    admin_date: (date) => `📅 Дата подачи: ${date}`,
    admin_type: (isLong) => `⏲️ Тип: ${isLong ? "2-дневная" : "1-дневная"}`,
    admin_status: "🟡 Статус: Ожидает проверки",
    error: "❌ Произошла ошибка. Пожалуйста, попробуйте позже.",
    not_found: "❌ Ошибка: Ваша заявка не найдена.",
    book_meeting: "📅 Записаться на встречу",
  },
  uz: { // Uzbek Cyrillic
    internal_error: "❌ Ботнинг ички хатоси. Илтимос, қайта уриниб кўринг.",
    existing_pending: "⚠️ Сизда ҳали тугалланмаган ариза мавжуд. Янги ариза яратиш учун уни якунланг ёки бекор қилинг.",
    phone_saved: "✅ Телефон рақамингиз сақланган. Оферта қабул қилинг.",
    offer_prompt: "📜 Илтимос, ОМАВИЙ ОФЕРТАНИ ўқинг ва қабул қилиш учун 'Қабул қиламан' тугмасини босинг:",
    read_offer: "📖 ОМАВИЙ ОФЕРТАНИ ўқиш",
    accept_offer: "✅ Қабул қиламан",
    request_phone: "📲 Илтимос, телефон рақамингизни тугма орқали юборинг:",
    contact_button: "🟢➡️ 📞 Рақамни юбориш ⬅️🟢",
    phone_accepted: "✅ Телефон рақамингиз қабул қилинди.",
    retry_phone: "📱 Телефон рақамингизни фақат тугма орқали юборинг. Рақамни матн сифатида ёзманг:",
    retry_contact_button: "📞 Рақамни юбориш",
    too_many_retries: "❌ Сиз кўп марта нотўғри маълумот юбордингиз. Илтимос, /start буйруғи билан қайтадан бошланг.",
    select_colony: "🏛 Илтимос, КОЛОНИЯНИ танланг:",
    colony_button: (c) => `🏛 ${c}-сон колония ${c === "23" ? "МУИК" : "ЖИЭК"}`,
    select_visit_type: "⏲️ Илтимос, УЧРАШУВ турини танланг:",
    short_visit: "🔵 1-кунлик",
    long_visit: "🟢 2-кунлик",
    enter_full_name: "👤 Илтимос, тўлиқ исмингизни киритинг: (ФАМИЛИЯ ИСМ ШАРИФИ)",
    cancel_text: "❌ Аризани бекор қилиш",
    invalid_name: "❌ Илтимос, исм ва фамилияни матн шаклида юборинг.",
    enter_prisoner_name: "👥 Сиз ким билан учрашмоқчисиз? Маҳбуснинг тўлиқ исмини киритинг: (ФАМИЛИЯ ИСМ ШАРИФИ)",
    invalid_prisoner: "❌ Илтимос, маҳбуснинг исмини матн шаклида юборинг.",
    add_more_prompt: "➕ Яна қариндош қўшишни хоҳлайсизми? (максимал 3 та)",
    yes_add: "Ҳа, қўшаман",
    no_done: "Йўқ",
    max_reached: "⚠️ Максимал 3 та қариндош қўшилди.",
    new_relative: "👤 Янги қариндошнинг исми ва фамилиясини киритинг:",
    summary_title: "📋 Аризангиз тафсилотлари:",
    summary_colony: (colony) => `🏛 Колониа: ${colony}-сон ${colony === "23" ? "МУИК" : "ЖИЭК"}`,
    summary_prisoner: (name) => `👤 Маҳбус: ${name}`,
    summary_relative: (i, name) => `👥 Қариндош ${i + 1}: ${name}`,
    confirm_prompt: "❓ Ушбу маълумотларни тасдиқлайсизми?",
    confirm_button: "✅ Тасдиқлаш",
    cancel_button: "❌ Аризани бекор қилиш",
    booking_canceled: "❌ Учрашув ёзуви бекор қилинди.",
    booking_saved: (position) => `✅ Учрашув аризани бериш учун юборилди!\n📊 Сизнинг навбатингиз: ${position}`,
    queue_status: "📊 Навбат ҳолати",
    cancel_application: (id) => `❌ Аризани бекор қилиш #${id}`,
    join_group: "🫂 Гуруҳга қўшинг",
    group_button: "📌 Гуруҳга ўтиш",
    admin_new: (id) => `📌 Янги ариза. №: ${id}`,
    admin_applicant: (name) => `👥 Аризачи: ${name}`,
    admin_colony: (colony) => `🏛 Колониа: ${colony}-сон ${colony === "23" ? "МУИК" : "ЖИЭК"}`,
    admin_date: (date) => `📅 Берилган сана: ${date}`,
    admin_type: (isLong) => `⏲️ Тури: ${isLong ? "2-кунлик" : "1-кунлик"}`,
    admin_status: "🟡 Ҳолат: Текширувни кутиш",
    error: "❌ Хатолик юз берди. Илтимос, кейинроқ уриниб кўринг.",
    not_found: "❌ Хатолик: Аризангиз топилмади.",
    book_meeting: "📅 Учрашувга ёзилиш",
  },
  uzl: { // Uzbek Latin (original)
    internal_error: "❌ Botning ichki xatosi. Iltimos, qayta urinib ko‘ring.",
    existing_pending: "⚠️ Sizda hali tugallanmagan ariza mavjud. Yangi ariza yaratish uchun uni yakunlang yoki bekor qiling.",
    phone_saved: "✅ Telefon raqamingiz saqlangan. Ofertani qabul qiling.",
    offer_prompt: "📜 Iltimos, OMAVIY OFERTANI o‘qing va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:",
    read_offer: "📖 OMAVIY OFERTANI o‘qish",
    accept_offer: "✅ Qabul qilaman",
    request_phone: "📲 Iltimos, telefon raqamingizni tugma orqali yuboring:",
    contact_button: "🟢➡️ 📞 Raqamni yuborish ⬅️🟢",
    phone_accepted: "✅ Telefon raqamingiz qabul qilindi.",
    retry_phone: "📱 Telefon raqamingizni faqat tugma orqali yuboring. Raqamni matn sifatida yozmang:",
    retry_contact_button: "📞 Raqamni yuborish",
    too_many_retries: "❌ Siz ko‘p marta noto‘g‘ri ma’lumot yubordingiz. Iltimos, /start buyrug‘i bilan qaytadan boshlang.",
    select_colony: "🏛 Iltimos, KOLONIYANI tanlang:",
    colony_button: (c) => `🏛 ${c}-son ${c === "23" ? "MUIK" : "JIEK"}`,
    select_visit_type: "⏲️ Iltimos, UCHRASHUV turini tanlang:",
    short_visit: "🔵 1-kunlik",
    long_visit: "🟢 2-kunlik",
    enter_full_name: "👤 Iltimos, to‘liq ismingizni kiriting: (FAMILIYA ISM SHARIFI)",
    cancel_text: "❌ Bekor qilish ariza",
    invalid_name: "❌ Iltimos, ism va familiyani matn shaklida yuboring.",
    enter_prisoner_name: "👥 Siz kim bilan uchrashmoqchisiz? Mahbusning to‘liq ismini kiriting: (FAMILIYA ISM SHARIFI)",
    invalid_prisoner: "❌ Iltimos, mahbusning ismini matn shaklida yuboring.",
    add_more_prompt: "➕ Yana qarindosh qo‘shishni xohlaysizmi? (maksimal 3 ta)",
    yes_add: "Ha, qo‘shaman",
    no_done: "Yo‘q",
    max_reached: "⚠️ Maksimal 3 ta qarindosh qo‘shildi.",
    new_relative: "👤 Yangi qarindoshning ismi va familiyasini kiriting:",
    summary_title: "📋 Arizangiz tafsilotlari:",
    summary_colony: (colony) => `🏛 Koloniya: ${colony}-son ${colony === "23" ? "MUIK" : "JIEK"}`,
    summary_prisoner: (name) => `👤 Mahbus: ${name}`,
    summary_relative: (i, name) => `👥 Qarindosh ${i + 1}: ${name}`,
    confirm_prompt: "❓ Ushbu ma’lumotlarni tasdiqlaysizmi?",
    confirm_button: "✅ Tasdiqlash",
    cancel_button: "❌ Bekor qilish ariza",
    booking_canceled: "❌ Uchrashuv yozuvi bekor qilindi.",
    booking_saved: (position) => `✅ Uchrashuv arizani berish uchun yuborildi!\n📊 Sizning navbatingiz: ${position}`,
    queue_status: "📊 Navbat holati",
    cancel_application: (id) => `❌ Arizani bekor qilish #${id}`,
    join_group: "🫂 Grupaga qo'shing",
    group_button: "📌 Grupaga otish",
    admin_new: (id) => `📌 Yangi ariza. №: ${id}`,
    admin_applicant: (name) => `👥 Arizachi: ${name}`,
    admin_colony: (colony) => `🏛 Koloniya: ${colony}-son ${colony === "23" ? "MUIK" : "JIEK"}`,
    admin_date: (date) => `📅 Berilgan sana: ${date}`,
    admin_type: (isLong) => `⏲️ Turi: ${isLong ? "2-kunlik" : "1-kunlik"}`,
    admin_status: "🟡 Holat: Tekshiruvni kutish",
    error: "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring.",
    not_found: "❌ Xatolik: Arizangiz topilmadi.",
    book_meeting: "📅 Uchrashuvga yozilish",
  }
};

function generateColonyKeyboard(lang) {
  const keyboard = [];
  for (let i = 0; i < colonies.length; i += 3) {
    const row = colonies
      .slice(i, i + 3)
      .map((c) =>
        Markup.button.callback(
          texts[lang].colony_button(c),
          `colony_${c}`
        )
      );
    keyboard.push(row);
  }
  return Markup.inlineKeyboard(keyboard);
}

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Phone check and request
  async (ctx) => {
    const lang = ctx.session.language;
    try {
      console.log(`Step 0: Starting for user ${ctx.from.id}`);

      if (!ctx.wizard) {
        console.error(`ctx.wizard is undefined for user ${ctx.from.id}`);
        await ctx.reply(texts[lang].internal_error);
        return ctx.scene.leave();
      }

      ctx.wizard.state = {};

      const [rows] = await pool.query(
        `SELECT id, status, created_at
       FROM bookings
       WHERE user_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
        [ctx.from.id]
      );
      console.log(`Step 0: Pending bookings for user ${ctx.from.id}:`, rows);

      if (rows.length > 0) {
        await ctx.reply(
          texts[lang].existing_pending,
          Markup.keyboard([
            [texts[lang].queue_status],
            [texts[lang].cancel_text],
          ]).resize()
        );
        return ctx.scene.leave();
      }

      const [userRows] = await pool.query(
        `SELECT phone_number
       FROM bookings
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
        [ctx.from.id]
      );
      console.log(
        `Step 0: Phone query result for user ${ctx.from.id}:`,
        userRows
      );

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        ctx.wizard.state.offerRequested = true;
        await ctx.reply(
          texts[lang].phone_saved,
          Markup.removeKeyboard()
        );
        await ctx.reply(
          texts[lang].offer_prompt,
          Markup.inlineKeyboard([
            [
              Markup.button.url(
                texts[lang].read_offer,
                "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
              ),
            ],
            [Markup.button.callback(texts[lang].accept_offer, "accept_offer")],
          ])
        );
        console.log(
          `Step 0: Moving to Step 2 for user ${ctx.from.id} with phone ${ctx.wizard.state.phone}`
        );
        return ctx.wizard.selectStep(2);
      }

      ctx.wizard.state.offerRequested = false;
      await ctx.reply(
        texts[lang].request_phone,
        Markup.keyboard([
          [Markup.button.contactRequest(texts[lang].contact_button)],
        ])
          .resize()
          .oneTime()
      );
      console.log(`Step 0: Requesting phone number for user ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      console.error(`Error in Step 0 for user ${ctx.from.id}:`, err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 1: Accept only contact
  async (ctx) => {
    const lang = ctx.session.language;
    try {
      console.log(
        `Step 1: Starting for user ${ctx.from.id}, message:`,
        ctx.message,
        `wizard state:`,
        ctx.wizard.state
      );

      if (!ctx.message?.contact?.phone_number) {
        ctx.wizard.state.retryCount = (ctx.wizard.state.retryCount || 0) + 1;

        if (ctx.wizard.state.retryCount > 2) {
          await ctx.reply(
            texts[lang].too_many_retries,
            Markup.removeKeyboard()
          );
          console.log(`Step 1: Too many retries for user ${ctx.from.id}`);
          return ctx.scene.leave();
        }

        await ctx.reply(
          texts[lang].retry_phone,
          Markup.keyboard([
            [Markup.button.contactRequest(texts[lang].retry_contact_button)],
          ])
            .resize()
            .oneTime()
        );
        console.log(`Step 1: Requesting phone retry for user ${ctx.from.id}`);
        return;
      }

      ctx.wizard.state.phone = ctx.message.contact.phone_number;
      ctx.wizard.state.offerRequested = true;
      await ctx.reply(
        texts[lang].phone_accepted,
        Markup.removeKeyboard()
      );
      console.log(
        `Step 1: Phone received for user ${ctx.from.id}: ${ctx.wizard.state.phone}`
      );

      await ctx.reply(
        texts[lang].offer_prompt,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              texts[lang].read_offer,
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback(texts[lang].accept_offer, "accept_offer")],
        ])
      );
      console.log(`Step 1: Offer requested for user ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      console.error(`Error in Step 1 for user ${ctx.from.id}:`, err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 2: Accept public offer
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 2: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    if (!ctx.callbackQuery?.data || ctx.callbackQuery.data !== "accept_offer") {
      await ctx.reply(
        texts[lang].offer_prompt,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              texts[lang].read_offer,
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback(texts[lang].accept_offer, "accept_offer")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.offer_accepted = true;

    await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
    console.log(`Step 2: Moving to colony selection for user ${ctx.from.id}`);
    return ctx.wizard.next();
  },

  // Step 3: Select colony
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
      await ctx.reply(
        texts[lang].select_colony,
        generateColonyKeyboard(lang)
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");

    ctx.wizard.state.relatives = [];
    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.prisoner_name = null;
    ctx.wizard.state.visit_type = null;

    await ctx.reply(
      texts[lang].select_visit_type,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(texts[lang].short_visit, "short"),
          Markup.button.callback(texts[lang].long_visit, "long"),
        ],
      ])
    );
    return ctx.wizard.next();
  },

  // Step 4: Select visit type
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 4: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (
      !ctx.callbackQuery?.data ||
      (ctx.callbackQuery.data !== "long" && ctx.callbackQuery.data !== "short")
    ) {
      await ctx.reply(
        texts[lang].select_visit_type,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(texts[lang].short_visit, "short"),
            Markup.button.callback(texts[lang].long_visit, "long"),
          ],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.visit_type = ctx.callbackQuery.data;

    await ctx.reply(texts[lang].enter_full_name);
    return ctx.wizard.next();
  },

  // Step 5: Full name
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(`Step 5: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (ctx.message?.text === texts[lang].cancel_text) {
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              texts[lang].book_meeting,
              "start_booking"
            ),
          ],
        ])
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply(texts[lang].invalid_name);
      return ctx.wizard.selectStep(5);
    }

    ctx.wizard.state.currentRelative.full_name = ctx.message.text.toUpperCase();
    ctx.wizard.state.currentRelative.passport = "AC1234567";
    ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

    if (!ctx.wizard.state.prisoner_name) {
      await ctx.reply(texts[lang].enter_prisoner_name);
      return ctx.wizard.selectStep(7);
    } else {
      return askAddMore(ctx);
    }
  },

  // Step 6: Placeholder (not used)
  async (ctx) => {
    return ctx.wizard.next();
  },

  // Step 7: Prisoner name
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(`Step 7: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (!ctx.message?.text) {
      await ctx.reply(texts[lang].invalid_prisoner);
      return ctx.wizard.selectStep(7);
    }

    ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();
    return askAddMore(ctx);
  },

  // Step 8: Add more or done
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 8: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "add_more") {
      if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
        ctx.wizard.state.currentRelative = {};
        await ctx.reply(texts[lang].new_relative);
        return ctx.wizard.selectStep(5);
      } else {
        await ctx.reply(texts[lang].max_reached);
        return showSummary(ctx);
      }
    } else if (ctx.callbackQuery?.data === "done") {
      return showSummary(ctx);
    } else {
      await ctx.reply(
        texts[lang].add_more_prompt,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].yes_add, "add_more")],
          [Markup.button.callback(texts[lang].no_done, "done")],
        ])
      );
      return;
    }
  },

  // Step 9: Final confirm or cancel
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 9: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "confirm") {
      return saveBooking(ctx);
    } else if (ctx.callbackQuery?.data === "cancel") {
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return ctx.scene.leave();
    } else {
      await ctx.reply(
        texts[lang].confirm_prompt,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].confirm_button, "confirm")],
          [Markup.button.callback(texts[lang].cancel_button, "cancel")],
        ])
      );
      return;
    }
  }
);

async function askAddMore(ctx) {
  const lang = ctx.session.language;
  // if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
  //   await ctx.reply(
  //     texts[lang].add_more_prompt,
  //     Markup.inlineKeyboard([
  //       [Markup.button.callback(texts[lang].yes_add, "add_more")],
  //       [Markup.button.callback(texts[lang].no_done, "done")],
  //     ])
  //   );
  //   return ctx.wizard.selectStep(8);
  // } else {
  //   await ctx.reply(texts[lang].max_reached);
  //   return showSummary(ctx);
  // }
  return showSummary(ctx);
}

async function showSummary(ctx) {
  const lang = ctx.session.language;
  const { prisoner_name, relatives, colony } = ctx.wizard.state;
  let text = texts[lang].summary_title + "\n";
  text += texts[lang].summary_colony(colony) + "\n";
  text += texts[lang].summary_prisoner(prisoner_name) + "\n\n";
  relatives.forEach((r, i) => {
    text += texts[lang].summary_relative(i, r.full_name) + "\n";
  });
  text += texts[lang].confirm_prompt;

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback(texts[lang].confirm_button, "confirm")],
      [Markup.button.callback(texts[lang].cancel_button, "cancel")],
    ])
  );
  return ctx.wizard.selectStep(9);
}

async function saveBooking(ctx) {
  const lang = ctx.session.language;
  const { prisoner_name, relatives, visit_type, colony } = ctx.wizard.state;
  const chatId = ctx.chat.id;
  try {
    const [result] = await pool.query(
      `INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, colony, status, telegram_chat_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
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

    // await sendApplicationToAdmin(ctx, {
    //   relatives,
    //   prisoner: prisoner_name,
    //   id: bookingId,
    //   visit_type,
    //   colony,
    //   lang, 
    // });

    const [rows] = await pool.query(
      `SELECT * FROM bookings WHERE status = 'pending' AND colony = ? ORDER BY id ASC`,
      [colony]
    );
    const myIndex = rows.findIndex((b) => b.id === bookingId);
    if (myIndex === -1) {
      console.error("Booking ID not found in pending bookings");
      await ctx.reply(texts[lang].not_found);
      return;
    }
    const position = myIndex + 1;

    await ctx.reply(
      texts[lang].booking_saved(position),
      Markup.keyboard([
        [texts[lang].queue_status],
        [texts[lang].cancel_application(bookingId)],
      ])
        .resize()
        .oneTime(false)
    );

    let groupUrl = "https://t.me/smartdunyomeet";

    switch (colony) {
      case "1":
        groupUrl = "https://t.me/SmartJIEK1";
        break;
      case "2":
        groupUrl = "https://t.me/SmartJIEK2";
        break;
      case "3":
        groupUrl = "https://t.me/SmartJIEK3";
        break;
      case "4":
        groupUrl = "https://t.me/SmartJIEK4";
        break;
      case "5":
        groupUrl = "https://t.me/SmartJIEK5";
        break;
      case "6":
        groupUrl = "https://t.me/SmartJIEK6";
        break;
      case "7":
        groupUrl = "https://t.me/SmartJIEK7";
        break;
      case "8":
        groupUrl = "https://t.me/SmartJIEK8";
        break;
      case "9":
        groupUrl = "https://t.me/SmartJIEK9";
        break;
      case "10":
        groupUrl = "https://t.me/SmartJIEK10";
        break;
      case "11":
        groupUrl = "https://t.me/SmartJIEK11";
        break;
      case "12":
        groupUrl = "https://t.me/SmartJIEK12";
        break;
      case "17":
        groupUrl = "https://t.me/SmartJIEK17";
        break;
      case "20":
        groupUrl = "https://t.me/SmartJIEK20";
        break;
      case "21":
        groupUrl = "https://t.me/SmartJIEK21";
        break;
      case "22":
        groupUrl = "https://t.me/SmartJIEK22";
        break;
      case "23":
        groupUrl = "https://t.me/SmartJIEK23";
        break;
      case "24":
        groupUrl = "https://t.me/SmartJIEK24";
        break;
    }

    await ctx.reply(
      texts[lang].join_group,
      Markup.inlineKeyboard([[Markup.button.url(texts[lang].group_button, groupUrl)]])
    );
  } catch (err) {
    console.error("Error in saveBooking:", err);
    await ctx.reply(texts[lang].error);
  }
}

async function sendApplicationToAdmin(ctx, application) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const firstRelative = application.relatives[0];
  const name = firstRelative ? `${firstRelative.full_name}` : (application.lang === 'ru' ? "Неизвестно" : application.lang === 'uz' ? "Номаълум" : "Noma'lum");
  const locale = application.lang === 'ru' ? 'ru-RU' : 'uz-UZ';
  const date = new Date().toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const isLong = application.visit_type === "long";
  const text = `${texts[application.lang].admin_new(application.id)}
${texts[application.lang].admin_applicant(name)}
${texts[application.lang].admin_colony(application.colony)}
${texts[application.lang].admin_date(date)}
${texts[application.lang].admin_type(isLong)}
${texts[application.lang].admin_status}`;

  try {
    await ctx.telegram.sendMessage(adminChatId, text);
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      console.warn(
        `⚠️ Admin chat ${adminChatId} blocked the bot, message not sent`
      );
    } else {
      console.error("Error sending to admin:", err);
    }
  }
}

module.exports = bookingWizard;
const { Scenes, Markup } = require("telegraf");
const pool = require("../db");
const texts = require("./texts.js");
const { generateColonyKeyboard } = require("./helpers/keyboards.js");
const {
  askAddMore, // Если не используется, можно удалить импорт
  showSummary,
  saveBooking,
} = require("./helpers/bookingUtils.js");
// const { MAX_RELATIVES } = require("./constants/config.js");  // Не используется теперь

// Добавлен массив платных колоний — легко добавлять/убирать
const PAID_COLONIES = ["24"]; // Добавляйте/убирайте ID колоний здесь, например ['24', '25']

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
        await ctx.reply(texts[lang].phone_saved, Markup.removeKeyboard());
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
        return ctx.wizard.selectStep(2); // К оферте
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
      return ctx.wizard.next(); // К Step 1
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
      await ctx.reply(texts[lang].phone_accepted, Markup.removeKeyboard());
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
      return ctx.wizard.next(); // К Step 2
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
    return ctx.wizard.next(); // К Step 3
  },

  // Step 3: Select colony
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 3: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    if (
      !ctx.callbackQuery?.data ||
      !ctx.callbackQuery.data.startsWith("colony_")
    ) {
      await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");

    const phone = ctx.wizard.state.phone;

    // Инициализация для бронирования (только один родственник)
    ctx.wizard.state.relatives = [];
    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.prisoner_name = null;
    ctx.wizard.state.visit_type = null;

    if (PAID_COLONIES.includes(ctx.wizard.state.colony)) {
      // Create preliminary booking for payment
      let insertResult;
      try {
        [insertResult] = await pool.query(
          "INSERT INTO bookings (user_id, phone_number, colony, language, payment_status, status, telegram_chat_id) VALUES (?, ?, ?, ?, 'pending', 'pending', ?)",
          [ctx.from.id, phone, ctx.wizard.state.colony, lang, ctx.chat.id]
        );
      } catch (err) {
        console.error("Error creating preliminary booking:", err);
        await ctx.reply(texts[lang].error);
        return ctx.scene.leave();
      }
      const booking_id = insertResult.insertId;
      ctx.wizard.state.booking_id = booking_id;
      ctx.wizard.state.waiting_for_payment = true;

      console.log(`Preliminary booking created: ID ${booking_id}, user ${ctx.from.id}`);

      const return_url = encodeURIComponent(
        `https://bot.test-dunyo.uz/payment_return?booking_id=${booking_id}`
      );
      const pay_url = `https://my.click.uz/services/pay?service_id=${process.env.CLICK_SERVICE_ID}&merchant_id=84549&amount=1000&transaction_param=${booking_id}&return_url=${return_url}`;

      console.log(
        `Step 3: Showing payment for paid colony ${ctx.wizard.state.colony}, booking_id=${booking_id}`
      );
      await ctx.reply(
        texts[lang].please_pay,
        Markup.inlineKeyboard([
          [Markup.button.url(texts[lang].pay_button, pay_url)],
          [Markup.button.callback(texts[lang].check_status, "check_payment")],
          [Markup.button.callback(texts[lang].cancel_text, "cancel_booking")],
        ])
      );

      return ctx.wizard.next(); // К Step 4: ожидание оплаты
    }

    // Proceed for non-paid: сразу к типу визита
    await ctx.reply(
      texts[lang].select_visit_type,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(texts[lang].short_visit, "short"),
          Markup.button.callback(texts[lang].long_visit, "long"),
        ],
      ])
    );
    return ctx.wizard.selectStep(5); // К Step 5 (тип визита)
  },

  // Step 4: Ожидание оплаты
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 4: Waiting for payment, user input: ${
        ctx.callbackQuery?.data || ctx.message?.text
      }`
    );

    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      const messageId = ctx.callbackQuery.message.message_id; // Захватываем ID сообщения
      const chatId = ctx.callbackQuery.message.chat.id;

      if (data === "cancel_booking") {
        await ctx.answerCbQuery();
        await pool.query("DELETE FROM bookings WHERE id = ?", [
          ctx.wizard.state.booking_id,
        ]);
        await ctx.telegram.editMessageText(
          chatId,
          messageId,
          undefined,
          texts[lang].booking_canceled
        ); // Используем telegram API напрямую
        return ctx.scene.leave();
      }

      if (data === "check_payment") {
        const [bookingRows] = await pool.query(
          "SELECT payment_status FROM bookings WHERE id = ?",
          [ctx.wizard.state.booking_id]
        );

        if (
          bookingRows.length > 0 &&
          bookingRows[0].payment_status === "paid"
        ) {
          await ctx.answerCbQuery();
          await ctx.telegram.editMessageText(
            chatId,
            messageId,
            undefined,
            texts[lang].payment_success
          ); // Редактируем на успех
          ctx.wizard.state.waiting_for_payment = false;

          // Продолжаем к типу визита
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
          await ctx.answerCbQuery(texts[lang].payment_not_confirmed, {
            show_alert: true,
          });
          return; // Ничего не редактируем, кнопка остаётся
        }
      }
      await ctx.answerCbQuery(); // Для других callbacks
    }

    // Ignore text input
    if (ctx.message) {
      await ctx.reply(texts[lang].wait_for_payment_action);
    }
    return;
  },

  // Step 5: Select visit type
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 5: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
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
    return ctx.wizard.next(); // К Step 6: ФИО (единственного родственника)
  },

  // Step 6: Full name (единственного родственника)
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(`Step 6: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (ctx.message?.text === texts[lang].cancel_text) {
      if (
        ctx.wizard.state.booking_id &&
        PAID_COLONIES.includes(ctx.wizard.state.colony)
      ) {
        await pool.query("DELETE FROM bookings WHERE id = ?", [
          ctx.wizard.state.booking_id,
        ]);
      }
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply(texts[lang].invalid_name);
      return;
    }

    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.currentRelative.full_name = ctx.message.text.toUpperCase();
    ctx.wizard.state.currentRelative.passport = "AC1234567";
    ctx.wizard.state.relatives = [ctx.wizard.state.currentRelative]; // Только один

    await ctx.reply(texts[lang].enter_prisoner_name);
    return ctx.wizard.selectStep(8); // К Step 8: имя заключенного (пропускаем placeholder)
  },

  // Step 7: Placeholder (not used)
  async (ctx) => {
    return ctx.wizard.next();
  },

  // Step 8: Prisoner name
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(`Step 8: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (ctx.message?.text === texts[lang].cancel_text) {
      if (
        ctx.wizard.state.booking_id &&
        PAID_COLONIES.includes(ctx.wizard.state.colony)
      ) {
        await pool.query("DELETE FROM bookings WHERE id = ?", [
          ctx.wizard.state.booking_id,
        ]);
      }
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply(texts[lang].invalid_prisoner);
      return;
    }

    ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();

    // Поскольку нет добавления родственников — сразу к summary и подтверждению
    return showSummary(ctx); // Это должно показать summary, затем next() вызовет Step 9 (confirm)
  },

  // Step 9: Final confirm or cancel (былый Step 10, теперь нет add_more)
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 9: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "confirm") {
      return saveBooking(ctx);
    } else if (ctx.callbackQuery?.data === "cancel") {
      if (
        ctx.wizard.state.booking_id &&
        PAID_COLONIES.includes(ctx.wizard.state.colony)
      ) {
        await pool.query("DELETE FROM bookings WHERE id = ?", [
          ctx.wizard.state.booking_id,
        ]);
      }
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return ctx.scene.leave();
    } else {
      // Если showSummary вызывает это — покажите confirm
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

  /*
    // Step 9: Add more or done
  async (ctx) => {
    const lang = ctx.session.language;
    console.log(
      `Step 9: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "add_more") {
      if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
        ctx.wizard.state.currentRelative = {};
        await ctx.reply(texts[lang].new_relative);
        return ctx.wizard.selectStep(6);  // Назад к вводу ФИО
      } else {
        await ctx.reply(texts[lang].max_reached);
        return showSummary(ctx);  // К Step 10
      }
    } else if (ctx.callbackQuery?.data === "done") {
      return showSummary(ctx);  // К Step 10
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
  */
);

module.exports = bookingWizard;

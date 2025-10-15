const { Scenes, Markup } = require("telegraf");
const pool = require("../db");
const texts = require("./texts.js");
const { generateColonyKeyboard } = require("./helpers/keyboards.js");
const {
  askAddMore,
  showSummary,
  saveBooking,
} = require("./helpers/bookingUtils.js");
const { MAX_RELATIVES } = require("./constants/config.js");

const paidColonies = ['24'];

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
      await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");
    const colony = ctx.wizard.state.colony;

    if (!paidColonies.includes(colony)) {
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
    }

    // Handle paid colony
    const phone = ctx.wizard.state.phone;
    let [attemptRows] = await pool.query(
      "SELECT attempts FROM users_attempts WHERE phone_number = ?",
      [phone]
    );
    let attempts = attemptRows.length ? attemptRows[0].attempts : 0;

    if (!attemptRows.length) {
      await pool.query(
        "INSERT INTO users_attempts (phone_number, attempts) VALUES (?, 0)",
        [phone]
      );
    }

    const [paidRows] = await pool.query(
      "SELECT id FROM bookings WHERE phone_number = ? AND colony = ? AND payment_status = 'paid'",
      [phone, colony]
    );
    const hasPaidBefore = paidRows.length > 0;

    if (hasPaidBefore && attempts < 2) {
      // Proceed without payment
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
    } else {
      // Require payment
      // Create pending booking
      const [insertResult] = await pool.query(
        "INSERT INTO bookings (user_id, telegram_chat_id, phone_number, colony, payment_status, language) VALUES (?, ?, ?, ?, 'pending', ?)",
        [ctx.from.id, ctx.chat.id, phone, colony, lang]
      );
      const bookingId = insertResult.insertId;
      const transaction_param = `booking_${bookingId}`;

      const service_id = process.env.CLICK_SERVICE_ID;
      const merchant_id = 84549;
      const amount = "1000.00";
      const return_url = `https://bot.test-dunyo.uz/return?trans=${transaction_param}`;

      const payUrl = `https://my.click.uz/services/pay?service_id=${service_id}&merchant_id=${merchant_id}&amount=${amount}&transaction_param=${transaction_param}&return_url=${return_url}`;

      await ctx.reply(
        "Вы выбрали 24-ю колонию. Чтобы продолжить, оплатите по ссылке ниже 👇",
        Markup.inlineKeyboard([
          Markup.button.url("Оплатить", payUrl),
        ])
      );

      // Leave scene, user will return after payment
      return ctx.scene.leave();
    }
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
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
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

module.exports = bookingWizard;
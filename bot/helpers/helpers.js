// helpers.js
const pool = require("../../db.js");
const { Markup } = require("telegraf");
const texts = require("../texts.js");
async function getLatestPendingOrApprovedId(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT colony_application_number
       FROM bookings
       WHERE status IN ('pending', 'approved') AND user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return rows.length ? rows[0].colony_application_number : null;
  } catch (err) {
    console.error("Error in getLatestPendingOrApprovedId:", err);
    throw err;
  }
}

async function getLatestBooking(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, prisoner_name, colony, relatives, status, created_at, start_datetime, colony_application_number, language
       FROM bookings
       WHERE user_id = ? AND status IN ('pending', 'approved')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return rows.length ? rows[0] : null;
  } catch (err) {
    console.error("Error in getLatestBooking:", err);
    throw err;
  }
}

function buildMainMenu(lang, latestPendingNumber) {
  let rows = [];
  if (latestPendingNumber) {
    rows = [
      [texts[lang].queue_status, texts[lang].group_join],
      [texts[lang].application_copy, texts[lang].additional_info_button],
      [texts[lang].visitor_reminder, texts[lang].colony_location_button],
    ];
    rows.push([
      texts[lang].cancel_application(latestPendingNumber)
    ]);
    rows.push([texts[lang].change_language]);
  } else {
    rows = [[texts[lang].book_meeting], [texts[lang].change_language]];
  }
  return Markup.keyboard(rows).resize().persistent();
}

async function getQueuePosition(bookingId) {
  try {
    const [bookingsRows] = await pool.query(
      "SELECT colony, colony_application_number FROM bookings WHERE id = ?",
      [bookingId]
    );

    if (!bookingsRows.length) return null;

    const colony = bookingsRows[0].colony;
    const colonyApplicationNumber = bookingsRows[0].colony_application_number;

    const [rows] = await pool.query(
      "SELECT colony_application_number FROM bookings WHERE status = 'pending' AND colony = ? ORDER BY colony_application_number ASC",
      [colony]
    );

    const numbers = rows.map((row) => row.colony_application_number);
    const position = numbers.indexOf(colonyApplicationNumber);
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
      await ctx.scene.leave();
    }
    ctx.session = ctx.session || {};
    delete ctx.session.__scenes;
  } catch (err) {
    console.error("Error in resetSessionAndScene:", err);
    throw err;
  }
}

module.exports = {
  getLatestPendingOrApprovedId,
  getLatestBooking,
  buildMainMenu,
  getQueuePosition,
  resetSessionAndScene,
};

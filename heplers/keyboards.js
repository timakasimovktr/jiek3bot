const { Markup } = require("telegraf");
const texts = require("../bot/texts.js");
const colonies = require("../constants/colonies.js");

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

module.exports = { generateColonyKeyboard };

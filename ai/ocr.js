const Tesseract = require("tesseract.js");

async function readID(image) {
  const { data } = await Tesseract.recognize(
    image,
    "eng"
  );

  return data.text;
}

module.exports = {
  readID
};
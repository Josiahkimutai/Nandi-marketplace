const Tesseract = require("tesseract.js");

async function readID(image) {

  const { data } = await Tesseract.recognize(
    image,
    "eng"
  );

  return {
    text: data.text || "",
    confidence: data.confidence || 0
  };
}

module.exports = {
  readID
};
import type { NativeAttachment } from "../../../../packages/pvo-assistant/native/index.js";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const textFile = /\.(txt|md|csv|json)$/i;

/** Decode locally; original image bytes never leave the browser. */
export async function readAssistantAttachment(
  file: File,
): Promise<NativeAttachment> {
  const name = file.name.slice(0, 160);
  if (imageTypes.has(file.type)) {
    if (file.size > 12 * 1024 * 1024)
      throw new Error("Choose a photo smaller than 12 MB.");
    const image = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not read this photo.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
      if (dataUrl.length > 700000) throw new Error("Choose a smaller photo.");
      return { kind: "image", name, dataUrl };
    } finally {
      image.close();
    }
  }
  if (!textFile.test(file.name))
    throw new Error(
      "Choose a JPG, PNG, WebP, TXT, Markdown, CSV or JSON file.",
    );
  if (file.size > 16000)
    throw new Error("Choose a text file smaller than 16 KB.");
  const text = await file.text();
  if (!text.trim() || /[\u0000-\u0008\u000e-\u001f]/.test(text))
    throw new Error("Choose a readable text file.");
  return { kind: "text", name, text };
}

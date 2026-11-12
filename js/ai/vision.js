// Photo -> grocery items. Uses the AI (if set up) or free on-device OCR (Tesseract.js) for receipts.
import { chat, extractJSON } from './llm.js';

const PROMPT = `You read photos for a UK kitchen-stock app. The photo is a supermarket receipt, an online grocery order confirmation, or groceries laid out on a counter.
List every product that was bought. Ignore totals, discounts, savings, carrier bags, payment and store details.
Expand supermarket abbreviations into plain UK product names without brands (e.g. "BRIT CHKN BRST FLLT 640G" -> name "chicken breast fillets", size "640g").
For a photo of groceries, estimate pack sizes from the packaging if visible.
Reply with ONLY JSON, no other text:
{"store": "Tesco" or null, "items": [{"name": "semi skimmed milk", "quantity": 1, "size": "2.272L", "frozen": false, "household": false}]}
quantity = number of packs/items bought. size = pack size as printed ("500g", "6 pack", "4 pints") or "". household = true for non-food (cleaning, toiletries, kitchen roll).`;

export async function readImageWithAI(image, ai, { signal } = {}) {
  const res = await chat({ ai, system: PROMPT, signal, maxTokens: 6000,
    messages: [{ role: 'user', content: [{ type: 'image', mediaType: image.mediaType, data: image.data }, { type: 'text', text: 'List the products in this photo as JSON.' }] }] });
  const json = extractJSON(res.text);
  return { store: json.store || null, items: Array.isArray(json.items) ? json.items : [] };
}

// ── On-device OCR (no key needed; library + English model download once from jsDelivr) ──
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let loading = null;

function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error('Could not load the receipt reader. It needs internet the first time.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function ocrImage(canvas, onProgress = () => {}) {
  onProgress(0, 'Loading the receipt reader…');
  await loadTesseract();
  const worker = await globalThis.Tesseract.createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress, 'Reading the receipt…'); },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' }); // 4 = single column of variable-size text
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally { await worker.terminate(); }
}

// ── Image helpers ──
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** Downscale (and optionally boost contrast for OCR). */
export function toCanvas(img, maxSide, { ocr = false } = {}) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d', { willReadFrequently: ocr });
  if (ocr) ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.05)';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function canvasToImagePart(canvas, quality = 0.82) {
  const url = canvas.toDataURL('image/jpeg', quality);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url };
}

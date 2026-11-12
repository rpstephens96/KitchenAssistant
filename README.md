# 🥕 Larder

A calm, phone-first kitchen app: **What's in** (fridge / freezer / cupboard) → **Cook** (recipes ranked by what you have) → **Plan** (Mon–Sun) → **Shop** (aisle-grouped list, minus what you already have). Plus **receipt scanning** and an optional **✨ AI kitchen assistant**.

Runs entirely in the browser. No server, no build step, no npm packages. Hosts free on GitHub Pages and works offline (except for AI features, receipt reading and recipe import).

## Run locally

```bash
python -m http.server 8080      # Windows: python or py; Mac: python3 — then open http://localhost:8080
npm test                        # Node 20+, no install needed (42 tests)
```

## Deploy to GitHub Pages
1. Push this folder to `main` of a new repo.
2. **Settings → Pages → Source: GitHub Actions.** Every push runs the tests, then deploys to `https://<user>.github.io/<repo>/`.
3. On each phone, open the URL and use **Share → Add to Home Screen**.

## Adding shopping without typing — 🧾 "Just been shopping?"
On *What's in* (top card) or *Shop* (**Done shopping**). Four ways in, all ending at the same review screen. On that screen you untick anything wrong, tap 📍 to change Fridge, Freezer or Cupboard, use − / + to adjust amounts, then press **Put away**. Anything that was on the shopping list is ticked off automatically.

| Option | How it works | Needs |
|---|---|---|
| **Photo of the receipt** | Read on the phone with Tesseract.js OCR, then the UK receipt parser | Internet the first time (≈ 5 MB download), no account |
| | …or read by the AI assistant if set up (more accurate with creased or faded receipts) | AI key |
| **Photo of the shopping** | Lay it on the counter and snap it; the AI identifies products and pack sizes | AI key |
| **Paste an online order** | Paste the Tesco / Sainsbury's / Asda / Ocado confirmation email or type a quick list | Nothing |
| **I got everything on my list** | Converts the shopping list into whole packs | Nothing |

The receipt parser (`js/core/receipt.js`) handles:
- **Abbreviations:** `BRIT CHKN BRST FLLT` → Chicken Breast.
- **Pack sizes:** `4PT`, `4X400G`, `12PK`.
- **Quantity lines:** weighed produce (`0.950 kg @ £0.68/kg`) and multi-buys (`2 x £0.79`), matched to the right item by price.
- **Online-order quantity columns.**
- **Lines it skips:** discounts, totals, payment and Clubcard/Nectar lines.

Household items only tick off the list. Unrecognised items are shown unticked.

## ✨ AI kitchen assistant (optional)
Tap the ✨ button on any screen. It can see your current kitchen, recipes, meal plan and shopping list, and it **acts** through tools:

> "What can I make tonight?" · "Plan this week around what's going off" · "We've run out of milk and eggs" · "Save a recipe for a quick veggie chilli and put it on Thursday" · 📷 *photo of the open fridge* "what should I use first?" · 🎤 voice input

Every change goes through the normal undo system. Each reply lists what it changed and has an **↶ Undo these changes** button.

**Setup (once per phone):** ⚙️ → *AI assistant* → pick a provider → paste your key → **Test connection**.

| Provider | Default model | Cost |
|---|---|---|
| Google Gemini *(recommended)* | `gemini-3.8-flash` | Has a free tier — get a key at aistudio.google.com/apikey |
| OpenAI | `gpt-6-luna` | Pay as you go |
| Anthropic Claude | `claude-haiku-5-5` | Pay as you go |
| Other / own proxy | — | Any OpenAI-compatible endpoint (OpenRouter, Ollama, a Cloudflare Worker) |

Model names change over time. You can override them under *Advanced*.

**Privacy and keys:**
- The key is stored only on that phone, never in backups or Gist sync. Only requests you make are sent to the provider you chose, directly from your phone.
- With paid providers, set a monthly spending limit.
- Free tiers may use your prompts to improve the provider's models, so check their terms.
- Some work networks block AI services; use home Wi-Fi or mobile data.

## Sharing between two phones
- **Simplest:** ⚙️ → *Save backup file* → send it → ⚙️ → *Load backup file* → **Merge**.
- **Automatic:** a GitHub token with only the `gist` scope; *Sync now* pulls, merges per record (newest wins, deletions propagate) and pushes.

## Folder structure
```
index.html · manifest.webmanifest · sw.js · icons/ · css/app.css
js/
  app.js            router + event delegation
  store.js          state, autosave, undo, revision counter, backup
  sync.js           GitHub Gist sync
  core/             pure logic, unit-tested
    normalizer.js   UK unit converter + ingredient normaliser ★
    receipt.js      UK receipt / order parser ★ new
    kitchen.js      shared mutations (add stock, put away, shopping) ★ new
    matching.js · planner.js · shopping.js · importer.js · merge.js · util.js
  ai/               ★ new
    llm.js          provider-agnostic client (OpenAI-compatible + Anthropic)
    agent.js        system prompt with kitchen snapshot, 10 tools, tool loop
    vision.js       photo → items (AI) and on-device OCR (Tesseract.js)
  data/             ingredients.js (142 items, US/UK aliases, packs) · seed.js
  ui/               inventory · recipes · plan · shop · scan · assistant · settings · dom
tests/              normalizer · features · receipt · agent  (node --test)
docs/SCHEMA.md
.github/workflows/deploy.yml
```

## Known limits
- On-phone OCR works best on flat, well-lit receipts; crumpled thermal paper benefits from the AI option. You always get a review screen before anything is saved.
- Supermarket abbreviations vary. Add new ones to `ABBR` in `js/core/receipt.js`, and add a test line.
- The assistant needs internet; everything else works offline once loaded.

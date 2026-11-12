# 🥕 Larder

A calm, phone-first kitchen app: **What's in** (fridge / freezer / cupboard) → **Cook** (recipes ranked by what you have) → **Plan** (Mon–Sun) → **Shop** (aisle-grouped list, minus what you already have). Plus a **receipt scanner that learns** and an optional **✨ AI kitchen assistant**.

Runs entirely in the browser — no server, no build step, no npm packages. Hosts free on GitHub Pages.

## What's new in v3
- **Receipt scanner learns.** On the review screen, tap any item's name → pick the right thing (or create a new item, or "Not food — skip"). The receipt wording is saved to the **🧠 Receipt key** and used first next time. Moving an item to Fridge/Freezer/Cupboard is remembered too.
- **⚙️ → Receipt key**: see everything learned, add rules by hand ("ASDA LURPAK SLIGHTLY SALTED" → Butter), or forget one.
- **Fixed:** "WATERMELON" was read as water. The fuzzy matcher now only expands abbreviations and never matches a longer word that merely starts with a food name; watermelon, melon, pineapple, mango, pears, kiwi, cauliflower, steak, white fish, fish fingers, pizza and bottled water were added.
- **Household sharing is automatic.** Once both phones are linked, everything — kitchen, **recipes**, meal plan, shopping list and the receipt key — syncs when the app opens and a few seconds after each change. A green dot on ⚙️ shows it's on.

## Where is data stored? Can we both see recipes?
Each phone keeps its data in the browser's local storage. **Until sharing is switched on, recipes exist only on the phone that added them.** With sharing on (⚙️ → *Share with your household*), both phones read and write one private GitHub Gist; each record merges separately (newest edit wins, deletions carry over), so you can both add recipes at the same time. The AI key and GitHub token never leave the phone.

## Run locally
```bash
python -m http.server 8080      # then open http://localhost:8080
npm test                        # Node 20+, 47 tests
```

## Deploy / update on GitHub Pages
Upload the contents of this folder to your repo (replace existing files). Either:
- **Settings → Pages → Deploy from a branch → main / (root)** — simplest; or
- **Source: GitHub Actions** — uses `.github/workflows/deploy.yml` and runs the tests first.

Phones pick up the new version next time the app is opened (the service worker is network-first).

## Folder structure
```
index.html · manifest.webmanifest · sw.js · icons/ · css/app.css · .nojekyll
js/
  app.js            router, event delegation, automatic household sync
  store.js          state, autosave, undo, backup
  sync.js           GitHub Gist sync
  core/             pure logic, unit-tested
    normalizer.js   UK unit converter + ingredient normaliser
    receipt.js      receipt / order parser + receipt key (learning) ★
    kitchen.js      shared mutations (stock, put away, shopping)
    matching.js · planner.js · shopping.js · importer.js · merge.js · util.js
  ai/               llm.js (providers) · agent.js (assistant tools) · vision.js (photo → items, OCR)
  data/             ingredients.js (UK catalogue + aliases) · seed.js (demo)
  ui/               inventory · recipes · plan · shop · scan · receiptkey ★ · assistant · settings · dom
tests/              normalizer · features · receipt · agent
docs/SCHEMA.md
```

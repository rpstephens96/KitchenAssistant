# Larder data schema (v1)

One JSON document in `localStorage["larder.v1"]`, also used for backup files and Gist sync.
Every shared record has a stable `id` and ISO `updatedAt` (per-record merge, newest wins); deletions live in `tombstones`.

```jsonc
{
  "schemaVersion": 1,
  "inventory": [], "recipes": [], "plans": { "2026-11-09": {} },
  "shopping": { "items": [] },
  "customIngredients": [],        // foods you've added that aren't in the catalogue
  "receiptKey": [],               // learned receipt wording (shared between phones)
  "tombstones": { "<id>": "<deleted at>" },
  "settings": {                   // per phone, never synced
    "showBreakfast": false, "showLunch": false,
    "gist": { "token": "", "id": "", "auto": true }, "lastSync": null,
    "ai": { "provider": "gemini", "key": "", "model": "", "baseUrl": "", "useForReceipts": true }
  }
}
```

## ReceiptKey entry ★
```jsonc
{ "id": "rk_melon-medley",        // derived from key, so both phones' corrections merge
  "key": "melon medley",          // receipt wording without brand, size, count, price
  "ingredientId": "frozen-berries",
  "location": "freezer",          // optional: where it usually goes
  "ignore": false,                // true = "not food, skip this line"
  "custom": null,                 // full Ingredient when it maps to a food you created
  "example": "TESCO MELON MEDLEY 400G", "updatedAt": "…" }
```
Lookup: exact wording first, then the longest learned wording contained (as whole words) in the line, then the built-in catalogue.

## Ingredient · NormalizedLine · InventoryItem · Recipe · MealPlanWeek · ShoppingItem
Unchanged from v2 — see comments in `js/data/ingredients.js`, `js/core/normalizer.js`, `js/core/shopping.js`.
InventoryItem holds an exact `qty` (base unit) **or** a rough `level` (`full | half | low`).

## ReceiptLine (review screen only, never stored)
```jsonc
{ "raw": "BRIT CHKN BRST FLLT 640G", "keyText": "chkn brst fllt", "ingredientId": "chicken-breast",
  "qty": 640, "baseUnit": "g", "display": "640 g", "location": "fridge", "locTouched": false,
  "kind": "food | household | unknown", "include": true, "learned": false,
  "src": { "text": "…", "count": null, "price": 4.95, "kg": null } }
```

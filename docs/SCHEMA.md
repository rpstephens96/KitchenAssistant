# Larder data schema (v1)

One JSON document in `localStorage["larder.v1"]`, used unchanged for backup files and Gist sync.
Every record has a stable `id` and ISO `updatedAt` (per-record merge, newest wins); deletions are kept in `tombstones`.

```jsonc
{
  "schemaVersion": 1,
  "inventory": [ /* InventoryItem */ ], "recipes": [ /* Recipe */ ],
  "plans": { "2026-11-09": /* MealPlanWeek, keyed by Monday */ },
  "shopping": { "items": [ /* ShoppingItem */ ], "generatedAt": "…", "weekStart": "…" },
  "customIngredients": [ /* Ingredient with custom: true */ ],
  "tombstones": { "<id>": "<deleted at>" },
  "settings": {
    "showBreakfast": false, "showLunch": false,
    "gist": { "token": "", "id": "" },                         // token stripped from exports
    "ai": { "provider": "gemini", "key": "", "model": "", "baseUrl": "", "useForReceipts": true } // key stripped from exports
  }
}
```

## Ingredient (catalogue, `js/data/ingredients.js`)
```jsonc
{ "id": "butter", "name": "Butter", "emoji": "🧈", "aisle": "Dairy & Eggs",
  "base": "g",            // aggregation unit: g | ml | tsp | count
  "store": "fridge",      // default home: fridge | freezer | pantry
  "aliases": ["unsalted butter", "lurpak"],
  "cupG": 227, "tbspG": 15, "tspG": null, "unitG": null, "unitMl": null, "density": null,
  "pack": { "size": 250, "label": "250g block" },   // shopping hint + receipt default when no size printed
  "always": false, "staple": true }
```

## NormalizedLine (recipe ingredient)
```jsonc
{ "raw": "1/2 cup unsalted butter, softened", "ingredientId": "butter", "name": "Butter",
  "qty": 0.5, "unit": "cup", "baseQty": 113.5, "baseUnit": "g", "display": "115 g",
  "approx": false, "note": "softened", "optional": false, "toTaste": false }
```

## InventoryItem — exact `qty` (base unit) **or** rough `level`
```jsonc
{ "id": "i_…", "ingredientId": "egg", "name": "Eggs", "emoji": "🥚", "location": "fridge",
  "qty": 4, "level": null, "useSoon": false, "expiresOn": "2026-11-14", "addedAt": "…", "updatedAt": "…" }
```

## Recipe
```jsonc
{ "id": "r_…", "title": "…", "emoji": "🍪", "image": "…", "sourceUrl": "…", "servings": 18,
  "prepMins": 15, "cookMins": 12, "totalMins": 30, "system": "US",
  "ingredients": [ /* NormalizedLine */ ], "method": ["Preheat oven to 180°C (160°C fan, gas 4)…"], "tags": [] }
```

## MealPlanWeek
```jsonc
{ "weekStart": "2026-11-09", "days": { "mon": { "dinner": { "recipeId": "r_…", "servings": 4 } }, "tue": {}, … } }
```

## ShoppingItem
```jsonc
{ "id": "s_…", "ingredientId": "butter", "name": "Butter", "emoji": "🧈", "aisle": "Dairy & Eggs",
  "buyQty": 193.5, "baseUnit": "g", "display": "195 g", "packHint": "1 250g block",
  "note": "Have 100 g, need 195 g", "sources": ["Mushroom Risotto"], "checked": false, "manual": false }
```

## ReceiptLine (transient — review screen only, never stored)
```jsonc
{ "raw": "BRIT CHKN BRST FLLT 640G", "ingredientId": "chicken-breast", "name": "Chicken Breast",
  "qty": 640, "baseUnit": "g", "display": "640 g", "approx": false, "location": "fridge", "price": 4.95,
  "kind": "food",        // food | household (ticks list only) | unknown (unticked; custom ingredient if kept)
  "include": true }
```

## Assistant chat (in memory only, not persisted)
Neutral messages: `{ role: 'user'|'assistant'|'tool', content, toolCalls?, raw? }`. `raw` keeps the provider's own assistant message (thinking blocks / thought signatures) so tool loops replay correctly.

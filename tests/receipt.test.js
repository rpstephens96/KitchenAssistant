import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText, linesFromAI, interpretItem, extractSize, detectStore } from '../js/core/receipt.js';
import { putAway, linesFromShoppingList } from '../js/core/kitchen.js';
import { buildSeedState } from '../js/data/seed.js';
import { makeShoppingItem } from '../js/core/shopping.js';
import { getIngredient } from '../js/core/normalizer.js';

const TESCO = `TESCO
Superstore York
VAT No 220430231
TESCO S/SKIM MILK 4PT        1.65
BRIT CHKN BRST FLLT 640G     4.95
FREE RANGE EGGS 12PK         3.10
CHOPPED TOMS 4X400G          1.80
MAT CHED 400G                3.75
BANANAS LOOSE
 0.950 kg @ £0.68/kg         0.65
2 x £0.79
TESCO RED PEPPER             1.58
ONIONS 1KG                   0.89
TESCO FROZEN PEAS 900G       1.35
KITCHEN ROLL 2PK             2.00
DOUBLE CRM 300ML             1.30
CLUBCARD PRICE              -0.50
WTRS GOCHUJANG 170G          2.50
SUBTOTAL                    25.62
TOTAL                       25.12
VISA                        25.12
CHANGE DUE                   0.00
12/11/26 14:32  ST:2345`;

const byName = (lines) => Object.fromEntries(lines.map((l) => [l.name, l]));

test('Tesco receipt: abbreviations, sizes, multipacks, weighed and multi-buy lines', () => {
  const { store, lines } = parseReceiptText(TESCO);
  assert.equal(store, 'Tesco');
  const L = byName(lines);
  assert.equal(L.Milk.display, '2.27 l');
  assert.equal(L['Chicken Breast'].display, '640 g');
  assert.equal(L['Chicken Breast'].location, 'fridge');
  assert.equal(L.Eggs.qty, 12);
  assert.equal(L['Chopped Tomatoes'].display, '1.6 kg');
  assert.equal(L.Cheddar.display, '400 g');
  assert.equal(L.Bananas.display, '≈ 8');          // 0.95 kg ÷ 120 g
  assert.equal(L.Peppers.qty, 2);                 // "2 x £0.79" matched to the £1.58 line below it
  assert.equal(L['Frozen Peas'].location, 'freezer');
  assert.equal(L['Double Cream'].display, '300 ml');
  assert.equal(L['Kitchen Roll'].kind, 'household');
  assert.equal(L.Gochujang.kind, 'unknown');
  assert.equal(L.Gochujang.include, false);
  assert.ok(!lines.some((l) => /total|visa|clubcard|change/i.test(l.raw)));
  assert.equal(lines.length, 12);
});

test("Aldi/Sainsbury's style lines with VAT codes and price on its own line", () => {
  const { store, lines } = parseReceiptText(`ALDI STORES\nMILK SEMI SKIMMED 2.27L  1.45 A\nBROCCOLI  0.59 A\nBEEF MINCE 5% 500G  2.99 A\nGREEK STYLE YOGURT\n  1.29 A\nBALANCE DUE 6.32`);
  assert.equal(store, 'Aldi');
  const L = byName(lines);
  assert.equal(L.Milk.display, '2.27 l');
  assert.equal(L.Broccoli.display, '≈ 350 g');
  assert.equal(L['Beef Mince'].display, '500 g');
  assert.equal(L['Greek Yogurt'].display, '≈ 500 g');
  assert.equal(lines.length, 4);
});

test('pasted online order / typed list (no prices)', () => {
  const L = byName(parseReceiptText(`Semi skimmed milk 4 pints\n6 free range eggs\nBananas x 5\nSainsbury's Basmati Rice 1kg\nFairy washing up liquid`).lines);
  assert.equal(L.Milk.display, '2.27 l');
  assert.equal(L.Eggs.qty, 6);
  assert.equal(L.Bananas.qty, 5);
  assert.equal(L.Rice.display, '1 kg');
  assert.equal(L['Washing-up Liquid'].kind, 'household');
});

test('online order quantity column and duplicate lines merge', () => {
  const { lines } = parseReceiptText(`Tesco Chopped Tomatoes 400G 3 £1.35\nTesco Chopped Tomatoes 400G 1 £0.45\nTesco Bananas Loose 5 £0.80`);
  const L = byName(lines);
  assert.equal(L['Chopped Tomatoes'].display, '1.6 kg');
  assert.equal(L.Bananas.qty, 5);
});

test('size extraction', () => {
  assert.deepEqual(extractSize('CHOPPED TOMS 4X400G').size, { qty: 400, unit: 'g' });
  assert.equal(extractSize('CHOPPED TOMS 4X400G').mult, 4);
  assert.equal(Math.round(extractSize('MILK 4PT').size.qty), 2273);
  assert.equal(extractSize('EGGS 12PK').packCount, 12);
  assert.equal(extractSize('12 LARGE EGGS').size, null);
  assert.equal(detectStore("J SAINSBURY PLC\n..."), "Sainsbury's");
});

test('frozen keyword overrides location; no size falls back to pack', () => {
  assert.equal(interpretItem('FROZEN BLUEBERRIES').location, 'freezer');
  const butter = interpretItem('LURPAK SPREADABLE');
  assert.equal(butter.name, 'Butter');
  assert.equal(butter.display, '≈ 250 g');
});

test('AI vision items map onto the same pipeline', () => {
  const L = byName(linesFromAI([
    { name: 'Chicken thigh fillets', quantity: 1, size: '1kg' }, { name: 'Greek style yogurt', quantity: 2, size: '500g' },
    { name: 'Frozen garden peas', quantity: 1, size: '1.13kg', frozen: true }, { name: 'Toilet roll', quantity: 1, size: '9 pack', household: true },
  ]));
  assert.equal(L['Chicken Thighs'].display, '1 kg');
  assert.equal(L['Greek Yogurt'].display, '1 kg');
  assert.equal(L['Frozen Peas'].location, 'freezer');
  assert.equal(L['Toilet Roll'].kind, 'household');
});

test('put away: merges into stock, skips household, ticks off the shopping list', () => {
  const s = buildSeedState();
  s.shopping.items = [makeShoppingItem(getIngredient('egg'), { buyQty: 2 }), makeShoppingItem(getIngredient('kitchen-roll'), { buyQty: 1 }), makeShoppingItem(getIngredient('lemon'), { buyQty: 1 })];
  const eggsBefore = s.inventory.find((i) => i.ingredientId === 'egg').qty;
  const { lines } = parseReceiptText(TESCO);
  const r = putAway(s, lines.filter((l) => l.include), { tickList: true });
  assert.equal(s.inventory.find((i) => i.ingredientId === 'egg' && i.location === 'fridge').qty, eggsBefore + 12);
  assert.ok(s.inventory.some((i) => i.ingredientId === 'peas' && i.location === 'freezer'));
  assert.ok(!s.inventory.some((i) => i.ingredientId === 'kitchen-roll'));
  assert.equal(r.ticked, 2);
  assert.deepEqual(s.shopping.items.map((i) => i.ingredientId), ['lemon']);
});

test('"I got everything on my list" rounds up to whole packs', () => {
  const [eggs] = linesFromShoppingList([makeShoppingItem(getIngredient('egg'), { buyQty: 2 })]);
  assert.equal(eggs.qty, 6);
});

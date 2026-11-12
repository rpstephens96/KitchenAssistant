import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText, linesFromAI, interpretItem, extractSize, detectStore, receiptKeyText, learnedMap, teachReceipt, reinterpret, fuzzyFind, lookupLearned } from '../js/core/receipt.js';
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
  assert.equal(L.Eggs.qty, 12);
  assert.equal(L['Chopped Tomatoes'].display, '1.6 kg');
  assert.equal(L.Cheddar.display, '400 g');
  assert.equal(L.Bananas.display, '≈ 8');
  assert.equal(L.Peppers.qty, 2);
  assert.equal(L['Frozen Peas'].location, 'freezer');
  assert.equal(L['Kitchen Roll'].kind, 'household');
  assert.equal(L.Gochujang.kind, 'unknown');
  assert.ok(!lines.some((l) => /total|visa|clubcard|change/i.test(l.raw)));
  assert.equal(lines.length, 12);
});

test('BUG FIX: watermelon is not water; bottled water is not recipe water', () => {
  assert.equal(interpretItem('TESCO WATERMELON EACH').name, 'Watermelon');
  assert.equal(interpretItem('ASDA MINI WATERMELON').name, 'Watermelon');
  assert.equal(interpretItem('WTRMLN CHUNKS 450G').name, 'Watermelon');
  assert.equal(interpretItem('STILL WATER 6X2L').name, 'Bottled Water');
  assert.equal(interpretItem('STILL WATER 6X2L').display, '12 l');
  assert.equal(fuzzyFind('watermelon')?.id ?? null, 'watermelon');
  // fuzzy only expands abbreviations, never matches a longer word that starts with an alias
  assert.equal(fuzzyFind('buttermilk'), null);
  assert.equal(fuzzyFind('peanutty'), null);
});

test('receipt key wording ignores brands, sizes, counts and prices', () => {
  assert.equal(receiptKeyText('TESCO WATERMELON EACH'), 'watermelon');
  assert.equal(receiptKeyText('WTRS GOCHUJANG 170G'), 'gochujang');
  assert.equal(receiptKeyText('2 x MELON MEDLEY 400G'), 'melon medley');
  assert.equal(receiptKeyText('Sainsburys Taste the Difference Halloumi 225g'), 'halloumi');
});

test('LEARNING: a correction is remembered, wins over the catalogue, and keeps size/qty', () => {
  const state = { receiptKey: [], customIngredients: [] };
  // user corrected "MELON MEDLEY" (catalogue guessed Melon) to frozen berries in the freezer
  teachReceipt(state, { keyText: 'melon medley', ingredientId: 'frozen-berries', location: 'freezer', example: 'TESCO MELON MEDLEY 400G' });
  // and taught a brand-new item
  const goch = { id: 'x-gochujang', name: 'Gochujang', emoji: '🛒', base: 'g', store: 'fridge', aisle: 'Other', custom: true, aliases: [] };
  teachReceipt(state, { keyText: 'gochujang', custom: goch });
  // and told it "BAG FOR LIFE"-style junk isn't food
  teachReceipt(state, { keyText: receiptKeyText('BBC GOOD FOOD MAGAZINE'), ignore: true });
  const learned = learnedMap(state.receiptKey);
  const { lines, ignored } = parseReceiptText(`TESCO\nTESCO MELON MEDLEY 400G 2.00\nWTRS GOCHUJANG 170G 2.50\nBBC GOOD FOOD MAGAZINE 5.99\nTESCO WATERMELON 3.50\nTOTAL 28.00`, { learned });
  const L = byName(lines);
  assert.equal(ignored, 1);
  assert.equal(L['Frozen Berries'].display, '400 g');
  assert.equal(L['Frozen Berries'].location, 'freezer');
  assert.equal(L['Frozen Berries'].learned, true);
  assert.equal(L.Gochujang.kind, 'food');
  assert.equal(L.Gochujang.include, true);
  assert.equal(L.Gochujang.display, '170 g');
  assert.equal(L.Watermelon.learned, false);
});

test('learned wording also matches longer variants ("contains"), longest wins', () => {
  const learned = learnedMap([{ key: 'halloumi', ingredientId: 'feta' }, { key: 'light halloumi', ingredientId: 'mozzarella' }]);
  assert.equal(lookupLearned('grilling halloumi', learned).ingredientId, 'feta');
  assert.equal(lookupLearned('light halloumi slices', learned).ingredientId, 'mozzarella');
  assert.equal(lookupLearned('hal', learned), null);
});

test('re-teaching the same wording overwrites (same id, so both phones merge cleanly)', () => {
  const s = { receiptKey: [] };
  const a = teachReceipt(s, { keyText: 'melon', ingredientId: 'watermelon' });
  const b = teachReceipt(s, { keyText: 'melon', ingredientId: 'melon' });
  assert.equal(a.id, b.id);
  assert.equal(s.receiptKey.length, 1);
  assert.equal(s.receiptKey[0].ingredientId, 'melon');
});

test('reinterpret keeps the receipt size/count when the user picks a different item', () => {
  const [l] = parseReceiptText('BRIT CHKN BRST FLLT 640G').lines;
  assert.equal(reinterpret(l, getIngredient('chicken-thigh')).display, '640 g');
  const [w] = parseReceiptText('2 x TESCO WATERMELON').lines;
  assert.equal(reinterpret(w, getIngredient('melon')).qty, 2);
});

test('put away teaches the storage place when the user moved it', () => {
  const s = buildSeedState();
  const [l] = parseReceiptText('TESCO BANANAS 5PK').lines;
  l.location = 'fridge'; l.locTouched = true;
  const r = putAway(s, [l]);
  assert.equal(r.learned, 1);
  assert.equal(s.receiptKey[0].location, 'fridge');
  const [again] = parseReceiptText('TESCO BANANAS 5PK', { learned: learnedMap(s.receiptKey) }).lines;
  assert.equal(again.location, 'fridge');
});

test("Aldi/Sainsbury's style lines with VAT codes and price on its own line", () => {
  const { store, lines } = parseReceiptText(`ALDI STORES\nMILK SEMI SKIMMED 2.27L  1.45 A\nBROCCOLI  0.59 A\nBEEF MINCE 5% 500G  2.99 A\nGREEK STYLE YOGURT\n  1.29 A\nBALANCE DUE 6.32`);
  assert.equal(store, 'Aldi');
  const L = byName(lines);
  assert.equal(L.Milk.display, '2.27 l');
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

test('size extraction & store detection', () => {
  assert.deepEqual(extractSize('CHOPPED TOMS 4X400G').size, { qty: 400, unit: 'g' });
  assert.equal(extractSize('CHOPPED TOMS 4X400G').mult, 4);
  assert.equal(Math.round(extractSize('MILK 4PT').size.qty), 2273);
  assert.equal(extractSize('EGGS 12PK').packCount, 12);
  assert.equal(detectStore("J SAINSBURY PLC\n..."), "Sainsbury's");
});

test('AI vision items use the receipt key too', () => {
  const learned = learnedMap([{ key: 'melon medley', ingredientId: 'frozen-berries', location: 'freezer' }]);
  const L = byName(linesFromAI([{ name: 'Melon medley', quantity: 1, size: '400g' }, { name: 'Watermelon', quantity: 1 },
    { name: 'Toilet roll', quantity: 1, size: '9 pack', household: true }], { learned }));
  assert.equal(L['Frozen Berries'].location, 'freezer');
  assert.equal(L.Watermelon.qty, 1);
  assert.equal(L['Toilet Roll'].kind, 'household');
});

test('put away: merges into stock, skips household, ticks off the shopping list', () => {
  const s = buildSeedState();
  s.shopping.items = [makeShoppingItem(getIngredient('egg'), { buyQty: 2 }), makeShoppingItem(getIngredient('kitchen-roll'), { buyQty: 1 }), makeShoppingItem(getIngredient('lemon'), { buyQty: 1 })];
  const eggsBefore = s.inventory.find((i) => i.ingredientId === 'egg').qty;
  const { lines } = parseReceiptText(TESCO);
  const r = putAway(s, lines.filter((l) => l.include), { tickList: true });
  assert.equal(s.inventory.find((i) => i.ingredientId === 'egg' && i.location === 'fridge').qty, eggsBefore + 12);
  assert.ok(!s.inventory.some((i) => i.ingredientId === 'kitchen-roll'));
  assert.equal(r.ticked, 2);
  assert.deepEqual(s.shopping.items.map((i) => i.ingredientId), ['lemon']);
});

test('"I got everything on my list" rounds up to whole packs', () => {
  const [eggs] = linesFromShoppingList([makeShoppingItem(getIngredient('egg'), { buyQty: 2 })]);
  assert.equal(eggs.qty, 6);
});

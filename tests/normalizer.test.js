// Run: npm test   (Node 20+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, parseLine, normalizeLine, normalizeIngredients, aggregate, explainAggregate,
  formatQty, roundSmart, ovenFromF, convertTextToUK, findIngredient, suggestIngredients } from '../js/core/normalizer.js';

const n = (s, o) => normalizeLine(s, o);
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('quantities: fractions, unicode, mixed numbers, ranges, words', () => {
  assert.equal(parseQuantity('1 1/2 cups').qty, 1.5);
  assert.equal(parseQuantity('½ tsp').qty, 0.5);
  assert.equal(parseQuantity('1½ cups').qty, 1.5);
  assert.equal(parseQuantity('3/4 cup').qty, 0.75);
  assert.deepEqual([parseQuantity('2-3 cloves').qtyMin, parseQuantity('2-3 cloves').qty], [2, 3]);
  assert.equal(parseQuantity('a pinch').qty, 1);
  assert.equal(parseQuantity('two eggs').qty, 2);
});

test('THE BUTTER EXAMPLE: 50 g + 2 tbsp + ½ cup merge into one gram total', () => {
  const lines = ['50g butter', '2 tbsp butter', '1/2 cup unsalted butter, softened'].map((l) => n(l));
  assert.ok(lines.every((l) => l.ingredientId === 'butter' && l.baseUnit === 'g'));
  assert.deepEqual(lines.map((l) => l.display), ['50 g', '30 g', '115 g']);
  const [agg] = aggregate(lines);
  assert.equal(agg.display, '195 g');
  assert.equal(explainAggregate(agg), '50 g + 30 g + 115 g = 195 g Butter');
});

test('ingredient-specific dry cup conversions', () => {
  assert.equal(n('1 cup all-purpose flour').baseQty, 120);
  assert.equal(n('1 cup sugar').baseQty, 200);
  near(n('1 cup butter').baseQty, 227);
  assert.equal(n('3/4 cup packed brown sugar').display, '165 g');
  assert.equal(n('1 cup powdered sugar').name, 'Icing Sugar');
  assert.equal(n('1 1/2 cups basmati rice').display, '280 g');
});

test('weights: oz / lb -> g / kg', () => {
  assert.equal(n('1 lb boneless skinless chicken breasts').display, '455 g');
  assert.equal(n('8 oz cheddar cheese').display, '225 g');
  assert.equal(n('2.5 lbs potatoes').display, '1.13 kg');
});

test('liquids: cups / fl oz / pints / quarts -> ml / l (US vs UK pint)', () => {
  assert.equal(n('2 cups whole milk').display, '475 ml');
  assert.equal(n('8 fl oz heavy cream').display, '235 ml');
  assert.equal(n('1 quart chicken broth').display, '945 ml');
  assert.equal(n('1 pint milk', { pint: 'US' }).display, '475 ml');
  assert.equal(n('1 pint milk', { pint: 'UK' }).display, '570 ml');
  assert.equal(normalizeIngredients(['1 cup flour', '1 pint milk'])[1].display, '475 ml');
  assert.equal(normalizeIngredients(['200g flour', '1 pint milk'])[1].display, '570 ml');
});

test('US -> UK canonical names', () => {
  const cases = {
    '3 scallions, sliced': 'Spring Onions', '4 green onions': 'Spring Onions', '1/4 cup cilantro': 'Coriander',
    '1 red bell pepper': 'Peppers', '1 cup heavy cream': 'Double Cream', '1 eggplant': 'Aubergines',
    '2 zucchini': 'Courgettes', '1 tsp baking soda': 'Bicarbonate of Soda', '2 tbsp cornstarch': 'Cornflour',
    '1 lb ground beef': 'Beef Mince', '200g shrimp': 'Prawns', '2 tbsp tomato paste': 'Tomato Purée',
    '1 cup half and half': 'Single Cream', '1 tsp crushed red pepper flakes': 'Chilli Flakes',
    '1/2 tsp freshly ground black pepper': 'Black Pepper', '1 (14 oz) can garbanzo beans': 'Chickpeas',
  };
  for (const [line, name] of Object.entries(cases)) assert.equal(n(line).name, name, line);
});

test('longest alias wins: no false matches on substrings', () => {
  assert.equal(findIngredient('egg noodles').id, 'noodles');
  assert.equal(findIngredient('eggplant').id, 'aubergine');
  assert.equal(findIngredient('coconut milk').id, 'coconut-milk');
  assert.equal(findIngredient('peanut butter').id, 'peanut-butter');
  assert.equal(findIngredient('red onion').id, 'red-onion');
  assert.equal(findIngredient('garlic powder').id, 'garlic-powder');
  assert.equal(findIngredient('buttermilk'), null);
});

test('tins, packs and dual units', () => {
  assert.equal(n('2 x 400g tins chopped tomatoes').display, '800 g');
  assert.equal(n('1 (14.5 oz) can diced tomatoes').display, '410 g');
  assert.equal(n('1 (13.5 fl oz) can coconut milk').display, '400 ml');
  assert.equal(n('1 tin chickpeas').display, '400 g');
  assert.equal(n('400g/14oz spaghetti').display, '400 g');
  assert.equal(n('1 cup (240ml) milk').display, '235 ml');
  assert.equal(n('1 head garlic').baseQty, 10);
  assert.equal(n('1 stick butter').display, '115 g');
});

test('spices stored in tsp; grams/tbsp merge', () => {
  const [agg] = aggregate(['1 tbsp ground cumin', '1 tsp cumin', '5g cumin'].map((l) => n(l)));
  assert.equal(agg.baseQty, 6);
  assert.equal(agg.display, '2 tbsp');
  assert.equal(n('pinch of salt').display, '¼ tsp');
});

test('whole items, citrus juice, eggs', () => {
  assert.equal(n('2-3 large eggs').baseQty, 3);
  assert.equal(n('2 tbsp lemon juice').display, '≈ 1');
  assert.equal(n('juice of 1 lime').baseQty, 1);
  assert.equal(n('3 cloves garlic, minced').note, 'minced');
  assert.equal(n('200g onion').display, '≈ 1½');
});

test('flags: optional, to taste, unknown ingredients become custom', () => {
  assert.equal(n('1 egg (optional)').optional, true);
  assert.equal(n('Salt and pepper, to taste').toTaste, true);
  const x = n('1 tsp sumac');
  assert.equal(x.name, 'Sumac');
  assert.equal(x.baseUnit, 'tsp');
  assert.ok(x.newIngredient);
});

test('formatting & rounding', () => {
  assert.equal(roundSmart(113.5), 115);
  assert.equal(roundSmart(7.3), 7.5);
  assert.equal(formatQty(1250, 'g'), '1.25 kg');
  assert.equal(formatQty(1000, 'ml'), '1 l');
  assert.equal(formatQty(1.5, 'tsp'), '1½ tsp');
  assert.equal(formatQty(0.3, 'count'), '½');
});

test('oven temperatures °F -> °C + fan + gas', () => {
  assert.deepEqual(ovenFromF(350), { c: 180, fan: 160, gas: '4' });
  assert.deepEqual(ovenFromF(425), { c: 220, fan: 200, gas: '7' });
  assert.equal(convertTextToUK('Preheat oven to 375°F.'), 'Preheat oven to 190°C (170°C fan, gas 5).');
  assert.equal(convertTextToUK('Bake at 400 degrees F'), 'Bake at 200°C (180°C fan, gas 6)');
  assert.equal(convertTextToUK('Grease a 9x13-inch pan'), 'Grease a 23 x 33cm pan');
  assert.equal(convertTextToUK('Already 200°C'), 'Already 200°C');
});

test('autocomplete & parseLine notes', () => {
  assert.equal(suggestIngredients('chick')[0].id, 'chicken-breast');
  assert.ok(suggestIngredients('scall').some((i) => i.id === 'spring-onion'));
  const p = parseLine('1 onion, finely chopped');
  assert.equal(p.text, 'onion');
  assert.equal(p.note, 'finely chopped');
});

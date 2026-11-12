// Demo data. Recipes deliberately mix US cups/°F with UK grams to exercise the normaliser.
import { buildRecipe } from '../core/importer.js';
import { getIngredient } from '../core/normalizer.js';
import { uid, nowISO, weekStartOf, addDays, isoDate, DAYS } from '../core/util.js';

const RAW_RECIPES = [
  { title: 'Creamy Pesto Pasta', emoji: '🌿', servings: 2, totalMins: 15,
    ingredients: ['200g penne', '3 tbsp basil pesto', '1/2 cup heavy cream', '1 cup frozen peas', '1/4 cup grated parmesan', 'Salt and pepper, to taste'],
    method: ['Cook the penne in salted boiling water until al dente, adding the peas for the last 2 minutes.', 'Drain, reserving a splash of pasta water.', 'Stir through the pesto, cream and parmesan, loosening with pasta water. Season and serve.'] },
  { title: 'Mushroom Risotto', emoji: '🍄', servings: 4, totalMins: 40,
    ingredients: ['50g butter', '1 onion, finely chopped', '2 garlic cloves, crushed', '300g arborio rice', '250g chestnut mushrooms, sliced', '125ml dry white wine', '1 litre vegetable stock', '50g parmesan, grated'],
    method: ['Melt half the butter and soften the onion and garlic for 5 minutes.', 'Add the mushrooms and fry until golden.', 'Stir in the rice, then the wine. Add hot stock a ladle at a time, stirring, for about 20 minutes.', 'Beat in the remaining butter and the parmesan. Rest for 2 minutes.'] },
  { title: 'Garlic Butter Salmon & Greens', emoji: '🐟', servings: 2, totalMins: 25,
    ingredients: ['2 salmon fillets', '2 tbsp butter', '3 cloves garlic, minced', '1 lemon', '7 oz green beans', '2 cups baby spinach'],
    method: ['Preheat the oven to 400°F.', 'Put the salmon and green beans on a lined tray.', 'Melt the butter with the garlic and lemon zest, then spoon over the salmon.', 'Roast for 12–15 minutes. Wilt the spinach in the pan juices and finish with lemon juice.'] },
  { title: 'Chocolate Chip Cookies', emoji: '🍪', servings: 18, totalMins: 30,
    ingredients: ['1/2 cup unsalted butter, softened', '3/4 cup packed brown sugar', '1/4 cup granulated sugar', '1 large egg', '1 tsp vanilla extract', '1 1/2 cups all-purpose flour', '1/2 tsp baking soda', '1/2 tsp salt', '1 cup semisweet chocolate chips'],
    method: ['Preheat oven to 350°F and line two baking sheets.', 'Cream the butter and sugars, then beat in the egg and vanilla.', 'Mix in the flour, baking soda and salt, then fold in the chocolate chips.', 'Scoop onto the sheets 2 inches apart and bake 10–12 minutes.'] },
  { title: 'Chickpea & Spinach Curry', emoji: '🍛', servings: 4, totalMins: 35,
    ingredients: ['1 tbsp vegetable oil', '1 onion, diced', '3 garlic cloves', '1 tbsp grated fresh ginger', '2 tbsp curry powder', '1 (14 oz) can chickpeas, drained', '1 (13.5 fl oz) can coconut milk', '1 (14.5 oz) can diced tomatoes', '3 cups baby spinach', '1 1/2 cups basmati rice'],
    method: ['Fry the onion in the oil until soft, then add the garlic, ginger and curry powder for 1 minute.', 'Add the tomatoes, coconut milk and chickpeas and simmer for 15 minutes.', 'Cook the rice. Stir the spinach into the curry until wilted.'] },
  { title: 'Spaghetti Bolognese', emoji: '🍝', servings: 4, totalMins: 50,
    ingredients: ['500g beef mince', '1 onion, chopped', '2 carrots, diced', '2 celery sticks, diced', '3 garlic cloves', '2 x 400g tins chopped tomatoes', '2 tbsp tomato purée', '300ml beef stock', '400g spaghetti', '40g parmesan, to serve'],
    method: ['Brown the mince in a large pan, then remove.', 'Soften the onion, carrot, celery and garlic for 10 minutes.', 'Return the mince with the tomatoes, purée and stock. Simmer for 30 minutes.', 'Serve with spaghetti and parmesan.'] },
  { title: 'Chicken Fajitas', emoji: '🌮', servings: 4, totalMins: 25,
    ingredients: ['1 lb boneless skinless chicken breasts, sliced', '2 bell peppers, sliced', '1 red onion', '2 tbsp olive oil', '2 tsp chili powder', '1 tsp ground cumin', '8 flour tortillas', '1/2 cup sour cream', '1 cup shredded cheddar', '1/4 cup chopped cilantro', '1 lime'],
    method: ['Toss the chicken with the oil, chili powder and cumin.', 'Fry in a hot pan for 6–8 minutes, add the peppers and onion and cook until charred.', 'Squeeze over the lime and serve in warm tortillas with sour cream, cheddar and coriander.'] },
  { title: 'Sausage & Potato Traybake', emoji: '🌭', servings: 4, totalMins: 50,
    ingredients: ['8 pork sausages', '750g baby potatoes, halved', '2 red onions, cut into wedges', '1 red pepper', '2 tbsp olive oil', '1 tsp dried oregano'],
    method: ['Heat the oven to 200°C (180°C fan).', 'Toss everything in a roasting tin with the oil and oregano.', 'Roast for 40 minutes, turning halfway.'] },
  { title: 'Spinach & Feta Omelette', emoji: '🍳', servings: 1, totalMins: 10,
    ingredients: ['3 eggs', '1 cup spinach', '30g feta, crumbled', 'Knob of butter', 'Salt and pepper'],
    method: ['Beat the eggs with a little seasoning.', 'Melt the butter, wilt the spinach, then pour in the eggs.', 'Scatter over the feta, fold and serve.'] },
];

function inv(ingredientId, location, { qty = null, level = null, useSoon = false, expiresInDays = null } = {}, today) {
  const ing = getIngredient(ingredientId);
  return { id: uid('i_'), ingredientId, name: ing.name, emoji: ing.emoji, location, qty, level: qty == null ? (level || 'full') : null, useSoon,
    expiresOn: expiresInDays != null ? addDays(today, expiresInDays) : null, addedAt: nowISO(), updatedAt: nowISO() };
}

export function defaultSettings() {
  return { showBreakfast: false, showLunch: false, gist: { token: '', id: '' }, lastSync: null,
    ai: { provider: '', key: '', model: '', baseUrl: '', useForReceipts: true } };
}

export function buildSeedState() {
  const t = isoDate();
  const recipes = RAW_RECIPES.map((r) => buildRecipe(r)).map(({ newIngredients, ...r }) => r);
  const byTitle = Object.fromEntries(recipes.map((r) => [r.title, r.id]));
  const week = weekStartOf();
  const days = Object.fromEntries(DAYS.map((d) => [d, {}]));
  days.mon.dinner = { recipeId: byTitle['Mushroom Risotto'], servings: 4 };
  days.tue.dinner = { recipeId: byTitle['Garlic Butter Salmon & Greens'], servings: 2 };
  days.wed.dinner = { recipeId: byTitle['Chickpea & Spinach Curry'], servings: 4 };
  days.sat.lunch = { recipeId: byTitle['Chocolate Chip Cookies'], servings: 18 };
  return {
    schemaVersion: 1,
    updatedAt: nowISO(),
    inventory: [
      inv('egg', 'fridge', { qty: 4 }, t), inv('milk', 'fridge', { level: 'half' }, t), inv('butter', 'fridge', { level: 'low' }, t),
      inv('cheddar', 'fridge', { qty: 200 }, t), inv('chicken-breast', 'fridge', { qty: 340, expiresInDays: 1 }, t),
      inv('spinach', 'fridge', { qty: 150, useSoon: true }, t), inv('peppers', 'fridge', { qty: 2 }, t),
      inv('double-cream', 'fridge', { qty: 300, expiresInDays: 2 }, t), inv('parmesan', 'fridge', { qty: 100 }, t),
      inv('mushroom', 'fridge', { qty: 250, useSoon: true }, t), inv('pesto', 'fridge', { qty: 190 }, t),
      inv('peas', 'freezer', { level: 'full' }, t), inv('salmon', 'freezer', { qty: 260 }, t), inv('sausages', 'freezer', { qty: 8 }, t),
      inv('beef-mince', 'freezer', { qty: 500 }, t),
      inv('pasta', 'pantry', { qty: 500 }, t), inv('rice', 'pantry', { qty: 1000 }, t), inv('chopped-tomatoes', 'pantry', { qty: 800 }, t),
      inv('chickpeas', 'pantry', { qty: 400 }, t), inv('onion', 'pantry', { qty: 3 }, t), inv('garlic', 'pantry', { qty: 6 }, t),
      inv('olive-oil', 'pantry', { level: 'full' }, t), inv('veg-oil', 'pantry', { level: 'full' }, t), inv('plain-flour', 'pantry', { level: 'full' }, t),
      inv('curry-powder', 'pantry', { level: 'full' }, t), inv('chilli-powder', 'pantry', { level: 'half' }, t), inv('cumin', 'pantry', { level: 'full' }, t),
    ],
    recipes,
    plans: { [week]: { weekStart: week, updatedAt: nowISO(), days } },
    shopping: { items: [], generatedAt: null, weekStart: null, updatedAt: nowISO() },
    customIngredients: [],
    tombstones: {},
    settings: defaultSettings(),
  };
}

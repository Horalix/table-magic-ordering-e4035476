// Hardcoded menu data extracted from menu.lasoul.net
// This will be used as seed data and for the initial frontend

export interface MenuItem {
  name: string;
  description?: string;
  price: number;
  image_url?: string;
}

export interface Subcategory {
  name: string;
  items: MenuItem[];
}

export interface Category {
  name: string;
  type: 'drinks' | 'food' | 'dessert';
  subcategories: Subcategory[];
}

export const menuData: Category[] = [
  {
    name: "Drinks",
    type: "drinks",
    subcategories: [
      {
        name: "Cocktails",
        items: [
          { name: "La Soul Signature", description: "Our signature cocktail crafted with premium spirits", price: 14.00 },
          { name: "Espresso Martini", description: "Vodka, coffee liqueur, fresh espresso", price: 13.00 },
          { name: "Aperol Spritz", description: "Aperol, prosecco, soda water", price: 12.00 },
          { name: "Negroni", description: "Gin, sweet vermouth, Campari", price: 13.00 },
          { name: "Old Fashioned", description: "Bourbon, bitters, sugar, orange peel", price: 14.00 },
          { name: "Mojito", description: "White rum, lime, mint, sugar, soda", price: 12.00 },
        ],
      },
      {
        name: "Wine",
        items: [
          { name: "House Red Wine", description: "Glass of our selected red", price: 8.00 },
          { name: "House White Wine", description: "Glass of our selected white", price: 8.00 },
          { name: "Rosé Wine", description: "Refreshing glass of rosé", price: 9.00 },
          { name: "Prosecco", description: "Italian sparkling wine", price: 10.00 },
        ],
      },
      {
        name: "Beer",
        items: [
          { name: "Draft Beer", description: "Local craft on tap", price: 6.00 },
          { name: "Heineken", description: "330ml bottle", price: 6.00 },
          { name: "Corona", description: "330ml bottle with lime", price: 7.00 },
        ],
      },
      {
        name: "Hot Drinks",
        items: [
          { name: "Espresso", description: "Single shot", price: 3.00 },
          { name: "Cappuccino", description: "Espresso with steamed milk foam", price: 5.00 },
          { name: "Latte", description: "Espresso with steamed milk", price: 5.50 },
          { name: "Turkish Coffee", description: "Traditional Bosnian coffee", price: 4.00 },
          { name: "Tea Selection", description: "Various herbal and black teas", price: 4.00 },
        ],
      },
      {
        name: "Fresh Juices",
        items: [
          { name: "Orange Juice", description: "Freshly squeezed", price: 6.00 },
          { name: "Lemonade", description: "House-made with fresh lemons", price: 5.00 },
          { name: "Green Juice", description: "Apple, celery, cucumber, ginger", price: 7.00 },
        ],
      },
      {
        name: "Soft Drinks",
        items: [
          { name: "Coca-Cola", description: "330ml", price: 4.00 },
          { name: "Sprite", description: "330ml", price: 4.00 },
          { name: "San Pellegrino", description: "Sparkling mineral water", price: 5.00 },
          { name: "Still Water", description: "750ml", price: 3.00 },
        ],
      },
    ],
  },
  {
    name: "Food",
    type: "food",
    subcategories: [
      {
        name: "Starters",
        items: [
          { name: "Bruschetta", description: "Toasted bread with tomatoes, basil, and olive oil", price: 9.00 },
          { name: "Hummus Plate", description: "Served with warm pita bread and vegetables", price: 10.00 },
          { name: "Soup of the Day", description: "Ask your waiter for today's selection", price: 8.00 },
          { name: "Caesar Salad", description: "Romaine lettuce, croutons, parmesan, Caesar dressing", price: 11.00 },
        ],
      },
      {
        name: "Main Courses",
        items: [
          { name: "Grilled Salmon", description: "Atlantic salmon with seasonal vegetables and lemon butter", price: 24.00 },
          { name: "Beef Steak", description: "Premium cut with roasted potatoes and jus", price: 28.00 },
          { name: "Chicken Supreme", description: "Pan-seared chicken breast with mushroom sauce", price: 20.00 },
          { name: "Risotto", description: "Creamy Italian rice with seasonal ingredients", price: 18.00 },
          { name: "Pasta Carbonara", description: "Spaghetti with guanciale, egg, pecorino", price: 16.00 },
        ],
      },
      {
        name: "Burgers",
        items: [
          { name: "La Soul Burger", description: "Premium beef, aged cheddar, caramelized onions, truffle mayo", price: 18.00 },
          { name: "Chicken Burger", description: "Crispy chicken, lettuce, tomato, garlic aioli", price: 16.00 },
          { name: "Veggie Burger", description: "Plant-based patty with avocado and sprouts", price: 15.00 },
        ],
      },
      {
        name: "Pizza",
        items: [
          { name: "Margherita", description: "San Marzano tomatoes, mozzarella, fresh basil", price: 14.00 },
          { name: "Quattro Formaggi", description: "Four cheese pizza with honey drizzle", price: 16.00 },
          { name: "Prosciutto", description: "Parma ham, arugula, parmesan shavings", price: 18.00 },
        ],
      },
      {
        name: "Sides",
        items: [
          { name: "French Fries", description: "Crispy golden fries with seasoning", price: 6.00 },
          { name: "Mixed Salad", description: "Fresh seasonal greens", price: 7.00 },
          { name: "Grilled Vegetables", description: "Seasonal vegetables with herb oil", price: 8.00 },
        ],
      },
    ],
  },
  {
    name: "Desserts",
    type: "dessert",
    subcategories: [
      {
        name: "Desserts",
        items: [
          { name: "Tiramisu", description: "Classic Italian coffee-flavored dessert", price: 10.00 },
          { name: "Chocolate Fondant", description: "Warm chocolate cake with a molten center", price: 12.00 },
          { name: "Crème Brûlée", description: "Classic vanilla custard with caramelized sugar", price: 10.00 },
          { name: "Cheesecake", description: "New York style with berry compote", price: 11.00 },
          { name: "Ice Cream Selection", description: "Three scoops of artisanal gelato", price: 9.00 },
          { name: "Fruit Platter", description: "Fresh seasonal fruits", price: 10.00 },
        ],
      },
    ],
  },
];

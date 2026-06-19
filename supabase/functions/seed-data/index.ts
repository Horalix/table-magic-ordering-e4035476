import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthUser {
  id: string;
  email?: string;
}

interface ExistingTable {
  table_number: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: string[] = [];

    // 1. Create admin user
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: "kerim.sabic@gmail.com",
      password: "kerimko123",
      email_confirm: true,
    });

    if (userError && !userError.message.includes("already been registered")) {
      throw userError;
    }

    const userId = userData?.user?.id;
    if (userId) {
      await supabase.from("user_roles").upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
      results.push(`Admin user created: ${userId}`);
    } else {
      // User exists, find them
      const { data: users } = await supabase.auth.admin.listUsers();
      const existing = (users?.users as AuthUser[] | undefined)?.find((u) => u.email === "kerim.sabic@gmail.com");
      if (existing) {
        await supabase.from("user_roles").upsert({ user_id: existing.id, role: "admin" }, { onConflict: "user_id,role" });
        results.push(`Admin role assigned to existing user: ${existing.id}`);
      }
    }

    // 2. Insert 30 tables
    const tables = Array.from({ length: 30 }, (_, i) => ({ table_number: i + 1 }));
    const { error: tablesError } = await supabase.from("tables").upsert(tables, { onConflict: "table_number", ignoreDuplicates: true });
    if (tablesError) {
      // table_number might not have unique constraint, just insert
      const { data: existingTables } = await supabase.from("tables").select("table_number");
      const existingNums = new Set(((existingTables ?? []) as ExistingTable[]).map((t) => t.table_number));
      const newTables = tables.filter((t) => !existingNums.has(t.table_number));
      if (newTables.length > 0) {
        const { error: insertErr } = await supabase.from("tables").insert(newTables);
        if (insertErr) throw insertErr;
      }
    }
    results.push("30 tables created");

    // 3. Seed categories, subcategories, menu items
    const menuData = [
      {
        name: "Drinks", sort_order: 0,
        subcategories: [
          { name: "Cocktails", sort_order: 0, items: [
            { name: "La Soul Signature", description: "Our signature cocktail crafted with premium spirits", price: 14.00, sort_order: 0 },
            { name: "Espresso Martini", description: "Vodka, coffee liqueur, fresh espresso", price: 13.00, sort_order: 1 },
            { name: "Aperol Spritz", description: "Aperol, prosecco, soda water", price: 12.00, sort_order: 2 },
            { name: "Negroni", description: "Gin, sweet vermouth, Campari", price: 13.00, sort_order: 3 },
            { name: "Old Fashioned", description: "Bourbon, bitters, sugar, orange peel", price: 14.00, sort_order: 4 },
            { name: "Mojito", description: "White rum, lime, mint, sugar, soda", price: 12.00, sort_order: 5 },
          ]},
          { name: "Wine", sort_order: 1, items: [
            { name: "House Red Wine", description: "Glass of our selected red", price: 8.00, sort_order: 0 },
            { name: "House White Wine", description: "Glass of our selected white", price: 8.00, sort_order: 1 },
            { name: "Rosé Wine", description: "Refreshing glass of rosé", price: 9.00, sort_order: 2 },
            { name: "Prosecco", description: "Italian sparkling wine", price: 10.00, sort_order: 3 },
          ]},
          { name: "Beer", sort_order: 2, items: [
            { name: "Draft Beer", description: "Local craft on tap", price: 6.00, sort_order: 0 },
            { name: "Heineken", description: "330ml bottle", price: 6.00, sort_order: 1 },
            { name: "Corona", description: "330ml bottle with lime", price: 7.00, sort_order: 2 },
          ]},
          { name: "Hot Drinks", sort_order: 3, items: [
            { name: "Espresso", description: "Single shot", price: 3.00, sort_order: 0 },
            { name: "Cappuccino", description: "Espresso with steamed milk foam", price: 5.00, sort_order: 1 },
            { name: "Latte", description: "Espresso with steamed milk", price: 5.50, sort_order: 2 },
            { name: "Turkish Coffee", description: "Traditional Bosnian coffee", price: 4.00, sort_order: 3 },
            { name: "Tea Selection", description: "Various herbal and black teas", price: 4.00, sort_order: 4 },
          ]},
          { name: "Fresh Juices", sort_order: 4, items: [
            { name: "Orange Juice", description: "Freshly squeezed", price: 6.00, sort_order: 0 },
            { name: "Lemonade", description: "House-made with fresh lemons", price: 5.00, sort_order: 1 },
            { name: "Green Juice", description: "Apple, celery, cucumber, ginger", price: 7.00, sort_order: 2 },
          ]},
          { name: "Soft Drinks", sort_order: 5, items: [
            { name: "Coca-Cola", description: "330ml", price: 4.00, sort_order: 0 },
            { name: "Sprite", description: "330ml", price: 4.00, sort_order: 1 },
            { name: "San Pellegrino", description: "Sparkling mineral water", price: 5.00, sort_order: 2 },
            { name: "Still Water", description: "750ml", price: 3.00, sort_order: 3 },
          ]},
        ],
      },
      {
        name: "Food", sort_order: 1,
        subcategories: [
          { name: "Starters", sort_order: 0, items: [
            { name: "Bruschetta", description: "Toasted bread with tomatoes, basil, and olive oil", price: 9.00, sort_order: 0 },
            { name: "Hummus Plate", description: "Served with warm pita bread and vegetables", price: 10.00, sort_order: 1 },
            { name: "Soup of the Day", description: "Ask your waiter for today's selection", price: 8.00, sort_order: 2 },
            { name: "Caesar Salad", description: "Romaine lettuce, croutons, parmesan, Caesar dressing", price: 11.00, sort_order: 3 },
          ]},
          { name: "Main Courses", sort_order: 1, items: [
            { name: "Grilled Salmon", description: "Atlantic salmon with seasonal vegetables and lemon butter", price: 24.00, sort_order: 0 },
            { name: "Beef Steak", description: "Premium cut with roasted potatoes and jus", price: 28.00, sort_order: 1 },
            { name: "Chicken Supreme", description: "Pan-seared chicken breast with mushroom sauce", price: 20.00, sort_order: 2 },
            { name: "Risotto", description: "Creamy Italian rice with seasonal ingredients", price: 18.00, sort_order: 3 },
            { name: "Pasta Carbonara", description: "Spaghetti with guanciale, egg, pecorino", price: 16.00, sort_order: 4 },
          ]},
          { name: "Burgers", sort_order: 2, items: [
            { name: "La Soul Burger", description: "Premium beef, aged cheddar, caramelized onions, truffle mayo", price: 18.00, sort_order: 0 },
            { name: "Chicken Burger", description: "Crispy chicken, lettuce, tomato, garlic aioli", price: 16.00, sort_order: 1 },
            { name: "Veggie Burger", description: "Plant-based patty with avocado and sprouts", price: 15.00, sort_order: 2 },
          ]},
          { name: "Pizza", sort_order: 3, items: [
            { name: "Margherita", description: "San Marzano tomatoes, mozzarella, fresh basil", price: 14.00, sort_order: 0 },
            { name: "Quattro Formaggi", description: "Four cheese pizza with honey drizzle", price: 16.00, sort_order: 1 },
            { name: "Prosciutto", description: "Parma ham, arugula, parmesan shavings", price: 18.00, sort_order: 2 },
          ]},
          { name: "Sides", sort_order: 4, items: [
            { name: "French Fries", description: "Crispy golden fries with seasoning", price: 6.00, sort_order: 0 },
            { name: "Mixed Salad", description: "Fresh seasonal greens", price: 7.00, sort_order: 1 },
            { name: "Grilled Vegetables", description: "Seasonal vegetables with herb oil", price: 8.00, sort_order: 2 },
          ]},
        ],
      },
      {
        name: "Desserts", sort_order: 2,
        subcategories: [
          { name: "Desserts", sort_order: 0, items: [
            { name: "Tiramisu", description: "Classic Italian coffee-flavored dessert", price: 10.00, sort_order: 0 },
            { name: "Chocolate Fondant", description: "Warm chocolate cake with a molten center", price: 12.00, sort_order: 1 },
            { name: "Crème Brûlée", description: "Classic vanilla custard with caramelized sugar", price: 10.00, sort_order: 2 },
            { name: "Cheesecake", description: "New York style with berry compote", price: 11.00, sort_order: 3 },
            { name: "Ice Cream Selection", description: "Three scoops of artisanal gelato", price: 9.00, sort_order: 4 },
            { name: "Fruit Platter", description: "Fresh seasonal fruits", price: 10.00, sort_order: 5 },
          ]},
        ],
      },
    ];

    for (const cat of menuData) {
      const { data: catData, error: catErr } = await supabase
        .from("categories")
        .insert({ name: cat.name, sort_order: cat.sort_order })
        .select()
        .single();
      if (catErr) throw catErr;

      for (const sub of cat.subcategories) {
        const { data: subData, error: subErr } = await supabase
          .from("subcategories")
          .insert({ name: sub.name, category_id: catData.id, sort_order: sub.sort_order })
          .select()
          .single();
        if (subErr) throw subErr;

        const items = sub.items.map((item) => ({
          name: item.name,
          description: item.description,
          price: item.price,
          subcategory_id: subData.id,
          sort_order: item.sort_order,
        }));
        const { error: itemsErr } = await supabase.from("menu_items").insert(items);
        if (itemsErr) throw itemsErr;
      }
    }
    results.push("All menu data seeded");

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

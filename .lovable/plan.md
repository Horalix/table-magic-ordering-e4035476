

# La Soul — Premium Digital Menu & Table Ordering System

## Overview
A luxury mobile-first digital menu with QR-based table ordering, real-time kitchen display, and a full admin CMS/analytics dashboard for La Soul restaurant in Sarajevo.

---

## 1. Guest Experience (Mobile-First Menu)

### Landing Page
- Premium animated entrance with La Soul's signature olive/sage green branding and their arch logo
- Smooth transition into the menu categories (Drinks, Food, Dessert)

### Menu Browsing
- **3 main categories**: Drinks (12 subcategories), Food (10 subcategories), Dessert
- Beautiful food photography cards using La Soul's existing images from their current site
- Each item shows: high-quality photo, name, price (KM), description
- Tap to expand full item detail with "Add to Order" button
- Quantity selector, optional notes for kitchen (e.g. "no onions")
- Sticky cart/order summary bar at the bottom showing item count and total

### Table Ordering Flow
1. Guest scans QR code on their table → opens menu with table number embedded in URL (e.g. `/table/7?token=abc123`)
2. Each QR contains a **unique session token** that expires — prevents ordering from outside the restaurant
3. Guest browses menu, adds items to cart
4. Reviews order → confirms → order sent to kitchen in real-time
5. Guest can continue adding orders (multiple rounds) during their session
6. Running tab visible at all times showing everything ordered and total bill

### Anti-Fraud / Table Verification
- QR codes contain a **rotating token** that the admin refreshes daily or per-session
- Orders only accepted when the token matches the active session for that table
- Optional: Admin can manually open/close table sessions
- Expired or invalid tokens show a friendly "Please ask your waiter to help you scan"

---

## 2. Kitchen / Staff Display

### Real-Time Order Board
- Live dashboard showing incoming orders organized by table
- New orders appear with sound notification + visual alert
- Order cards show: table number, items ordered, time of order, special notes
- Staff can mark items as: Preparing → Ready → Served
- Color-coded priority (new = red, preparing = yellow, ready = green)

---

## 3. Admin CMS & Analytics Dashboard

### Menu Management
- Full CRUD for categories, subcategories, and menu items
- Upload/change item photos, edit names, descriptions, prices
- Toggle items as available/unavailable (86'd items)
- Drag-and-drop reordering

### Table Management
- Configure number of tables (20-50)
- Generate unique QR codes for each table (downloadable/printable)
- Open/close table sessions
- View current status of each table: occupied, ordering, idle

### Order Management
- Live feed of all orders across all tables
- Filter by table, status, time range
- Order history with full details

### Analytics Dashboard
- **Revenue**: Daily/weekly/monthly totals with charts
- **Most ordered items**: Ranked list with order counts
- **Table analytics**: Average session time, orders per table, revenue per table
- **Peak hours**: When most orders come in
- **Category breakdown**: Drinks vs Food vs Dessert split

### Staff Authentication
- Admin login with email/password
- Role-based access (admin vs kitchen staff view)

---

## 4. Design Direction
- **Color palette**: La Soul's signature sage/olive green (#8FA88B), cream whites, warm golds for accents
- **Typography**: Elegant serif font (Lora — matching their current site) with clean sans-serif for prices/UI
- **Photography-forward**: Large, beautiful food images as the hero of every item
- **Animations**: Subtle fade-ins, smooth page transitions, micro-interactions on add-to-cart
- **Mobile-first**: Optimized for phone screens since guests scan QR codes on phones
- **Premium feel**: Generous whitespace, thin borders, glass-morphism effects, soft shadows

---

## 5. Technical Approach
- **Frontend**: React + Tailwind (built here in Lovable)
- **Backend**: Lovable Cloud (Supabase) for database, auth, and real-time subscriptions
- **QR Generation**: Client-side QR code generation in admin panel
- **Real-time**: Supabase real-time subscriptions for live order updates to kitchen
- **Multi-language**: EN/BS toggle (matching their current site)

---

## Database Structure
- `tables` — table number, QR token, session status
- `categories` — name, type (drink/food/dessert), image, sort order
- `subcategories` — name, parent category, sort order
- `menu_items` — name, description, price, image URL, category, availability
- `table_sessions` — table, opened_at, closed_at, active token
- `orders` — table session, status, created_at, total
- `order_items` — order, menu item, quantity, notes, status
- `user_roles` — admin/staff roles (secure, separate table)


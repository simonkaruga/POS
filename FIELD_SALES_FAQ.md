# Field Sales FAQ - Your Questions Answered

## Q1: Why was I only able to view the field order in the Agent Dashboard? Shouldn't it appear in Field Orders page?

### Answer: YES, it should appear in BOTH places!

**Agent Dashboard (`/agent`)**:
- Shows orders created by **that specific agent only**
- Accessible by: SALES_AGENT role
- Purpose: Agent's personal order tracking and performance

**Field Orders Page (`/field-orders`)**:
- Shows **ALL field orders** for the business
- Accessible by: MANAGER, OWNER roles
- Purpose: Office staff to process, confirm, pack, and invoice orders

### Why you might not see it in Field Orders page:
1. **Wrong role**: You're logged in as SALES_AGENT (can only see Agent Dashboard)
2. **Wrong URL**: Make sure you're at `/field-orders` not `/agent`
3. **Filters applied**: Check if status/route filters are hiding the order

### Solution:
- Log in as MANAGER or OWNER to access Field Orders page
- Or ask your manager to check the Field Orders page
- The order WILL be there with status "SUBMITTED"

---

## Q2: Why is Customer and Shop Code showing as "undefined"?

### Answer: Backend bug - FIXED!

**The Problem**:
When creating a field order, the backend was only returning:
```javascript
customer: { name: true }  // ❌ Missing shopCode and phone
```

**The Fix** (Applied):
Updated `apps/api/src/field-sales/field-sales.service.ts` line 233:
```javascript
customer: { 
  name: true, 
  shopCode: true,  // ✅ Added
  phone: true      // ✅ Added
}
```

**What you should see now**:
```
Order No: FO-0001
Date: 09 May 2026
Customer: Premier Supermarket    ✅ (was working)
Shop Code: SHOP-0042             ✅ (now fixed)
Status: SUBMITTED                ✅ (was working)
```

**To apply the fix**:
1. Restart your API server: `cd apps/api && npm run start:dev`
2. Create a new test order
3. Customer name AND shop code should now display correctly

---

## Q3: When a field order is made, shouldn't I be able to access it to generate delivery? Should it appear in Delivery Routes?

### Answer: Not immediately - there's a workflow!

### The Complete Flow:

#### Step 1: Order Created (SUBMITTED)
```
Agent creates order → Status: SUBMITTED
```
**Appears in**:
- ✅ Agent Dashboard
- ✅ Field Orders page
- ❌ NOT in Delivery Routes yet

**Why not in Delivery Routes?**
- Order needs to be confirmed and packed first
- Can't deliver what hasn't been picked from warehouse

---

#### Step 2: Office Confirms (CONFIRMED)
```
Manager reviews → Sets delivery date → Status: CONFIRMED
```
**Appears in**:
- ✅ Agent Dashboard
- ✅ Field Orders page
- ❌ Still NOT in Delivery Routes

**Why not yet?**
- Order confirmed but not physically packed
- Warehouse needs to pick items first

---

#### Step 3: Warehouse Packs (PACKED)
```
Warehouse picks items → Prints picking list → Status: PACKED
```
**Appears in**:
- ✅ Agent Dashboard
- ✅ Field Orders page
- ✅ NOW ready to add to Delivery Routes

**This is the key step!**
- Order is physically ready for delivery
- Can now be added to a Delivery Run

---

#### Step 4: Add to Delivery Run (DISPATCHED)
```
Office staff → "Add to Delivery Run" → Select route & driver → Status: DISPATCHED
```
**Appears in**:
- ✅ Agent Dashboard
- ✅ Field Orders page
- ✅ Delivery Routes page (in the selected run)

**Now visible to driver!**
- Driver can see it in their assigned delivery run
- Can navigate to customer and deliver

---

### How to Add Order to Delivery Run:

**Option A: From Field Orders Page**
1. Go to Field Orders page (`/field-orders`)
2. Find your order (status should be PACKED)
3. Click on the order to open detail panel
4. Click "Add to Delivery Run" button
5. Select an existing PLANNED run OR create new run
6. Order is now DISPATCHED and appears in Delivery Routes

**Option B: From Delivery Routes Page**
1. Go to Delivery Routes page (`/delivery-routes`)
2. Create a new Delivery Run:
   - Click "New Delivery Run"
   - Select route (e.g., "Route A")
   - Select date
   - Assign driver (optional)
3. Click "Add Orders" button
4. Select PACKED orders to add to this run
5. Orders are now DISPATCHED

---

## Q4: What's the difference between Delivery Routes, Delivery Zones, and Pricing?

### Delivery Routes (Sales Routes)

**Purpose**: Organize customer visits and batch deliveries

**Example**:
```
Route A - Industrial Area
├─ Customer 1: ABC Hardware
├─ Customer 2: XYZ Supermarket
├─ Customer 3: Premier Store
└─ Customer 4: Elite Shop

Route B - CBD
├─ Customer 5: Downtown Mart
├─ Customer 6: City Center Store
└─ Customer 7: Main Street Shop
```

**Used for**:
- Sales agent territory assignment
- Planning which customers to visit
- Grouping orders for efficient delivery
- Creating delivery runs

**Assigned to**:
- Customers (each customer belongs to a route)
- Field Orders (inherit from customer's route)
- Delivery Runs (one run per route per day)

**Pricing**: NO - routes don't affect pricing

---

### Delivery Zones

**Purpose**: Calculate delivery fees based on distance

**Example**:
```
Zone 1: Within 5km
├─ Base fee: KES 200
├─ Per km: KES 20
└─ Max distance: 5km

Zone 2: 5-10km
├─ Base fee: KES 400
├─ Per km: KES 30
└─ Max distance: 10km

Zone 3: 10-20km
├─ Base fee: KES 800
├─ Per km: KES 40
└─ Max distance: 20km
```

**Used for**:
- E-commerce / online orders
- Customer self-service ordering
- Automatic delivery fee calculation at checkout

**Assigned to**:
- Delivery Orders (NOT Field Orders)
- Customer addresses (for online ordering)

**Pricing**: YES - zones determine delivery fees

---

### Pricing Levels (Different Concept!)

**Purpose**: Different prices for different customer types

**Example**:
```
Product: Coca-Cola 500ml

Retail Price:    KES 60  (walk-in customers)
Wholesale Price: KES 50  (bulk buyers)
VIP Price:       KES 45  (special customers)
```

**Used for**:
- Field Orders (agent selects price level)
- POS sales (cashier selects price level)
- Customer-specific pricing

**Assigned to**:
- Items (each item has 3 price levels)
- Customers (default price level)
- Sales (price level used for that sale)

**Pricing**: YES - affects item prices

---

### Summary Table

| Feature | Delivery Routes | Delivery Zones | Pricing Levels |
|---------|----------------|----------------|----------------|
| **Purpose** | Organize visits | Calculate delivery fees | Set item prices |
| **Affects Pricing?** | ❌ No | ✅ Yes (delivery fee) | ✅ Yes (item price) |
| **Used in Field Sales?** | ✅ Yes | ❌ No | ✅ Yes |
| **Used in E-commerce?** | ❌ No | ✅ Yes | ✅ Yes |
| **Assigned to Customers?** | ✅ Yes | ❌ No | ✅ Yes (default) |
| **Example** | "Route A - Industrial" | "Zone 1 - 0-5km: KES 200" | "Wholesale: KES 50" |

---

## Complete Example Scenario

### Monday Morning: Agent Creates Order

**Agent (John)** visits **Premier Supermarket** (Customer on Route A):
1. Opens Agent Dashboard on mobile
2. Finds "Premier Supermarket" in customer list
3. Creates new order:
   - 10 × Coca-Cola 500ml @ KES 50 (Wholesale price)
   - 5 × Fanta 500ml @ KES 45 (Wholesale price)
   - Total: KES 725
4. Submits order

**Result**:
- Order FO-0001 created
- Status: SUBMITTED
- Customer: Premier Supermarket ✅
- Shop Code: SHOP-0042 ✅
- Route: Route A (inherited from customer)

**Visible in**:
- ✅ John's Agent Dashboard
- ✅ Field Orders page (for managers)
- ❌ NOT in Delivery Routes (not packed yet)

---

### Monday Afternoon: Office Processes Order

**Manager (Mary)** at office:
1. Opens Field Orders page
2. Sees FO-0001 with status SUBMITTED
3. Reviews order, checks inventory
4. Clicks "Confirm Order"
5. Sets expected delivery: Tuesday 10 May
6. Status: SUBMITTED → CONFIRMED

**Warehouse Staff (Peter)**:
1. Receives picking list for FO-0001
2. Picks 10 × Coca-Cola, 5 × Fanta from warehouse
3. Packs items in boxes
4. Marks order as PACKED in system
5. Status: CONFIRMED → PACKED

**Manager (Mary)** adds to delivery:
1. Opens Field Orders page
2. Finds FO-0001 (status: PACKED)
3. Clicks "Add to Delivery Run"
4. Selects "Route A - Tuesday 10 May"
5. Assigns driver: James
6. Status: PACKED → DISPATCHED

**Result**:
- Order now appears in Delivery Routes page
- Driver James can see it in his assigned run
- Ready for delivery tomorrow

---

### Tuesday Morning: Driver Delivers

**Driver (James)**:
1. Opens Delivery Routes page (or mobile app)
2. Sees "Route A - Tuesday 10 May" run
3. Clicks "Start Run"
4. Navigates to Premier Supermarket (GPS)
5. Delivers 10 × Coca-Cola, 5 × Fanta
6. Captures proof:
   - Signature from store manager
   - GPS coordinates
   - Photo of delivered goods
7. Marks as delivered
8. Status: DISPATCHED → DELIVERED

---

### Tuesday Afternoon: Office Invoices

**Manager (Mary)**:
1. Opens Field Orders page
2. Finds FO-0001 (status: DELIVERED)
3. Clicks "Generate Invoice (Full)"
4. Invoice INV-FO-0001-12345 created
5. Status: DELIVERED → INVOICED
6. Premier Supermarket receives WhatsApp notification

**Customer pays**:
1. Premier Supermarket sends M-Pesa payment
2. Manager records payment in system
3. Payment status: UNPAID → PAID

**Done!** ✅

---

## Key Takeaways

1. **Field Orders appear in TWO places**:
   - Agent Dashboard (agent's own orders)
   - Field Orders page (all orders for managers)

2. **Customer/Shop Code undefined** = Backend bug (now fixed)

3. **Delivery Routes workflow**:
   - SUBMITTED → CONFIRMED → PACKED → **Add to Run** → DISPATCHED
   - Only PACKED orders can be added to delivery runs

4. **Delivery Routes ≠ Delivery Zones**:
   - Routes = Customer organization (no pricing)
   - Zones = Delivery fee calculation (for e-commerce)
   - Pricing Levels = Item prices (wholesale/retail/VIP)

5. **To see order in Delivery Routes**:
   - Must be PACKED first
   - Must be added to a Delivery Run
   - Then appears in Delivery Routes page

---

## Need More Help?

- Read: `FIELD_SALES_WORKFLOW.md` (detailed guide)
- View: `FIELD_SALES_DIAGRAM.md` (visual workflow)
- Contact: support@faidapos.co.ke

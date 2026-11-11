# Field Sales & Delivery Workflow Guide

## Overview
The Faida POS field sales module enables B2B sales agents to take orders from customers in the field, which are then processed by office staff and delivered via organized delivery runs.

---

## Key Concepts

### 1. **Sales Routes** (`SalesRoute`)
- **Purpose**: Predefined routes that sales agents follow to visit customers
- **Examples**: "Route A - Industrial Area", "Route B - CBD", "Route C - Westlands"
- **Contains**: List of customers assigned to that route
- **Used for**: 
  - Organizing customer visits
  - Planning delivery runs
  - Agent territory management
  - Call planning

### 2. **Delivery Zones** (`DeliveryZone`)
- **Purpose**: Geographic areas with pricing rules for delivery fees
- **Examples**: 
  - "Zone 1 - Within 5km: KES 200"
  - "Zone 2 - 5-10km: KES 400"
  - "Zone 3 - 10-20km: KES 800"
- **Contains**: Coordinates (polygon), base price, price per km, max distance
- **Used for**: Calculating delivery charges for customer orders

### 3. **Delivery Runs** (`DeliveryRun`)
- **Purpose**: Actual delivery trips on a specific date for a specific route
- **Examples**: "Route A - Monday 09 May 2026"
- **Contains**: Multiple field orders to be delivered on that trip
- **Statuses**: PLANNED → IN_PROGRESS → COMPLETED → CANCELLED
- **Used for**: Driver assignment, route optimization, delivery tracking

---

## Complete Workflow

### Phase 1: Agent Creates Order (Mobile/Web)

**Location**: Agent Dashboard (`/agent`)

1. **Agent logs in** with SALES_AGENT role
2. **Finds customer** from their assigned customer list
3. **Creates new order**:
   - Selects items from inventory
   - Sets quantities and prices
   - Adds notes (optional)
   - Marks as sample order if needed
4. **Submits order**:
   - Status: `DRAFT` → `SUBMITTED`
   - Order number generated: `FO-0001`, `FO-0002`, etc.
   - Customer details captured: name, shopCode, phone
   - Agent visit logged automatically

**What the agent sees**:
```
Order No: FO-0001
Date: 09 May 2026
Customer: Premier Supermarket
Shop Code: SHOP-0042
Status: SUBMITTED
```

**Where the order appears**:
- ✅ Agent Dashboard (`/agent`) - in "My Orders" section
- ✅ Field Orders Page (`/field-orders`) - visible to MANAGER/OWNER roles
- ❌ NOT in Delivery Routes yet (needs to be PACKED first)

---

### Phase 2: Office Staff Processes Order

**Location**: Field Orders Page (`/field-orders`)

**Who can access**: MANAGER, OWNER roles

**Order Statuses Flow**:
```
SUBMITTED → CONFIRMED → PACKED → DISPATCHED → DELIVERED → INVOICED
```

#### Step 1: Confirm Order
- Office staff reviews the order
- Sets expected delivery date
- Status: `SUBMITTED` → `CONFIRMED`
- Can reject order with reason (→ `CANCELLED`)

#### Step 2: Pack Order
- Warehouse staff picks items
- Prints picking list
- Marks order as packed
- Status: `CONFIRMED` → `PACKED`

#### Step 3: Add to Delivery Run
- **IMPORTANT**: Once order is `PACKED`, it can be added to a Delivery Run
- Office staff clicks "Add to Delivery Run"
- Selects an existing PLANNED delivery run OR creates a new one
- Order is now linked to that delivery run
- Status: `PACKED` → `DISPATCHED` (when run starts)

---

### Phase 3: Delivery Execution

**Location**: Delivery Routes Page (`/delivery-routes`)

**Who can access**: MANAGER, OWNER, DRIVER roles

#### Creating a Delivery Run:
1. Go to Delivery Routes page
2. Click "New Delivery Run"
3. Select:
   - Route (e.g., "Route A - Industrial Area")
   - Date
   - Driver (optional)
4. Add packed field orders to the run
5. Status: `PLANNED`

#### Driver Executes Delivery:
1. Driver views their assigned runs
2. Starts the run: `PLANNED` → `IN_PROGRESS`
3. For each order in the run:
   - Navigate to customer location (GPS)
   - Deliver items
   - Capture proof of delivery:
     - Signature (canvas)
     - Receiver name
     - GPS coordinates
     - Photo (optional)
     - Notes
   - Mark as delivered
4. Field order status: `DISPATCHED` → `DELIVERED`
5. Complete run: `IN_PROGRESS` → `COMPLETED`

---

### Phase 4: Invoicing & Payment

**Location**: Field Orders Page (`/field-orders`)

#### Generate Invoice:
Once order is `DELIVERED` (or `CONFIRMED`/`PACKED`/`DISPATCHED`):

1. **Full Invoice**: 
   - Click "Generate Invoice (Full)"
   - Creates proforma with all ordered items
   - Invoice number: `INV-FO-0001-12345`
   - Status: → `INVOICED`
   - Customer notified via WhatsApp/SMS

2. **Partial Invoice** (if some items not delivered):
   - Click "Generate Partial Invoice (Delivered Qty)"
   - Creates proforma with only delivered quantities
   - Useful for back-orders

3. **Bulk Invoicing**:
   - Click "Invoice All Delivered" button
   - Generates invoices for ALL orders with status `DELIVERED`
   - Batch processing

#### Record Payment:
1. Click "Record Payment" on order detail panel
2. Enter:
   - Amount (KES)
   - Payment method: Cash / M-Pesa / Bank Transfer / Cheque
   - Reference (for non-cash)
3. Payment status updates:
   - `UNPAID` → `PARTIAL` (if partial payment)
   - `PARTIAL` → `PAID` (if full payment)

---

## Key Differences Explained

### Delivery Routes vs Delivery Zones

| Feature | Delivery Routes | Delivery Zones |
|---------|----------------|----------------|
| **Purpose** | Organize customer visits & deliveries | Calculate delivery fees |
| **Contains** | List of customers | Geographic area (polygon) |
| **Used by** | Sales agents, drivers | Pricing engine |
| **Example** | "Route A - Industrial Area" | "Zone 1 - Within 5km: KES 200" |
| **Assigned to** | Customers, Field Orders | Delivery Orders (e-commerce) |

### Field Orders vs Delivery Orders

| Feature | Field Orders | Delivery Orders |
|---------|-------------|-----------------|
| **Created by** | Sales agents (B2B) | Customers (e-commerce) |
| **Source** | Agent Dashboard | Online store / POS |
| **Workflow** | SUBMITTED → CONFIRMED → PACKED → DISPATCHED → DELIVERED | PENDING → PICKED_UP → DELIVERED |
| **Delivery** | Via Delivery Runs (batch) | Individual courier delivery |
| **Pricing** | Wholesale/negotiated | Retail + delivery zone fee |

---

## Common Scenarios

### Scenario 1: Agent takes order, office delivers next day
1. **Monday 3pm**: Agent visits customer, creates order (SUBMITTED)
2. **Monday 5pm**: Office confirms order, sets delivery for Tuesday (CONFIRMED)
3. **Tuesday 8am**: Warehouse packs order (PACKED)
4. **Tuesday 9am**: Office adds to "Route A - Tuesday" delivery run (DISPATCHED)
5. **Tuesday 11am**: Driver delivers, captures signature (DELIVERED)
6. **Tuesday 2pm**: Office generates invoice (INVOICED)
7. **Wednesday**: Customer pays via M-Pesa, office records payment (PAID)

### Scenario 2: Credit limit exceeded
1. Agent creates order for KES 50,000
2. Customer credit limit: KES 30,000
3. System blocks order submission
4. Agent submits credit increase request
5. Manager approves → credit limit increased to KES 60,000
6. Agent resubmits order successfully

### Scenario 3: Partial delivery
1. Order: 10 items of Product A, 5 items of Product B
2. Warehouse only has 7 items of Product A in stock
3. Office marks delivered quantities: 7 × Product A, 5 × Product B
4. Office generates partial invoice for delivered items only
5. Remaining 3 × Product A marked as back-order
6. When stock arrives, create new order for back-order items

---

## Access Control

| Role | Agent Dashboard | Field Orders Page | Delivery Routes | Can Confirm | Can Invoice | Can Record Payment |
|------|----------------|-------------------|-----------------|-------------|-------------|-------------------|
| SALES_AGENT | ✅ (own orders) | ❌ | ❌ | ❌ | ❌ | ❌ |
| CASHIER | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MANAGER | ❌ | ✅ (all orders) | ✅ | ✅ | ✅ | ✅ |
| OWNER | ❌ | ✅ (all orders) | ✅ | ✅ | ✅ | ✅ |
| DRIVER | ❌ | ❌ | ✅ (assigned runs) | ❌ | ❌ | ❌ |

---

## API Endpoints

### Field Orders
- `POST /api/v1/field-sales/orders` - Create order (agent)
- `GET /api/v1/field-sales/orders` - List orders (with filters)
- `GET /api/v1/field-sales/orders/:id` - Get order details
- `PATCH /api/v1/field-sales/orders/:id/status` - Update status
- `POST /api/v1/field-sales/orders/:id/generate-invoice` - Generate full invoice
- `POST /api/v1/field-sales/orders/:id/generate-partial-invoice` - Generate partial invoice
- `POST /api/v1/field-sales/orders/:id/collect-payment` - Record payment
- `POST /api/v1/field-sales/orders/bulk-generate-invoices` - Bulk invoice all delivered

### Delivery Routes
- `GET /api/v1/delivery-routes/routes` - List routes
- `POST /api/v1/delivery-routes/routes` - Create route
- `GET /api/v1/delivery-routes/runs` - List delivery runs
- `POST /api/v1/delivery-routes/runs` - Create delivery run
- `POST /api/v1/delivery-routes/runs/:id/orders` - Add field order to run
- `PATCH /api/v1/delivery-routes/runs/:id/start` - Start run
- `PATCH /api/v1/delivery-routes/runs/:id/complete` - Complete run

### Agent Dashboard
- `GET /api/v1/field-sales/agent-stats` - Agent performance stats
- `GET /api/v1/field-sales/customers` - Agent's customers
- `POST /api/v1/field-sales/customers` - Register new customer
- `GET /api/v1/field-sales/call-plan` - Daily call plan
- `GET /api/v1/field-sales/credit-collection` - Outstanding credit
- `GET /api/v1/field-sales/leaderboard` - Agent leaderboard

---

## Troubleshooting

### Issue: Customer/Shop Code showing as "undefined"
**Cause**: Backend not including customer details in order response  
**Fix**: Updated `field-sales.service.ts` line 233 to include `shopCode` and `phone` in the `include` clause

### Issue: Order not appearing in Field Orders page
**Cause**: User doesn't have MANAGER/OWNER role  
**Solution**: Ensure user has correct role, or view from Agent Dashboard if SALES_AGENT

### Issue: Can't add order to delivery run
**Cause**: Order status is not `PACKED`  
**Solution**: Confirm order first, then mark as packed before adding to delivery run

### Issue: Delivery run not showing in Delivery Routes
**Cause**: Run status is `COMPLETED` or `CANCELLED`  
**Solution**: Filter by status or create a new run

---

## Best Practices

1. **Always confirm orders before packing** - Review quantities and pricing
2. **Set expected delivery dates** - Helps with customer expectations
3. **Use delivery runs for batch efficiency** - Group orders by route and date
4. **Capture proof of delivery** - Signature + GPS protects against disputes
5. **Generate invoices promptly** - After delivery confirmation
6. **Record payments immediately** - Keep customer balances accurate
7. **Monitor credit limits** - Prevent bad debt
8. **Review agent performance** - Use leaderboard and stats
9. **Plan routes efficiently** - Minimize travel time and fuel costs
10. **Communicate with customers** - WhatsApp/SMS notifications at each stage

---

## Future Enhancements

- [ ] Route optimization algorithm (shortest path)
- [ ] Real-time driver location tracking
- [ ] Customer portal for order tracking
- [ ] Automated credit scoring
- [ ] Integration with fleet management systems
- [ ] Predictive analytics for demand forecasting
- [ ] Mobile app for drivers (React Native)
- [ ] Barcode scanning for delivery verification
- [ ] Electronic signature capture
- [ ] Photo proof of delivery

---

## Support

For questions or issues, contact:
- Technical Support: support@faidapos.co.ke
- Documentation: https://docs.faidapos.co.ke
- GitHub Issues: https://github.com/faidapos/pos/issues

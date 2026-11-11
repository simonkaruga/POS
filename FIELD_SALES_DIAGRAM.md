# Field Sales Workflow - Visual Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Faida POS - FIELD SALES WORKFLOW                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  SALES AGENT     │
│  (Mobile/Web)    │
└────────┬─────────┘
         │
         │ 1. Creates Order
         │    - Selects customer
         │    - Adds items
         │    - Submits
         ▼
    ┌─────────┐
    │ DRAFT   │
    └────┬────┘
         │
         │ Auto-submit
         ▼
  ┌──────────────┐
  │  SUBMITTED   │◄─────────────────────────────────────┐
  └──────┬───────┘                                      │
         │                                              │
         │ Appears in:                                  │
         │ • Agent Dashboard (/agent)                   │
         │ • Field Orders Page (/field-orders)          │
         │                                              │
         │                                              │
┌────────▼──────────┐                                   │
│  OFFICE STAFF     │                                   │
│  (MANAGER/OWNER)  │                                   │
└────────┬──────────┘                                   │
         │                                              │
         │ 2. Reviews Order                             │
         │    - Checks inventory                        │
         │    - Sets delivery date                      │
         │    - Confirms OR Rejects                     │
         │                                              │
    ┌────┴────┐                                         │
    │         │                                         │
    ▼         ▼                                         │
┌─────────┐ ┌───────────┐                              │
│CONFIRMED│ │ CANCELLED │                              │
└────┬────┘ └───────────┘                              │
     │                                                  │
     │ 3. Warehouse Packs                               │
     │    - Picks items                                 │
     │    - Prints picking list                         │
     │    - Marks as packed                             │
     ▼                                                  │
┌─────────┐                                             │
│ PACKED  │                                             │
└────┬────┘                                             │
     │                                                  │
     │ 4. Add to Delivery Run                           │
     │    - Select route                                │
     │    - Assign driver                               │
     │    - Schedule date                               │
     ▼                                                  │
┌──────────────┐                                        │
│ DISPATCHED   │                                        │
└──────┬───────┘                                        │
       │                                                │
       │ Appears in:                                    │
       │ • Delivery Routes (/delivery-routes)           │
       │ • Driver's mobile app                          │
       │                                                │
┌──────▼──────────┐                                     │
│  DRIVER         │                                     │
│  (Mobile App)   │                                     │
└──────┬──────────┘                                     │
       │                                                │
       │ 5. Delivers Order                              │
       │    - Navigates to customer                     │
       │    - Hands over items                          │
       │    - Captures proof:                           │
       │      • Signature                               │
       │      • GPS location                            │
       │      • Photo                                   │
       │      • Receiver name                           │
       ▼                                                │
  ┌──────────┐                                          │
  │DELIVERED │                                          │
  └────┬─────┘                                          │
       │                                                │
       │ 6. Office Generates Invoice                    │
       │    - Full invoice OR                           │
       │    - Partial invoice (delivered qty)           │
       │    - Customer notified (WhatsApp/SMS)          │
       ▼                                                │
  ┌──────────┐                                          │
  │ INVOICED │                                          │
  └────┬─────┘                                          │
       │                                                │
       │ Invoice appears in:                            │
       │ • Sales → Proformas                            │
       │ • Field Orders (linked)                        │
       │ • Agent Dashboard (linked)                     │
       │                                                │
       │ 7. Customer Pays                               │
       │    - Cash / M-Pesa / Bank / Cheque             │
       │    - Office records payment                    │
       │                                                │
       ▼                                                │
  ┌──────────┐                                          │
  │   PAID   │                                          │
  └──────────┘                                          │
       │                                                │
       │ Payment Status:                                │
       │ UNPAID → PARTIAL → PAID                        │
       │                                                │
       └────────────────────────────────────────────────┘
                    (Cycle repeats)


═══════════════════════════════════════════════════════════════════════════════
                              PARALLEL CONCEPTS
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                            SALES ROUTES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Purpose: Organize customer visits & deliveries                             │
│                                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│  │  Route A     │     │  Route B     │     │  Route C     │               │
│  │  Industrial  │     │     CBD      │     │  Westlands   │               │
│  │              │     │              │     │              │               │
│  │ • Customer 1 │     │ • Customer 5 │     │ • Customer 9 │               │
│  │ • Customer 2 │     │ • Customer 6 │     │ • Customer10 │               │
│  │ • Customer 3 │     │ • Customer 7 │     │ • Customer11 │               │
│  │ • Customer 4 │     │ • Customer 8 │     │ • Customer12 │               │
│  └──────────────┘     └──────────────┘     └──────────────┘               │
│                                                                              │
│  Assigned to: Customers, Field Orders                                       │
│  Used by: Sales agents, Delivery planning                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           DELIVERY ZONES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Purpose: Calculate delivery fees based on distance                         │
│                                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│  │   Zone 1     │     │   Zone 2     │     │   Zone 3     │               │
│  │  0-5 km      │     │  5-10 km     │     │  10-20 km    │               │
│  │              │     │              │     │              │               │
│  │  KES 200     │     │  KES 400     │     │  KES 800     │               │
│  │              │     │              │     │              │               │
│  │  Base fee    │     │  Base fee    │     │  Base fee    │               │
│  │  + KES 20/km │     │  + KES 30/km │     │  + KES 40/km │               │
│  └──────────────┘     └──────────────┘     └──────────────┘               │
│                                                                              │
│  Assigned to: Delivery Orders (e-commerce)                                  │
│  Used by: Pricing engine, Checkout                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           DELIVERY RUNS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Purpose: Batch multiple orders for efficient delivery                      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐        │
│  │  Delivery Run: Route A - Monday 09 May 2026                    │        │
│  │  Driver: John Kamau                                             │        │
│  │  Status: IN_PROGRESS                                            │        │
│  ├────────────────────────────────────────────────────────────────┤        │
│  │  Stop 1: Customer 1 (FO-0001) - KES 15,000  ✓ DELIVERED        │        │
│  │  Stop 2: Customer 2 (FO-0003) - KES 8,500   ✓ DELIVERED        │        │
│  │  Stop 3: Customer 3 (FO-0005) - KES 22,000  ⏳ IN TRANSIT      │        │
│  │  Stop 4: Customer 4 (FO-0007) - KES 12,500  ⏳ PENDING         │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  Statuses: PLANNED → IN_PROGRESS → COMPLETED                               │
│  Used by: Drivers, Delivery tracking                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                            DATA RELATIONSHIPS
═══════════════════════════════════════════════════════════════════════════════

Customer
   │
   ├─ salesAgentId ──────► User (SALES_AGENT role)
   ├─ routeId ───────────► SalesRoute
   └─ fieldOrders ───────► FieldOrder[]

FieldOrder
   │
   ├─ agentId ───────────► User (SALES_AGENT)
   ├─ customerId ────────► Customer
   ├─ routeId ───────────► SalesRoute
   ├─ items ─────────────► FieldOrderItem[]
   ├─ invoiceNumber ─────► Sale (Proforma)
   └─ deliveryRunOrders ─► DeliveryRunOrder[]

DeliveryRun
   │
   ├─ routeId ───────────► SalesRoute
   ├─ driverUserId ──────► User (DRIVER role)
   └─ orders ────────────► DeliveryRunOrder[]

DeliveryRunOrder
   │
   ├─ deliveryRunId ─────► DeliveryRun
   ├─ fieldOrderId ──────► FieldOrder
   └─ proof ─────────────► DeliveryProof


═══════════════════════════════════════════════════════════════════════════════
                              USER ROLES & ACCESS
═══════════════════════════════════════════════════════════════════════════════

┌──────────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│      ROLE        │ Agent Dash   │ Field Orders │ Delivery Rts │ Can Invoice  │
├──────────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  SALES_AGENT     │  ✅ Own      │      ❌      │      ❌      │      ❌      │
│  CASHIER         │      ❌      │      ❌      │      ❌      │      ❌      │
│  MANAGER         │      ❌      │  ✅ All      │  ✅ All      │      ✅      │
│  OWNER           │      ❌      │  ✅ All      │  ✅ All      │      ✅      │
│  DRIVER          │      ❌      │      ❌      │  ✅ Assigned │      ❌      │
└──────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘


═══════════════════════════════════════════════════════════════════════════════
                            QUICK REFERENCE
═══════════════════════════════════════════════════════════════════════════════

Order Statuses:
  DRAFT → SUBMITTED → CONFIRMED → PACKED → DISPATCHED → DELIVERED → INVOICED
                          ↓
                      CANCELLED

Payment Statuses:
  UNPAID → PARTIAL → PAID

Delivery Run Statuses:
  PLANNED → IN_PROGRESS → COMPLETED
               ↓
           CANCELLED

Key URLs:
  • Agent Dashboard:    /agent
  • Field Orders:       /field-orders
  • Delivery Routes:    /delivery-routes
  • Proformas/Invoices: /proformas

Key Actions:
  • Create Order:       Agent Dashboard → New Order
  • Confirm Order:      Field Orders → Confirm
  • Pack Order:         Field Orders → Mark as Packed
  • Add to Run:         Field Orders → Add to Delivery Run
  • Deliver:            Delivery Routes → Start Run → Deliver
  • Generate Invoice:   Field Orders → Generate Invoice
  • Record Payment:     Field Orders → Record Payment
```

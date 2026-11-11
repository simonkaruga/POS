# Faida POS Receipt System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Faida POS Receipt System                       │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │   THERMAL    │  │   A4 PDF     │  │   A5 PDF     │                │
│  │   (80mm)     │  │  (210×297mm) │  │  (148×210mm) │                │
│  │              │  │              │  │              │                │
│  │ • Fast       │  │ • Enterprise │  │ • Compact    │                │
│  │ • Counter    │  │ • Signature  │  │ • Retail     │                │
│  │ • Receipt    │  │ • Formal     │  │ • Invoice    │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
└─────────────────────────────────────────────────────────────────────────┘
```

## Transaction Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Transaction Types                               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
        ┌─────────────────────────┴─────────────────────────┐
        │                                                     │
        ▼                                                     ▼
┌───────────────────┐                              ┌───────────────────┐
│  Counter Sale     │                              │  B2B Transaction  │
│  (Walk-in)        │                              │  (Field Sales)    │
└─────────┬─────────┘                              └─────────┬─────────┘
          │                                                  │
          ▼                                                  ▼
    ┌─────────┐                                        ┌─────────┐
    │ THERMAL │                                        │   A4    │
    │ Receipt │                                        │ Invoice │
    └─────────┘                                        └─────────┘
          │                                                  │
          ▼                                                  ▼
    • Fast print                                       • Signature
    • 58/80mm                                          • Bank details
    • KOT ticket                                       • VAT breakdown
                                                       • Payment terms

        ┌─────────────────────────┐
        │  Delivery Order         │
        │  (Driver)               │
        └─────────┬───────────────┘
                  │
                  ▼
            ┌─────────┐
            │   A4    │
            │ Receipt │
            └─────────┘
                  │
                  ▼
            • Signature block
            • Proof of delivery
            • Customer confirmation
            • Date/time/ID fields
```

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Frontend Layer                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │   Web App    │  │  Mobile POS  │  │ Driver App   │                │
│  │  (React)     │  │  (Expo RN)   │  │  (Expo RN)   │                │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │
│         │                  │                  │                         │
│         └──────────────────┴──────────────────┘                         │
│                            │                                            │
│                            ▼                                            │
│                   ┌────────────────┐                                   │
│                   │  Print Button  │                                   │
│                   │  window.open() │                                   │
│                   └────────┬───────┘                                   │
└────────────────────────────┼────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            API Layer                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  ReportsController                                               │ │
│  │  ┌────────────────────────────────────────────────────────────┐ │ │
│  │  │  GET /reports/pdf/delivery-receipt/:id                     │ │ │
│  │  │  GET /reports/pdf/field-order-invoice/:id                  │ │ │
│  │  │  GET /reports/pdf/sale/:id                                 │ │ │
│  │  └────────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────┬───────────────────────────────────────┘ │
│                             │                                          │
│                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  PdfService                                                      │ │
│  │  ┌────────────────────────────────────────────────────────────┐ │ │
│  │  │  generateDeliveryReceipt(deliveryId)                       │ │ │
│  │  │  generateFieldOrderInvoice(orderId)                        │ │ │
│  │  │  generateSaleReceipt(saleId)                               │ │ │
│  │  │  htmlWrapper(title, content)                               │ │ │
│  │  └────────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────┬───────────────────────────────────────┘ │
│                             │                                          │
│                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Prisma ORM                                                      │ │
│  │  • DeliveryOrder.findUnique({ include: { sale, business } })    │ │
│  │  • FieldOrder.findUnique({ include: { customer, agent } })      │ │
│  │  • Sale.findUnique({ include: { items, payments } })            │ │
│  └──────────────────────────┬───────────────────────────────────────┘ │
└────────────────────────────┼────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Database Layer                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  PostgreSQL 16                                                   │ │
│  │  ┌────────────────────────────────────────────────────────────┐ │ │
│  │  │  Business                                                   │ │ │
│  │  │  • receiptFormatSale: "THERMAL"                            │ │ │
│  │  │  • receiptFormatInvoice: "A4"                              │ │ │
│  │  │  • receiptFormatDelivery: "A4"                             │ │ │
│  │  │  • receiptFormatEmail: "A4"                                │ │ │
│  │  │  • receiptHeader: "Company Name | Address"                 │ │ │
│  │  │  • receiptFooter: "Thank you!"                             │ │ │
│  │  │  • bankName, bankAccountNumber, etc.                       │ │ │
│  │  └────────────────────────────────────────────────────────────┘ │ │
│  │  ┌────────────────────────────────────────────────────────────┐ │ │
│  │  │  DeliveryOrder                                              │ │ │
│  │  │  • orderNumber, customerName, deliveryAddress              │ │ │
│  │  │  • status, deliveredAt, receivedBy                         │ │ │
│  │  │  • saleId → Sale (items, payments)                         │ │ │
│  │  └────────────────────────────────────────────────────────────┘ │ │
│  │  ┌────────────────────────────────────────────────────────────┐ │ │
│  │  │  FieldOrder                                                 │ │ │
│  │  │  • orderNumber, invoiceNumber, invoicedAt                  │ │ │
│  │  │  • customerId → Customer (name, kraPin, shopCode)          │ │ │
│  │  │  • agentId → User (name, phone)                            │ │ │
│  │  │  • items[] (itemName, quantity, unitPriceCents)            │ │ │
│  │  └────────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Receipt Generation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Receipt Generation Process                         │
└─────────────────────────────────────────────────────────────────────────┘

1. User clicks "Print Receipt" button
   │
   ▼
2. Frontend opens new tab: /reports/pdf/delivery-receipt/:id
   │
   ▼
3. API authenticates JWT + TenantGuard
   │
   ▼
4. Controller calls PdfService.generateDeliveryReceipt(id)
   │
   ▼
5. Service fetches data from Prisma:
   • DeliveryOrder (with sale, business, customer)
   • Sale items, payments
   • Business branding (header, footer, bank details)
   │
   ▼
6. Service builds HTML string:
   • Letterhead (business name, header)
   • Delivery details (address, status)
   • Itemized table (qty, price, total)
   • Signature blocks (driver, customer)
   • Footer (branding, terms)
   │
   ▼
7. Service wraps HTML with:
   • <style> tag (A4 layout, print-friendly CSS)
   • Print button (auto-hides when printing)
   • Responsive design
   │
   ▼
8. Controller returns HTML to browser
   │
   ▼
9. Browser renders A4 receipt
   │
   ▼
10. User clicks "Print / Save as PDF" button
    │
    ▼
11. Browser print dialog opens
    │
    ▼
12. User selects "Save as PDF" destination
    │
    ▼
13. Professional A4 PDF downloaded ✅
```

## Configuration Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Receipt Preference Configuration                     │
└─────────────────────────────────────────────────────────────────────────┘

1. Admin opens Settings page
   │
   ▼
2. Frontend fetches: GET /business/:id/settings
   │
   ▼
3. Display current preferences:
   • Counter Sale: THERMAL
   • B2B Invoice: A4
   • Delivery: A4
   • Email: A4
   │
   ▼
4. Admin changes "Delivery" to "THERMAL"
   │
   ▼
5. Frontend sends: PATCH /business/:id/settings
   {
     "receiptFormatDelivery": "THERMAL"
   }
   │
   ▼
6. API updates Business record in database
   │
   ▼
7. Future delivery receipts use THERMAL format ✅
```

## Signature Block Layout (A4 Delivery Receipt)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DELIVERY CONFIRMATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐   │
│  │ Delivered By (Driver)        │  │ Received By (Customer)       │   │
│  │                              │  │                              │   │
│  │ ___________________________  │  │ ___________________________  │   │
│  │ Name & Signature             │  │ Name & Signature             │   │
│  └──────────────────────────────┘  └──────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐   │
│  │ Date & Time                  │  │ ID Number (Optional)         │   │
│  │                              │  │                              │   │
│  │ 15 May 2026, 14:30          │  │ ___________________________  │   │
│  └──────────────────────────────┘  └──────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Format Comparison

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Format Comparison                               │
├──────────────┬──────────────┬──────────────┬──────────────────────────┤
│ Feature      │ THERMAL      │ A4 PDF       │ A5 PDF (Future)          │
├──────────────┼──────────────┼──────────────┼──────────────────────────┤
│ Width        │ 58/80mm      │ 210mm        │ 148mm                    │
│ Height       │ Variable     │ 297mm        │ 210mm                    │
│ Speed        │ <1s          │ ~5ms HTML    │ ~5ms HTML                │
│ Signature    │ ❌           │ ✅           │ ✅                       │
│ Letterhead   │ ❌           │ ✅           │ ✅                       │
│ Bank Details │ ❌           │ ✅           │ ✅                       │
│ VAT Table    │ Simple       │ Detailed     │ Detailed                 │
│ Use Case     │ Counter      │ B2B/Delivery │ Retail Invoice           │
│ Print Cost   │ Low          │ Medium       │ Medium                   │
│ Professional │ ⭐⭐         │ ⭐⭐⭐⭐⭐   │ ⭐⭐⭐⭐                 │
└──────────────┴──────────────┴──────────────┴──────────────────────────┘
```

## Integration Points

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Integration Points                              │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Email Service   │  → Attach A4 PDF to customer emails
│  (Resend)        │     • generateDeliveryReceipt()
└──────────────────┘     • Convert HTML → PDF (Puppeteer)
                         • Send via Resend API

┌──────────────────┐
│  WhatsApp        │  → Send A4 PDF via Africa's Talking
│  (Africa's       │     • Upload PDF to S3/CloudFlare
│   Talking)       │     • Send media URL via WhatsApp API
└──────────────────┘

┌──────────────────┐
│  SMS Service     │  → Send receipt link via SMS
│  (Africa's       │     • Generate short URL
│   Talking)       │     • Send SMS with link
└──────────────────┘

┌──────────────────┐
│  Mobile App      │  → Print/Share PDF on mobile
│  (Expo Print)    │     • Fetch HTML from API
│                  │     • expo-print → PDF
│                  │     • expo-sharing → Share
└──────────────────┘

┌──────────────────┐
│  Desktop App     │  → Print via Tauri
│  (Tauri)         │     • Open PDF in system viewer
│                  │     • Print via native dialog
└──────────────────┘
```

## Security Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Security Layers                                 │
└─────────────────────────────────────────────────────────────────────────┘

1. Authentication
   ├─ JWT token required
   ├─ JwtAuthGuard validates token
   └─ User must be authenticated

2. Authorization
   ├─ TenantGuard checks businessId
   ├─ User must belong to business
   └─ No cross-tenant data access

3. Data Sanitization
   ├─ HTML escaping for user input
   ├─ Prisma ORM prevents SQL injection
   └─ No XSS vulnerabilities

4. Audit Trail
   ├─ All PDF generations logged
   ├─ AuditLog records access
   └─ Tamper-evident hash chain
```

---

**Legend**:
- ✅ Implemented
- 🔄 In Progress
- 📋 Planned
- ❌ Not Supported
- ⭐ Rating (1-5 stars)

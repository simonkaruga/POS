---
title: "Faida POS"
subtitle: "User Guide"
author: "Faida Systems"
audience: "Business owners, managers, cashiers, waiters, kitchen and accounts staff"
---

# Faida POS — User Guide

**This guide is for the people who use Faida POS to run a business.** Owners,
managers, cashiers, waiters, kitchen staff and accountants.

You do not need to understand servers, databases or code to read it. If you are
installing Faida on a server, you want the **Admin & Installation Guide** instead.

Everything here is written as a task: *how do I take a sale*, *how do I refund
someone*, *how do I close the day*. Find your task, follow the steps.

---

## Contents

**Getting going**
1. [Who does what](#1-who-does-what)
2. [Signing in](#2-signing-in)
3. [Your first sale in 60 seconds](#3-your-first-sale-in-60-seconds)

**Selling**
4. [The POS screen](#4-the-pos-screen)
5. [Adding items to the cart](#5-adding-items-to-the-cart)
6. [Taking payment](#6-taking-payment)
7. [Receipts](#7-receipts)
8. [Holding and recalling a sale](#8-holding-and-recalling-a-sale)
9. [Fixing mistakes: cart edit, void, refund](#9-fixing-mistakes-cart-edit-void-refund)
10. [Customers, credit and loyalty](#10-customers-credit-and-loyalty)

**Your kind of business**
11. [Restaurant, café and bar](#11-restaurant-café-and-bar)
12. [Hotel](#12-hotel)
13. [Pharmacy](#13-pharmacy)
14. [Fuel station, cyber café and other trades](#14-fuel-station-cyber-café-and-other-trades)

**Stock and suppliers**
15. [Stock, receiving and counting](#15-stock-receiving-and-counting)
16. [Expiry dates and batches](#16-expiry-dates-and-batches)
17. [Suppliers and purchase orders](#17-suppliers-and-purchase-orders)

**Money**
18. [Cash drawer, shifts and closing the day](#18-cash-drawer-shifts-and-closing-the-day)
19. [Expenses and the books](#19-expenses-and-the-books)
20. [Reports worth knowing](#20-reports-worth-knowing)
21. [KRA, VAT and eTIMS](#21-kra-vat-and-etims)

**Beyond the counter**
22. [Selling online and to customers' phones](#22-selling-online-and-to-customers-phones)
23. [Delivery](#23-delivery)
24. [Field sales and B2B invoicing](#24-field-sales-and-b2b-invoicing)
25. [Staff, leave and payroll](#25-staff-leave-and-payroll)
26. [The mobile apps](#26-the-mobile-apps)

**Running the shop**
27. [Settings you will actually use](#27-settings-you-will-actually-use)
28. [Your plan and what it unlocks](#28-your-plan-and-what-it-unlocks)
29. [Working offline](#29-working-offline)
30. [When something goes wrong](#30-when-something-goes-wrong)
31. [Quick reference card](#31-quick-reference-card)
32. [Glossary](#32-glossary)

---

# Getting going

## 1. Who does what

Faida gives each person only what their job needs. If a screen described in this
guide is missing for you, it is almost certainly your role — ask the owner.

| Role | What they can do |
|---|---|
| **Owner** | Everything, including settings, staff and billing |
| **Manager** | Sell, manage stock, approve things, see reports, authorise voids |
| **Cashier** | Sell, look up and create customers, manage **their own** cash drawer, see **their own** sales |
| **Waiter** | Take table orders, print bills. **Cannot take payment or see reports** |
| **Kitchen** | See the kitchen screen and mark items in-progress or ready. Sees no money at all |
| **Accountant** | Reports, expenses, ledger, supplier accounts. **Cannot sell or edit stock** |

Two deliberate choices worth knowing:

- A **cashier cannot browse other cashiers' takings.** The sales list shows only
  their own. Owners, managers and accountants see everything.
- An **accountant can see the money but cannot touch stock or staff.** Approving
  spending is a management act, not an accounting one.

Owners can also build **custom roles** in Settings if these six do not fit.

## 2. Signing in

There are two ways in, and they behave differently on purpose.

**Email and password** — for office work. Your session lasts **15 minutes** of
inactivity before it needs refreshing. This is the secure option for anything
involving money, staff or settings.

**PIN** — for the shop floor. Four to six digits, and the session lasts **12 hours**,
so a cashier is not retyping a password all shift. Tap your name, enter your PIN.
Every person needs their **own** PIN: Faida refuses to save a PIN that a colleague
already uses, because a PIN is how it knows who rang up a sale or approved a void. If
two staff already share one from before, they can still sign in by tapping their name
first; a manager override will ask the owner to give each manager a different PIN.

Owners may also enable:

- **Google sign-in**
- **Two-factor (TOTP)** — an authenticator app code on top of your password.
  Recommended for owners, and often required
- **Fingerprint / face unlock** where the device supports it. It only works when the app is opened through its secure `https://` web address, not an IP address or plain `http://`. An owner or manager registers each person's device under Settings -> Users

> **"No sales found" when you know there are sales?** Your session quietly expired.
> Sign in again. If it keeps happening on a shared shop-floor device, ask the owner
> to switch that device to PIN login.

## 3. Your first sale in 60 seconds

1. Open **POS**.
2. Type the first few letters of the item, or scan its barcode.
3. Click the item. It lands in the cart on the right.
4. Click **Charge** (or press **F1** for a straight cash sale).
5. Pick how the customer is paying.
6. Enter what they handed over. Faida shows the change.
7. **Complete**. The receipt prints or sends.

That is the whole loop. Everything below is detail on top of it.

---

# Selling

## 4. The POS screen

Three areas:

- **Left / centre — the item grid.** Your products, grouped by category. Tap to add.
- **Top — the search bar.** Typing here searches names, SKUs and barcodes.
- **Right — the cart.** Lines, quantities, discounts, the running total, and the
  **Charge** button.

**Keyboard shortcuts** (they work when you are not typing in a box):

| Key | Does |
|---|---|
| `/` | Jump to search |
| `F1` | Charge as cash |
| `F5` | Hold the current sale |
| `F6` | Recall a held sale |

The screen adapts to your business type. A restaurant asks which table first; a fuel
station asks which pump; a supermarket runs a denser, scan-heavy layout. Same cart
underneath.

## 5. Adding items to the cart

**Search** — type any part of the name, the SKU, or the barcode.

**Scan** — use a USB/Bluetooth scanner, or the camera. A scanner just types into the
search box, so it works anywhere the box is focused.

**Quick price entry** — type `3x500` and press Enter to add **three of the item that
costs KES 500**. `3×500` and `3*500` work too. This is built for market stalls and
kiosks where staff know goods by price rather than name. Note it matches on **price,
not quantity of shillings** — if two items both cost 500, it takes the first.

**Weighed goods** — scan the label a weighing scale prints (a GS1 barcode). Faida
reads the weight, subtracts the **tare** (the container's own weight, set per item),
and prices the net. A toast confirms: *"Scanned: Beef — Net: 1.240 kg (tare: 0.010 kg
deducted)"*.

**Price levels** — retail and wholesale. Switch the level on the cart before charging
and every line reprices.

**Overriding a price** — allowed if your role permits it, and it is recorded against
your name.

Two things may interrupt you, by design:

- **Age gate** — for age-restricted goods, Faida asks you to confirm the customer's
  age before the line is added.
- **Expiry warning** — if stock about to be sold is expired or close to it, Faida
  stops and shows you which batch. See [section 16](#16-expiry-dates-and-batches).

## 6. Taking payment

Click **Charge**. The payment window offers:

| Method | Notes |
|---|---|
| **Cash** | Type what the customer handed over; change is calculated |
| **M-Pesa — STK Push** | Sends the prompt to the customer's phone. They enter their PIN |
| **M-Pesa — QR Code** | Shows a QR on screen for the customer to scan |
| **M-Pesa — Paybill / Till** | For manual paybill payments; enter the reference |
| **Card — Paystack** | Card payment through Paystack |
| **Card — Terminal** | A connected card terminal (Ingenico, PAX, Verifone) |
| **NFC** | Tap-to-pay where supported |
| **Bank Transfer** | Records bank, account name, branch and reference |
| **Credit Sale** | Puts it on the customer's account. Needs a customer, and respects their credit limit |
| **Gift Card** | Scan or type the card code; shows the remaining balance |
| **Room Charge** | Hotel mode — type the room number; the sale is added to the folio of the guest checked in to that room and paid at check-out. A room with no checked-in guest is refused |
| **Split Pay** | Any combination of the above |

**Split payments** are the common real-world case: KES 1,000 in cash and the rest on
M-Pesa. Choose **Split Pay**, add each part, and Faida tracks *Remaining to pay*
until it reaches zero.

**On credit sales**, if the amount would push the customer past their limit, Faida
blocks it and says *"Credit limit exceeded"*. A manager can raise the limit on the
customer's record.

**On M-Pesa STK**, the screen shows *"Waiting for payment"* while the customer
approves on their phone. Do not hand over goods until it confirms. If they never
respond it times out and you can retry or switch method.

## 7. Receipts

After a sale you can:

- **Print** to a thermal receipt printer. Choose the printer once in **Settings, Printers,
  Receipt printing (this device)** and every sale prints to it without asking. See
  *Setting up your receipt printer* below
- **Send by SMS or WhatsApp** — automatic when the sale has a customer with a phone
  number
- **Email** it
- Show a **digital receipt** on screen for the customer to photograph
- Print an **A4 invoice** instead of a receipt, for business customers

### Setting up your receipt printer

Each till or phone keeps its own printer choice. New devices start on **System printer**, which
works the way printing works in any other program: the print window lists every printer installed
on that computer, including thermal printers, and you pick one. Nothing has to be paired.

1. Install the thermal printer on the computer as usual (its driver and a test page).
2. Open **Settings, Printers**. Under **Receipt printing (this device)** keep **System printer**.
3. Choose the **Paper size**: 58 mm for small rolls, 80 mm for standard thermal printers.
4. Press **Print test receipt**, pick your thermal printer in the print window, and check the slip.

In the **Faida POS desktop app** the first choice is **Installed printer, no print window**. Pick your
thermal printer from the list of printers installed on the computer, press **Print test receipt**, and every
sale then prints straight to it with no window. It needs a thermal receipt printer (it sends receipt
commands, so a laser or inkjet printer would print them as text).

In the browser, after a sale press **Print** and choose the printer in the window; the browser remembers your last
choice. To skip the window, make the thermal printer the computer's default printer, start Chrome or
Edge with the `--kiosk-printing` option, and switch on **Print automatically after each sale**.

#### Advanced: direct thermal printing

Under **Advanced** you can choose USB thermal, Bluetooth thermal, LAN thermal (through the server),
Star or Epson. These send the receipt straight to one device instead of using the installed-printer
list, so they ignore the computer's drivers. Use them for phones, or for printers with no driver.

- For USB or Bluetooth press **Pair** and pick the printer. On Windows a printer that already has
  its driver installed is usually not available for USB pairing; use the system printer instead.
- For a Star or Epson printer type its address and press **Save**.
- For a LAN printer, first add it below with connection type NETWORK and an address such as
  `192.168.1.50:9100`.
- Once a direct printer is chosen, **Print automatically after each sale** is switched on, and the
  Print and Reprint buttons go straight to it. Turn the switch off to print only on request.
- Choose **Ask each time** to see the picker every time.

USB and Bluetooth printing needs Chrome or Edge (on a computer or an Android phone); it does not
work in Safari on iPhone or iPad. In those browsers use the system printer, or a LAN, Star or Epson
printer.

You can customise the header, footer, logo and wording in **Settings → Receipt**.

## 8. Holding and recalling a sale

A customer forgot their wallet and is going to the car. Do not cancel the sale.

- **F5** or **Hold** parks the cart under a name or number.
- **F6** or **Recall** brings it back.

The till is free for the next customer in between. Held sales are not sales yet —
nothing has been recorded and no stock has moved.

## 9. Fixing mistakes: cart edit, void, refund

This is the section worth reading twice, because the three are genuinely different
and Faida treats them differently on purpose.

### Before payment — just edit the cart

Remove the line, change the quantity, start over. Nothing has happened yet: no
receipt, no stock movement, no record. **No manager, no reason, no audit trail.**

### After payment — void

The receipt exists, so undoing it is a formal act.

- Requires a **manager PIN** and a **written reason**
- Either **the whole sale** or **specific lines**
- Writes a permanent entry to the audit log that nobody can edit or delete
- **Puts the stock back**
- Sends a **void or amendment to KRA** through eTIMS

Use a void when the sale should never have happened — wrong item rung up, duplicate
charge, customer changed their mind at the counter.

- The **books are corrected too**: the sale's revenue, tax and payment are taken back
- A **credit sale** can be voided (what the customer owed is cancelled), unless part of it has been paid
- A **prescription** that was dispensed is returned by voiding its sale: stock comes back, the prescription is waiting
  again (or goes back to its previous fill), the insurer's claim is cancelled and the controlled-drug register gets a
  return line. To take back only some of the medicines, void just those lines (or part of a quantity): the patient keeps the
  rest and the insurer's claim comes down by its share. You can do this once per fill. Not possible once the insurer has paid that claim
- A **pump sale** is voided from the fuel screen's **Sales** list (managers): the litres go back into the tank and a
  fleet account is credited

### Later — refund / return

The customer comes back tomorrow with the goods. Use **Return** from the sale in the
sales list. Stock comes back in, the money goes out, and the return is linked to the
original sale.

> **Rule of thumb:** cart edit = nothing happened. Void = it happened and we are
> cancelling it. Return = it happened, it stood, and now goods are coming back.

## 10. Customers, credit and loyalty

Add a customer from the POS or from **Customers**. Useful fields: phone (drives SMS
and WhatsApp receipts), KRA PIN (needed on B2B invoices), and **credit limit**.

**Credit / account sales** — sell now, collect later. The customer's outstanding
balance shows on their record and in the **Credit Book** report. Record payments
against the account as they come in.

**Loyalty** — customers earn points on qualifying sales and redeem them as payment.
Set the earn and redeem rates in Settings.

**Gift cards** — sell them, check balances, redeem them at the till.

---

# Your kind of business

Faida runs one till that changes shape depending on your business type. Set it in
**Settings → Business type**.

## 11. Restaurant, café and bar

**Tables.** The floor plan shows your tables grouped by area. Tap a table to start or
continue its order. Tables can be **merged**, **transferred** to another table, and
**split** for separate bills.

**The order is not a sale.** Food goes to the kitchen long before anyone pays. Faida
keeps *orders* (what the kitchen is making) separate from *sales* (money that
changed hands). The order becomes a sale when the bill is settled.

**Taking payment on a phone.** On the table's order screen, tap **Bill** when the guest
asks for it, then **Take payment** (it appears once the bill is requested, and you can
also choose it straight from the "Bill requested" message). The checkout shows exactly
what is on the table, with no cart involved, and the table is freed when payment goes
through. If someone adds or voids a line on another screen while you are at the
checkout, the payment is refused with a message and you reopen the order to see the new
total, so nobody is charged an amount they were not shown. A table cannot be paid
while offline, because the order has to be closed on the server; the phone tells you the
table is still open instead of queuing the payment. As on the web till, no service
charge is added to a table bill, because dine-in prices already include it.

**The bill is the order.** When you take payment for a table, the sale is built from
what is on the order, at the prices it was taken at, with any priced extras included. It
does not depend on what the till screen sends. The payments must cover the total, and
the order is closed in the same step, so two tills cannot both take payment for one
table. A sale on a normal (paid-up) sale needs payments that cover the total; credit and
layaway sales are the exceptions.

**Selling out of stock.** An item marked sold out can still be ordered and sold, so a
forgotten stock receipt never stops service. Stock simply goes negative (sell 5 with
none in hand and it shows -5), and when you later receive stock it is added on top, so
the 5 you already sold come off automatically. To make an item *refuse* to sell at zero,
set its stock policy to Block.

**Kitchen tickets (KOT).** When you send an order, it is split into one ticket per
station — **Kitchen**, **Bar** or **Dessert** — so the bartender sees only the drinks
and the cook only the food. Each ticket has a number that restarts at #1 every day.
Set where an item is made on the item itself (**Inventory, Edit item, Made at**).
Leave it on *Automatic* and Faida guesses from the name and category, with the
kitchen as the fallback. Each station's tickets print on the printer set up for it in
Settings, Printers.

Send an order twice by mistake and nothing is cooked twice: lines already sent are
refused, and the waiter's screen says so.

**Kitchen display (KDS).** Instead of paper, the kitchen can run a screen showing
live tickets, on a wall screen, a tablet or a phone. Tickets arrive the moment they
are sent (with an optional chime), and turn amber then red as they wait. Pick
**Kitchen**, **Bar** or **Dessert** along the top to dedicate a screen to one station;
the choice is remembered on that device. Each ticket shows the table or room, the
waiter, modifiers, special instructions in a highlighted box, allergens, and a
**+ Add-on** tag when it adds to an order already being made. Kitchen staff tap
**Start**, then **Ready**; a drink goes straight to **Ready**. A ticket marked ready by
mistake can be **recalled**. Waiters (and managers) mark it **Served** from the order
panel or the display.

On a shared kitchen screen, switch on **Shared**. To start a ticket the cook taps
**their name**, then types their PIN. The ticket is then recorded against that cook, not
the screen's login.

**Voids and cancellations reach the kitchen.** Cancelling an order cancels its open
tickets. Removing a line the kitchen already has needs a **manager** and a reason; the
line comes off its ticket and every kitchen screen shows a red warning ("Stop making
it") with a chime, instead of the cooks finding out when the guest asks.

**Kitchen on a phone.** The mobile app has the same kitchen screen: the same live
tickets, station tabs, and Start / Ready / Recall buttons. A kitchen account opens
straight onto it and signs out from its header. Waiters mark tickets served from the
table's order screen.

**A restaurant or hotel inside another business.** Your POS mode is your main till. A
fuel station, shop or supermarket that also runs a kitchen can switch on **Restaurant &
kitchen** under Settings, *Also run*, which adds Tables, bar tabs, happy hours, the
waitlist and the Kitchen Display without changing the main till. **Hotel & rooms** does
the same for rooms, bookings, guest folios and housekeeping. Both are off by default,
and these features are refused by the server (not just hidden) for a business that has
not enabled them. A Hospitality till already includes both; Fast Food and Bar include
the restaurant.

**Modifiers.** "No onions", "extra shot", "well done" — and they can carry a price.

**Bar tabs.** Open a tab against a customer or a name, keep adding to it, settle at
the end of the night.

**Service charge.** Applied automatically at your configured rate.

**Reservations and the waitlist.** Take bookings ahead of time, and manage walk-ins
waiting for a table.

## 12. Hotel

- **Rooms** — availability, rates, status
- **Bookings** — check guests in and out
- **Deposits** — take a deposit when booking, or later with **Take a Deposit**, in cash, M-Pesa, card or bank. It
  is used against the bill at check-out; if it is more than the bill, the rest is paid back the way it came in. Cancel a
  reservation and the deposit is paid back, or a manager can keep it
- **Guest folio** — everything the guest charges during their stay, on one bill
- **Check-out invoice** — when your business records hotel takings as sales (ask the owner to check), check-out
  produces a proper tax invoice with a receipt number and goes to KRA. For a company guest, enter their KRA PIN when
  booking so it prints on the invoice
- **Hotel levies** — if your hotel charges a tourism or catering levy, the owner or manager adds it once in
  **Settings > Hotel levies** and it is added to every guest bill. Leave it empty if you charge none
- **Room charge** — the restaurant and bar can bill straight to a room. The sale appears on the guest's folio as a "charged sale" and is paid at check-out with the rest of the bill; it is not billed a second time on the stay's invoice. If it was a mistake, void the sale while the guest is still in the room
- **Housekeeping** — a live queue of rooms needing service
- **Channel manager** — keeps availability in step with booking sites

## 13. Pharmacy

- **Prescriptions** captured at the till against the patient
- **Dispensing and payment** — when your business records pharmacy takings as sales (ask the owner to check), pressing
  **Dispense** (or **Process Refill**) shows the price of the medicines, takes the patient's payment and prints a receipt that
  goes to KRA. Every medicine on the prescription must be linked to a catalogue item with a price, otherwise the screen
  names the one to fix. Set each medicine's tax class in the catalogue (many are exempt) so the receipt shows the right VAT
- **Insurance** — tick *Insurance covers part of this*, choose the insurer, enter the member number and the percentage the
  patient pays. The patient pays only their share; the rest is recorded as a claim to that insurer. When the insurer pays,
  open **Claims**, mark it **Approved** then **Paid** and enter the amount received: any shortfall is written off and the
  books are updated
- **Batch and expiry tracking** enforced — see [section 16](#16-expiry-dates-and-batches)
- Controlled items flagged and recorded

## 14. Fuel station, cyber café and other trades

- **Fuel station** — authorise a pump, sell the fuel it dispensed, close the pump. A manager can void a sale from the Sales list
- **Cyber café** — start and stop timed sessions per station, bill the time. Stations
  are counter-managed on the web app. When your business records cyber takings as sales (ask the owner to check), ending a
  session gives a proper receipt that goes to KRA, with the time (or package), printing and other services on separate
  lines. **Credit is only for registered customers**: pick the customer when you end the session. For a company customer
  enter their KRA PIN. To undo an ended session, void its sale from the sales list
- **Salon / clinic** — an appointment diary with bookings against staff. Choose the **service** when booking so it is priced.
  When your business records these takings as sales (ask the owner to check): a **deposit** is recorded as money taken (say how it
  was paid; **Deposit** adds more); **Complete** takes the payment (the deposit is used first, anything left over is paid back) and
  gives a receipt that goes to KRA; **Cancel** or **No-Show** pays the deposit back, or a manager can keep it. Only a manager can
  change a service's price. To undo a completed appointment, void its sale from the sales list
- **Supermarket** — a denser, faster scan-first layout built for queues

---

# Stock and suppliers

## 15. Stock, receiving and counting

**Stock is never simply typed in.** Every change is a recorded movement with a
reason: a sale, a return, a delivery received, a transfer, a count adjustment, a
write-off. That is why you can always answer *"where did those twelve go?"*.

**Adding items** — one at a time in **Inventory**, or in bulk by **CSV import**.
Items can have **variants** (size, colour, weight) and be sold as **bundles** or made
from a **recipe**.

**Receiving stock** — raise a purchase order, then receive against it (a GRN). What
you actually received is recorded, so short deliveries show up in the **GRN
Discrepancy** report rather than quietly vanishing.

**Stocktake** — open a stocktake session, count, and enter counts. Faida shows
counted against expected, you review the variance, then commit. The adjustment is
recorded with your name on it.

**Transfers** — move stock between stores. The sending store loses it and the
receiving store gains it, with the movement recorded both ends.

**Damaged goods** — write off breakages and spoilage with a reason, so shrinkage is
measured rather than guessed.

**Barcode labels** — generate and print labels for items and shelf edges.

## 16. Expiry dates and batches

If you sell food, medicine or anything else that goes off, turn on batch tracking for
those items.

- Stock is received in **batches**, each with its own expiry date
- Faida sells **oldest-first (FEFO)** automatically — first expired, first out
- You get **expiry alerts** ahead of time so stock can be moved or discounted
- If someone tries to sell expired stock, the till **stops them** and names the batch
- A **recall** can pull a whole batch, and tell you which customers bought from it

**Serial numbers** are the same idea for individually-tracked goods — electronics,
appliances — where you need to know exactly which unit went to which customer.

## 17. Suppliers and purchase orders

- **Suppliers** — contacts, terms, and what you owe them
- **Purchase orders** — raise, send, and track them
- **Goods received (GRN)** — record what actually arrived
- **RFQ** — ask several suppliers to quote, compare, and pick. Suppliers respond
  through a link you send them; they do not need a login
- **Supplier ageing** — what you owe, by how overdue it is

---

# Money

## 18. Cash drawer, shifts and closing the day

**Opening.** Declare your opening float when you start.

**During the shift.** Record cash paid in and out (a supplier paid in cash, a staff
advance) so the drawer stays explainable.

**X-report.** A mid-shift snapshot. Read it any time; it changes nothing.

**Z-report.** The end-of-day close. It totals the day, closes it off, and is the
number your books are built on.

**Counting down.** Enter what is physically in the drawer. Faida shows the
difference against what it expected — over, under, or exact. Differences are
recorded, which is the point.

## 19. Expenses and the books

- **Expenses** — record what the business spends, by category, with approval where
  you require it
- **Cheques** — track cheques in and out and when they clear
- **Ledger** — the underlying accounts
- **Reconciliation** — match your records against the bank and M-Pesa statements
- **Budgets** — set them and track against them

## 20. Reports worth knowing

There are 44 report tabs across six groups. These are the ones most businesses live
on:

| Report | Answers |
|---|---|
| **X / Z Report** | What happened today, and closing it off |
| **Sales** | What sold, when, by whom |
| **Gross Margin** | What you actually made, not just turnover |
| **P & L** | Profit and loss for the period |
| **Dead Stock** | What has not moved and is tying up cash |
| **Shrinkage** | What went missing |
| **Credit Book** | Who owes you |
| **Supplier Ageing** | Who you owe |
| **Sales by Staff** | Who is selling |
| **Item Summary** | Per-item performance |
| **Basket Analysis** | What gets bought together |
| **Customer LTV** | What a customer is worth over time |
| **VAT Return** | Your VAT position |
| **Audit Log** | Who did what, tamper-evident |

Every tab exports to **CSV**. VAT reports, receipts, purchase orders and B2B invoices
also export to **PDF**. Reports can be **scheduled** to email themselves to you.

**Forecasting** predicts demand from your sales history so you order better.

## 21. KRA, VAT and eTIMS

Faida is built for Kenyan tax compliance.

- **VAT is inclusive.** The price on the shelf is what the customer pays; Faida
  extracts the VAT within it. It does not add VAT on top at the till.
- **TOT** (turnover tax) is supported for businesses not on VAT.
- **eTIMS** — sales are submitted to KRA automatically after checkout. Voids and
  amendments go too.
- **Offline** — if KRA is unreachable, submissions queue and go when the connection
  returns. You keep trading.
- **KRA export** — produce the files KRA asks for.
- **Audit log** — tamper-evident, and exportable.

Your KRA credentials are entered once in **Settings → eTIMS** and stored encrypted.
Start in **test** mode; switch to **production** once KRA approves you.

---

# Beyond the counter

## 22. Selling online and to customers' phones

Each of these is a link you can print, share or turn into a QR code. **None of them
require the customer to install anything.**

| What | Link | For |
|---|---|---|
| **Web storefront** | `/shop/<your business>` | Browsing and ordering online |
| **QR menu** | `/menu/<your business>` | Table menus in a restaurant |
| **Older ordering link** | `/order/<your business>` | Sends the customer to the web storefront, so links you already printed keep working |
| **Payment link** | `/pay/<code>` | Send someone a link to pay you |
| **Order tracking** | `/track/<order number>` | Customer follows their delivery |
| **Customer portal** | `/portal` | Customers sign in with a phone code to see orders, points and account |

Orders placed through these arrive in **Online Orders** for you to accept and fulfil.

## 23. Delivery

- Take delivery orders from the shop, the storefront or the phone apps
- Assign a **driver**
- The customer gets a **tracking link** showing the driver's live position
- Drivers confirm delivery on their phone, with proof
- **Delivery routes** plan a driver's whole run rather than one drop at a time

## 24. Field sales and B2B invoicing

For businesses that sell out of a van or through agents on the road.

**The agent, on their phone:**
- Sees a **call plan** — which shops to visit, prioritised by who owes the most
- Registers new shops, with GPS
- Takes orders against a shop's credit limit
- Collects payments and records them
- Works with no signal — everything queues and syncs later

**The office, on the web:**
- Orders arrive on the **Field Orders** board
- **Generate Invoice** for the full order, or **Partial Invoice** for only what was
  actually delivered
- **Invoice All Delivered** does the whole day's delivered orders at once
- **Record Payment** — cash, M-Pesa, bank or cheque
- The customer is notified by WhatsApp or SMS automatically
- **B2B Invoice PDF** with your letterhead, itemised lines, payment terms and bank
  details
- **Invoice Ageing** buckets what is outstanding: 0–30, 31–60, 61–90, 90+ days

You can also save a POS cart as a **proforma invoice** rather than a sale — useful
when a business customer needs a quote before they will pay.

## 25. Staff, leave and payroll

- **Staff records**, roles and pay rates
- **Commission** — by sales value, transaction count, or gross margin
- **Leave** with running balances
- **Shift scheduling**, plus sales per shift
- **Attendance**
- **Disciplinary records** and **salary advances**
- **Payroll** — Kenyan PAYE, **SHIF**, NSSF and the Affordable Housing Levy
- **Payslips** generated per employee

> Payroll follows the **SHIF** rules that replaced NHIF. Older payslips keep the
> figures they were generated with.

## 26. The mobile apps

Four separate Android apps, each for one job.

| App | Who | What it does |
|---|---|---|
| **Faida POS** | Cashiers, managers | A full till in your hand, plus a Manage section for stock, counts, transfers, approvals and day-close |
| **Faida Order** | Your customers | Browse the menu, order, pay by M-Pesa, book a table, check points |
| **Faida Driver** | Drivers | Assigned drops, navigation hand-off, delivery confirmation, earnings |
| **Faida Agent** | Field sales agents | Call plan, orders, collections, new shop registration |

All four work offline and sync when signal returns.

**Pointing an app at your server:** on the login screen, set the server address. Your
installer will give you this. It defaults to the cloud service.

**Receipt printing on mobile** is off by default, because most mobile selling has no
printer and sends the receipt by SMS or WhatsApp instead. Turn it on in the app's
Settings, then choose how the phone reaches the printer:

- **Bluetooth** for small receipt printers. Pair the printer in the phone's Bluetooth
  settings first, then choose it in the app. Android only.
- **Wi-Fi / LAN** for counter printers: type the printer's address, for example
  `192.168.1.50`. The phone must be on the same Wi-Fi.
- **Print dialog** to use the phone's own print system or save a PDF.

Also choose the **paper size**: 58 mm for the small Bluetooth printers, 80 mm for
standard thermal printers. The receipt is laid out to fit the paper you choose. With
Bluetooth or Wi-Fi you can switch on **Print automatically** so each sale prints the
moment it completes. Use **Print test receipt** to check the setup.

---

# Running the shop

## 27. Settings you will actually use

| Setting | Why you would touch it |
|---|---|
| **Business type** | Changes the whole till — restaurant, retail, fuel, pharmacy… |
| **Receipt** | Logo, header, footer wording |
| **Tax** | VAT or TOT, and your rate |
| **eTIMS** | KRA credentials, test or production |
| **Payments** | M-Pesa, Paystack, bank details |
| **Users** | Add staff, set roles and PINs |
| **Stores** | Multiple branches |
| **Printers** | The receipt printer for this device, and which printer gets food and which gets drinks |
| **Loyalty** | Earn and redeem rates |
| **Security** | Two-factor, password rules, lockouts |

## 28. Your plan and what it unlocks

| Plan | KES/month | Stores | Users |
|---|---:|---:|---:|
| **Free** | 0 | 1 | 1 |
| **Starter** | 999 | 1 | 8 |
| **Growth** | 2,499 | 2 | 15 |
| **Pro** | 4,999 | 5 | 30 |
| **Enterprise** | 14,999 | Unlimited | Unlimited |

Roughly what each adds:

- **Free** — the till, stock, customers, sales list, cash drawer
- **Starter** — reports, batch tracking, receipt customisation
- **Growth** — restaurant and bar, kitchen screen, pharmacy, delivery, suppliers,
  promotions, gift cards, stocktake
- **Pro** — multi-store transfers, owner dashboard, HR and payroll, ledger,
  reconciliation, API keys, scheduled reports
- **Enterprise** — field sales, delivery routes, hotel, channel manager, forecasting,
  franchise

**During your trial you get everything**, so you can see what you actually need. When
the trial ends, your plan's features apply.

If a menu item is missing, it is on a higher plan. Clicking it explains which.

### Referring other businesses

If you recommend Faida to another business and they sign up, you earn a reward
through the **referral programme**. Your referral link is in Settings.

There is also a separate **affiliate programme** for people who promote Faida
commercially and earn ongoing commission — you do not need to be a Faida customer to
join it. Affiliates get their own sign-in at `/affiliate`, which is separate from your
POS login and gives no access to any business's data.

## 29. Working offline

Faida is built to keep selling when the internet does not.

**What still works offline:** taking sales, printing receipts, looking up cached
items and customers.

**What happens to those sales:** they are saved on the device and sent up when the
connection returns. Each one carries a unique ID, so a sale that was actually
received before the connection dropped is **never charged twice** on retry.

**What you will see:** a sync indicator showing how many are waiting.

**What does not work offline:** anything that needs a live third party — M-Pesa STK,
card payments, and live KRA submission. eTIMS submissions queue and go later.

> **On the mobile cashier app**, the offline queue is flushed from the **Sync** button
> in Settings. If you have been selling offline, open Settings and tap Sync once you
> are back on signal.

## 30. When something goes wrong

**"No sales found" but there are sales**
Your session expired. Sign in again.

**A menu item disappeared**
Either your role does not include it, or it is on a higher plan.

**M-Pesa says "waiting for payment" forever**
The customer never approved it on their phone. Cancel and retry, or take another
payment method. Never hand over goods on an unconfirmed STK.

**"Credit limit exceeded"**
The sale would put the customer past their limit. A manager can raise it on the
customer's record, or take part payment now.

**The receipt printer does nothing**
Check power and cable first. Then open **Settings, Printers** and press **Print test
receipt**; the message beside the button says what is wrong. A USB or Bluetooth printer
must be paired on this device (press **Pair**), and a browser can forget a Bluetooth
pairing after a restart. For kitchen tickets, check the category is routed to that
printer. If the printer cannot be reached during a sale, the print choices open so the
receipt is not lost.

**Stock looks wrong**
Open the item's movement history. Every change is listed with a reason and a name.

**Expired-stock warning I need to get past**
That is deliberate. Check the batch. If it genuinely is fine, a manager can resolve
it — but the warning is there because selling expired goods is a real liability.

**Sales are not reaching KRA**
Check the eTIMS status in Settings. If the queue is backing up, your credentials or
connection need attention — tell whoever runs your server.

**The app is slow or behaving oddly**
Refresh the page. If it persists on one device only, that device is the problem, not
the system.

## 31. Quick reference card

**Keyboard**

| Key | Action |
|---|---|
| `/` | Search |
| `F1` | Cash sale |
| `F5` | Hold sale |
| `F6` | Recall held sale |

**Quick entry**

| Type | Result |
|---|---|
| `3x500` | Three of the item priced KES 500 |
| Scan a scale label | Weighed item, tare deducted |

**The three ways to undo**

| Situation | Do this | Needs |
|---|---|---|
| Not paid yet | Edit the cart | Nothing |
| Paid, cancel it | **Void** | Manager PIN + reason |
| Paid, goods coming back | **Return** | Per your settings |

**Daily rhythm**

1. Sign in, declare your float
2. Sell
3. X-report to check mid-shift
4. Count the drawer
5. **Z-report** to close the day

## 32. Glossary

| Term | Meaning |
|---|---|
| **Batch / lot** | A delivery of stock with its own expiry date |
| **eTIMS** | KRA's electronic tax invoice system |
| **FEFO** | First Expired, First Out — oldest stock sells first |
| **Folio** | A hotel guest's running bill |
| **GRN** | Goods Received Note — what actually arrived |
| **KOT** | Kitchen Order Ticket |
| **KDS** | Kitchen Display Screen |
| **Layaway** | Customer pays in instalments; goods held until paid |
| **PAYE** | Kenyan income tax deducted from salaries |
| **Proforma** | A quote — looks like an invoice, is not a sale |
| **RFQ** | Request for Quotation — ask suppliers to bid |
| **SHIF** | Social Health Insurance Fund, replaced NHIF |
| **STK push** | The M-Pesa prompt that appears on a customer's phone |
| **Shrinkage** | Stock lost to theft, damage or error |
| **Tare** | The container's own weight, deducted from weighed goods |
| **TOT** | Turnover Tax, for businesses not registered for VAT |
| **VSCU** | The offline eTIMS queue that holds sales until KRA is reachable |
| **X / Z report** | Mid-shift snapshot / end-of-day close |

---

*Need the installation and server side instead? See the **Admin & Installation
Guide**.*

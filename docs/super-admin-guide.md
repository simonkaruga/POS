---
title: "Faida POS"
subtitle: "Super Admin Guide"
author: "Faida Systems"
audience: "Platform operators running Faida as a service"
---

# Super Admin Guide

**This console is for running the Faida platform itself — not for running a shop.**
Everything here acts across tenants. Your customers never see it.

Signed in as super admin, you can change any business's plan, read any business's
audit log, reset any user's password, and delete a tenant outright. Treat that
accordingly.

---

## Contents

1. [Signing in](#1-signing-in)
2. [Dashboard](#2-dashboard)
3. [Businesses](#3-businesses)
4. [Gifting a plan](#4-gifting-a-plan)
5. [Users](#5-users)
6. [Analytics](#6-analytics)
7. [License keys](#7-license-keys)
8. [Referrals](#8-referrals)
9. [Affiliates](#9-affiliates)
10. [Webhooks](#10-webhooks)
11. [Support tools](#11-support-tools)
12. [Platform settings](#12-platform-settings)
13. [Audit and accountability](#13-audit-and-accountability)
14. [Health and incidents](#14-health-and-incidents)

---

## 1. Signing in

The console lives on its own host (port **3012** in development) and has a separate
login from the POS: `POST /api/v1/super-admin/login`.

There is **no super-admin row in the seed**. The account comes from environment
variables on the API:

- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`
- `SUPER_ADMIN_SECRET`

Your token lives in `sessionStorage`, so **closing the tab signs you out**. That is
deliberate — this console should not stay open on an unattended machine.

The API must have `ADMIN_URL` set to this console's origin, or CORS denies every
request silently.

## 2. Dashboard

Platform totals at a glance: businesses, revenue, signups, activity.

The sidebar carries a live status dot derived from real health data — queue depths
for email, webhooks and eTIMS, plus the eTIMS failure rate:

| Status | Means |
|---|---|
| **Operational** | Queues clear, no eTIMS failures |
| **Degraded** | Any queue above 10, or any eTIMS failure |
| **Incident** | Any queue above 50, or eTIMS failures above 20% |

The bell shows a platform alert feed. Critical alerts are flagged red, and alerts
tied to a specific business link straight to it.

Health and alerts refresh every 30 seconds.

## 3. Businesses

The tenant list — every business on the platform, its plan, status and trial state.

What you can do to a business:

| Action | Notes |
|---|---|
| **Change subscription** | Move a tenant between tiers |
| **Bulk update subscriptions** | Apply a change across many tenants at once |
| **Gift a plan** | Grant a tier without recording revenue — see below |
| **Cancel** | End the subscription |
| **Delete** | Removes the tenant. Irreversible |
| **Impersonate** | Sign in as that business to reproduce a problem |
| **View data** | Inspect the tenant's records |
| **Force update** | Push a client update to that tenant |
| **Audit log** | Everything that happened inside that business |

**On impersonation:** it exists so you can reproduce what a customer is reporting.
You are acting as them, with their access. It is recorded. Use it to diagnose, not to
do their data entry for them.

**On deletion:** deleting a business is not a soft delete you can undo from the UI.
Confirm you have the right tenant, and prefer **Cancel** when the customer might come
back.

## 4. Gifting a plan

Use this for partner accounts, internal use, pilots and goodwill — anywhere a tenant
should have a paid tier without paying.

Open the business, choose **Gift a plan**, then set:

- **Plan** — which tier to grant (defaults to Enterprise)
- **Reason** — why. Defaults to "Complimentary account"; replace it with something
  that will still make sense in a year, e.g. *"Partner account — pilot through Q4"*

The account is marked **comped**. That is the important part: **gifted accounts are
excluded from revenue**, so they do not inflate MRR or distort your analytics. The
modal states this on screen before you confirm.

Escape closes the dialog, Enter confirms.

> This replaced an older flow built on browser `prompt()` boxes, which could not show
> the tier, the price being waived, and the revenue exclusion at the same time.

## 5. Users

Cross-tenant user administration:

- **List all users** across the platform, or the users of one business
- **Reset a password**
- **Unlock** an account locked out by failed sign-ins
- **Update** a user
- **Delete** a user

Password reset and unlock are the two you will use daily — they are the most common
support request and the safest to action.

## 6. Analytics

Growth, churn and plan mix across the platform. Comped accounts are excluded from
revenue figures, so the numbers reflect actual money.

## 7. License keys

For the offline (desktop) edition. A key is a plain code (`KPS-` and three groups of
characters). **It is not what protects the licence**: the customer enters it once, in
the app under *Licence*, and the Faida server answers with a signed licence that is
tied to that computer. The app checks the signature offline; nothing in the app can
make one.

- **Issue** a key (plan and, except Lifetime, a number of days)
- **Computer** column — the computer the key was activated on, and when it last
  checked in. A key belongs to **one** server computer. Till computers that connect to
  it over the shop network need no key of their own.
- **Release** — frees the key from its computer so the customer can activate it on a
  new one (a replaced PC). The old computer keeps working until its current licence
  period (up to 30 days) ends, then drops to Free.
- **Revoke** a key — the computer stops being renewed; after its remaining period plus a
  14-day grace it falls back to the Free plan. Data stays open and backups never stop.
- **Resend** a key to the customer
- **Regenerate** a key

**How renewal works.** Whenever the customer's computer is online it renews quietly
(about once a day). Each renewal is good for 30 days, never beyond the licence's own end
date. If it cannot reach the server, the owner is warned during the last 7 days, then
gets 14 days of grace, then the shop is on the Free plan — the same result as a lapsed
cloud subscription.

**One-time setup.** The signing key pair is made once with
`node apps/api/scripts/generate-license-keys.mjs --private-out <file> --public-out <file>`:

1. Put the private key's contents in the cloud server's environment as
   `LICENSE_SIGNING_PRIVATE_KEY`, keep a second safe copy, then delete the file. Whoever
   holds it can issue licences. It must never be committed or sent in chat.
2. Put the public key in the GitHub Actions *variable* `LICENSE_PUBLIC_KEY`. The Windows
   installer build fails without it, so an installer that cannot verify licences is never
   made by accident.
3. Apply database migration `20261108000000_license_activation` to the cloud database
   **before** deploying this version.

Losing the private key means no new licences for installed apps; replacing the pair means
every installed app must be updated.

## 8. Referrals

The customer-to-customer referral programme: existing users bring in new businesses
and earn a reward. Review referrals and their payouts here.

Distinct from affiliates — see below.

## 9. Affiliates

External partners who promote Faida and earn **recurring commission**. Unlike
referrals, affiliates are not necessarily customers.

- Review and **approve or reject** applications
- Set the **commission percentage** per affiliate
- **Record a payout**

Affiliates sign in to their own portal (`/affiliate` on the web app) with a separate
token audience — an affiliate login is not a POS login and grants no tenant access.

These endpoints live outside the super-admin controller, under `/api/v1/affiliate/admin/*`.

## 10. Webhooks

Platform webhook endpoints and their delivery log. Toggle an endpoint on or off.
Payloads are HMAC-signed so receivers can verify them.

If the webhook queue depth is climbing on the dashboard, this is where you look.

## 11. Support tools

Diagnostics for handling a customer report: inspect a business's data, read its audit
log, and trigger a client force-update.

The usual sequence for "it is broken for this customer":

1. Check the alert feed and health for anything platform-wide
2. Open the business and read its audit log
3. Check `/api/v1/health/config` on the API for a blank credential — a missing key
   disables its feature silently rather than erroring
4. Impersonate only if you still cannot see it

## 12. Platform settings

Global configuration, plus an **IP whitelist** (add and remove entries) for
restricting access.

## 13. Audit and accountability

Two separate logs, and the distinction matters:

- **Business audit log** — what happened inside one tenant
- **Super-admin audit log** — what *you and other operators* did across tenants

Both are tamper-evident. Every consequential action in this console is recorded:
plan changes, gifts, impersonations, password resets, deletions.

## 14. Health and incidents

The console surfaces live queue depths (email, webhooks, eTIMS) and the eTIMS failure
rate.

What backing queues usually mean:

| Symptom | Usual cause |
|---|---|
| **Email queue climbing** | Resend key missing, invalid, or rate-limited |
| **Webhook queue climbing** | A customer endpoint is down and deliveries are retrying |
| **eTIMS queue climbing** | KRA unreachable, or a tenant's credentials expired |
| **eTIMS failure rate above 20%** | Treat as an incident — sales are not reaching KRA |

Redis backs these queues. **If `REDIS_HOST` is unset, jobs run synchronously with no
retry** — queue depths will read zero because there is no queue, not because
everything is healthy.

---

*Server installation and maintenance is in the **Admin & Installation Guide**.
Day-to-day POS operation is in the **User Guide**.*

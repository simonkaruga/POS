/**
 * Faida POS — Load & Stress Test
 * Run: node load-test.js [--users 1000] [--url http://localhost:3010/api/v1]
 *
 * Simulates realistic POS workloads: auth, item listing, checkout, reports.
 * No external dependencies — pure Node.js fetch.
 */

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3010/api/v1';

const CONCURRENT_USERS = parseInt(
  process.argv.includes('--users') ? process.argv[process.argv.indexOf('--users') + 1] : '50'
);

const BUSINESS_ID = 'biz-001';
const STORE_ID = 'store-001';

// ─── Stats collector ────────────────────────────────────────────────────────

const stats = {
  requests: 0,
  success: 0,
  errors: 0,
  latencies: [],
  errorDetails: {},
  startTime: null,
};

function recordResult(endpoint, durationMs, ok, errorMsg) {
  stats.requests++;
  stats.latencies.push(durationMs);
  if (ok) {
    stats.success++;
  } else {
    stats.errors++;
    const key = `${endpoint}: ${errorMsg?.slice(0, 60) ?? 'unknown'}`;
    stats.errorDetails[key] = (stats.errorDetails[key] ?? 0) + 1;
  }
}

async function timedFetch(endpoint, options = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(10000),
    });
    const duration = Date.now() - t0;
    const ok = res.status < 500;
    const body = await res.json().catch(() => ({}));
    recordResult(endpoint, duration, ok, ok ? null : JSON.stringify(body).slice(0, 80));
    return { ok, status: res.status, body, duration };
  } catch (err) {
    const duration = Date.now() - t0;
    recordResult(endpoint, duration, false, err.message);
    return { ok: false, status: 0, body: null, duration, error: err.message };
  }
}

// ─── Workload scenarios ──────────────────────────────────────────────────────

async function scenarioPINLogin(pin = '0000') {
  return timedFetch('/auth/login/pin', {
    method: 'POST',
    body: JSON.stringify({ pin, businessId: BUSINESS_ID }),
  });
}

async function scenarioListItems(token) {
  return timedFetch(`/items?businessId=${BUSINESS_ID}&storeId=${STORE_ID}&activeOnly=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function scenarioCheckout(token, itemId) {
  return timedFetch('/sales', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      businessId: BUSINESS_ID,
      storeId: STORE_ID,
      cashierId: 'user-cashier-001',
      type: 'NORMAL',
      priceLevel: 'RETAIL',
      serviceChargeCents: 0,
      items: [{ itemId: itemId ?? 'item-001', quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 50000 }],
    }),
  });
}

async function scenarioGetSales(token) {
  return timedFetch(`/sales?businessId=${BUSINESS_ID}&storeId=${STORE_ID}&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function scenarioXReport(token) {
  return timedFetch(`/reports/x-report?businessId=${BUSINESS_ID}&storeId=${STORE_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function scenarioGetCustomers(token) {
  return timedFetch(`/customers?businessId=${BUSINESS_ID}&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Single virtual user session ────────────────────────────────────────────

async function runUserSession(userId) {
  // Step 1: Login
  const loginRes = await scenarioPINLogin('0000');
  const token = loginRes.body?.access_token;
  if (!token) return; // auth failed, session ends

  // Stagger requests to avoid thundering herd
  await sleep(Math.random() * 200);

  // Step 2: Browse items (every user does this)
  await scenarioListItems(token);

  // Step 3: 70% of users complete a sale
  if (Math.random() < 0.7) {
    await scenarioCheckout(token, 'item-001');
  }

  // Step 4: 40% check sales history
  if (Math.random() < 0.4) {
    await scenarioGetSales(token);
  }

  // Step 5: 20% run X-report
  if (Math.random() < 0.2) {
    await scenarioXReport(token);
  }

  // Step 6: 30% look up customers
  if (Math.random() < 0.3) {
    await scenarioGetCustomers(token);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Percentile calculator ────────────────────────────────────────────────────

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function runLoadTest(concurrentUsers, label) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  SCENARIO: ${label}`);
  console.log(`  ${concurrentUsers} concurrent users → ${BASE_URL}`);
  console.log(`${'─'.repeat(60)}`);

  // Reset stats
  Object.assign(stats, {
    requests: 0, success: 0, errors: 0,
    latencies: [], errorDetails: {},
    startTime: Date.now(),
  });

  // Launch all users simultaneously (true concurrency simulation)
  const sessions = [];
  for (let i = 0; i < concurrentUsers; i++) {
    sessions.push(runUserSession(i));
  }
  await Promise.allSettled(sessions);

  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rps = (stats.requests / elapsed).toFixed(1);
  const errorRate = ((stats.errors / stats.requests) * 100).toFixed(1);

  console.log(`\n  Results:`);
  console.log(`  ✓ Total requests  : ${stats.requests}`);
  console.log(`  ✓ Successful      : ${stats.success} (${(100 - parseFloat(errorRate)).toFixed(1)}%)`);
  console.log(`  ✗ Errors          : ${stats.errors} (${errorRate}%)`);
  console.log(`  ⏱ Duration        : ${elapsed.toFixed(2)}s`);
  console.log(`  ⚡ Throughput      : ${rps} req/s`);
  console.log(`\n  Latency (ms):`);
  console.log(`    p50  : ${percentile(stats.latencies, 50)}`);
  console.log(`    p90  : ${percentile(stats.latencies, 90)}`);
  console.log(`    p95  : ${percentile(stats.latencies, 95)}`);
  console.log(`    p99  : ${percentile(stats.latencies, 99)}`);
  console.log(`    max  : ${Math.max(...stats.latencies)}`);

  if (Object.keys(stats.errorDetails).length > 0) {
    console.log(`\n  Top errors:`);
    Object.entries(stats.errorDetails)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([msg, count]) => console.log(`    [${count}x] ${msg}`));
  }

  return {
    users: concurrentUsers,
    requests: stats.requests,
    errorRate: parseFloat(errorRate),
    rps: parseFloat(rps),
    p50: percentile(stats.latencies, 50),
    p95: percentile(stats.latencies, 95),
    p99: percentile(stats.latencies, 99),
  };
}

// ─── Scalability projection (no live server needed) ─────────────────────────

function printScalabilityAnalysis() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SCALABILITY ANALYSIS — Faida POS ARCHITECTURE`);
  console.log(`${'═'.repeat(60)}`);

  const scenarios = [
    {
      users: 100,
      businesses: 10,
      concurrent: 10,
      note: 'Small pilot — 10 businesses, 10 simultaneous cashiers',
    },
    {
      users: 1_000,
      businesses: 100,
      concurrent: 100,
      note: 'Growth — 100 businesses, busy hour',
    },
    {
      users: 10_000,
      businesses: 500,
      concurrent: 500,
      note: 'Scale — 500 businesses, peak retail season',
    },
    {
      users: 1_000_000,
      businesses: 50_000,
      concurrent: 5_000,
      note: 'Enterprise SaaS — 50k businesses, national scale',
    },
  ];

  for (const s of scenarios) {
    // NestJS on a 4-core server can handle ~2,000 req/s for typical API calls
    // Checkout (writes) = ~200 req/s single instance due to DB transactions
    // Each user session = ~5 requests avg (login + items + checkout + 2 optional)
    const reqPerSecond = s.concurrent * 5 / 3; // 3s avg session
    const checkoutPerSecond = s.concurrent * 0.7 / 3;
    const dbConnNeeded = Math.min(s.concurrent, 100); // PG max_connections

    // Postgres single instance: ~500 TPS simple queries, ~100 TPS complex transactions
    const pgSaturated = checkoutPerSecond > 100;
    // Single NestJS: ~2000 req/s simple, ~200 req/s with DB
    const apiSaturated = reqPerSecond > 1500;

    console.log(`\n  ┌─ ${s.note}`);
    console.log(`  │  Users in system  : ${s.users.toLocaleString()}`);
    console.log(`  │  Concurrent       : ${s.concurrent.toLocaleString()}`);
    console.log(`  │  Est. req/s       : ${reqPerSecond.toFixed(0)}`);
    console.log(`  │  Checkouts/s      : ${checkoutPerSecond.toFixed(0)}`);
    console.log(`  │  DB connections   : ${dbConnNeeded}`);
    console.log(`  │  API bottleneck   : ${apiSaturated ? '⚠ SATURATED — need horizontal scaling' : '✓ Single instance OK'}`);
    console.log(`  │  DB bottleneck    : ${pgSaturated ? '⚠ SATURATED — need read replicas + connection pooling (PgBouncer)' : '✓ Single PostgreSQL OK'}`);
    console.log(`  └─ Verdict          : ${getVerdict(s.concurrent)}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  BOTTLENECKS (in order of impact):`);
  console.log(`  1. PostgreSQL transactions (checkout writes)`);
  console.log(`     → Fix: PgBouncer connection pooler + read replicas`);
  console.log(`  2. Single NestJS process (Node.js event loop)`);
  console.log(`     → Fix: PM2 cluster mode (4× CPU cores) or Kubernetes`);
  console.log(`  3. eTIMS submission (synchronous KRA HTTP call)`);
  console.log(`     → Already mitigated: BullMQ retry queue`);
  console.log(`  4. PDF report generation (CPU-intensive)`);
  console.log(`     → Fix: Dedicated worker process or Lambda`);
  console.log(`  5. M-Pesa STK push (300ms+ external latency)`);
  console.log(`     → Already mitigated: async + polling`);
  console.log(`\n  CURRENT ARCHITECTURE LIMITS:`);
  console.log(`  • Single server (4-core, 8GB RAM): ~200 concurrent users`);
  console.log(`  • With PM2 cluster (4 workers)   : ~800 concurrent users`);
  console.log(`  • With PgBouncer + PM2           : ~1,500 concurrent users`);
  console.log(`  • With horizontal scaling (K8s)  : ~50,000+ concurrent users`);
  console.log(`  • With Redis cluster + sharding  : ~1,000,000 users (data)`);
  console.log(`\n  OFFLINE-FIRST ADVANTAGE:`);
  console.log(`  Faida's offline-first design means a server outage does NOT`);
  console.log(`  stop sales — each device continues operating independently.`);
  console.log(`  This naturally distributes the load and reduces server pressure.`);
  console.log(`${'─'.repeat(60)}\n`);
}

function getVerdict(concurrent) {
  if (concurrent <= 10) return '✓ Runs fine on a KES 500/mo VPS';
  if (concurrent <= 100) return '✓ Runs fine on a single 2-core server';
  if (concurrent <= 500) return '⚠ Add PgBouncer + PM2 cluster mode';
  if (concurrent <= 5000) return '⚠ Kubernetes + read replicas required';
  return '✗ Requires full microservices + sharding architecture';
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Faida POS — SYSTEM TEST & SCALABILITY REPORT`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`${'═'.repeat(60)}`);

  // Check if server is up
  const health = await timedFetch('/auth/login/pin', {
    method: 'POST',
    body: JSON.stringify({ pin: '0000', businessId: BUSINESS_ID }),
  }).catch(() => null);

  const serverUp = health?.status > 0 && health?.status !== 0;

  if (!serverUp) {
    console.log(`\n  ⚠ API server not reachable at ${BASE_URL}`);
    console.log(`  Running scalability projection only (no live traffic).\n`);
    printScalabilityAnalysis();
    return;
  }

  console.log(`\n  ✓ Server reachable (${health.duration}ms response)\n`);

  // Run live load tests with increasing concurrency
  const results = [];
  for (const n of [1, 5, 10, 25, CONCURRENT_USERS]) {
    const r = await runLoadTest(n, `${n} concurrent users`);
    results.push(r);
    await sleep(500); // brief pause between runs
  }

  // Summary table
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  LIVE TEST SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Users | Req/s | Error% | p50ms | p95ms | p99ms`);
  console.log(`  ------|-------|--------|-------|-------|------`);
  for (const r of results) {
    console.log(
      `  ${String(r.users).padEnd(5)} | ${String(r.rps).padEnd(5)} | ${String(r.errorRate + '%').padEnd(6)} | ${String(r.p50).padEnd(5)} | ${String(r.p95).padEnd(5)} | ${r.p99}`
    );
  }

  printScalabilityAnalysis();
}

main().catch(console.error);

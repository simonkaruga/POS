import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, VersioningType } from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { configuredOrigins } from './common/app-urls';

// Initialize Sentry before anything else so all errors are captured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Warn loudly if DATABASE_URL is missing or looks relative — prevents silent auth failures
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl) {
    logger.error('DATABASE_URL is not set! Auth will fail. Set it in apps/api/.env');
  } else if (!dbUrl.startsWith('file:///') && !dbUrl.startsWith('postgresql') && !dbUrl.startsWith('mysql')) {
    logger.warn(`DATABASE_URL uses a relative path: "${dbUrl}" - login may fail if CWD differs. Use an absolute path (file:///home/...).`);
  } else {
    // Never log the raw URL: it carries the database password.
    logger.log(`DATABASE_URL: ${dbUrl.replace(/\/\/[^@/]*@/, '//***@')}`);
  }

  try {
    logger.log('Starting NestJS application...');
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
      rawBody: true, // required for Paystack webhook signature verification
    });

    // Behind Render (or any load balancer) the socket address is the proxy's, so
    // without this every caller shares one rate-limit bucket — a 5/min endpoint
    // becomes 5/min for the entire platform. `1` means "trust exactly one hop",
    // so Express reads the address our proxy appended rather than anything a
    // client put in X-Forwarded-For itself. Off by default locally, where there
    // is no proxy and trusting the header would let callers forge their own IP.
    const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '');
    if (trustProxy) {
      const hops = Number(trustProxy);
      app.getHttpAdapter().getInstance().set('trust proxy', Number.isFinite(hops) ? hops : trustProxy);
      logger.log(`Trusting ${trustProxy} proxy hop(s) for client IP resolution`);
    }

    // Enable Socket.IO adapter for WebSocket/LAN sync support
    app.useWebSocketAdapter(new IoAdapter(app));
    app.useGlobalFilters(new AllExceptionsFilter());

    // Security headers (HSTS, XSS protection, content-type sniff prevention, etc.)
    app.use(helmet({
      contentSecurityPolicy: false,       // disabled to allow Swagger UI
      crossOriginEmbedderPolicy: false,
      // Google OAuth popup needs to communicate back to the opener window.
      // same-origin COOP blocks window.closed polling used by @react-oauth/google.
      crossOriginOpenerPolicy: false,
    }));

    logger.log('Enabling CORS...');
    const allowedOrigins = [
      ...configuredOrigins(),
      ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',').map(o => o.trim()).filter(Boolean) : []),
    ];
    if (process.env.NODE_ENV === 'production' && (!process.env.FRONTEND_URL || !process.env.ADMIN_URL)) {
      logger.error('FRONTEND_URL and ADMIN_URL must be set in production: links in emails and payment callbacks are refused without them.');
    }
    logger.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
    app.enableCors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Render health checks)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // Allow any *.vercel.app preview deployment
        if (origin.endsWith('.vercel.app')) return callback(null, true);
        // Deny silently — using callback(new Error(...)) can interfere with
        // Express error handling before CORS headers are written to the response.
        callback(null, false);
      },
      credentials: true,
    });

    logger.log('Setting global prefix to /api...');
    app.setGlobalPrefix('api');

    logger.log('Enabling URI versioning (default v1)...');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

    // ─── Swagger / OpenAPI ─────────────────────────────────────────────────────
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Faida POS API')
      .setDescription('eTIMS-compliant POS API for Kenyan businesses')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    logger.log('Starting server on port 3010...');
    // Lightweight health check for Render (no auth required)
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.get('/api/v1/health', (_req: any, res: any) => res.json({ status: 'ok' }));

    // Config presence check — reports which env vars are SET (booleans only, never
    // values), so you can verify a deploy at a glance. Safe to expose: no secrets.
    const has = (k: string) => !!process.env[k]?.trim();
    httpAdapter.get('/api/v1/health/config', (_req: any, res: any) => res.json({
      env: process.env.NODE_ENV ?? 'development',
      database: has('DATABASE_URL'),
      jwtSecret: has('JWT_SECRET'),
      encryptionKey: has('ENCRYPTION_KEY') && process.env.ENCRYPTION_KEY?.length === 64,
      urls: { frontend: has('FRONTEND_URL'), admin: has('ADMIN_URL') },
      email: { resend: has('RESEND_API_KEY'), from: has('EMAIL_FROM') },
      payments: {
        paystackSecret: has('PAYSTACK_SECRET_KEY'),
        paystackWebhook: has('PAYSTACK_WEBHOOK_SECRET'),
        paystackPlans: has('PAYSTACK_STARTER_PLAN') && has('PAYSTACK_GROWTH_PLAN') && has('PAYSTACK_PRO_PLAN') && has('PAYSTACK_ENTERPRISE_PLAN'),
        mpesaEnv: process.env.MPESA_ENV ?? 'sandbox',
      },
      superAdmin: { email: has('SUPER_ADMIN_EMAIL'), password: has('SUPER_ADMIN_PASSWORD'), secret: has('SUPER_ADMIN_SECRET') },
      etimsEnv: process.env.ETIMS_ENV ?? 'test',
      redis: has('REDIS_HOST'),
    }));

    const port = process.env.PORT ?? 3010;
    // HOST narrows who can connect. Unset (the cloud, development) it listens on every interface as before; the offline
    // desktop edition sets 127.0.0.1 unless the owner chose to act as a server for other computers on the network.
    const host = process.env.HOST;
    if (host) await app.listen(port, host);
    else await app.listen(port);

    logger.log(`🚀 API running on port ${port}/api`);
    logger.log('📋 Health check: http://localhost:3010/api/auth/me');
    logger.log('📖 Swagger docs: http://localhost:3010/api/docs');
    logger.log('🔑 Super Admin: POST /api/v1/super-admin/login');

    // ── Keep-alive ping (free Render tier) ─────────────────────────────────
    // Render free services sleep after 15 min of inactivity.
    // Pinging own /health every 14 min keeps the service warm during business hours.
    if (process.env.KEEP_ALIVE === 'true' && process.env.RENDER_EXTERNAL_URL) {
      const pingUrl = `${process.env.RENDER_EXTERNAL_URL}/api/v1/health`;
      logger.log(`🏓 Keep-alive ping enabled → ${pingUrl}`);
      setInterval(async () => {
        try {
          await fetch(pingUrl);
        } catch {
          // ignore — if the server is down a restart will handle it
        }
      }, 14 * 60 * 1000); // every 14 minutes
    }
  } catch (error) {
    logger.error('Failed to start application:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    process.exit(1);
  }
}
bootstrap();

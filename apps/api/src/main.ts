import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ZodError, z } from 'zod';
import { httpContracts } from '@harbor/sdk';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { Consoles } from './console';
import { Auth } from './auth';
import { AppModule } from './module';
import { SystemMonitor } from './system-monitor';
import { ApiKeys, apiKeyCreateSchema, type KeyRequest } from './api-keys';
import { createCustomerInputSchema, orderInputSchema } from './platform';
import { apiScope, apiRouteCatalog } from './api-key-policy';
import { appUrl, encryptionKey } from './security';
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500,
      message = 'An unexpected error occurred';
    let details: unknown;
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message = typeof body === 'string' ? body : (body as any).message;
    } else if (error instanceof ZodError) {
      status = 400;
      message = 'Please check the supplied fields';
      details = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      status = error.code === 'P2025' ? 404 : ['P2002', 'P2003'].includes(error.code) ? 409 : 500;
      message =
        status === 404
          ? 'Record not found'
          : status === 409
            ? error.code === 'P2003'
              ? 'This record is still referenced or its related record is missing'
              : 'This record already exists'
            : 'Database operation failed';
    }
    if (status === 500)
      new Logger('HTTP').error(error instanceof Error ? error.message : 'Unknown error');
    res.status(status).json({ error: { message, code: status, details } });
  }
}
export async function createApp() {
  encryptionKey();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: '2mb' });
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use(helmet());
  app.use(cookieParser());
  app.use(app.get(SystemMonitor).middleware);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !req.path.startsWith('/api/remote') &&
      !req.path.startsWith('/api/v1/webhooks')
    ) {
      const origin = req.get('origin');
      if (
        (origin && origin !== appUrl()) ||
        req.get('sec-fetch-site') === 'cross-site' ||
        (req.cookies?.harbor_session && !origin)
      )
        return res.status(403).json({ error: { message: 'Request origin was rejected' } });
    }
    next();
  });
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({ error: { message: 'Too many requests. Try again shortly.' } }),
    }),
  );
  app.use(async (req: KeyRequest, res: Response, next: NextFunction) => {
    if (
      !req.path.startsWith('/api/v1/') ||
      !req.headers.authorization ||
      req.path.startsWith('/api/v1/node-setup/') ||
      req.path.startsWith('/api/v1/webhooks/')
    )
      return next();
    try {
      await app.get(ApiKeys).authenticate(req);
      next();
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse();
        const message = typeof body === 'string' ? body : (body as any).message;
        res.status(error.getStatus()).json({ error: { message, code: error.getStatus() } });
      } else next(error);
    }
  });
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60000,
      limit: 120,
      skip: (req) => !(req as KeyRequest).harborApiKey,
      keyGenerator: (req) => (req as KeyRequest).harborApiKey!.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      identifier: 'harbor-api-key',
      handler: (_req, res) =>
        res.status(429).json({
          error: {
            message: 'API key rate limit reached. Wait for Retry-After before retrying.',
            code: 429,
          },
        }),
    }),
  );
  app.use(
    '/api/v1/api-keys',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 30,
      skip: (req) => ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method),
      keyGenerator: async (req) => (await app.get(Auth).require(req)).id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      identifier: 'harbor-key-confirmation',
      handler: (_req, res) =>
        res
          .status(429)
          .json({
            error: {
              message:
                'Too many API key password confirmations for this account. Try again later; existing keys can still be revoked.',
              code: 429,
            },
          }),
    }),
  );
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json({ error: { message: 'Too many authentication attempts. Try again later.' } }),
  });
  app.use(
    [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/forgot-password',
      '/api/v1/auth/verification/confirm',
      '/api/v1/auth/verification/resend',
      '/api/v1/setup',
      '/api/remote/sftp/auth',
    ],
    authLimiter,
  );
  app.useGlobalFilters(new Errors());
  const config = new DocumentBuilder()
    .setTitle('Harbor API')
    .setDescription(
      'Versioned hosting platform API. Successful responses use {data}; failures use {error}.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('harbor_session', { type: 'apiKey', in: 'cookie' }, 'harbor_session')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description:
          'Customer or admin API key generated from the dashboard. Use the minimum required scopes.',
      },
      'apiKey',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.openapi = '3.1.0';
  for (const contract of httpContracts) {
    const operation = (document.paths[contract.path] as any)?.[contract.method];
    if (!operation) continue;
    const errorSchema = z.toJSONSchema(
      z.object({ error: z.object({ message: z.string(), code: z.number().optional() }) }),
      { target: 'draft-7' },
    );
    for (const status of ['400', '401', '403', '409', '500']) {
      operation.responses[status] = {
        description: 'Request failed',
        content: { 'application/json': { schema: errorSchema } },
      };
    }
    if ('request' in contract)
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: z.toJSONSchema(contract.request, { target: 'draft-7', unrepresentable: 'any' }),
          },
        },
      };
    if ('response' in contract)
      operation.responses[contract.method === 'get' ? '200' : '201'] = {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: z.toJSONSchema(z.object({ data: contract.response }), {
              target: 'draft-7',
              unrepresentable: 'any',
            }),
          },
        },
      };
  }
  const supplementalBodies = [
    ['/api/v1/api-keys', 'post', apiKeyCreateSchema],
    [
      '/api/v1/api-keys/{id}/rotate',
      'post',
      z
        .object({
          password: z.string().min(1).max(200),
          totp: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
          expiresInDays: z.number().int().min(1).max(365).default(90),
        })
        .strict(),
    ],
    [
      '/api/v1/admin/api-keys/{id}/revoke',
      'post',
      z.object({ reason: z.string().min(3).max(1000) }).strict(),
    ],
    ['/api/v1/customers', 'post', createCustomerInputSchema],
    ['/api/v1/customers/{id}/orders', 'post', orderInputSchema],
    [
      '/api/v1/customers/{id}/orders/quote',
      'post',
      orderInputSchema
        .omit({
          idempotencyKey: true,
          expectedQuoteId: true,
          expectedTotal: true,
          expectedCurrency: true,
          domain: true,
          sshKey: true,
        })
        .strict(),
    ],
  ] as const;
  for (const [path, method, schema] of supplementalBodies) {
    const operation = (document.paths[path] as any)?.[method];
    if (!operation) continue;
    const body: any = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
    if (body.properties?.password)
      body.properties.password = {
        ...body.properties.password,
        format: 'password',
        writeOnly: true,
      };
    operation.requestBody = { required: true, content: { 'application/json': { schema: body } } };
  }
  for (const [path, item] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(item || {})) {
      if (!['get', 'post', 'patch', 'delete', 'put', 'head'].includes(method) || !operation)
        continue;
      const route = path.replace(/\{([^}]+)\}/g, ':$1');
      const client = apiScope('CLIENT', method.toUpperCase(), route),
        admin = apiScope('ADMIN', method.toUpperCase(), route);
      const action = route === '/api/v1/services/:id/actions' && method === 'post';
      if (path.startsWith('/api/v1/api-keys') || path.startsWith('/api/v1/admin/api-keys'))
        (operation as any).security = [{ harbor_session: [] }];
      if (client || admin || action) {
        (operation as any).security = [{ harbor_session: [] }, { apiKey: [] }];
        (operation as any)['x-harbor-scopes'] = {
          client: client === '@identity' ? 'any valid client key' : client,
          admin: admin === '@identity' ? 'any valid admin key' : admin,
          ...(action
            ? { note: 'Scope depends on action. See /api/v1/api-keys/options or docs/api.md.' }
            : {}),
        };
      }
    }
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: false },
  });
  app.get(Consoles).attach(app.getHttpServer());
  return app;
}
if (require.main === module)
  void createApp()
    .then((app) =>
      app.listen(Number(process.env.API_PORT || 4000), process.env.API_HOST || '127.0.0.1'),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

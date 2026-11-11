import { gameFilePath } from './game-files';
import { GameEggs } from './game-eggs';
import { Invoicing } from './invoicing';
import { InvoiceDocuments } from './invoice-documents';
import { SettingsAdmin } from './settings-admin';
import { SystemMonitor } from './system-monitor';
import { Jobs } from './jobs';
import { Carts } from './cart';
import { remainingBalance, serviceInvoiceWhere } from './invoice-issue';
import { Offers } from './offers';
import { Cancellations } from './cancellations';
import { serial } from './transactions';
import { Taxes } from './taxes';
import { Catalog } from './catalog';
import {
  All,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Consoles } from './console';
import { Auth, safeUser } from './auth';
import { Db, json } from './db';
import { Platform } from './platform';
import { Payments } from './payments';
import { Extensions } from './extensions';
import { WingsProvider } from './providers/wings';
import { ProxmoxProvider } from './providers/proxmox';
import { locationSchema } from './providers/proxmox-config';
import { billingAddressSchema } from './billing';
import { Wallets } from './wallet';
import { Tickets, type TicketUpload } from './tickets';
import { Coupons } from './coupons';
import { PleskProvider } from './providers/plesk';
import { NativeWebProvider } from './providers/native-web';
const ok = (data: unknown) => ({ data });
const userView = (user: any) => (user ? { ...user, role: user.role.toLowerCase() } : null);
@ApiTags('Harbor')
@Controller('api/v1')
export class ApiController {
  constructor(
    @Inject(Auth) private auth: Auth,
    @Inject(Platform) private platform: Platform,
    @Inject(Db) private db: Db,
    @Inject(Payments) private payments: Payments,
    @Inject(Extensions) private extensions: Extensions,
    @Inject(Consoles) private consoles: Consoles,
    @Inject(Wallets) private wallets: Wallets,
    @Inject(Tickets) private tickets: Tickets,
    @Inject(Coupons) private coupons: Coupons,
    @Inject(Catalog) private catalog: Catalog,
    @Inject(Taxes) private taxes: Taxes,
    @Inject(Cancellations) private cancellations: Cancellations,
    @Inject(Offers) private offers: Offers,
    @Inject(Invoicing) private invoicing: Invoicing,
    @Inject(InvoiceDocuments) private documents: InvoiceDocuments,
    @Inject(SettingsAdmin) private settingsAdmin: SettingsAdmin,
    @Inject(SystemMonitor) private monitor: SystemMonitor,
    @Inject(Jobs) private jobs: Jobs,
    @Inject(Carts) private carts: Carts,
    @Inject(GameEggs) private eggs: GameEggs,
  ) {}
  @Post('invoices/quote') async quoteInvoice(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.invoicing.quote(await this.auth.require(req, true), body));
  }
  @Post('invoices') async issueInvoice(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.invoicing.create(await this.auth.require(req, true), body));
  }
  @Post('wallet/funding-invoices') async fundingInvoice(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return ok(await this.invoicing.fund(await this.auth.require(req), body));
  }
  @Post('invoices/:id/void') async voidInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.invoicing.void(await this.auth.require(req), id, body));
  }
  @Post('invoices/:id/funding-credit') async creditFunding(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return ok(await this.invoicing.retryCredit(await this.auth.require(req, true), id));
  }
  @Get('products/:id/configuration') async productConfiguration(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.auth.require(req, true);
    return ok(await this.offers.get(id));
  }
  @Patch('products/:id/configuration') async saveProductConfiguration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.offers.save(await this.auth.require(req, true), id, body));
  }
  @Get('cancellations') async cancellationList(@Req() req: Request) {
    return ok(await this.cancellations.list(await this.auth.require(req)));
  }
  @Get('services/:id/cancellations') async serviceCancellations(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return ok(await this.cancellations.list(await this.auth.require(req), id));
  }
  @Post('services/:id/cancellations') async requestCancellation(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.cancellations.request(await this.auth.require(req), id, body));
  }
  @Post('cancellations/:id/review') async reviewCancellation(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.cancellations.review(await this.auth.require(req, true), id, body));
  }
  @Post('cancellations/:id/withdraw') async withdrawCancellation(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return ok(await this.cancellations.withdraw(await this.auth.require(req), id));
  }
  @Get('payments/review') async paymentReviewQueue(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.payments.reviewQueue());
  }
  @Post('payments/:id/review') async resolvePaymentReview(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.payments.resolveReview(await this.auth.require(req, true), id, body));
  }
  @Get('tax-rates') async taxRates(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.taxes.list());
  }
  @Post('tax-rates') async createTaxRate(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.taxes.save(await this.auth.require(req, true), body));
  }
  @Patch('tax-rates/:id') async editTaxRate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.taxes.save(await this.auth.require(req, true), body, id));
  }
  @Get('catalog/categories') async catalogCategories(@Req() req: Request) {
    const actor = await this.auth.actor(req);
    return ok(await this.catalog.list(actor?.role === 'ADMIN'));
  }
  @Post('catalog/categories') async createCategory(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.catalog.save(await this.auth.require(req, true), body));
  }
  @Patch('catalog/categories/:id') async editCategory(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.catalog.save(await this.auth.require(req, true), body, id));
  }
  @Get('coupons') async couponList(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.coupons.list());
  }
  @Post('coupons') async createCoupon(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.coupons.save(await this.auth.require(req, true), body));
  }
  @Patch('coupons/:id') async editCoupon(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.coupons.save(await this.auth.require(req, true), body, id));
  }
  @Post('orders/quote') async orderQuote(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.orderQuote(await this.auth.require(req), body));
  }
  @Get('support/departments') async supportDepartments(@Req() req: Request) {
    return ok(await this.tickets.departments(await this.auth.require(req)));
  }
  @Post('support/departments') async addSupportDepartment(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return ok(await this.tickets.saveDepartment(await this.auth.require(req, true), body));
  }
  @Patch('support/departments/:id') async editSupportDepartment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.tickets.saveDepartment(await this.auth.require(req, true), body, id));
  }
  @Get('support/agents') async supportAgents(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.tickets.agents());
  }
  @Get('tickets') async ticketList(@Req() req: Request) {
    return ok(await this.tickets.list(await this.auth.require(req)));
  }
  @Post('tickets') async createTicket(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.tickets.create(await this.auth.require(req), body));
  }
  @Get('tickets/:id') async ticket(@Req() req: Request, @Param('id') id: string) {
    return ok(await this.tickets.detail(await this.auth.require(req), id));
  }
  @Patch('tickets/:id') async updateTicket(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.tickets.update(await this.auth.require(req), id, body));
  }
  @Post('tickets/:id/messages')
  @UseInterceptors(
    FileInterceptor('attachment', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }),
  )
  async ticketReply(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file?: TicketUpload,
  ) {
    return ok(await this.tickets.reply(await this.auth.require(req), id, body, file));
  }
  @Get('support/attachments/:id') async ticketAttachment(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.tickets.attachment(await this.auth.require(req), id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(file.path, file.filename);
  }
  @Get('profile') async profile(@Req() req: Request) {
    const actor = await this.auth.require(req);
    return ok(await this.db.user.findUnique({ where: { id: actor.id }, select: safeUser }));
  }
  @Patch('profile') async updateProfile(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.auth.require(req);
    const d = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        billingAddress: billingAddressSchema.optional(),
        autoPayWallet: z.boolean().optional(),
        notificationPreferences: z
          .object({
            ticketReplies: z.boolean().default(true),
            loginAlerts: z.boolean().default(true),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, 'Supply a field to update')
      .parse(body);
    const result = await this.db.user.update({
      where: { id: actor.id },
      data: { ...d, billingAddress: d.billingAddress ? json(d.billingAddress) : undefined },
      select: safeUser,
    });
    await this.platform.audit(actor, 'profile.updated', actor.id);
    return ok(result);
  }
  @Get('wallet') async wallet(@Req() req: Request, @Query('currency') currency?: string) {
    return ok(await this.wallets.summary((await this.auth.require(req)).id, currency));
  }
  @Post('wallet/topups') async topup(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.wallets.request((await this.auth.require(req)).id, body));
  }
  @Get('admin/wallets') async adminWallets(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.wallets.admin());
  }
  @Get('admin/wallets/:userId') async walletStatement(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Query('currency') currency?: string,
  ) {
    await this.auth.require(req, true);
    return ok(await this.wallets.summary(userId, currency));
  }
  @Post('admin/wallets/topups/:id/review') async reviewTopup(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.wallets.review(await this.auth.require(req, true), id, body));
  }
  @Post('invoices/:id/wallet-payment') async walletPayment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req),
      invoice = await this.platform.invoice(actor, id);
    const d = z
      .object({
        amount: z.number().int().min(1).max(2000000000).optional(),
        idempotencyKey: z.string().uuid().optional(),
      })
      .strict()
      .refine((v) => !!v.amount === !!v.idempotencyKey, 'An explicit amount requires a request key')
      .parse(body === undefined ? {} : body);
    const reference = d.idempotencyKey
      ? `wallet-${id}-${actor.id}-${d.idempotencyKey}`
      : `wallet-${id}`;
    return ok(
      await this.payments.settle({
        gateway: 'wallet',
        eventId: reference,
        paymentId: reference,
        invoiceId: id,
        amount: d.amount ?? remainingBalance(invoice),
        currency: invoice.currency,
        walletUserId: actor.id,
        strictIdempotency: !!d.idempotencyKey,
      }),
    );
  }
  @Get('health') @ApiOperation({ summary: 'Check database readiness' }) async health() {
    await this.db.$queryRaw`SELECT 1`;
    return ok({ status: 'ok', version: '0.1.0' });
  }
  @Get('setup') async setupStatus() {
    return ok({
      completed: !!(await this.db.setting.findUnique({ where: { id: 'installation' } })),
    });
  }
  @Post('setup') async setup(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const user = await this.platform.setup(body);
    await this.auth.session(user.id, res);
    return ok(userView(user));
  }
  @Get('auth/me') async me(@Req() req: Request) {
    return ok(userView(await this.auth.require(req)));
  }
  @Post('auth/login') async login(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return ok(userView(await this.auth.login(body, res, req)));
  }
  @Post('auth/register') async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return ok(userView(await this.auth.register(body, res)));
  }
  @Post('auth/logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return ok(await this.auth.logout(req, res));
  }
  @Post('auth/forgot-password') async forgot(@Body() body: unknown) {
    return ok(await this.auth.resetRequest(body));
  }
  @Post('auth/reset-password') async reset(@Body() body: unknown) {
    return ok(await this.auth.resetPassword(body));
  }
  @Post('auth/verification/resend') async resendVerification(@Req() req: Request) {
    return ok(await this.auth.requestVerification(await this.auth.require(req)));
  }
  @Post('auth/verification/confirm') async confirmVerification(@Body() body: unknown) {
    return ok(await this.auth.verifyEmail(body));
  }
  @Post('auth/totp/setup') async totpSetup(@Req() req: Request, @Body() body: unknown) {
    const d = z.object({ password: z.string().max(200) }).parse(body);
    return ok(await this.auth.totpStart(await this.auth.require(req), d.password));
  }
  @Post('auth/totp/confirm') async totpConfirm(@Req() req: Request, @Body() body: unknown) {
    const d = z.object({ code: z.string().length(6) }).parse(body);
    return ok(await this.auth.totpConfirm(await this.auth.require(req), d.code));
  }
  @Get('settings') async settings() {
    return ok(await this.platform.settings());
  }
  @Get('admin/settings') async privateSettings(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok({ ...(await this.platform.settings()), ...(await this.settingsAdmin.info()) });
  }
  @Get('admin/system') async systemStatus(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.monitor.status());
  }
  @Get('admin/system/http') async httpLogs(@Req() req: Request, @Query() query: unknown) {
    await this.auth.require(req, true);
    return ok(await this.monitor.logs('http', query));
  }
  @Get('admin/system/audit') async auditLogs(@Req() req: Request, @Query() query: unknown) {
    await this.auth.require(req, true);
    return ok(await this.monitor.logs('audit', query));
  }
  @Get('admin/system/jobs') async jobLogs(@Req() req: Request, @Query() query: unknown) {
    await this.auth.require(req, true);
    return ok(await this.monitor.jobs(query));
  }
  @Post('admin/system/maintenance') async manualMaintenance(@Req() req: Request) {
    const actor = await this.auth.require(req, true);
    return ok(await this.monitor.maintenance(() => this.jobs.maintenance(), 'manual', actor.id));
  }
  @Patch('admin/settings/mail') async mailSettings(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.settingsAdmin.saveMail(await this.auth.require(req, true), body));
  }
  @Post('admin/settings/mail/test') async testMail(@Req() req: Request) {
    return ok(await this.settingsAdmin.testMail(await this.auth.require(req, true)));
  }
  @Get('admin/settings/templates') async templates(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.settingsAdmin.templates());
  }
  @Patch('admin/settings/templates/:key') async saveTemplate(
    @Req() req: Request,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return ok(await this.settingsAdmin.saveTemplate(await this.auth.require(req, true), key, body));
  }
  @Get('admin/settings/mail/logs') async mailLogs(@Req() req: Request, @Query() query: unknown) {
    await this.auth.require(req, true);
    return ok(await this.settingsAdmin.logs(query));
  }
  @Post('admin/settings/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  async logoUpload(
    @Req() req: Request,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return ok(await this.settingsAdmin.upload(await this.auth.require(req, true), file));
  }
  @Get('branding/:name') async branding(@Param('name') name: string, @Res() res: Response) {
    const image = await this.settingsAdmin.image(name);
    res.setHeader('Content-Type', image.type);
    res.setHeader('Cache-Control', 'public,max-age=86400,immutable');
    res.send(image.content);
  }
  @Patch('settings') async saveSettings(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.updateSettings(await this.auth.require(req, true), body));
  }
  @Get('dashboard') async dashboard(@Req() req: Request) {
    return ok(await this.platform.dashboard(await this.auth.require(req)));
  }
  @Get('catalog/products') async storefrontProducts(@Req() req: Request) {
    const user = await this.auth.actor(req);
    return ok(await this.platform.products(true, user?.id));
  }
  @Get('products') async products(@Req() req: Request) {
    const user = await this.auth.actor(req);
    return ok(await this.platform.products(user?.role !== 'ADMIN', user?.id));
  }
  @Post('products') async createProduct(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.saveProduct(await this.auth.require(req, true), body));
  }
  @Patch('products/:id') async updateProduct(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.saveProduct(await this.auth.require(req, true), body, id));
  }
  @Post('customers') async createCustomer(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.createCustomer(await this.auth.require(req, true), body));
  }
  @Post('customers/:id/orders/quote') async customerOrderQuote(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(
      await this.platform.customerOrder(await this.auth.require(req, true), id, body, true),
    );
  }
  @Post('customers/:id/orders') async customerOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.customerOrder(await this.auth.require(req, true), id, body));
  }
  @Get('customers') async customers(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.platform.customers());
  }
  @Get('customers/:id') async customer(@Req() req: Request, @Param('id') id: string) {
    await this.auth.require(req, true);
    return ok(await this.platform.customer(id));
  }
  @Post('customers/:id/suspension') async suspension(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.suspendCustomer(await this.auth.require(req, true), id, body));
  }
  @Get('pricing/regions') async regions(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.platform.pricingRegions());
  }
  @Post('pricing/regions') async createRegion(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.savePricingRegion(await this.auth.require(req, true), body));
  }
  @Patch('pricing/regions/:id') async editRegion(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.savePricingRegion(await this.auth.require(req, true), body, id));
  }
  @Post('pricing/prices') async regionalPrice(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.saveRegionalPrice(await this.auth.require(req, true), body));
  }
  @Delete('pricing/prices/:id') async deleteRegionalPrice(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.require(req, true);
    await this.db.regionalPrice.delete({ where: { id } });
    await this.platform.audit(actor, 'pricing.price.deleted', id);
    return ok({ deleted: true });
  }
  @Patch('customers/:id') async editCustomer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.editCustomer(await this.auth.require(req, true), id, body));
  }
  @Post('customers/:id/password') async customerPassword(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(
      await this.platform.changeCustomerPassword(await this.auth.require(req, true), id, body),
    );
  }
  @Post('customers/:id/revoke-sessions') async revokeCustomerSessions(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return ok(await this.platform.revokeCustomerSessions(await this.auth.require(req, true), id));
  }
  @Get('orders') async orders(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.platform.orders());
  }
  @Post('orders') async order(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.order(await this.auth.require(req), body));
  }
  @Get('services') async services(@Req() req: Request) {
    return ok(await this.platform.services(await this.auth.require(req)));
  }
  @Get('services/:id') async service(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.require(req);
    return ok(await this.platform.serviceView(await this.platform.rawService(user, id)));
  }
  @Get('services/:id/startup') async gameStartup(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.auth.require(req);
    const service = await this.platform.rawService(actor, id);
    if (service.provider !== 'wings') throw new BadRequestException('Game server required');
    return ok(await this.eggs.startup(service, actor));
  }
  @Patch('services/:id/startup') async gameStartupSave(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.eggs.saveStartup(id, await this.auth.require(req), body));
  }
  @Post('services/:id/actions') async action(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.action(await this.auth.require(req), id, body));
  }
  @Post('services/:id/retry-provision') async retryProvision(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.require(req, true);
    const s = await this.platform.rawService(actor, id);
    if (s.cancelAt && s.cancelAt <= new Date())
      throw new BadRequestException('This service has reached its cancellation cutoff');
    if (s.status !== 'FAILED')
      throw new BadRequestException('Only failed services can retry provisioning');
    if (!(await this.db.invoice.count({ where: { ...serviceInvoiceWhere(id), status: 'PAID' } })))
      throw new BadRequestException('A paid invoice is required');
    const op = await this.db.operation.create({
      data: { serviceId: id, action: 'provision', idempotencyKey: `retry-${id}-${Date.now()}` },
    });
    await this.platform.audit(actor, 'service.provision.retry', id);
    return ok({ operationId: op.id, message: 'Provisioning retry queued' });
  }
  @Get('services/:id/operations') async operations(@Req() req: Request, @Param('id') id: string) {
    await this.platform.rawService(await this.auth.require(req), id);
    return ok(
      await this.db.operation.findMany({
        where: { serviceId: id },
        select: {
          id: true,
          action: true,
          status: true,
          result: true,
          error: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }
  @Get('services/:id/usage') async usage(@Req() req: Request, @Param('id') id: string) {
    const s = await this.platform.rawService(await this.auth.require(req), id);
    if (!s.externalId) throw new BadRequestException('Service has not been provisioned');
    return ok(
      await (
        await this.extensions.provider(s.provider)
      ).inspect(this.platform.connection(s.product.connection), this.platform.hostingService(s)),
    );
  }
  @Get('services/:id/backups') async backups(@Req() req: Request, @Param('id') id: string) {
    const s = await this.platform.rawService(await this.auth.require(req), id);
    if (s.provider === 'wings')
      return ok(
        Object.entries((s.metadata as any).backups || {}).map(([id, backup]) => ({
          id,
          ...(backup as object),
        })),
      );
    if (!s.externalId) return ok([]);
    const c = this.platform.connection(s.product.connection);
    const p = await this.extensions.provider(s.provider);
    if (s.provider === 'native-web')
      return ok(await (p as NativeWebProvider).call(c, `/sites/${id}/backups`));
    if (s.provider === 'proxmox') {
      const placement = (p as ProxmoxProvider).effective(c, this.platform.hostingService(s));
      if (!placement.config.backupStorage) return ok([]);
      await (p as ProxmoxProvider).owned(c, this.platform.hostingService(s));
      const list = await (p as ProxmoxProvider).call(
        placement,
        `/nodes/${encodeURIComponent(String(placement.config.node))}/storage/${encodeURIComponent(String(placement.config.backupStorage))}/content?content=backup&vmid=${encodeURIComponent(s.externalId)}`,
      );
      return ok(
        list.map((b: any) => ({
          id: b.volid,
          size: b.size,
          createdAt: new Date(b.ctime * 1000).toISOString(),
          completed: true,
        })),
      );
    }
    return ok([]);
  }
  @Post('services/:id/console') async console(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.auth.require(req);
    const s = await this.platform.rawService(actor, id);
    if (s.status !== 'ACTIVE' || (s.cancelAt && s.cancelAt <= new Date()))
      throw new BadRequestException('Service is not active');
    if (s.provider === 'proxmox') {
      if (actor.apiKeyId)
        throw new ForbiddenException('Proxmox browser consoles require a dashboard session');
      return ok(await this.consoles.grant(actor, req, id));
    }
    if (s.provider !== 'wings')
      throw new BadRequestException('Console tickets are available for game servers here');
    return ok(
      ((await this.extensions.provider('wings')) as WingsProvider).console(
        this.platform.connection(s.product.connection),
        this.platform.hostingService(s),
        actor.id,
        actor.apiKeyId &&
          !(req as any).harborApiKey?.scopes.includes(
            actor.role === 'ADMIN' ? 'admin:services:control' : 'services:control',
          )
          ? ['control.console']
          : undefined,
      ),
    );
  }
  @Post('services/:id/panel-login') async panelLogin(@Req() req: Request, @Param('id') id: string) {
    const s = await this.platform.rawService(await this.auth.require(req), id);
    if (s.provider !== 'plesk' || s.status !== 'ACTIVE' || (s.cancelAt && s.cancelAt <= new Date()))
      throw new BadRequestException('Plesk login is unavailable');
    return ok(
      await ((await this.extensions.provider('plesk')) as PleskProvider).login(
        this.platform.connection(s.product.connection),
        this.platform.hostingService(s),
        req.ip || '',
      ),
    );
  }
  @Get('services/:id/files/content') async content(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('path') path: string,
  ) {
    const s = await this.platform.rawService(await this.auth.require(req), id);
    if (s.status !== 'ACTIVE' || (s.cancelAt && s.cancelAt <= new Date()))
      throw new BadRequestException('Service is not active');
    path = gameFilePath(path, false);
    if (s.provider === 'wings') {
      const r = await ((await this.extensions.provider('wings')) as WingsProvider).content(
        this.platform.connection(s.product.connection),
        this.platform.hostingService(s),
        path,
      );
      if (!r.ok) throw new BadRequestException('Unable to read file');
      if (!r.body) return ok({ content: '' });
      const reader = r.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 1048576)
            throw new BadRequestException(
              'File is too large for the editor. Use Download instead.',
            );
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.includes(0))
        throw new BadRequestException('Binary files cannot be edited. Use Download instead.');
      return ok({ content: buffer.toString('utf8') });
    }
    if (s.provider === 'native-web')
      return ok(
        await ((await this.extensions.provider(s.provider)) as NativeWebProvider).call(
          this.platform.connection(s.product.connection),
          `/sites/${id}/file?path=${encodeURIComponent(path)}`,
        ),
      );
    throw new BadRequestException('File editing is unavailable for this provider');
  }
  @Post('services/:id/files/content') async writeContent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req);
    const s = await this.platform.rawService(actor, id);
    if (s.status !== 'ACTIVE' || (s.cancelAt && s.cancelAt <= new Date()))
      throw new BadRequestException('Service is not active');
    const d = z
      .object({ path: z.string().min(1).max(2000), content: z.string().max(1048576) })
      .parse(body);
    d.path = gameFilePath(d.path, false);
    if (s.provider === 'wings') {
      const c = this.platform.connection(s.product.connection);
      const r = await fetch(
        `${c.url}/api/servers/${id}/files/write?file=${encodeURIComponent(d.path)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.secret.token}`, 'Content-Type': 'text/plain' },
          body: d.content,
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!r.ok) throw new BadRequestException('Unable to save file');
    } else if (s.provider === 'native-web')
      await ((await this.extensions.provider(s.provider)) as NativeWebProvider).call(
        this.platform.connection(s.product.connection),
        `/sites/${id}/file`,
        'PUT',
        d,
      );
    else throw new BadRequestException('File editing is unavailable');
    await this.platform.audit(actor, 'service.file.updated', id, { path: d.path });
    return ok({ saved: true });
  }
  @Post('services/:id/database') async nativeDatabase(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.require(req);
    const s = await this.platform.rawService(actor, id);
    if (
      s.provider !== 'native-web' ||
      s.status !== 'ACTIVE' ||
      (s.cancelAt && s.cancelAt <= new Date())
    )
      throw new BadRequestException('Database management is unavailable');
    const provider = (await this.extensions.provider('native-web')) as NativeWebProvider;
    const result = await provider.call(
      this.platform.connection(s.product.connection),
      `/sites/${id}/database`,
      'POST',
      {},
    );
    await this.platform.audit(actor, 'service.database.reset', id);
    return ok(result);
  }
  @Post('services/:id/certificate') async nativeCertificate(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.require(req);
    const s = await this.platform.rawService(actor, id);
    if (
      s.provider !== 'native-web' ||
      s.status !== 'ACTIVE' ||
      (s.cancelAt && s.cancelAt <= new Date())
    )
      throw new BadRequestException('Certificate management is unavailable');
    const provider = (await this.extensions.provider('native-web')) as NativeWebProvider;
    const result = await provider.call(
      this.platform.connection(s.product.connection),
      `/sites/${id}/certificate`,
      'POST',
      { email: actor.email },
    );
    await this.platform.audit(actor, 'service.certificate.issued', id);
    return ok(result);
  }
  @Get('invoices') async invoices(@Req() req: Request) {
    return ok(await this.platform.invoices(await this.auth.require(req)));
  }
  @Get('cart') async cart(@Req() req: Request) {
    return ok(await this.carts.current(await this.auth.require(req)));
  }
  @Post('cart/items') async addCartItem(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.carts.add(await this.auth.require(req), body));
  }
  @Patch('cart/items/:id') async editCartItem(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.carts.edit(await this.auth.require(req), id, body));
  }
  @Delete('cart/items/:id') async removeCartItem(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.carts.edit(await this.auth.require(req), id, body, true));
  }
  @Post('cart/checkout') async checkoutCart(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.carts.checkout(await this.auth.require(req), body));
  }
  @Post('invoices/:id/cancel-checkout') async cancelCart(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.carts.cancel(await this.auth.require(req), id, body));
  }
  @Get('invoices/:id') async invoice(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.auth.require(req);
    await this.platform.invoice(actor, id);
    return ok((await this.platform.invoices(actor)).find((i) => i.id === id));
  }
  @Get('invoices/:id/pdf') async invoicePdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const document = await this.documents.pdf(await this.auth.require(req), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(document.content);
  }
  @Get('invoices/:id/deliveries') async invoiceDeliveries(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.auth.require(req, true);
    return ok(await this.documents.history(id));
  }
  @Post('invoices/:id/deliveries') async sendInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.documents.request(await this.auth.require(req, true), id, body));
  }
  @Post('invoices/:id/deliveries/:deliveryId/retry') async retryInvoiceDelivery(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Body() body: unknown,
  ) {
    return ok(await this.documents.retry(await this.auth.require(req, true), id, deliveryId, body));
  }
  @Get('gateways') async gateways() {
    return ok(await this.payments.available());
  }
  @Post('invoices/:id/demo-payment') async demoPayment(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.require(req);
    const invoice = await this.platform.invoice(actor, id);
    if (!invoice.serviceId)
      throw new BadRequestException('This invoice is not a demo hosting invoice');
    const service = await this.db.service.findUniqueOrThrow({ where: { id: invoice.serviceId } });
    if (service.provider !== 'demo-game')
      throw new BadRequestException('This invoice is not a demo');
    return ok(
      await this.payments.settle({
        gateway: 'demo',
        eventId: `demo-${id}`,
        paymentId: `demo-${id}`,
        invoiceId: id,
        amount: invoice.amount,
        currency: invoice.currency,
      }),
    );
  }
  @Post('invoices/:id/checkout') async checkout(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req);
    await this.platform.invoice(actor, id);
    const d = z.object({ gateway: z.string().max(64) }).parse(body);
    return ok(await this.payments.checkout(id, d.gateway));
  }
  @Post('invoices/:id/paypal/capture') async capture(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.platform.invoice(await this.auth.require(req), id);
    const input = z.object({ orderId: z.string().max(100).optional() }).parse(body || {});
    return ok(await this.payments.capturePayPal(id, input.orderId));
  }
  @Post('invoices/:id/manual-payment') async manual(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req, true);
    const invoice = await this.platform.invoice(actor, id);
    const d = z
      .object({
        reference: z.string().trim().min(3).max(200),
        amount: z.number().int().min(1).max(2000000000).optional(),
      })
      .strict()
      .parse(body);
    const result = await this.payments.settle({
      gateway: 'manual',
      eventId: d.reference,
      paymentId: d.reference,
      invoiceId: id,
      amount:
        d.amount ?? (invoice.status === 'UNPAID' ? remainingBalance(invoice) : invoice.amount),
      currency: invoice.currency,
    });
    await this.platform.audit(actor, 'payment.manual', id, { reference: d.reference });
    return ok(result);
  }
  @Get('nodes') async nodes(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.platform.connections());
  }
  @Get('locations') async locations(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(
      await this.db.location.findMany({
        include: { _count: { select: { connections: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }
  @Post('locations') async addLocation(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.auth.require(req, true);
    const location = await this.db.location.create({ data: locationSchema.parse(body) });
    await this.platform.audit(actor, 'location.created', location.id);
    return ok(location);
  }
  @Patch('locations/:id') async editLocation(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req, true);
    const location = await this.db.location.update({
      where: { id },
      data: locationSchema.parse(body),
    });
    await this.platform.audit(actor, 'location.updated', id);
    return ok(location);
  }
  @Delete('locations/:id') async deleteLocation(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.auth.require(req, true);
    await this.db.location.delete({ where: { id } });
    await this.platform.audit(actor, 'location.deleted', id);
    return ok({ deleted: true });
  }
  @Get('nodes/:id/proxmox') async proxmoxInventory(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('node') node?: string,
    @Query('storage') storage?: string,
  ) {
    await this.auth.require(req, true);
    return ok(await this.platform.proxmoxInventory(id, node, storage));
  }
  @Post('nodes/:id/cluster-nodes') async clusterNode(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.addProxmoxNode(await this.auth.require(req, true), id, body));
  }
  @Post('nodes/:id/ip-pools') async addIpPool(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req, true);
    const result = await this.platform.addIpPool(id, body);
    await this.platform.audit(actor, 'ip-pool.created', id);
    return ok(result);
  }
  @Delete('nodes/:id/resources/:resourceId') async deleteResource(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
  ) {
    const actor = await this.auth.require(req, true);
    const result = await this.platform.removeResource(id, resourceId);
    await this.platform.audit(actor, 'allocation.deleted', resourceId);
    return ok(result);
  }
  @Post('nodes') async node(@Req() req: Request, @Body() body: unknown) {
    return ok(await this.platform.createConnection(await this.auth.require(req, true), body));
  }
  @Patch('nodes/:id') async updateNode(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return ok(await this.platform.updateConnection(await this.auth.require(req, true), id, body));
  }
  @Post('nodes/:id/check') async checkNode(@Req() req: Request, @Param('id') id: string) {
    await this.auth.require(req, true);
    return ok(await this.platform.connectionHealth(id));
  }
  @Get('nodes/:id/configuration') async nodeConfig(@Req() req: Request, @Param('id') id: string) {
    await this.auth.require(req, true);
    return ok(await this.platform.nodeConfiguration(id));
  }
  @Get('nodes/:id/resources') async resources(@Req() req: Request, @Param('id') id: string) {
    await this.auth.require(req, true);
    return ok(await this.db.resource.findMany({ where: { connectionId: id } }));
  }
  @Post('nodes/:id/resources') async addResource(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req, true);
    const result = await this.platform.resources(id, body);
    await this.platform.audit(actor, 'allocation.created', id);
    return ok(result);
  }
  @Get('extensions') async extensionsList(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.extensions.list());
  }
  @Get('extensions/pages') async pages(@Req() req: Request) {
    const actor = await this.auth.require(req);
    const enabled = new Set(
      (await this.db.extension.findMany({ where: { enabled: true }, select: { id: true } })).map(
        (e) => e.id,
      ),
    );
    return ok(
      this.extensions.pages.filter(
        (p) => enabled.has(p.extensionId) && (actor.role === 'ADMIN' || p.area !== 'admin'),
      ),
    );
  }
  @All('extensions/:id/routes/:route') async extensionRoute(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('route') route: string,
  ) {
    const actor = await this.auth.require(req);
    const enabled = await this.db.extension.findUnique({ where: { id } });
    if (!enabled?.enabled) throw new NotFoundException('Extension is unavailable');
    const handler = this.extensions.routes.find(
      (r) => r.extensionId === id && r.method === req.method && r.path === `/${route}`,
    );
    if (!handler)
      throw new NotFoundException('Extension route not found; a restart may be required');
    if (handler.admin && actor.role !== 'ADMIN')
      throw new ForbiddenException('Administrator access required');
    return ok(
      await handler.handler({
        user: { id: actor.id, role: actor.role.toLowerCase() },
        body: req.body,
        query: req.query,
      }),
    );
  }
  @Patch('extensions/:id') async toggleExtension(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req, true);
    const d = z.object({ enabled: z.boolean() }).parse(body);
    const result = await this.extensions.toggle(id, d.enabled);
    await this.platform.audit(actor, 'extension.toggled', id, { enabled: d.enabled });
    return ok(result);
  }
  @Post('extensions/:id/rollback') async rollbackExtension(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.require(req, true);
    const result = await this.extensions.rollback(id);
    await this.platform.audit(actor, 'extension.rolled-back', id);
    return ok(result);
  }
  @Patch('extensions/:id/config') async configExtension(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.require(req, true);
    const d = z.object({ secret: z.record(z.string(), z.string()) }).parse(body);
    const result = await this.extensions.configure(id, d.secret);
    await this.platform.audit(actor, 'extension.configured', id);
    return ok(result);
  }
  @Post('extensions/install')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async installExtension(@Req() req: Request, @UploadedFile() file: { buffer: Buffer }) {
    const actor = await this.auth.require(req, true);
    if (!file) throw new BadRequestException('Upload an extension .tgz package');
    const result = await this.extensions.install(file.buffer);
    await this.platform.audit(actor, 'extension.installed', result.id);
    return ok(result);
  }
  @Get('audit') async audit(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(await this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
  }
  @Get('operations') async allOperations(@Req() req: Request) {
    await this.auth.require(req, true);
    return ok(
      await this.db.operation.findMany({
        include: { service: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }
  @Post('operations/:id/retry') async retry(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.auth.require(req, true);
    await serial(this.db, async (tx) => {
      const op = await tx.operation.findUnique({ where: { id }, include: { service: true } });
      if (!op || op.status !== 'FAILED')
        throw new BadRequestException('Only failed operations can be retried');
      if (
        op.service.status === 'TERMINATED' ||
        (op.action !== 'terminate' && op.service.cancelAt && op.service.cancelAt <= new Date())
      )
        throw new BadRequestException(
          'This service is terminated or has reached its cancellation cutoff',
        );
      await tx.operation.update({ where: { id }, data: { status: 'PENDING', error: null } });
      await tx.serviceCancellation.updateMany({
        where: { operationId: id, status: 'FAILED' },
        data: { status: 'PROCESSING' },
      });
    });
    await this.platform.audit(actor, 'operation.retried', id);
    return ok({ queued: true });
  }
}
@Controller('api/v1/webhooks')
export class WebhookController {
  constructor(@Inject(Payments) private payments: Payments) {}
  @Post('stripe') async stripe(@Req() req: Request & { rawBody?: Buffer }) {
    if (!req.rawBody) throw new BadRequestException('Missing webhook body');
    return this.payments.stripeWebhook(req.rawBody, req.get('stripe-signature') || '');
  }
  @Post('paypal') async paypal(@Req() req: Request) {
    return this.payments.paypalWebhook(req);
  }
}

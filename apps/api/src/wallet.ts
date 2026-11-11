import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { serial } from './transactions';
import type { Actor } from './auth';
import { walletPolicy } from './billing';
import { customerRegion, currencySchema } from './pricing';
@Injectable()
export class Wallets {
  constructor(@Inject(Db) private db: Db) {}
  async summary(userId: string, requestedCurrency?: string) {
    const settings = await this.db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
    const region = await customerRegion(this.db, settings, userId);
    const currency = currencySchema.parse(
      requestedCurrency || region?.currency || settings.currency,
    );
    const currencies = [
      ...new Set([
        settings.currency,
        ...(
          await this.db.pricingRegion.findMany({
            where: { active: true },
            select: { currency: true },
          })
        ).map((r) => r.currency),
        ...(await this.db.wallet.findMany({ where: { userId }, select: { currency: true } })).map(
          (w) => w.currency,
        ),
        ...(
          await this.db.invoice.findMany({
            where: { userId },
            select: { currency: true },
            distinct: ['currency'],
          })
        ).map((i) => i.currency),
      ]),
    ];
    if (!currencies.includes(currency))
      throw new BadRequestException('This wallet currency is not configured');
    const wallet = await this.db.wallet.upsert({
      where: { userId_currency: { userId, currency } },
      create: { userId, currency },
      update: {},
    });
    return {
      ...wallet,
      currencies,
      policy: walletPolicy(settings),
      entries: await this.db.walletEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      topups: await this.db.walletTopup.findMany({
        where: { userId, currency },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      fundingInvoices: await this.db.invoice.findMany({
        where: { userId, currency, kind: 'WALLET_FUNDING' },
        select: {
          id: true,
          number: true,
          amount: true,
          paidAmount: true,
          currency: true,
          status: true,
          walletCreditedAt: true,
          dueAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      instructions:
        (settings.companyBilling as any).paymentInstructions ||
        'Contact the hosting company for transfer instructions before submitting a top-up request.',
    };
  }
  async request(userId: string, input: unknown) {
    const d = z
      .object({
        amount: z.number().int().min(1).max(100000000),
        reference: z.string().trim().min(3).max(200),
        currency: currencySchema.optional(),
      })
      .strict()
      .parse(input);
    const settings = await this.db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
    const summary = await this.summary(userId, d.currency);
    const currency = summary.currency;
    return serial(this.db, async (tx) => {
      const previous = await tx.walletTopup.findUnique({
        where: { userId_reference: { userId, reference: d.reference } },
      });
      if (previous) {
        if (previous.amount !== d.amount || previous.currency !== currency)
          throw new ConflictException(
            'This transfer reference was already submitted with a different amount',
          );
        return previous;
      }
      const policy = walletPolicy(settings);
      if (!policy.depositsEnabled)
        throw new ConflictException('Wallet deposits are currently disabled');
      if (d.amount < policy.minDeposit || d.amount > policy.maxDeposit)
        throw new BadRequestException('Deposit amount is outside the configured limits');
      const wallet = await tx.wallet.findUnique({
        where: { userId_currency: { userId, currency } },
      });
      if ((wallet?.balance || 0) + d.amount > policy.maxBalance)
        throw new ConflictException('Deposit would exceed the wallet balance limit');
      if ((await tx.walletTopup.count({ where: { userId, status: 'PENDING' } })) >= 10)
        throw new ConflictException('Wait for staff to review your pending deposits');
      return tx.walletTopup.create({ data: { ...d, userId, currency } });
    });
  }
  async review(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        approve: z.boolean(),
        note: z.string().trim().min(3).max(500),
        paymentReference: z.string().trim().min(3).max(200).optional(),
      })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const request = await tx.walletTopup.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Top-up request not found');
      if (request.status !== 'PENDING') return { status: request.status, duplicate: true };
      if (d.approve) {
        if (!d.paymentReference)
          throw new BadRequestException('Enter the verified bank transaction ID');
        if (
          await tx.paymentEvent.findUnique({
            where: { gateway_externalId: { gateway: 'manual', externalId: d.paymentReference } },
          })
        )
          throw new ConflictException('This bank transaction has already been recorded');
        const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } });
        const policy = walletPolicy(settings);
        const wallet = await tx.wallet.upsert({
          where: { userId_currency: { userId: request.userId, currency: request.currency } },
          create: { userId: request.userId, currency: request.currency },
          update: {},
        });
        if (wallet.currency !== request.currency)
          throw new ConflictException('Wallet currency does not match');
        if (wallet.balance + request.amount > policy.maxBalance)
          throw new BadRequestException('Wallet balance limit exceeded');
        await tx.paymentEvent.create({
          data: { gateway: 'manual', externalId: d.paymentReference },
        });
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: request.amount } },
        });
        await tx.walletEntry.create({
          data: {
            walletId: wallet.id,
            amount: request.amount,
            balanceAfter: updated.balance,
            kind: 'TOPUP',
            reference: `manual-${d.paymentReference}`,
            description: `Verified deposit: ${d.paymentReference}`,
          },
        });
      }
      const result = await tx.walletTopup.update({
        where: { id },
        data: {
          status: d.approve ? 'APPROVED' : 'REJECTED',
          reviewedBy: actor.id,
          reviewNote: d.note,
          reviewedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: d.approve ? 'wallet.topup.approved' : 'wallet.topup.rejected',
          targetId: id,
          details: { amount: request.amount, note: d.note },
        },
      });
      return result;
    });
  }
  async admin() {
    return {
      wallets: await this.db.wallet.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { userId: 'asc' },
        take: 500,
      }),
      topups: await this.db.walletTopup.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    };
  }
}

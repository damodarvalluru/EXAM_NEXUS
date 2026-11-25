import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { runInTenantScope, tenantScopeStorage } from '../../database/tenant-scope';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { OutboundHttpService } from '../../common/net/outbound-http.service';
import { AuditService } from '../../common/services/audit.service';
import { verifyWebhookSignature } from '../../common/webhooks/webhook-signature';
import type { BillingMutationView, BillingWebhookView, CheckoutView, CreateCheckoutDto } from './dto/billing.dto';

export const BILLING_PROVIDER = 'external';

export interface BillingWebhookHeaders {
  signature?: string | undefined;
  timestamp?: string | undefined;
  nonce?: string | undefined;
}

interface ProviderEvent {
  eventId: string;
  type: string;
  tenantId: string | null;
  subscriptionId: string | null;
  amount: number | null;
  currency: string | null;
  reference: string | null;
  paidAt: Date | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: OutboundHttpService,
    private readonly audit: AuditService,
  ) {}

  /** Starts a provider-hosted checkout. No Payment row is created until the provider confirms it. */
  async createCheckout(
    dto: CreateCheckoutDto,
    principal: { userId?: string; tenantId?: string | null; email?: string | null } | undefined,
    request?: RequestWithContext | null,
  ): Promise<CheckoutView> {
    const tenantId = dto.tenantId ?? principal?.tenantId ?? null;
    if (!tenantId) throw this.badRequest('A tenant is required for checkout');
    const subscription = await this.runElevated((tx) =>
      tx.subscription.findUnique({ where: { tenantId }, select: { id: true, plan: true, seats: true, billingCycle: true } }),
    );
    if (!subscription) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Subscription not found' });

    const baseUrl = this.config.get<string>('billing.providerBaseUrl');
    const keyId = this.config.get<string>('billing.keyId');
    const keySecret = this.config.get<string>('billing.keySecret');
    if (!baseUrl || !keyId || !keySecret) throw this.badRequest('Billing provider is not configured');

    const plan = dto.plan ?? subscription.plan;
    const billingCycle = dto.billingCycle ?? subscription.billingCycle;
    const providerBody = {
      tenantId,
      subscriptionId: subscription.id,
      plan,
      seats: dto.seats ?? subscription.seats,
      billingCycle,
      ...(dto.successUrl ? { successUrl: dto.successUrl } : {}),
      ...(dto.cancelUrl ? { cancelUrl: dto.cancelUrl } : {}),
    };
    const response = await this.http.request({
      url: `${baseUrl.replace(/\/$/, '')}/checkout/sessions`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'idempotency-key': request?.requestId ?? randomUUID(),
      },
      body: JSON.stringify(providerBody),
    });
    if (!response.ok) throw this.badRequest(`Billing provider rejected checkout (${response.status})`);

    const payload = this.parseObject(response.body);
    const sessionId = this.firstString(payload, ['sessionId', 'id', 'checkoutSessionId']);
    const checkoutUrl = this.firstString(payload, ['checkoutUrl', 'url']);
    if (!checkoutUrl || !this.isHttpsUrl(checkoutUrl)) {
      throw this.badRequest('Billing provider did not return a valid HTTPS checkout URL');
    }
    const expiresAt = this.firstString(payload, ['expiresAt', 'expires_at']);
    const view: CheckoutView = {
      provider: BILLING_PROVIDER,
      sessionId,
      checkoutUrl,
      expiresAt: expiresAt && !Number.isNaN(Date.parse(expiresAt)) ? new Date(expiresAt).toISOString() : null,
    };
    await this.audit.record({
      actorUserId: principal?.userId ?? null,
      actorEmail: principal?.email ?? null,
      tenantId,
      action: 'billing.checkout.created',
      resourceType: 'subscription',
      resourceId: subscription.id,
      newValues: { sessionId: view.sessionId, plan, billingCycle, checkoutUrl: view.checkoutUrl },
      request,
    });
    return view;
  }

  /**
   * Verifies the provider HMAC before any mutation. Amounts and references are
   * taken exclusively from the signed payload; replays cannot create a second
   * Payment because providerReference is checked first.
   */
  async verifyProviderWebhook(
    rawBody: string,
    headers: BillingWebhookHeaders,
    request?: RequestWithContext | null,
  ): Promise<BillingWebhookView> {
    const secret = this.config.get<string>('billing.webhookSecret');
    if (!secret) throw this.badRequest('Billing webhook secret is not configured');
    const verification = verifyWebhookSignature({
      secret,
      signature: headers.signature,
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      rawBody,
      toleranceSeconds: this.config.get<number>('integrations.webhookToleranceSeconds') ?? 300,
    });
    if (!verification.valid) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: `Invalid billing webhook signature: ${verification.reason ?? 'unknown reason'}`,
      });
    }

    const payload = this.parseObject(rawBody);
    const event = this.readEvent(payload);
    if (!event) throw this.badRequest('Billing webhook is missing an event id or type');

    const subscription = await this.runElevated(async (tx) => {
      if (event.tenantId) return tx.subscription.findUnique({ where: { tenantId: event.tenantId } });
      if (event.subscriptionId) return tx.subscription.findUnique({ where: { id: event.subscriptionId } });
      return null;
    });
    if (!subscription) {
      await this.audit.record({
        action: 'billing.webhook.ignored',
        resourceType: 'billing_webhook',
        resourceId: event.eventId,
        outcome: 'FAILURE',
        newValues: { type: event.type, reason: 'subscription_not_found' },
        request,
      });
      return { eventId: event.eventId, status: 'IGNORED', tenantId: null, subscriptionStatus: null, paymentId: null, replayed: false };
    }

    const targetStatus = this.statusForEvent(event.type);
    let paymentId: string | null = null;
    let replayed = false;
    const isPaymentEvent = this.isPaymentEvent(event.type);
    const reference = event.reference ?? event.eventId;
    if (isPaymentEvent && event.amount !== null && event.currency) {
      const existing = await this.runElevated((tx) =>
        tx.payment.findFirst({ where: { provider: BILLING_PROVIDER, providerReference: reference } }),
      );
      if (existing) {
        paymentId = existing.id;
        replayed = true;
      } else {
        const created = await this.runElevated((tx) =>
          tx.payment.create({
            data: {
              tenantId: subscription.tenantId,
              subscriptionId: subscription.id,
              provider: BILLING_PROVIDER,
              providerReference: reference,
              amount: new Prisma.Decimal(event.amount!.toFixed(2)),
              currency: event.currency!,
              status: 'SUCCEEDED',
              paidAt: event.paidAt ?? new Date(),
            },
            select: { id: true },
          }),
        );
        paymentId = created.id;
      }
    }

    if (targetStatus && targetStatus !== subscription.status) {
      await this.runElevated((tx) =>
        tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: targetStatus as never,
            ...(targetStatus === 'ACTIVE' ? { endDate: null } : {}),
            ...(targetStatus === 'CANCELLED' || targetStatus === 'EXPIRED' ? { endDate: new Date() } : {}),
          },
        }),
      );
    }
    await this.audit.record({
      actorUserId: request?.principal?.userId ?? null,
      actorEmail: request?.principal?.email ?? null,
      tenantId: subscription.tenantId,
      action: 'billing.webhook.received',
      resourceType: 'billing_webhook',
      resourceId: event.eventId,
      newValues: { type: event.type, subscriptionStatus: targetStatus ?? subscription.status, paymentId, replayed },
      request,
    });
    return {
      eventId: event.eventId,
      status: 'PROCESSED',
      tenantId: subscription.tenantId,
      subscriptionStatus: targetStatus ?? subscription.status,
      paymentId,
      replayed,
    };
  }

  async cancelSubscription(
    id: string,
    reason: string | undefined,
    principal: { userId?: string; email?: string | null } | undefined,
    request?: RequestWithContext | null,
  ): Promise<BillingMutationView> {
    const existing = await this.runElevated((tx) => tx.subscription.findUnique({ where: { id } }));
    if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Subscription not found' });
    if (existing.status === 'CANCELLED') return this.mutationView(existing);
    const updated = await this.runElevated((tx) =>
      tx.subscription.update({
        where: { id },
        data: { status: 'CANCELLED', endDate: new Date() },
      }),
    );
    await this.audit.record({
      actorUserId: principal?.userId ?? null,
      actorEmail: principal?.email ?? null,
      tenantId: updated.tenantId,
      action: 'billing.subscription.cancelled',
      resourceType: 'subscription',
      resourceId: id,
      previousValues: { status: existing.status },
      newValues: { status: updated.status, reason: reason ?? null },
      request,
    });
    return this.mutationView(updated);
  }

  async restoreSubscription(
    id: string,
    reason: string | undefined,
    principal: { userId?: string; email?: string | null } | undefined,
    request?: RequestWithContext | null,
  ): Promise<BillingMutationView> {
    const existing = await this.runElevated((tx) => tx.subscription.findUnique({ where: { id } }));
    if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Subscription not found' });
    if (existing.status === 'ACTIVE' && !existing.endDate) return this.mutationView(existing);
    const updated = await this.runElevated((tx) =>
      tx.subscription.update({
        where: { id },
        data: { status: 'ACTIVE', endDate: null },
      }),
    );
    await this.audit.record({
      actorUserId: principal?.userId ?? null,
      actorEmail: principal?.email ?? null,
      tenantId: updated.tenantId,
      action: 'billing.subscription.restored',
      resourceType: 'subscription',
      resourceId: id,
      previousValues: { status: existing.status },
      newValues: { status: updated.status, reason: reason ?? null },
      request,
    });
    return this.mutationView(updated);
  }

  private readEvent(payload: Record<string, unknown>): ProviderEvent | null {
    const eventId = this.firstString(payload, ['eventId', 'id']);
    const type = this.firstString(payload, ['type', 'event']);
    if (!eventId || !type) return null;
    const metadata = this.parseObject(payload.metadata);
    const amount =
      this.firstNumber(payload, ['amount', 'amountPaid', 'total']) ??
      this.firstNumber(payload, ['amountMinor', 'amount_cents', 'amountPaidMinor'], 100);
    const currency = this.firstString(payload, ['currency'])?.toUpperCase() ?? null;
    const rawPaidAt = this.firstString(payload, ['paidAt', 'paid_at']);
    return {
      eventId,
      type,
      tenantId: this.firstString(payload, ['tenantId']) ?? this.firstString(metadata, ['tenantId']),
      subscriptionId: this.firstString(payload, ['subscriptionId']) ?? this.firstString(metadata, ['subscriptionId']),
      amount,
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      reference:
        this.firstString(payload, ['paymentReference', 'paymentIntent', 'providerReference', 'paymentId']) ??
        this.firstString(metadata, ['paymentReference', 'paymentIntent', 'providerReference']),
      paidAt: rawPaidAt && !Number.isNaN(Date.parse(rawPaidAt)) ? new Date(rawPaidAt) : null,
    };
  }

  private statusForEvent(type: string): string | null {
    const normalised = type.toLowerCase();
    if (['checkout.session.completed', 'payment.succeeded', 'invoice.paid', 'subscription.activated'].includes(normalised)) return 'ACTIVE';
    if (['payment.failed', 'invoice.payment_failed'].includes(normalised)) return 'PAST_DUE';
    if (['subscription.canceled', 'subscription.cancelled', 'subscription.deleted'].includes(normalised)) return 'CANCELLED';
    if (['subscription.restored', 'subscription.resumed'].includes(normalised)) return 'ACTIVE';
    if (['subscription.expired', 'invoice.expired'].includes(normalised)) return 'EXPIRED';
    if (['subscription.trialing'].includes(normalised)) return 'TRIAL';
    return null;
  }

  private isPaymentEvent(type: string): boolean {
    return ['checkout.session.completed', 'payment.succeeded', 'invoice.paid'].includes(type.toLowerCase());
  }

  private mutationView(row: { id: string; tenantId: string; status: string; endDate: Date | null }): BillingMutationView {
    return { id: row.id, tenantId: row.tenantId, status: row.status, endDate: row.endDate?.toISOString() ?? null };
  }

  private parseObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') return {};
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private firstString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() && value.length <= 500) return value;
    }
    return null;
  }

  private firstNumber(record: Record<string, unknown>, keys: string[], divisor = 1): number | null {
    for (const key of keys) {
      const value = record[key];
      const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
      if (Number.isFinite(parsed) && parsed >= 0) return Number((parsed / divisor).toFixed(2));
    }
    return null;
  }

  private isHttpsUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  private badRequest(message: string): BadRequestException {
    return new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message });
  }

  /** Reuse an already-open elevated transaction to avoid TiDB deadlocks. */
  private async runElevated<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const activeTx = tenantScopeStorage.getStore()?.tx as Prisma.TransactionClient | undefined;
    if (activeTx) return runInTenantScope({ tenantId: null, elevated: true, tx: activeTx }, () => work(activeTx));
    return this.prisma.withElevated(work);
  }
}

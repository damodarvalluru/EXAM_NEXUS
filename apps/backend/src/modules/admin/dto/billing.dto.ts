import { IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';

export class CreateCheckoutDto {
  @IsOptional() @IsString() @MaxLength(36) tenantId?: string;
  @IsOptional() @IsString() @MaxLength(80) plan?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) seats?: number;
  @IsOptional() @IsIn(['MONTHLY', 'YEARLY', 'QUARTERLY']) billingCycle?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_tld: false }) successUrl?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_tld: false }) cancelUrl?: string;
}

export class CancelSubscriptionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class RestoreSubscriptionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class DrainNotificationsDto {
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
}

/** Only provider-supplied fields are returned; no amounts are invented here. */
export interface CheckoutView {
  provider: string;
  sessionId: string | null;
  checkoutUrl: string;
  expiresAt: string | null;
}

export interface BillingMutationView {
  id: string;
  tenantId: string;
  status: string;
  endDate: string | null;
}

export interface BillingWebhookView {
  eventId: string;
  status: 'PROCESSED' | 'IGNORED';
  tenantId: string | null;
  subscriptionStatus: string | null;
  paymentId: string | null;
  replayed: boolean;
}

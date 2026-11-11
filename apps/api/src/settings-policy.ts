import { z } from 'zod';
const text = (max: number) => z.string().trim().max(max);
export const publicLink = z.union([
  z.literal(''),
  z
    .string()
    .max(1000)
    .refine((v) => {
      try {
        const u = new URL(v);
        return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
      } catch {
        return false;
      }
    }, 'Use an HTTP or HTTPS URL without credentials'),
]);
export const logoLink = z.union([
  publicLink,
  z.string().regex(/^\/api\/v1\/branding\/[a-f0-9-]{36}\.(png|jpg|webp)$/),
]);
export const experienceSchema = z
  .object({
    siteTitle: text(100).default(''),
    defaultLocale: z
      .enum(['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'hi-IN', 'ja-JP'])
      .default('en-US'),
    appearance: z
      .object({
        defaultTheme: z.enum(['dark', 'light', 'system']).default('dark'),
        radius: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
        density: z.enum(['comfortable', 'compact']).default('comfortable'),
        motion: z.enum(['system', 'reduced']).default('system'),
      })
      .strict()
      .prefault({}),
    storefront: z
      .object({
        badge: text(100).default('Games. Compute. Websites.'),
        title: text(150).default('Built for what you’re building.'),
        description: text(500).default(
          'Game servers, virtual machines, and web hosting. Your next project starts with the right foundation.',
        ),
        plansTitle: text(100).default('Find your next home.'),
        plansDescription: text(300).default('Choose a plan. Make something great.'),
        ctaLabel: text(40).min(1).default('Explore hosting'),
      })
      .strict()
      .prefault({}),
    links: z
      .object({
        supportUrl: publicLink.default(''),
        statusUrl: publicLink.default(''),
        termsUrl: publicLink.default(''),
        privacyUrl: publicLink.default(''),
      })
      .strict()
      .prefault({}),
    footerText: text(300).default(''),
    announcement: z
      .object({
        enabled: z.boolean().default(false),
        text: text(500).default(''),
        tone: z.enum(['info', 'success', 'warning']).default('info'),
        scope: z.enum(['all', 'storefront', 'customer']).default('all'),
      })
      .strict()
      .prefault({}),
  })
  .strict();
export const accessSchema = z
  .object({
    registrationEnabled: z.boolean().default(true),
    registrationDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
      )
      .max(100)
      .default([]),
    ordersEnabled: z.boolean().default(true),
    maintenanceEnabled: z.boolean().default(false),
    maintenanceMessage: text(1000).default(
      'We are performing scheduled maintenance. Please check back shortly.',
    ),
    sessionHours: z.number().int().min(1).max(720).default(168),
    requireVerifiedEmail: z.boolean().default(false),
    requireStaffTwoFactor: z.boolean().default(false),
  })
  .strict();
export const automationSchema = z
  .object({
    invoiceDueDays: z.number().int().min(1).max(90).default(7),
    renewalLeadDays: z.number().int().min(0).max(60).default(7),
    unpaidOrderExpiryHours: z.number().int().min(1).max(2160).default(168),
    autoSuspendEnabled: z.boolean().default(true),
    automaticRenewalCredit: z.boolean().default(false),
  })
  .strict();
export const supportPolicySchema = z
  .object({
    ticketsEnabled: z.boolean().default(true),
    allowAttachments: z.boolean().default(true),
    customerCloseEnabled: z.boolean().default(true),
    maxOpenTickets: z.number().int().min(1).max(100).default(20),
    welcomeMessage: text(1000).default(''),
    supportEmail: z.union([z.email(), z.literal('')]).default(''),
    hoursNote: text(200).default(''),
  })
  .strict();
export const notificationPolicySchema = z
  .object({
    ticketReplyEmails: z.boolean().default(true),
    renewalEmails: z.boolean().default(true),
    loginEmails: z.boolean().default(false),
  })
  .strict();
export const experience = (settings: any) => experienceSchema.parse(settings?.experience || {});
export const accessPolicy = (settings: any) => accessSchema.parse(settings?.access || {});
export const automationPolicy = (settings: any) =>
  automationSchema.parse(settings?.automation || {});
export const supportPolicy = (settings: any) =>
  supportPolicySchema.parse(settings?.supportPolicy || {});
export const notificationPolicy = (settings: any) =>
  notificationPolicySchema.parse(settings?.notifications || {});

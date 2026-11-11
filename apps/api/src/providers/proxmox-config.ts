import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);
const optionalId = z.union([id, z.literal('')]).optional();
const number = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );
export const proxmoxConfigSchema = z
  .object({
    node: id,
    storage: id,
    bridge: id.default('vmbr0'),
    backupStorage: optionalId,
    templateStorage: optionalId,
    pool: optionalId,
    disk: z.enum(['scsi0', 'virtio0', 'sata0']).default('scsi0'),
    cpuModel: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,80}$/)
      .default('x86-64-v2-AES'),
    vlan: number(1, 4094),
    mtu: number(576, 9000),
    rateMbps: number(1, 100000),
    nameserver: z.union([z.ipv4(), z.literal('')]).optional(),
    searchdomain: z
      .string()
      .max(253)
      .regex(/^[a-zA-Z0-9.-]*$/)
      .optional(),
    firewall: z.preprocess(
      (v) => (v === undefined ? true : v === true || v === 'true'),
      z.boolean(),
    ),
    onboot: z.preprocess((v) => (v === undefined ? true : v === true || v === 'true'), z.boolean()),
  })
  .strict();
export const locationSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    city: z.string().trim().min(1).max(100),
    country: z
      .string()
      .trim()
      .length(2)
      .transform((v) => v.toUpperCase()),
    description: z.string().trim().max(500).default(''),
  })
  .strict();
export const ipPoolSchema = z
  .object({
    start: z.ipv4(),
    end: z.ipv4(),
    prefix: z.coerce.number().int().min(1).max(32),
    gateway: z.ipv4(),
    pool: z.string().trim().min(1).max(80),
  })
  .strict();
export const ipv4Number = (ip: string) =>
  ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
export const numberIpv4 = (n: number) =>
  [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

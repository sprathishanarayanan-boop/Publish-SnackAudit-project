const { z } = require('zod');
const { badRequest } = require('./errors');

const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
};

const uuid = z.string().uuid();

const register = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  role: z.enum(['attendee', 'organizer']).default('attendee'),
  organizationName: z.string().trim().min(2).max(80).optional(),
}).refine((v) => v.role !== 'organizer' || !!v.organizationName, {
  message: 'organizationName is required for organizers',
  path: ['organizationName'],
});

const login = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const tier = z.object({
  name: z.string().trim().min(1).max(40),
  priceCents: z.number().int().min(0).max(10_000_000),
  quantity: z.number().int().min(1).max(2000),
  seatPrefix: z.string().trim().regex(/^[A-Za-z0-9]{1,6}$/, 'seatPrefix must be 1-6 letters/digits').optional(),
});

const eventBase = {
  title: z.string().trim().min(3).max(120),
  description: z.string().max(4000).default(''),
  venue: z.string().max(200).default(''),
  startsAt: z.coerce.date(),
  salesEndAt: z.coerce.date(),
};

const createEvent = z.object({
  ...eventBase,
  tiers: z.array(tier).min(1).max(8),
  publish: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.salesEndAt > v.startsAt) ctx.addIssue({ code: 'custom', path: ['salesEndAt'], message: 'Sales must end before the event starts' });
  if (v.salesEndAt <= new Date()) ctx.addIssue({ code: 'custom', path: ['salesEndAt'], message: 'Sales cut-off must be in the future' });
  const names = v.tiers.map((t) => t.name.toLowerCase());
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'Tier names must be unique' });
});

const updateEvent = z.object({
  title: eventBase.title.optional(),
  description: z.string().max(4000).optional(),
  venue: z.string().max(200).optional(),
  startsAt: z.coerce.date().optional(),
  salesEndAt: z.coerce.date().optional(),
  tiers: z.array(tier).min(1).max(8).optional(),
});

const hold = z.object({
  ticketIds: z.array(uuid).min(1).max(50).optional(),
  items: z.array(z.object({ tierId: uuid, quantity: z.number().int().min(1).max(50) })).min(1).max(8).optional(),
}).refine((v) => !!v.ticketIds !== !!v.items, { message: 'Provide either ticketIds (seat selection) or items (quantity per tier)' });

const checkout = z.object({
  cardNumber: z.string().regex(/^\d{12,19}$/, 'cardNumber must be 12-19 digits'),
});

module.exports = { parse, z, uuid, register, login, createEvent, updateEvent, hold, checkout };

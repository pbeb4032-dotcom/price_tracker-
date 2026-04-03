/**
 * Shkad Aadel — Zod Validation Schemas
 * 
 * Single source of truth for all input validation.
 * Used in forms (client-side) and edge functions (server-side).
 */

import { z } from 'zod';

// ---- Shared Refinements ----

/** Trims and checks non-empty for Arabic/English text */
const requiredText = (fieldAr: string, maxLen = 255) =>
  z
    .string()
    .trim()
    .min(1, { message: `${fieldAr} مطلوب` })
    .max(maxLen, { message: `${fieldAr} يجب أن لا يتجاوز ${maxLen} حرفاً` });

const optionalText = (maxLen = 500) =>
  z.string().trim().max(maxLen).optional().or(z.literal(''));

const positiveNumber = (fieldAr: string) =>
  z.number({ invalid_type_error: `${fieldAr} يجب أن يكون رقماً` }).positive({
    message: `${fieldAr} يجب أن يكون رقماً موجباً`,
  });

const uuid = z.string().uuid({ message: 'معرّف غير صالح' });

// ---- Profile ----

export const profileUpdateSchema = z.object({
  display_name: requiredText('اسم العرض', 100),
  language: z.enum(['ar', 'en'], { message: 'لغة غير مدعومة' }),
  preferred_region_id: uuid.optional().nullable(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ---- Price Report ----

export const priceReportCreateSchema = z.object({
  product_id: uuid,
  store_id: uuid.optional().nullable(),
  region_id: uuid,
  price: positiveNumber('السعر').max(999999999, { message: 'السعر مرتفع جداً' }),
  currency: z.string().default('IQD'),
  unit: requiredText('الوحدة', 20),
  quantity: z.number().positive().default(1),
  notes: optionalText(1000),
});

export type PriceReportCreateInput = z.infer<typeof priceReportCreateSchema>;

// ---- Store ----

export const storeCreateSchema = z.object({
  name_ar: requiredText('اسم المتجر', 200),
  name_en: optionalText(200),
  region_id: uuid,
  address: optionalText(500),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  store_type: z.enum(['retail', 'wholesale', 'market', 'online'], {
    message: 'نوع المتجر غير صالح',
  }),
});

export type StoreCreateInput = z.infer<typeof storeCreateSchema>;

// ---- Alert ----

export const alertCreateSchema = z.object({
  product_id: uuid,
  region_id: uuid.optional().nullable(),
  target_price: positiveNumber('السعر المستهدف').optional().nullable(),
  alert_type: z.enum(['price_drop', 'price_spike', 'new_report'], {
    message: 'نوع التنبيه غير صالح',
  }),
});

export type AlertCreateInput = z.infer<typeof alertCreateSchema>;

// ---- Vote ----

export const voteSchema = z.object({
  report_id: uuid,
  vote_type: z.enum(['up', 'down'], { message: 'نوع التصويت غير صالح' }),
});

export type VoteInput = z.infer<typeof voteSchema>;

// ---- Moderation ----

export const moderationActionSchema = z.object({
  report_id: uuid.optional().nullable(),
  action_type: z.enum(
    ['approve', 'reject', 'flag', 'unflag', 'ban_user', 'warn_user'],
    { message: 'نوع الإجراء غير صالح' }
  ),
  reason: optionalText(1000),
});

export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

// ---- Auth ----

export const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: 'البريد الإلكتروني غير صالح' })
    .max(255),
  password: z
    .string()
    .min(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
    .max(72, { message: 'كلمة المرور طويلة جداً' }),
  display_name: requiredText('اسم العرض', 100),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().email({ message: 'البريد الإلكتروني غير صالح' }),
  password: z.string().min(1, { message: 'كلمة المرور مطلوبة' }),
});

export type SignInInput = z.infer<typeof signInSchema>;

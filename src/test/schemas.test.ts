import { describe, it, expect } from 'vitest';
import {
  priceReportCreateSchema,
  signUpSchema,
  signInSchema,
  alertCreateSchema,
  voteSchema,
  storeCreateSchema,
  profileUpdateSchema,
  moderationActionSchema,
} from '@/lib/validation/schemas';

// ---- Price Report ----

describe('priceReportCreateSchema', () => {
  const validReport = {
    product_id: '550e8400-e29b-41d4-a716-446655440000',
    region_id: '550e8400-e29b-41d4-a716-446655440001',
    price: 1500,
    unit: 'kg',
  };

  it('accepts valid price report', () => {
    expect(priceReportCreateSchema.safeParse(validReport).success).toBe(true);
  });

  it('rejects negative price', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, price: -100 }).success).toBe(false);
  });

  it('rejects zero price', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, price: 0 }).success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, product_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects excessively high price', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, price: 9999999999 }).success).toBe(false);
  });

  it('accepts optional store_id as null', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, store_id: null }).success).toBe(true);
  });

  it('accepts optional notes', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, notes: 'سعر جيد' }).success).toBe(true);
  });

  it('rejects notes exceeding 1000 chars', () => {
    expect(priceReportCreateSchema.safeParse({ ...validReport, notes: 'أ'.repeat(1001) }).success).toBe(false);
  });

  it('defaults currency to IQD', () => {
    const result = priceReportCreateSchema.parse(validReport);
    expect(result.currency).toBe('IQD');
  });

  it('defaults quantity to 1', () => {
    const result = priceReportCreateSchema.parse(validReport);
    expect(result.quantity).toBe(1);
  });

  it('rejects missing region_id', () => {
    const { region_id, ...noRegion } = validReport;
    expect(priceReportCreateSchema.safeParse(noRegion).success).toBe(false);
  });
});

// ---- Sign Up ----

describe('signUpSchema', () => {
  const validSignUp = {
    email: 'user@example.com',
    password: 'secure123',
    display_name: 'أحمد',
  };

  it('accepts valid signup', () => {
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true);
  });

  it('rejects short password', () => {
    expect(signUpSchema.safeParse({ ...validSignUp, password: '123' }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(signUpSchema.safeParse({ ...validSignUp, email: 'not-email' }).success).toBe(false);
  });

  it('rejects empty display name', () => {
    expect(signUpSchema.safeParse({ ...validSignUp, display_name: '' }).success).toBe(false);
  });

  it('rejects password over 72 chars', () => {
    expect(signUpSchema.safeParse({ ...validSignUp, password: 'a'.repeat(73) }).success).toBe(false);
  });

  it('trims email whitespace', () => {
    const result = signUpSchema.parse({ ...validSignUp, email: '  user@example.com  ' });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects missing email', () => {
    const { email, ...noEmail } = validSignUp;
    expect(signUpSchema.safeParse(noEmail).success).toBe(false);
  });
});

// ---- Sign In ----

describe('signInSchema', () => {
  it('accepts valid sign in', () => {
    expect(signInSchema.safeParse({ email: 'user@example.com', password: 'secure123' }).success).toBe(true);
  });

  it('rejects empty password', () => {
    expect(signInSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(false);
  });

  it('rejects missing email field', () => {
    expect(signInSchema.safeParse({ password: 'secure123' }).success).toBe(false);
  });
});

// ---- Alert ----

describe('alertCreateSchema', () => {
  it('accepts valid alert', () => {
    expect(alertCreateSchema.safeParse({
      product_id: '550e8400-e29b-41d4-a716-446655440000',
      alert_type: 'price_drop',
      target_price: 5000,
    }).success).toBe(true);
  });

  it('rejects invalid alert type', () => {
    expect(alertCreateSchema.safeParse({
      product_id: '550e8400-e29b-41d4-a716-446655440000',
      alert_type: 'invalid',
    }).success).toBe(false);
  });

  it('accepts alert without target_price', () => {
    expect(alertCreateSchema.safeParse({
      product_id: '550e8400-e29b-41d4-a716-446655440000',
      alert_type: 'new_report',
    }).success).toBe(true);
  });

  it('accepts all valid alert types', () => {
    for (const type of ['price_drop', 'price_spike', 'new_report']) {
      expect(alertCreateSchema.safeParse({
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        alert_type: type,
      }).success).toBe(true);
    }
  });
});

// ---- Vote ----

describe('voteSchema', () => {
  it('accepts valid upvote', () => {
    expect(voteSchema.safeParse({
      report_id: '550e8400-e29b-41d4-a716-446655440000',
      vote_type: 'up',
    }).success).toBe(true);
  });

  it('accepts valid downvote', () => {
    expect(voteSchema.safeParse({
      report_id: '550e8400-e29b-41d4-a716-446655440000',
      vote_type: 'down',
    }).success).toBe(true);
  });

  it('rejects invalid vote type', () => {
    expect(voteSchema.safeParse({
      report_id: '550e8400-e29b-41d4-a716-446655440000',
      vote_type: 'maybe',
    }).success).toBe(false);
  });

  it('rejects invalid report_id', () => {
    expect(voteSchema.safeParse({
      report_id: 'bad-id',
      vote_type: 'up',
    }).success).toBe(false);
  });
});

// ---- Store ----

describe('storeCreateSchema', () => {
  const validStore = {
    name_ar: 'سوق الشورجة',
    region_id: '550e8400-e29b-41d4-a716-446655440000',
    store_type: 'market',
  };

  it('accepts valid store', () => {
    expect(storeCreateSchema.safeParse(validStore).success).toBe(true);
  });

  it('rejects empty store name', () => {
    expect(storeCreateSchema.safeParse({ ...validStore, name_ar: '' }).success).toBe(false);
  });

  it('rejects invalid store type', () => {
    expect(storeCreateSchema.safeParse({ ...validStore, store_type: 'invalid' }).success).toBe(false);
  });

  it('rejects invalid latitude', () => {
    expect(storeCreateSchema.safeParse({ ...validStore, latitude: 999 }).success).toBe(false);
  });

  it('rejects invalid longitude', () => {
    expect(storeCreateSchema.safeParse({ ...validStore, longitude: -200 }).success).toBe(false);
  });

  it('accepts all valid store types', () => {
    for (const type of ['retail', 'wholesale', 'market', 'online']) {
      expect(storeCreateSchema.safeParse({ ...validStore, store_type: type }).success).toBe(true);
    }
  });

  it('accepts valid coordinates', () => {
    expect(storeCreateSchema.safeParse({ ...validStore, latitude: 33.3, longitude: 44.4 }).success).toBe(true);
  });
});

// ---- Profile Update ----

describe('profileUpdateSchema', () => {
  it('accepts valid profile update', () => {
    expect(profileUpdateSchema.safeParse({
      display_name: 'محمد',
      language: 'ar',
    }).success).toBe(true);
  });

  it('rejects unsupported language', () => {
    expect(profileUpdateSchema.safeParse({
      display_name: 'محمد',
      language: 'fr',
    }).success).toBe(false);
  });

  it('rejects empty display name', () => {
    expect(profileUpdateSchema.safeParse({
      display_name: '',
      language: 'ar',
    }).success).toBe(false);
  });

  it('accepts English language', () => {
    expect(profileUpdateSchema.safeParse({
      display_name: 'Ahmed',
      language: 'en',
    }).success).toBe(true);
  });
});

// ---- Moderation Action ----

describe('moderationActionSchema', () => {
  it('accepts valid moderation action', () => {
    expect(moderationActionSchema.safeParse({
      report_id: '550e8400-e29b-41d4-a716-446655440000',
      action_type: 'approve',
    }).success).toBe(true);
  });

  it('rejects invalid action type', () => {
    expect(moderationActionSchema.safeParse({
      action_type: 'invalid_action',
    }).success).toBe(false);
  });

  it('accepts all valid action types', () => {
    for (const type of ['approve', 'reject', 'flag', 'unflag', 'ban_user', 'warn_user']) {
      expect(moderationActionSchema.safeParse({ action_type: type }).success).toBe(true);
    }
  });

  it('accepts optional reason', () => {
    expect(moderationActionSchema.safeParse({
      action_type: 'reject',
      reason: 'سعر غير واقعي',
    }).success).toBe(true);
  });
});

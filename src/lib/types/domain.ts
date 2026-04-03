/**
 * Shkad Aadel — Domain Types
 * 
 * These are the application-level types used throughout the codebase.
 * Database types are auto-generated in integrations/supabase/types.ts.
 * These types add semantic meaning and are used with Zod schemas.
 */

// ---- Enums ----

export type AppRole = 'user' | 'moderator' | 'admin';
export type ReportStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type VoteType = 'up' | 'down';
export type AlertType = 'price_drop' | 'price_spike' | 'new_report';
export type ModerationActionType = 'approve' | 'reject' | 'flag' | 'unflag' | 'ban_user' | 'warn_user';
export type SupportedLanguage = 'ar' | 'en';

// ---- Base ----

export interface Timestamped {
  created_at: string;
  updated_at: string;
}

// ---- Domain Entities ----

export interface Profile extends Timestamped {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  preferred_region_id: string | null;
  language: SupportedLanguage;
}

export interface Region extends Timestamped {
  id: string;
  name_ar: string;
  name_en: string | null;
  parent_region_id: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
}

export interface Product extends Timestamped {
  id: string;
  name_ar: string;
  name_en: string | null;
  category: string;
  unit: string;
  description_ar: string | null;
  description_en: string | null;
  image_url: string | null;
  is_active: boolean;
}

export interface ProductAlias {
  id: string;
  product_id: string;
  alias_name: string;
  language: string;
  created_at: string;
}

export interface Store extends Timestamped {
  id: string;
  name_ar: string;
  name_en: string | null;
  region_id: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  store_type: string;
  is_verified: boolean;
  created_by: string | null;
}

export interface PriceReport extends Timestamped {
  id: string;
  user_id: string;
  product_id: string;
  store_id: string | null;
  region_id: string;
  price: number;
  currency: string;
  unit: string;
  quantity: number;
  notes: string | null;
  photo_url: string | null;
  status: ReportStatus;
  trust_score: number;
  upvotes: number;
  downvotes: number;
  reported_at: string;
}

export interface ReportVote {
  id: string;
  report_id: string;
  user_id: string;
  vote_type: VoteType;
  created_at: string;
}

export interface Alert extends Timestamped {
  id: string;
  user_id: string;
  product_id: string;
  region_id: string | null;
  target_price: number | null;
  alert_type: AlertType;
  is_active: boolean;
  last_triggered_at: string | null;
}

export interface ModerationAction {
  id: string;
  moderator_id: string;
  report_id: string | null;
  action_type: ModerationActionType;
  reason: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ---- API Types ----

export interface ApiSuccessResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    request_id?: string;
    has_more?: boolean;
    next_cursor?: string;
  };
}

export interface ApiErrorDetail {
  field?: string;
  issue: string;
  issue_en?: string;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    message_en?: string;
    details?: ApiErrorDetail[];
  };
  meta: {
    timestamp: string;
    request_id?: string;
  };
}

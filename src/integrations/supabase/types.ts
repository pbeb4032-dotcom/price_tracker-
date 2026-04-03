export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          include_delivery: boolean
          is_active: boolean
          last_triggered_at: string | null
          product_id: string
          region_id: string | null
          target_price: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_type?: string
          created_at?: string
          id?: string
          include_delivery?: boolean
          is_active?: boolean
          last_triggered_at?: string | null
          product_id: string
          region_id?: string | null
          target_price?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          include_delivery?: boolean
          is_active?: boolean
          last_triggered_at?: string | null
          product_id?: string
          region_id?: string | null
          target_price?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "alerts_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      crawl_frontier: {
        Row: {
          blocked_reason: string | null
          canonical_url: string | null
          content_hash: string | null
          content_type: string | null
          depth: number
          discovered_at: string
          discovered_from: string | null
          fetch_ms: number | null
          http_status: number | null
          id: string
          last_crawled_at: string | null
          last_error: string | null
          last_error_code: string | null
          next_retry_at: string
          page_type: string
          parent_url: string | null
          retry_count: number
          source_domain: string
          status: string
          updated_at: string
          url: string
          url_hash: string | null
        }
        Insert: {
          blocked_reason?: string | null
          canonical_url?: string | null
          content_hash?: string | null
          content_type?: string | null
          depth?: number
          discovered_at?: string
          discovered_from?: string | null
          fetch_ms?: number | null
          http_status?: number | null
          id?: string
          last_crawled_at?: string | null
          last_error?: string | null
          last_error_code?: string | null
          next_retry_at?: string
          page_type?: string
          parent_url?: string | null
          retry_count?: number
          source_domain: string
          status?: string
          updated_at?: string
          url: string
          url_hash?: string | null
        }
        Update: {
          blocked_reason?: string | null
          canonical_url?: string | null
          content_hash?: string | null
          content_type?: string | null
          depth?: number
          discovered_at?: string
          discovered_from?: string | null
          fetch_ms?: number | null
          http_status?: number | null
          id?: string
          last_crawled_at?: string | null
          last_error?: string | null
          last_error_code?: string | null
          next_retry_at?: string
          page_type?: string
          parent_url?: string | null
          retry_count?: number
          source_domain?: string
          status?: string
          updated_at?: string
          url?: string
          url_hash?: string | null
        }
        Relationships: []
      }
      domain_bootstrap_paths: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          page_type: string
          path: string
          priority: number
          source_domain: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          page_type?: string
          path: string
          priority?: number
          source_domain: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          page_type?: string
          path?: string
          priority?: number
          source_domain?: string
        }
        Relationships: []
      }
      domain_url_patterns: {
        Row: {
          category_regex: string
          domain: string
          product_regex: string
          updated_at: string
        }
        Insert: {
          category_regex: string
          domain: string
          product_regex: string
          updated_at?: string
        }
        Update: {
          category_regex?: string
          domain?: string
          product_regex?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_delivery_logs: {
        Row: {
          created_at: string
          error_text: string | null
          id: string
          provider_message_id: string | null
          queue_id: string
          status_code: number
        }
        Insert: {
          created_at?: string
          error_text?: string | null
          id?: string
          provider_message_id?: string | null
          queue_id: string
          status_code: number
        }
        Update: {
          created_at?: string
          error_text?: string | null
          id?: string
          provider_message_id?: string | null
          queue_id?: string
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_logs_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "email_notification_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notification_queue: {
        Row: {
          attempts: number
          body_ar: string
          created_at: string
          email_to: string
          id: string
          last_error: string | null
          notification_id: string
          payload: Json
          sent_at: string | null
          status: string
          subject_ar: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body_ar: string
          created_at?: string
          email_to: string
          id?: string
          last_error?: string | null
          notification_id: string
          payload?: Json
          sent_at?: string | null
          status?: string
          subject_ar: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body_ar?: string
          created_at?: string
          email_to?: string
          id?: string
          last_error?: string | null
          notification_id?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          subject_ar?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_notification_queue_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          buy_iqd_per_usd: number | null
          created_at: string
          id: string
          is_active: boolean
          mid_iqd_per_usd: number
          rate_date: string
          sell_iqd_per_usd: number | null
          source_name: string
          source_type: string
        }
        Insert: {
          buy_iqd_per_usd?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          mid_iqd_per_usd: number
          rate_date: string
          sell_iqd_per_usd?: number | null
          source_name: string
          source_type: string
        }
        Update: {
          buy_iqd_per_usd?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          mid_iqd_per_usd?: number
          rate_date?: string
          sell_iqd_per_usd?: number | null
          source_name?: string
          source_type?: string
        }
        Relationships: []
      }
      image_recrawl_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          product_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          product_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          product_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_recrawl_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_recrawl_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      ingest_mutex: {
        Row: {
          lock_until: string
          name: string
          owner: string
          updated_at: string
        }
        Insert: {
          lock_until: string
          name: string
          owner: string
          updated_at?: string
        }
        Update: {
          lock_until?: string
          name?: string
          owner?: string
          updated_at?: string
        }
        Relationships: []
      }
      ingestion_error_events: {
        Row: {
          blocked_reason: string | null
          created_at: string
          error_code: string
          error_message: string | null
          frontier_id: string | null
          http_status: number | null
          id: string
          run_id: string | null
          source_domain: string
          url: string
        }
        Insert: {
          blocked_reason?: string | null
          created_at?: string
          error_code: string
          error_message?: string | null
          frontier_id?: string | null
          http_status?: number | null
          id?: string
          run_id?: string | null
          source_domain: string
          url: string
        }
        Update: {
          blocked_reason?: string | null
          created_at?: string
          error_code?: string
          error_message?: string | null
          frontier_id?: string | null
          http_status?: number | null
          id?: string
          run_id?: string | null
          source_domain?: string
          url?: string
        }
        Relationships: []
      }
      ingestion_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          items_found: number
          items_inserted: number
          items_skipped: number
          items_updated: number
          source_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          items_found?: number
          items_inserted?: number
          items_skipped?: number
          items_updated?: number
          source_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          items_found?: number
          items_inserted?: number
          items_skipped?: number
          items_updated?: number
          source_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_runs: {
        Row: {
          created_at: string
          ended_at: string | null
          failed: number
          function_name: string
          id: string
          notes: string | null
          processed: number
          run_id: string
          started_at: string
          status: string
          succeeded: number
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          failed?: number
          function_name: string
          id?: string
          notes?: string | null
          processed?: number
          run_id: string
          started_at?: string
          status?: string
          succeeded?: number
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          failed?: number
          function_name?: string
          id?: string
          notes?: string | null
          processed?: number
          run_id?: string
          started_at?: string
          status?: string
          succeeded?: number
        }
        Relationships: []
      }
      moderation_actions: {
        Row: {
          action_type: string
          created_at: string
          id: string
          moderator_id: string
          reason: string | null
          report_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          moderator_id: string
          reason?: string | null
          report_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          moderator_id?: string
          reason?: string | null
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "price_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "v_approved_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_push_deliveries: {
        Row: {
          error_text: string | null
          id: number
          notification_id: string
          sent_at: string
          status_code: number | null
          subscription_id: string
        }
        Insert: {
          error_text?: string | null
          id?: number
          notification_id: string
          sent_at?: string
          status_code?: number | null
          subscription_id: string
        }
        Update: {
          error_text?: string | null
          id?: number
          notification_id?: string
          sent_at?: string
          status_code?: number | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_push_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_push_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "web_push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body_ar: string
          created_at: string
          id: string
          is_read: boolean
          payload: Json
          push_sent_at: string | null
          read_at: string | null
          title_ar: string
          type: string
          user_id: string
        }
        Insert: {
          body_ar: string
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json
          push_sent_at?: string | null
          read_at?: string | null
          title_ar: string
          type?: string
          user_id: string
        }
        Update: {
          body_ar?: string
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json
          push_sent_at?: string | null
          read_at?: string | null
          title_ar?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      p2_fx_fix_log: {
        Row: {
          created_at: string
          fixed_at: string | null
          fx_rate: number
          observation_id: string
          old_currency: string | null
          old_price: number
          source_domain: string
        }
        Insert: {
          created_at?: string
          fixed_at?: string | null
          fx_rate: number
          observation_id: string
          old_currency?: string | null
          old_price: number
          source_domain: string
        }
        Update: {
          created_at?: string
          fixed_at?: string | null
          fx_rate?: number
          observation_id?: string
          old_currency?: string | null
          old_price?: number
          source_domain?: string
        }
        Relationships: []
      }
      price_guardrails: {
        Row: {
          category_key: string
          id: string
          max_iqd: number
          min_iqd: number
          updated_at: string
        }
        Insert: {
          category_key: string
          id?: string
          max_iqd: number
          min_iqd: number
          updated_at?: string
        }
        Update: {
          category_key?: string
          id?: string
          max_iqd?: number
          min_iqd?: number
          updated_at?: string
        }
        Relationships: []
      }
      price_reports: {
        Row: {
          created_at: string
          currency: string
          downvotes: number
          id: string
          notes: string | null
          photo_url: string | null
          price: number
          product_id: string
          quantity: number | null
          region_id: string
          reported_at: string
          status: Database["public"]["Enums"]["report_status"]
          store_id: string | null
          trust_score: number | null
          unit: string
          updated_at: string
          upvotes: number
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          downvotes?: number
          id?: string
          notes?: string | null
          photo_url?: string | null
          price: number
          product_id: string
          quantity?: number | null
          region_id: string
          reported_at?: string
          status?: Database["public"]["Enums"]["report_status"]
          store_id?: string | null
          trust_score?: number | null
          unit?: string
          updated_at?: string
          upvotes?: number
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          downvotes?: number
          id?: string
          notes?: string | null
          photo_url?: string | null
          price?: number
          product_id?: string
          quantity?: number | null
          region_id?: string
          reported_at?: string
          status?: Database["public"]["Enums"]["report_status"]
          store_id?: string | null
          trust_score?: number | null
          unit?: string
          updated_at?: string
          upvotes?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "price_reports_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_reports_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      price_sources: {
        Row: {
          base_url: string | null
          country_code: string
          created_at: string
          domain: string
          id: string
          is_active: boolean
          logo_url: string | null
          name_ar: string
          source_kind: string
          trust_weight: number
        }
        Insert: {
          base_url?: string | null
          country_code?: string
          created_at?: string
          domain: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name_ar: string
          source_kind: string
          trust_weight?: number
        }
        Update: {
          base_url?: string | null
          country_code?: string
          created_at?: string
          domain?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name_ar?: string
          source_kind?: string
          trust_weight?: number
        }
        Relationships: []
      }
      product_aliases: {
        Row: {
          alias_name: string
          created_at: string
          id: string
          language: string
          product_id: string
        }
        Insert: {
          alias_name: string
          created_at?: string
          id?: string
          language?: string
          product_id: string
        }
        Update: {
          alias_name?: string
          created_at?: string
          id?: string
          language?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_identity_map: {
        Row: {
          confidence: number
          created_at: string
          fingerprint: string
          id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          fingerprint: string
          id?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          fingerprint?: string
          id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_images: {
        Row: {
          confidence_score: number
          created_at: string
          height: number | null
          id: string
          image_url: string
          is_primary: boolean
          is_verified: boolean
          perceptual_hash: string | null
          position: number
          product_id: string
          source_page_url: string | null
          source_site: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          height?: number | null
          id?: string
          image_url: string
          is_primary?: boolean
          is_verified?: boolean
          perceptual_hash?: string | null
          position?: number
          product_id: string
          source_page_url?: string | null
          source_site?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          confidence_score?: number
          created_at?: string
          height?: number | null
          id?: string
          image_url?: string
          is_primary?: boolean
          is_verified?: boolean
          perceptual_hash?: string | null
          position?: number
          product_id?: string
          source_page_url?: string | null
          source_site?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand_ar: string | null
          brand_en: string | null
          category: string
          code: string | null
          condition: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name_ar: string
          name_en: string | null
          size_unit: string | null
          size_value: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand_ar?: string | null
          brand_en?: string | null
          category?: string
          code?: string | null
          condition?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          size_unit?: string | null
          size_value?: number | null
          unit?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand_ar?: string | null
          brand_en?: string | null
          category?: string
          code?: string | null
          condition?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          size_unit?: string | null
          size_value?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          language: string
          preferred_region_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          language?: string
          preferred_region_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          language?: string
          preferred_region_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name_ar: string
          name_en: string | null
          parent_region_id: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name_ar: string
          name_en?: string | null
          parent_region_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name_ar?: string
          name_en?: string | null
          parent_region_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regions_parent_region_id_fkey"
            columns: ["parent_region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_votes: {
        Row: {
          created_at: string
          id: string
          report_id: string
          user_id: string
          vote_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          report_id: string
          user_id: string
          vote_type: string
        }
        Update: {
          created_at?: string
          id?: string
          report_id?: string
          user_id?: string
          vote_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_votes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "price_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_votes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "v_approved_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      search_brand_aliases: {
        Row: {
          alias: string
          boost: number
          created_at: string
          id: number
          is_active: boolean
        }
        Insert: {
          alias: string
          boost?: number
          created_at?: string
          id?: number
          is_active?: boolean
        }
        Update: {
          alias?: string
          boost?: number
          created_at?: string
          id?: number
          is_active?: boolean
        }
        Relationships: []
      }
      search_cache_entries: {
        Row: {
          best_price_iqd: number | null
          created_at: string
          id: string
          image_url: string | null
          payload: Json
          product_id: string
          query_id: string
          rank: number
          rank_score: number
          region_id: string
          source_id: string | null
          source_name: string | null
          updated_at: string
        }
        Insert: {
          best_price_iqd?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          payload?: Json
          product_id: string
          query_id: string
          rank: number
          rank_score?: number
          region_id?: string
          source_id?: string | null
          source_name?: string | null
          updated_at?: string
        }
        Update: {
          best_price_iqd?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          payload?: Json
          product_id?: string
          query_id?: string
          rank?: number
          rank_score?: number
          region_id?: string
          source_id?: string | null
          source_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_cache_entries_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "search_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      search_intent_rules: {
        Row: {
          alias: string
          boost: number
          created_at: string
          id: number
          intent: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          alias: string
          boost: number
          created_at?: string
          id?: number
          intent: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          alias?: string
          boost?: number
          created_at?: string
          id?: number
          intent?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      search_quality_runs: {
        Row: {
          ac3_apple_ratio: number
          ac5_jaccard_jawwal_hatif: number
          active_short_aliases: number
          details: Json
          id: number
          intent_rules_count: number
          overall_pass: boolean
          p95_latency_ms: number
          run_at: string
        }
        Insert: {
          ac3_apple_ratio?: number
          ac5_jaccard_jawwal_hatif?: number
          active_short_aliases?: number
          details?: Json
          id?: number
          intent_rules_count?: number
          overall_pass?: boolean
          p95_latency_ms?: number
          run_at?: string
        }
        Update: {
          ac3_apple_ratio?: number
          ac5_jaccard_jawwal_hatif?: number
          active_short_aliases?: number
          details?: Json
          id?: number
          intent_rules_count?: number
          overall_pass?: boolean
          p95_latency_ms?: number
          run_at?: string
        }
        Relationships: []
      }
      search_queries: {
        Row: {
          avg_latency_ms: number | null
          created_at: string
          expires_at: string
          filters: Json
          hits_count: number
          id: string
          last_executed_at: string
          normalized_query: string
          query_key: string
          query_text: string
          result_count: number
          status: string
          updated_at: string
        }
        Insert: {
          avg_latency_ms?: number | null
          created_at?: string
          expires_at: string
          filters?: Json
          hits_count?: number
          id?: string
          last_executed_at?: string
          normalized_query: string
          query_key: string
          query_text: string
          result_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          avg_latency_ms?: number | null
          created_at?: string
          expires_at?: string
          filters?: Json
          hits_count?: number
          id?: string
          last_executed_at?: string
          normalized_query?: string
          query_key?: string
          query_text?: string
          result_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      search_query_events: {
        Row: {
          cache_hit: boolean
          created_at: string
          id: number
          latency_ms: number
          query_id: string
          result_count: number
        }
        Insert: {
          cache_hit: boolean
          created_at?: string
          id?: number
          latency_ms: number
          query_id: string
          result_count?: number
        }
        Update: {
          cache_hit?: boolean
          created_at?: string
          id?: number
          latency_ms?: number
          query_id?: string
          result_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_query_events_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "search_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      search_synonyms: {
        Row: {
          alias: string
          canonical: string
          created_at: string
          id: number
          is_active: boolean
          weight: number
        }
        Insert: {
          alias: string
          canonical: string
          created_at?: string
          id?: number
          is_active?: boolean
          weight?: number
        }
        Update: {
          alias?: string
          canonical?: string
          created_at?: string
          id?: number
          is_active?: boolean
          weight?: number
        }
        Relationships: []
      }
      source_adapters: {
        Row: {
          adapter_type: string
          created_at: string
          id: string
          is_active: boolean
          priority: number
          selectors: Json
          source_id: string
          updated_at: string
        }
        Insert: {
          adapter_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          selectors?: Json
          source_id: string
          updated_at?: string
        }
        Update: {
          adapter_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          selectors?: Json
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_adapters_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_domain_rules: {
        Row: {
          country_code: string
          created_at: string
          domain: string
          is_active: boolean
        }
        Insert: {
          country_code?: string
          created_at?: string
          domain: string
          is_active?: boolean
        }
        Update: {
          country_code?: string
          created_at?: string
          domain?: string
          is_active?: boolean
        }
        Relationships: []
      }
      source_entrypoints: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_active: boolean
          page_type: string
          priority: number
          url: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          is_active?: boolean
          page_type?: string
          priority?: number
          url: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_active?: boolean
          page_type?: string
          priority?: number
          url?: string
        }
        Relationships: []
      }
      source_price_observations: {
        Row: {
          anomaly_reason: string | null
          created_at: string
          currency: string
          delivery_fee: number | null
          discount_price: number | null
          evidence_ref: string | null
          evidence_type: string
          id: string
          in_stock: boolean
          is_price_anomaly: boolean | null
          is_synthetic: boolean
          is_verified: boolean
          merchant_name: string | null
          normalization_factor: number | null
          normalized_price_iqd: number | null
          observed_at: string
          parsed_currency: string | null
          price: number
          price_confidence: number | null
          product_condition: string
          product_id: string
          raw_price_text: string | null
          region_id: string
          source_id: string
          source_url: string
          synthetic_reason: string | null
          unit: string
        }
        Insert: {
          anomaly_reason?: string | null
          created_at?: string
          currency?: string
          delivery_fee?: number | null
          discount_price?: number | null
          evidence_ref?: string | null
          evidence_type: string
          id?: string
          in_stock?: boolean
          is_price_anomaly?: boolean | null
          is_synthetic?: boolean
          is_verified?: boolean
          merchant_name?: string | null
          normalization_factor?: number | null
          normalized_price_iqd?: number | null
          observed_at?: string
          parsed_currency?: string | null
          price: number
          price_confidence?: number | null
          product_condition?: string
          product_id: string
          raw_price_text?: string | null
          region_id: string
          source_id: string
          source_url: string
          synthetic_reason?: string | null
          unit: string
        }
        Update: {
          anomaly_reason?: string | null
          created_at?: string
          currency?: string
          delivery_fee?: number | null
          discount_price?: number | null
          evidence_ref?: string | null
          evidence_type?: string
          id?: string
          in_stock?: boolean
          is_price_anomaly?: boolean | null
          is_synthetic?: boolean
          is_verified?: boolean
          merchant_name?: string | null
          normalization_factor?: number | null
          normalized_price_iqd?: number | null
          observed_at?: string
          parsed_currency?: string | null
          price?: number
          price_confidence?: number | null
          product_condition?: string
          product_id?: string
          raw_price_text?: string | null
          region_id?: string
          source_id?: string
          source_url?: string
          synthetic_reason?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "source_price_observations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_raw_items: {
        Row: {
          external_item_id: string | null
          fetched_at: string
          id: string
          parse_error: string | null
          parse_status: string
          raw_payload: Json
          raw_title: string | null
          raw_url: string | null
          run_id: string
          source_id: string
        }
        Insert: {
          external_item_id?: string | null
          fetched_at?: string
          id?: string
          parse_error?: string | null
          parse_status?: string
          raw_payload: Json
          raw_title?: string | null
          raw_url?: string | null
          run_id: string
          source_id: string
        }
        Update: {
          external_item_id?: string | null
          fetched_at?: string
          id?: string
          parse_error?: string | null
          parse_status?: string
          raw_payload?: Json
          raw_title?: string | null
          raw_url?: string | null
          run_id?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_raw_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_raw_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_sync_runs: {
        Row: {
          error_count: number
          error_summary: string | null
          fetched_count: number
          finished_at: string | null
          id: string
          inserted_count: number
          meta: Json
          normalized_count: number
          source_id: string
          started_at: string
          status: string
          updated_count: number
        }
        Insert: {
          error_count?: number
          error_summary?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          inserted_count?: number
          meta?: Json
          normalized_count?: number
          source_id: string
          started_at?: string
          status?: string
          updated_count?: number
        }
        Update: {
          error_count?: number
          error_summary?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          inserted_count?: number
          meta?: Json
          normalized_count?: number
          source_id?: string
          started_at?: string
          status?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_sync_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          id: string
          is_verified: boolean
          latitude: number | null
          longitude: number | null
          name_ar: string
          name_en: string | null
          region_id: string
          store_type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_verified?: boolean
          latitude?: number | null
          longitude?: number | null
          name_ar: string
          name_en?: string | null
          region_id: string
          store_type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_verified?: boolean
          latitude?: number | null
          longitude?: number | null
          name_ar?: string
          name_en?: string | null
          region_id?: string
          store_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          email_enabled: boolean
          notifications_unread_only: boolean
          push_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          notifications_unread_only?: boolean
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          notifications_unread_only?: boolean
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      web_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          is_active: boolean
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          is_active?: boolean
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          is_active?: boolean
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      product_price_snapshot: {
        Row: {
          display_iqd: number | null
          median_iqd: number | null
          product_id: string | null
          samples: number | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_price_snapshot_v2: {
        Row: {
          display_iqd: number | null
          is_trusted: boolean | null
          median_iqd: number | null
          product_id: string | null
          samples: number | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_price_snapshot_v3: {
        Row: {
          display_iqd: number | null
          high_iqd_safe: number | null
          is_trusted: boolean | null
          low_iqd_safe: number | null
          product_id: string | null
          samples: number | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      v_approved_reports: {
        Row: {
          created_at: string | null
          currency: string | null
          downvotes: number | null
          id: string | null
          notes: string | null
          price: number | null
          product_id: string | null
          quantity: number | null
          region_id: string | null
          reported_at: string | null
          store_id: string | null
          trust_score: number | null
          unit: string | null
          upvotes: number | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          downvotes?: number | null
          id?: string | null
          notes?: string | null
          price?: number | null
          product_id?: string | null
          quantity?: number | null
          region_id?: string | null
          reported_at?: string | null
          store_id?: string | null
          trust_score?: number | null
          unit?: string | null
          upvotes?: number | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          downvotes?: number | null
          id?: string | null
          notes?: string | null
          price?: number | null
          product_id?: string | null
          quantity?: number | null
          region_id?: string | null
          reported_at?: string | null
          store_id?: string | null
          trust_score?: number | null
          unit?: string | null
          upvotes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "price_reports_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_reports_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      v_best_offers: {
        Row: {
          barcode: string | null
          base_price: number | null
          brand_ar: string | null
          brand_en: string | null
          category: string | null
          currency: string | null
          delivery_fee: number | null
          discount_price: number | null
          final_price: number | null
          in_stock: boolean | null
          merchant_name: string | null
          observed_at: string | null
          offer_id: string | null
          product_id: string | null
          product_image_url: string | null
          product_name_ar: string | null
          product_name_en: string | null
          region_id: string | null
          region_name_ar: string | null
          region_name_en: string | null
          size_unit: string | null
          size_value: number | null
          source_domain: string | null
          source_id: string | null
          source_kind: string | null
          source_logo_url: string | null
          source_name_ar: string | null
          source_url: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "source_price_observations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      v_best_offers_ui: {
        Row: {
          barcode: string | null
          base_price: number | null
          brand_ar: string | null
          brand_en: string | null
          category: string | null
          currency: string | null
          delivery_fee: number | null
          discount_price: number | null
          display_price_iqd: number | null
          final_price: number | null
          high_price_safe: number | null
          in_stock: boolean | null
          is_price_trusted: boolean | null
          last_observed_at: string | null
          low_price_safe: number | null
          merchant_name: string | null
          observed_at: string | null
          offer_id: string | null
          price_quality: string | null
          price_samples: number | null
          product_id: string | null
          product_image_url: string | null
          product_image_url_safe: string | null
          product_name_ar: string | null
          product_name_en: string | null
          region_id: string | null
          region_name_ar: string | null
          region_name_en: string | null
          size_unit: string | null
          size_value: number | null
          source_domain: string | null
          source_id: string | null
          source_kind: string | null
          source_logo_url: string | null
          source_name_ar: string | null
          source_url: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "source_price_observations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      v_product_all_offers: {
        Row: {
          base_price: number | null
          brand_ar: string | null
          brand_en: string | null
          category: string | null
          currency: string | null
          delivery_fee: number | null
          discount_price: number | null
          final_price: number | null
          in_stock: boolean | null
          merchant_name: string | null
          observed_at: string | null
          offer_id: string | null
          product_id: string | null
          product_image_url: string | null
          product_name_ar: string | null
          product_name_en: string | null
          region_id: string | null
          region_name_ar: string | null
          region_name_en: string | null
          source_domain: string | null
          source_id: string | null
          source_kind: string | null
          source_logo_url: string | null
          source_name_ar: string | null
          source_url: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "source_price_observations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      v_product_price_summary: {
        Row: {
          avg_price: number | null
          category: string | null
          latest_report_at: string | null
          max_price: number | null
          min_price: number | null
          name_ar: string | null
          name_en: string | null
          product_id: string | null
          region_id: string | null
          report_count: number | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_reports_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trusted_price_summary: {
        Row: {
          avg_price_iqd: number | null
          category: string | null
          last_observed_at: string | null
          max_price_iqd: number | null
          min_price_iqd: number | null
          product_id: string | null
          product_name_ar: string | null
          product_name_en: string | null
          region_id: string | null
          region_name_ar: string | null
          region_name_en: string | null
          sample_count: number | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_price_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_price_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "source_price_observations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_ingest_mutex: {
        Args: { p_name: string; p_owner: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      claim_crawl_frontier_batch:
        | {
            Args: { p_limit: number }
            Returns: {
              depth: number
              id: string
              page_type: string
              source_domain: string
              url: string
            }[]
          }
        | {
            Args: {
              p_exclude_domains?: string[]
              p_limit?: number
              p_per_domain_limit?: number
            }
            Returns: {
              depth: number
              id: string
              page_type: string
              source_domain: string
              url: string
            }[]
          }
      cleanup_search_cache: {
        Args: { p_delete_limit?: number }
        Returns: {
          deleted_entries: number
          deleted_queries: number
        }[]
      }
      enqueue_triggered_price_alert_notifications: {
        Args: { p_cooldown_minutes?: number; p_limit?: number }
        Returns: {
          alert_id: string
          matched_price: number
          notification_id: string
          product_id: string
          target_price: number
          user_id: string
        }[]
      }
      expand_query_text: { Args: { p_query: string }; Returns: string }
      get_ingestion_dashboard: { Args: never; Returns: Json }
      get_pending_email_notifications: {
        Args: { p_limit?: number }
        Returns: {
          body_ar: string
          email_to: string
          notification_id: string
          payload: Json
          queue_id: string
          subject_ar: string
          user_id: string
        }[]
      }
      get_pending_push_notifications: {
        Args: { p_limit?: number }
        Returns: {
          auth: string
          body_ar: string
          endpoint: string
          notification_id: string
          p256dh: string
          payload: Json
          subscription_id: string
          title_ar: string
        }[]
      }
      get_product_price_history: {
        Args: {
          p_days?: number
          p_include_delivery?: boolean
          p_product_id: string
          p_region_id?: string
        }
        Returns: {
          avg_price: number
          day: string
          max_price: number
          min_price: number
          offer_count: number
          source_count: number
        }[]
      }
      get_triggered_price_alerts: {
        Args: { p_limit?: number }
        Returns: {
          alert_id: string
          current_price: number
          product_id: string
          region_id: string
          source_name_ar: string
          source_url: string
          target_price: number
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_blocked_image_host: { Args: { url: string }; Returns: boolean }
      mark_email_delivery: {
        Args: {
          p_error_text?: string
          p_provider_message_id?: string
          p_queue_id: string
          p_status_code: number
        }
        Returns: undefined
      }
      mark_push_delivery: {
        Args: {
          p_error_text?: string
          p_notification_id: string
          p_status_code: number
          p_subscription_id: string
        }
        Returns: undefined
      }
      normalize_ar_text: { Args: { v: string }; Returns: string }
      process_triggered_price_alerts: {
        Args: { p_cooldown_minutes?: number; p_limit?: number }
        Returns: {
          alert_id: string
          include_delivery: boolean
          matched_price: number
          product_id: string
          region_id: string
          target_price: number
          user_id: string
        }[]
      }
      refresh_ingest_mutex: {
        Args: { p_name: string; p_owner: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      release_ingest_mutex: {
        Args: { p_name: string; p_owner: string }
        Returns: boolean
      }
      search_cache_key: {
        Args: { p_filters: Json; p_query_norm: string; p_region_id: string }
        Returns: string
      }
      search_offers_cached: {
        Args: {
          p_category?: string
          p_limit?: number
          p_query: string
          p_region_id?: string
        }
        Returns: {
          barcode: string | null
          base_price: number | null
          brand_ar: string | null
          brand_en: string | null
          category: string | null
          currency: string | null
          delivery_fee: number | null
          discount_price: number | null
          display_price_iqd: number | null
          final_price: number | null
          high_price_safe: number | null
          in_stock: boolean | null
          is_price_trusted: boolean | null
          last_observed_at: string | null
          low_price_safe: number | null
          merchant_name: string | null
          observed_at: string | null
          offer_id: string | null
          price_quality: string | null
          price_samples: number | null
          product_id: string | null
          product_image_url: string | null
          product_image_url_safe: string | null
          product_name_ar: string | null
          product_name_en: string | null
          region_id: string | null
          region_name_ar: string | null
          region_name_en: string | null
          size_unit: string | null
          size_value: number | null
          source_domain: string | null
          source_id: string | null
          source_kind: string | null
          source_logo_url: string | null
          source_name_ar: string | null
          source_url: string | null
          unit: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_best_offers_ui"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_products: {
        Args: {
          category_filter?: string
          limit_count?: number
          search_query: string
        }
        Returns: {
          barcode: string
          brand_ar: string
          brand_en: string
          category: string
          condition: string
          image_url: string
          name_ar: string
          name_en: string
          product_id: string
          similarity_score: number
          unit: string
        }[]
      }
      search_products_engine: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_query: string
          p_region_id?: string
          p_sort?: string
        }
        Returns: {
          out_best_price_iqd: number
          out_cache_hit: boolean
          out_category: string
          out_image_url: string
          out_name_ar: string
          out_name_en: string
          out_product_id: string
          out_query_id: string
          out_rank_score: number
          out_source_name: string
        }[]
      }
      search_products_live: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_query: string
          p_region_id?: string
          p_sort?: string
        }
        Returns: {
          best_price_iqd: number
          category: string
          image_url: string
          name_ar: string
          name_en: string
          product_id: string
          rank_score: number
          source_id: string
          source_name: string
        }[]
      }
      search_quality_snapshot: {
        Args: never
        Returns: {
          ac3_apple_ratio: number
          ac5_jaccard_jawwal_hatif: number
          active_short_aliases: number
          details: Json
          id: number
          intent_rules_count: number
          overall_pass: boolean
          p95_latency_ms: number
          run_at: string
        }
        SetofOptions: {
          from: "*"
          to: "search_quality_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "user" | "moderator" | "admin"
      report_status: "pending" | "approved" | "rejected" | "flagged"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "moderator", "admin"],
      report_status: ["pending", "approved", "rejected", "flagged"],
    },
  },
} as const


-- ================================================
-- Shkad Aadel Foundation Schema
-- ================================================

-- 1. Role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('user', 'moderator', 'admin');

CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function: check role without RLS recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS for user_roles
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    preferred_region_id UUID,
    language TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are publicly viewable"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 3. Regions table
CREATE TABLE public.regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar TEXT NOT NULL,
    name_en TEXT,
    parent_region_id UUID REFERENCES public.regions(id),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Regions are publicly viewable"
  ON public.regions FOR SELECT USING (true);

CREATE POLICY "Admins can manage regions"
  ON public.regions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_regions_parent ON public.regions(parent_region_id);
CREATE INDEX idx_regions_active ON public.regions(is_active) WHERE is_active = true;

-- 4. Products table
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar TEXT NOT NULL,
    name_en TEXT,
    category TEXT NOT NULL DEFAULT 'general',
    unit TEXT NOT NULL DEFAULT 'kg',
    description_ar TEXT,
    description_en TEXT,
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Products are publicly viewable"
  ON public.products FOR SELECT USING (true);

CREATE POLICY "Admins can manage products"
  ON public.products FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_active ON public.products(is_active) WHERE is_active = true;

-- 5. Product aliases (Arabic variant names)
CREATE TABLE public.product_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'ar',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, alias_name)
);

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aliases are publicly viewable"
  ON public.product_aliases FOR SELECT USING (true);

CREATE POLICY "Admins can manage aliases"
  ON public.product_aliases FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_aliases_product ON public.product_aliases(product_id);

-- 6. Stores table
CREATE TABLE public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar TEXT NOT NULL,
    name_en TEXT,
    region_id UUID NOT NULL REFERENCES public.regions(id),
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    store_type TEXT NOT NULL DEFAULT 'retail',
    is_verified BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stores are publicly viewable"
  ON public.stores FOR SELECT USING (true);

CREATE POLICY "Authenticated users can add stores"
  ON public.stores FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins can manage stores"
  ON public.stores FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_stores_region ON public.stores(region_id);
CREATE INDEX idx_stores_type ON public.stores(store_type);

-- 7. Price reports table
CREATE TYPE public.report_status AS ENUM ('pending', 'approved', 'rejected', 'flagged');

CREATE TABLE public.price_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    product_id UUID NOT NULL REFERENCES public.products(id),
    store_id UUID REFERENCES public.stores(id),
    region_id UUID NOT NULL REFERENCES public.regions(id),
    price NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'IQD',
    unit TEXT NOT NULL DEFAULT 'kg',
    quantity NUMERIC(10, 3) DEFAULT 1,
    notes TEXT,
    photo_url TEXT,
    status report_status NOT NULL DEFAULT 'pending',
    trust_score NUMERIC(3, 2) DEFAULT 0,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.price_reports ENABLE ROW LEVEL SECURITY;

-- Public can read approved reports
CREATE POLICY "Approved reports are publicly viewable"
  ON public.price_reports FOR SELECT
  USING (status = 'approved');

-- Authenticated users can see their own reports (any status)
CREATE POLICY "Users can view own reports"
  ON public.price_reports FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own reports
CREATE POLICY "Users can submit reports"
  ON public.price_reports FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own pending reports
CREATE POLICY "Users can update own pending reports"
  ON public.price_reports FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND status = 'pending');

-- Moderators can manage all reports
CREATE POLICY "Moderators can manage reports"
  ON public.price_reports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'));

CREATE INDEX idx_reports_product_region ON public.price_reports(product_id, region_id, reported_at DESC);
CREATE INDEX idx_reports_user ON public.price_reports(user_id);
CREATE INDEX idx_reports_status ON public.price_reports(status);
CREATE INDEX idx_reports_created ON public.price_reports(created_at DESC);

-- 8. Report votes
CREATE TABLE public.report_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.price_reports(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_id, user_id)
);

ALTER TABLE public.report_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Votes are publicly viewable"
  ON public.report_votes FOR SELECT USING (true);

CREATE POLICY "Users can insert own votes"
  ON public.report_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own votes"
  ON public.report_votes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own votes"
  ON public.report_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_votes_report ON public.report_votes(report_id);
CREATE INDEX idx_votes_user ON public.report_votes(user_id);

-- 9. Alerts table
CREATE TABLE public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id),
    region_id UUID REFERENCES public.regions(id),
    target_price NUMERIC(12, 2),
    alert_type TEXT NOT NULL DEFAULT 'price_drop' CHECK (alert_type IN ('price_drop', 'price_spike', 'new_report')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts"
  ON public.alerts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own alerts"
  ON public.alerts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own alerts"
  ON public.alerts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own alerts"
  ON public.alerts FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_alerts_user ON public.alerts(user_id);
CREATE INDEX idx_alerts_product_region ON public.alerts(product_id, region_id);
CREATE INDEX idx_alerts_active ON public.alerts(is_active) WHERE is_active = true;

-- 10. Moderation actions
CREATE TABLE public.moderation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id UUID NOT NULL REFERENCES auth.users(id),
    report_id UUID REFERENCES public.price_reports(id),
    action_type TEXT NOT NULL CHECK (action_type IN ('approve', 'reject', 'flag', 'unflag', 'ban_user', 'warn_user')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Moderators can view moderation actions"
  ON public.moderation_actions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'));

CREATE POLICY "Moderators can insert moderation actions"
  ON public.moderation_actions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'moderator') AND moderator_id = auth.uid());

CREATE INDEX idx_mod_actions_report ON public.moderation_actions(report_id);
CREATE INDEX idx_mod_actions_moderator ON public.moderation_actions(moderator_id);

-- 11. Audit logs (append-only)
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Audit logs: admins can read, no one can update/delete via client
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No INSERT policy for client — inserts only via triggers/edge functions
-- This prevents direct client writes to audit_logs

CREATE INDEX idx_audit_actor ON public.audit_logs(actor_id);
CREATE INDEX idx_audit_table ON public.audit_logs(table_name, created_at DESC);
CREATE INDEX idx_audit_record ON public.audit_logs(record_id);

-- ================================================
-- Shared Functions & Triggers
-- ================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_regions_updated_at
  BEFORE UPDATE ON public.regions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_price_reports_updated_at
  BEFORE UPDATE ON public.price_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Audit trigger for price_reports status changes
CREATE OR REPLACE FUNCTION public.audit_report_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      auth.uid(),
      'status_change',
      'price_reports',
      NEW.id,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER audit_price_report_status
  AFTER UPDATE ON public.price_reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_report_status_change();

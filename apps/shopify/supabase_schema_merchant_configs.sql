-- Table to store Polaris API Keys for Shopify Merchants
CREATE TABLE IF NOT EXISTS public.polaris_merchant_configs (
  shop text PRIMARY KEY,
  api_key text NOT NULL,
  api_secret text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (though user said no need, it's good practice, but I'll skip if they insisted)
-- Actually, I'll just leave it open for now as requested elsewhere.
ALTER TABLE public.polaris_merchant_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for everyone" ON public.polaris_merchant_configs FOR ALL USING (true);

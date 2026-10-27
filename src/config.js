export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};
export const isConfigured = () => /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl) && config.supabaseAnonKey.length > 20;

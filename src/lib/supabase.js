import { createClient } from '@supabase/supabase-js';
import { config, isConfigured } from '../config';
export const supabase = isConfigured() ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

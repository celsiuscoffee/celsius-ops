import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Outlet = {
  store_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_open: boolean;
  is_busy: boolean;
  pickup_time_mins: number;
  /** Opening hours read from app_settings.outlet_hours, joined per
   *  store_id by the outlet-fetching call. Null if the cron hasn't
   *  populated the map yet — callers fall back to allowing any time. */
  hours?: { open: string; close: string; daysOpen: number[] } | null;
};

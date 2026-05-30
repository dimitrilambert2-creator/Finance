import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ok = URL && KEY;

export const supabase = ok ? createClient(URL, KEY) : null;

export async function chargerDonnees() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("livret_data")
      .select("data")
      .eq("id", "foyer")
      .single();
    if (error || !data?.data || Object.keys(data.data).length === 0) return null;
    return data.data;
  } catch { return null; }
}

export async function sauvegarderDonnees(payload) {
  if (!supabase) return;
  try {
    await supabase
      .from("livret_data")
      .upsert({ id: "foyer", data: payload, updated_at: new Date().toISOString() });
  } catch {}
}

export async function getUpdatedAt() {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("livret_data")
      .select("updated_at")
      .eq("id", "foyer")
      .single();
    return data?.updated_at ?? null;
  } catch { return null; }
}

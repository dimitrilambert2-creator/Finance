import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ok = URL && KEY;

console.log("[supabase] URL:", URL ? URL.slice(0, 30) : "MANQUANTE");
console.log("[supabase] KEY:", KEY ? KEY.slice(0, 20) + "..." : "MANQUANTE");

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
  if (!supabase) { console.warn("[supabase] pas de client, save ignoré"); return; }
  const { error } = await supabase
    .from("livret_data")
    .upsert({ id: "foyer", data: payload, updated_at: new Date().toISOString() });
  if (error) console.error("[supabase] erreur save:", error);
  else console.log("[supabase] sauvegarde OK");
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

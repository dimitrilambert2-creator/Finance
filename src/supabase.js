import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function chargerDonnees() {
  const { data, error } = await supabase
    .from("livret_data")
    .select("data")
    .eq("id", "foyer")
    .single();
  if (error || !data?.data || Object.keys(data.data).length === 0) return null;
  return data.data;
}

export async function sauvegarderDonnees(payload) {
  await supabase
    .from("livret_data")
    .upsert({ id: "foyer", data: payload, updated_at: new Date().toISOString() });
}

export function ecouterChangements(callback) {
  return supabase
    .channel("livret_sync")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "livret_data" }, (payload) => {
      callback(payload.new.data);
    })
    .subscribe();
}

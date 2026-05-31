import { useState, useEffect, useRef } from "react";
import { chargerDonnees, sauvegarderDonnees, getUpdatedAt } from "./supabase.js";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Palette catégories (cycle pour nouvelles enveloppes)
const CAT_PALETTES = [
  { bg: "#FFF3CD", bar: "#F0C060" },
  { bg: "#FFE8E5", bar: "#E87060" },
  { bg: "#E6F5ED", bar: "#5CB87A" },
  { bg: "#EAF2FA", bar: "#6BAED4" },
  { bg: "#F3F0EA", bar: "#B0A899" },
];

const DEFAULT_ENVELOPPES = [
  { id: 1, name: "Loyer", icon: "🏠", paletteIdx: 0, provisionMensuelle: 0, solde: 0 },
  { id: 2, name: "Électricité / Gaz", icon: "⚡", paletteIdx: 1, provisionMensuelle: 0, solde: 0 },
  { id: 3, name: "Internet / Tél.", icon: "📡", paletteIdx: 3, provisionMensuelle: 0, solde: 0 },
  { id: 4, name: "Assurances", icon: "🛡️", paletteIdx: 3, provisionMensuelle: 0, solde: 0 },
  { id: 5, name: "Épargne", icon: "💰", paletteIdx: 2, provisionMensuelle: 0, solde: 0, isSavings: true },
  { id: 6, name: "Autre", icon: "📋", paletteIdx: 4, provisionMensuelle: 0, solde: 0 },
];

const DEFAULT_DATA = {
  enveloppes: DEFAULT_ENVELOPPES,
  mouvements: [],
  nextId: 7,
};


const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n ?? 0);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);
const labelMois = (mois) => {
  const [y, mo] = mois.split("-");
  return new Date(y, mo - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};

export default function App() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [synced, setSynced] = useState(false);
  const [view, setView] = useState("enveloppes");
  const [activeEnv, setActiveEnv] = useState(null);
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({});
  const isRemoteUpdate = useRef(false);
  const lastUpdatedAt = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    upd(d => {
      const oldIndex = d.enveloppes.findIndex(e => e.id === active.id);
      const newIndex = d.enveloppes.findIndex(e => e.id === over.id);
      d.enveloppes = arrayMove(d.enveloppes, oldIndex, newIndex);
    });
  };

  // Chargement initial depuis Supabase
  useEffect(() => {
    chargerDonnees().then(remote => {
      if (remote) setData({ ...DEFAULT_DATA, ...remote });
      setSynced(true);
    });
    getUpdatedAt().then(ts => { lastUpdatedAt.current = ts; });
  }, []);

  // Sauvegarde vers Supabase à chaque changement local
  useEffect(() => {
    if (!synced || isRemoteUpdate.current) { isRemoteUpdate.current = false; return; }
    sauvegarderDonnees(data).then(() => {
      getUpdatedAt().then(ts => { lastUpdatedAt.current = ts; });
    });
  }, [data, synced]);

  // Polling toutes les 5 secondes pour détecter les changements d'un autre appareil
  useEffect(() => {
    const interval = setInterval(async () => {
      const ts = await getUpdatedAt();
      if (ts && ts !== lastUpdatedAt.current) {
        lastUpdatedAt.current = ts;
        const remote = await chargerDonnees();
        if (remote) {
          isRemoteUpdate.current = true;
          setData(prev => ({ ...prev, ...remote }));
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const upd = (fn) => setData(prev => { const n = JSON.parse(JSON.stringify(prev)); fn(n); return n; });

  const todayStr = today();
  const getSoldeReel = (envId) => data.mouvements
    .filter(m => m.enveloppeId === envId && m.date <= todayStr)
    .reduce((s, m) => m.type === "credit" ? s + m.montant : s - m.montant, 0);
  const getSoldeProjete = (envId) => data.mouvements
    .filter(m => m.enveloppeId === envId)
    .reduce((s, m) => m.type === "credit" ? s + m.montant : s - m.montant, 0);
  const hasFuturs = (envId) => data.mouvements.some(m => m.enveloppeId === envId && m.date > todayStr);

  const soldeTotal = data.enveloppes.reduce((s, e) => s + getSoldeReel(e.id), 0);
  const enveloppeEpargne = data.enveloppes.find(e => e.isSavings);
  const soldeEpargne = enveloppeEpargne ? getSoldeReel(enveloppeEpargne.id) : 0;
  const totalProvisions = data.enveloppes.reduce((s, e) => s + (e.provisionMensuelle || 0), 0);

  const getEnv = (id) => data.enveloppes.find(e => e.id === id);
  const getMouvements = (envId) => data.mouvements.filter(m => m.enveloppeId === envId).sort((a, b) => b.date.localeCompare(a.date));

  const moisDispos = [...new Set(data.mouvements.map(m => m.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
  const getRecapMois = (mois) => {
    const mvts = data.mouvements.filter(m => m.date.startsWith(mois));
    const entrees = mvts.filter(m => m.type === "credit").reduce((s, m) => s + m.montant, 0);
    const sorties = mvts.filter(m => m.type === "debit").reduce((s, m) => s + m.montant, 0);
    return { entrees, sorties, net: entrees - sorties };
  };

  const anneeActuelle = new Date().getFullYear().toString();
  const moisAnnee = Array.from({ length: 12 }, (_, i) => `${anneeActuelle}-${String(i + 1).padStart(2, "0")}`);
  const shortMois = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const moisCourant = new Date().toISOString().slice(0, 7);
  const graphPoints = (() => {
    let cumul = 0;
    return moisAnnee.map((mois, i) => {
      const mvts = data.mouvements.filter(m => m.date.startsWith(mois));
      const net = mvts.filter(m => m.type === "credit").reduce((s, m) => s + m.montant, 0)
                - mvts.filter(m => m.type === "debit").reduce((s, m) => s + m.montant, 0);
      cumul += net;
      return { mois, label: shortMois[i], cumul };
    });
  })();
  const activePoints = graphPoints.filter(p => p.mois <= moisCourant);
  const graphVals = activePoints.map(p => p.cumul);
  const minVal = Math.min(0, ...graphVals);
  const maxVal = Math.max(0, ...graphVals, 1);
  const range = maxVal - minVal || 1;
  const GH = 100; const GW = 300;
  const toY = (v) => GH - Math.round(((v - minVal) / range) * GH);
  const toX = (i, total) => total < 2 ? GW / 2 : Math.round((i / (total - 1)) * GW);

  const ajouterMouvement = () => {
    const montant = parseFloat(form.montant);
    if (!form.label || isNaN(montant) || montant <= 0) return;
    const m = { id: Date.now(), enveloppeId: activeEnv, type: form.type, label: form.label, montant, date: form.date || today() };
    upd(d => { d.mouvements.push(m); });
    setModal(null); setForm({});
  };

  const appliquerProvisions = () => {
    const selection = form.selectionProvisions || {};
    const moisCourant = today().slice(0, 7);
    upd(d => {
      d.enveloppes.forEach(e => {
        if (e.provisionMensuelle > 0 && selection[e.id] === true) {
          const dejaFait = d.mouvements.some(m => m.enveloppeId === e.id && m.label === "Provision mensuelle" && m.date.startsWith(moisCourant));
          if (dejaFait) return;
          const m = { id: Date.now() + e.id, enveloppeId: e.id, type: "credit", label: "Provision mensuelle", montant: e.provisionMensuelle, date: today() };
          d.mouvements.push(m);
        }
      });
    });
    setModal(null); setForm({});
  };

  const effectuerTransfert = () => {
    const montant = parseFloat(form.montant);
    if (!form.de || !form.vers || isNaN(montant) || montant <= 0 || form.de === form.vers) return;
    const ts = Date.now();
    upd(d => {
      const src = d.enveloppes.find(e => e.id === Number(form.de));
      const dst = d.enveloppes.find(e => e.id === Number(form.vers));
      d.mouvements.push({ id: ts,     enveloppeId: src.id, type: "debit",  label: `Transfert → ${dst.name}`, montant, date: today() });
      d.mouvements.push({ id: ts + 1, enveloppeId: dst.id, type: "credit", label: `Transfert ← ${src.name}`, montant, date: today() });
    });
    setModal(null); setForm({});
  };

  const supprimerMouvement = (m) => {
    upd(d => { d.mouvements = d.mouvements.filter(x => x.id !== m.id); });
  };

  const sauvegarderEnv = () => {
    if (!form.name) return;
    if (editTarget === "new") {
      upd(d => {
        const paletteIdx = d.enveloppes.length % CAT_PALETTES.length;
        if (form.isSavings) d.enveloppes.forEach(e => { e.isSavings = false; });
        d.enveloppes.push({ id: d.nextId++, name: form.name, icon: form.icon || "📦", paletteIdx, provisionMensuelle: parseFloat(form.provisionMensuelle) || 0, objectif: parseFloat(form.objectif) || 0, solde: 0, isSavings: !!form.isSavings });
      });
    } else {
      upd(d => {
        if (form.isSavings) d.enveloppes.forEach(e => { e.isSavings = false; });
        const e = d.enveloppes.find(e => e.id === editTarget);
        e.name = form.name;
        e.icon = form.icon || e.icon;
        e.provisionMensuelle = parseFloat(form.provisionMensuelle) || 0;
        e.objectif = parseFloat(form.objectif) || 0;
        e.isSavings = !!form.isSavings;
      });
    }
    setModal(null); setForm({}); setEditTarget(null);
  };

  const supprimerEnv = (id) => {
    upd(d => { d.enveloppes = d.enveloppes.filter(e => e.id !== id); d.mouvements = d.mouvements.filter(m => m.enveloppeId !== id); });
    setView("enveloppes"); setActiveEnv(null);
  };

  const envActive = activeEnv ? getEnv(activeEnv) : null;
  const mouvementsActifs = activeEnv ? getMouvements(activeEnv) : [];
  const isDetail = view === "detail";

  const ICONS = ["🏠","⚡","📡","🛡️","💰","🚗","🛒","👶","💊","🎓","✈️","🎬","🐾","🏋️","📋"];

  // Calcul barre progression enveloppe : objectif défini > provision*12 > max des soldes
  const maxSolde = Math.max(...data.enveloppes.map(e => getSoldeReel(e.id)), 1);
  const getPct = (env) => {
    const solde = getSoldeReel(env.id);
    const ref = env.objectif > 0 ? env.objectif : env.provisionMensuelle > 0 ? env.provisionMensuelle * 12 : maxSolde;
    return Math.min(100, Math.max(0, ref > 0 ? (solde / ref) * 100 : 0));
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8", color: "#2D3A35", fontFamily: "'Nunito', sans-serif", display: "flex", flexDirection: "column", width: "100%", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;600&family=Nunito:wght@300;400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        button{cursor:pointer;border:none;background:none;color:inherit;font-family:'Nunito',sans-serif}
        input,select{outline:none;font-family:'Nunito',sans-serif}
        .fade{animation:fi .2s ease}@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        .env-card:active{opacity:.85;transform:scale(0.99)}
        .row:hover .del-btn{opacity:1!important}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#EDE9E3}
      `}</style>

      {/* ═══ HEADER HÉRO ═══ */}
      {!isDetail && (
        <div style={{ background: "linear-gradient(135deg, #E8F4FD 0%, #EDF8F0 100%)", padding: "28px 20px 20px" }}>
          {/* Chip */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.7)", borderRadius: 20, padding: "4px 12px", marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: synced ? "#6EDB8F" : "#F0C060" }} />
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#6B8C7A" }}>{synced ? "SYNCHRONISÉ" : "CONNEXION…"}</span>
          </div>

          {/* Montant total */}
          <div style={{ fontFamily: "'Lora', serif", fontSize: 38, fontWeight: 600, color: "#2D3A35", lineHeight: 1.1, marginBottom: 16 }}>
            {fmt(soldeTotal)}
          </div>

          {/* Grille stats 1×2 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: enveloppeEpargne ? enveloppeEpargne.name.toUpperCase() : "ÉPARGNE", value: fmt(soldeEpargne), color: "#2D3A35" },
              { label: "PROVISIONS/MOIS", value: fmt(totalProvisions), color: "#8B7355" },
            ].map(s => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.65)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#8FA89A", letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ NAV ═══ */}
      {!isDetail && (
        <div style={{ display: "flex", gap: 4, padding: "12px 16px 0", background: "#FAFAF8", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 1px 0 #EDE9E3" }}>
          {[{ id: "enveloppes", label: "Enveloppes" }, { id: "recap", label: "Récap mensuel" }].map(n => (
            <button key={n.id} onClick={() => setView(n.id)}
              style={{ flex: 1, textAlign: "center", padding: "8px", fontSize: 11, fontWeight: 600, borderRadius: 8, transition: "all .2s",
                background: view === n.id ? "#2D3A35" : "transparent",
                color: view === n.id ? "#FAFAF8" : "#B0A899" }}>
              {n.label}
            </button>
          ))}
        </div>
      )}

      {/* ═══ VUE ENVELOPPES ═══ */}
      {view === "enveloppes" && (
        <div className="fade" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Actions */}
          <div style={{ display: "flex", gap: 8, padding: "12px 12px 8px" }}>
            <button onClick={() => { setForm({ selectionProvisions: {} }); setModal("provision"); }}
              style={{ flex: 1, padding: "10px 14px", background: "#FFFFFF", border: "0.5px solid #EDE9E3", borderRadius: 10, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#3A8A5C", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              ↑ Provisions
            </button>
            <button onClick={() => { setForm({ de: "", vers: "" }); setModal("transfert"); }}
              style={{ flex: 1, padding: "10px 14px", background: "#FFFFFF", border: "0.5px solid #EDE9E3", borderRadius: 10, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#8B7355", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              ⇄ Transfert
            </button>
            <button onClick={() => { setEditTarget("new"); setForm({ icon: "📦" }); setModal("editEnv"); }}
              style={{ padding: "10px 16px", background: "#2D3A35", borderRadius: 10, fontSize: 18, color: "#FAFAF8", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              +
            </button>
          </div>

          {/* Liste */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={data.enveloppes.map(e => e.id)} strategy={verticalListSortingStrategy}>
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px 20px" }}>
                {data.enveloppes.map(env => (
                  <SortableEnvCard
                    key={env.id}
                    env={env}
                    mouvements={data.mouvements}
                    onOpen={() => { setActiveEnv(env.id); setView("detail"); }}
                    getPct={getPct}
                    getSoldeReel={getSoldeReel}
                    getSoldeProjete={getSoldeProjete}
                    hasFuturs={hasFuturs}
                    todayStr={todayStr}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* ═══ VUE RÉCAP MENSUEL ═══ */}
      {view === "recap" && (
        <div className="fade" style={{ flex: 1, overflowY: "auto", padding: "16px 12px 20px" }}>

          {/* Graphe */}
          <div style={{ background: "#FFFFFF", border: "0.5px solid #EDE9E3", borderRadius: 14, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 14 }}>ÉVOLUTION DU SOLDE — {anneeActuelle}</div>
            {activePoints.length < 2 ? (
              <div style={{ textAlign: "center", color: "#B0A899", fontSize: 12, padding: "30px 0" }}>Pas encore assez de données</div>
            ) : (
              <svg width={GW + 40} height={GH + 40} style={{ display: "block", margin: "0 auto" }}>
                <defs>
                  <linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5CB87A" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#5CB87A" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1={0} y1={toY(0) + 8} x2={GW + 40} y2={toY(0) + 8} stroke="#EDE9E3" strokeWidth={1} strokeDasharray="4 4" />
                <polygon
                  fill="url(#gfill)"
                  points={[
                    `20,${toY(0) + 8}`,
                    ...activePoints.map((p, i) => `${toX(i, activePoints.length) + 20},${toY(p.cumul) + 8}`),
                    `${toX(activePoints.length - 1, activePoints.length) + 20},${toY(0) + 8}`
                  ].join(" ")}
                />
                <polyline
                  fill="none" stroke="#3A8A5C" strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round"
                  points={activePoints.map((p, i) => `${toX(i, activePoints.length) + 20},${toY(p.cumul) + 8}`).join(" ")}
                />
                {activePoints.map((p, i) => (
                  <circle key={p.mois} cx={toX(i, activePoints.length) + 20} cy={toY(p.cumul) + 8} r={3.5}
                    fill={p.cumul >= 0 ? "#3A8A5C" : "#C0533A"} />
                ))}
                {activePoints.map((p, i) => (
                  (i === 0 || i === activePoints.length - 1 || activePoints.length <= 6 || i % 2 === 0) && (
                    <text key={p.mois + "l"} x={toX(i, activePoints.length) + 20} y={GH + 28}
                      textAnchor="middle" fontSize={8} fill="#B0A899" fontFamily="Nunito">{p.label}</text>
                  )
                ))}
                {activePoints.length > 0 && (() => {
                  const last = activePoints[activePoints.length - 1];
                  return (
                    <text x={toX(activePoints.length - 1, activePoints.length) + 20} y={toY(last.cumul)}
                      textAnchor="middle" fontSize={9} fill="#3A8A5C" fontWeight="700" fontFamily="Nunito">
                      {last.cumul >= 0 ? "+" : ""}{Math.round(last.cumul)}€
                    </text>
                  );
                })()}
              </svg>
            )}
          </div>

          {moisDispos.length === 0 && (
            <div style={{ textAlign: "center", color: "#B0A899", fontSize: 13, padding: "20px 0" }}>Aucun mouvement enregistré</div>
          )}
          {moisDispos.map(mois => {
            const { entrees, sorties, net } = getRecapMois(mois);
            return (
              <div key={mois} style={{ marginBottom: 14, background: "#FFFFFF", border: "0.5px solid #EDE9E3", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px 10px", borderBottom: "0.5px solid #EDE9E3", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#2D3A35", textTransform: "capitalize" }}>{labelMois(mois)}</div>
                  <div style={{ fontFamily: "'Lora', serif", fontSize: 14, fontWeight: 600, color: net >= 0 ? "#3A8A5C" : "#C0533A" }}>
                    {net >= 0 ? "+" : ""}{fmt(net)}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                  <div style={{ padding: "12px 18px", borderRight: "0.5px solid #EDE9E3" }}>
                    <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 6 }}>ENTRÉES</div>
                    <div style={{ fontFamily: "'Lora', serif", fontSize: 16, fontWeight: 600, color: "#3A8A5C" }}>{fmt(entrees)}</div>
                  </div>
                  <div style={{ padding: "12px 18px" }}>
                    <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 6 }}>SORTIES</div>
                    <div style={{ fontFamily: "'Lora', serif", fontSize: 16, fontWeight: 600, color: "#C0533A" }}>{fmt(sorties)}</div>
                  </div>
                </div>
                <div style={{ height: 3, background: "#F0EDE8" }}>
                  {(entrees + sorties) > 0 && (
                    <div style={{ height: "100%", width: `${Math.round((entrees / (entrees + sorties)) * 100)}%`, background: "linear-gradient(90deg, #5CB87A, #6BAED4)", transition: "width .8s ease" }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ VUE DÉTAIL ENVELOPPE ═══ */}
      {view === "detail" && envActive && (() => {
        const pal = CAT_PALETTES[envActive.paletteIdx ?? 4];
        return (
          <div className="fade" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {/* Header avec fond gradient */}
            <div style={{ background: "linear-gradient(135deg, #E8F4FD 0%, #EDF8F0 100%)", padding: "20px 20px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <button onClick={() => setView("enveloppes")} style={{ fontSize: 18, color: "#B0A899", padding: "4px 8px 4px 0" }}>←</button>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: pal.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{envActive.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#8FA89A", letterSpacing: 1 }}>ENVELOPPE</div>
                  <div style={{ fontFamily: "'Lora', serif", fontSize: 18, fontWeight: 600, color: "#2D3A35" }}>{envActive.name}</div>
                </div>
                <button onClick={() => { setEditTarget(envActive.id); setForm({ name: envActive.name, icon: envActive.icon, provisionMensuelle: envActive.provisionMensuelle, objectif: envActive.objectif || "", isSavings: !!envActive.isSavings }); setModal("editEnv"); }}
                  style={{ fontSize: 12, color: "#B0A899", border: "0.5px solid #EDE9E3", borderRadius: 8, padding: "6px 10px", background: "rgba(255,255,255,0.7)" }}>✎</button>
              </div>

              {/* Bloc solde */}
              <div style={{ background: "rgba(255,255,255,0.65)", borderRadius: 12, padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 3, color: "#8FA89A", marginBottom: 4 }}>SOLDE</div>
                  <div style={{ fontFamily: "'Lora', serif", fontSize: 28, fontWeight: 600, color: getSoldeReel(envActive.id) < 0 ? "#C0533A" : "#2D3A35" }}>{fmt(getSoldeReel(envActive.id))}</div>
                  {hasFuturs(envActive.id) && (
                    <div style={{ fontSize: 11, color: "#B0A899", marginTop: 4 }}>→ {fmt(getSoldeProjete(envActive.id))} prévu</div>
                  )}
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 6 }}>
                  {envActive.provisionMensuelle > 0 && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 2 }}>PROVISION</div>
                      <div style={{ fontFamily: "'Lora', serif", fontSize: 15, color: "#3A8A5C" }}>
                        {fmt(envActive.provisionMensuelle)}<span style={{ fontSize: 10, color: "#B0A899", fontFamily: "'Nunito', sans-serif" }}>/mois</span>
                      </div>
                    </div>
                  )}
                  {envActive.objectif > 0 && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 2 }}>OBJECTIF</div>
                      <div style={{ fontFamily: "'Lora', serif", fontSize: 15, color: "#6BAED4" }}>
                        {Math.round(getPct(envActive))}%
                        <span style={{ fontSize: 10, color: "#B0A899", fontFamily: "'Nunito', sans-serif" }}> / {fmt(envActive.objectif)}</span>
                      </div>
                      {hasFuturs(envActive.id) && (
                        <div style={{ fontSize: 10, color: "#B0A899", marginTop: 2 }}>
                          {Math.round(Math.min(100, getSoldeProjete(envActive.id) / envActive.objectif * 100))}% prévu
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Boutons actions */}
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "0.5px solid #EDE9E3" }}>
              <button onClick={() => { setForm({ type: "credit", date: today() }); setModal("mouvement"); }}
                style={{ flex: 1, padding: "10px", background: "#E6F5ED", border: "0.5px solid #AADABF", borderRadius: 10, fontSize: 11, fontWeight: 700, color: "#3A8A5C", letterSpacing: 1 }}>
                ↑ ENTRÉE
              </button>
              <button onClick={() => { setForm({ type: "debit", date: today() }); setModal("mouvement"); }}
                style={{ flex: 1, padding: "10px", background: "#FFE8E5", border: "0.5px solid #F0B0A0", borderRadius: 10, fontSize: 11, fontWeight: 700, color: "#C0533A", letterSpacing: 1 }}>
                ↓ DÉPENSE
              </button>
            </div>

            {/* Historique */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: "#8FA89A", marginBottom: 12 }}>HISTORIQUE</div>
              {mouvementsActifs.length === 0 && (
                <div style={{ textAlign: "center", color: "#B0A899", fontSize: 13, padding: "40px 0" }}>Aucun mouvement</div>
              )}
              {mouvementsActifs.map(m => {
                const futur = m.date > todayStr;
                return (
                  <div key={m.id} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "0.5px solid #EDE9E3", opacity: futur ? 0.6 : 1 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: futur ? "#D0CCC8" : m.type === "credit" ? "#5CB87A" : "#E87060", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 400, color: "#2D3A35", display: "flex", alignItems: "center", gap: 6 }}>
                        {m.label}
                        {futur && <span style={{ fontSize: 9, fontWeight: 700, color: "#B0A899", background: "#F0EDE8", borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>PRÉVU</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#B0A899", marginTop: 2 }}>{fmtDate(m.date)}</div>
                    </div>
                    <div style={{ fontFamily: "'Lora', serif", fontSize: 14, fontWeight: 600, color: futur ? "#B0A899" : m.type === "credit" ? "#3A8A5C" : "#2D3A35", flexShrink: 0 }}>
                      {m.type === "credit" ? "+" : "−"}{fmt(m.montant)}
                    </div>
                    <button className="del-btn" onClick={() => supprimerMouvement(m)}
                      style={{ opacity: 0, transition: "opacity .15s", fontSize: 13, color: "#C0533A", padding: "4px 6px", flexShrink: 0 }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ═══ MODALS ═══ */}
      {modal && (
        <div onClick={e => { if (e.target === e.currentTarget) { setModal(null); setForm({}); } }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: "#FFFFFF", borderRadius: "20px 20px 0 0", borderTop: "0.5px solid #EDE9E3", width: "100%", maxWidth: 480, padding: 24, maxHeight: "85vh", overflowY: "auto" }} className="fade">

            {modal === "mouvement" && (
              <>
                <div style={{ fontFamily: "'Lora', serif", fontSize: 17, fontWeight: 600, marginBottom: 20, color: form.type === "credit" ? "#3A8A5C" : "#C0533A" }}>
                  {form.type === "credit" ? "↑ Nouvelle entrée" : "↓ Nouvelle dépense"} — {envActive?.name}
                </div>
                <input placeholder="Libellé" value={form.label || ""} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  style={inputStyle} />
                <input type="number" placeholder="Montant (€)" value={form.montant || ""} onChange={e => setForm(f => ({ ...f, montant: e.target.value }))}
                  style={inputStyle} />
                <input type="date" value={form.date || today()} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  style={{ ...inputStyle, color: "#8FA89A", marginBottom: 20 }} />
                <button onClick={ajouterMouvement} style={btnPrimaryStyle}>ENREGISTRER</button>
              </>
            )}

            {modal === "provision" && (() => {
              const envsAvecProv = data.enveloppes.filter(e => e.provisionMensuelle > 0);
              const sel = form.selectionProvisions || {};
              const moisCourant = today().slice(0, 7);
              const dejaProvisionnees = new Set(data.mouvements.filter(m => m.label === "Provision mensuelle" && m.date.startsWith(moisCourant)).map(m => m.enveloppeId));
              const totalSel = envsAvecProv.filter(e => sel[e.id] === true && !dejaProvisionnees.has(e.id)).reduce((s, e) => s + e.provisionMensuelle, 0);
              const tousCoches = envsAvecProv.every(e => sel[e.id] === true);
              return (
                <>
                  <div style={{ fontFamily: "'Lora', serif", fontSize: 17, fontWeight: 600, marginBottom: 6, color: "#2D3A35" }}>Provisions du mois</div>
                  <div style={{ fontSize: 12, color: "#8FA89A", marginBottom: 16 }}>Sélectionne les enveloppes à provisionner.</div>

                  {envsAvecProv.length === 0 && (
                    <div style={{ fontSize: 12, color: "#B0A899", textAlign: "center", padding: "20px 0" }}>Aucune provision configurée.</div>
                  )}

                  {envsAvecProv.length > 1 && (
                    <button onClick={() => {
                      const newSel = {};
                      envsAvecProv.forEach(e => { newSel[e.id] = !tousCoches; });
                      setForm(f => ({ ...f, selectionProvisions: newSel }));
                    }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 8, background: "#F7F5F2", border: "0.5px solid #EDE9E3", borderRadius: 10, fontSize: 12, fontWeight: 600, color: "#8FA89A" }}>
                      <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${tousCoches ? "#3A8A5C" : "#D0CCC8"}`, background: tousCoches ? "#3A8A5C" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {tousCoches && <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>✓</span>}
                      </div>
                      Tout sélectionner
                    </button>
                  )}

                  {envsAvecProv.map(e => {
                    const checked = sel[e.id] === true;
                    const deja = dejaProvisionnees.has(e.id);
                    return (
                      <button key={e.id} onClick={() => { if (deja) return; setForm(f => ({ ...f, selectionProvisions: { ...f.selectionProvisions, [e.id]: !checked } })); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", marginBottom: 6, background: deja ? "#F7F5F2" : checked ? "#F0FAF4" : "#FAFAF8", border: `0.5px solid ${deja ? "#EDE9E3" : checked ? "#AADABF" : "#EDE9E3"}`, borderRadius: 10, textAlign: "left", opacity: deja ? 0.6 : 1, cursor: deja ? "default" : "pointer" }}>
                        <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${deja ? "#D0CCC8" : checked ? "#3A8A5C" : "#D0CCC8"}`, background: deja ? "#EDE9E3" : checked ? "#3A8A5C" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {deja ? <span style={{ color: "#B0A899", fontSize: 11, lineHeight: 1 }}>✓</span> : checked ? <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>✓</span> : null}
                        </div>
                        <span style={{ fontSize: 13, color: deja ? "#B0A899" : "#2D3A35", flex: 1 }}>{e.icon} {e.name}</span>
                        <span style={{ fontSize: 12, color: deja ? "#B0A899" : checked ? "#3A8A5C" : "#B0A899", fontWeight: 600 }}>
                          {deja ? "déjà fait" : `+${fmt(e.provisionMensuelle)}`}
                        </span>
                      </button>
                    );
                  })}

                  {envsAvecProv.length > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 4px 4px", fontSize: 12, color: "#8FA89A", borderTop: "0.5px solid #EDE9E3", marginTop: 4 }}>
                      <span style={{ fontWeight: 600 }}>TOTAL SÉLECTIONNÉ</span>
                      <span style={{ color: "#3A8A5C", fontFamily: "'Lora', serif", fontWeight: 600 }}>+{fmt(totalSel)}</span>
                    </div>
                  )}

                  <button onClick={appliquerProvisions} disabled={totalSel === 0}
                    style={{ ...btnPrimaryStyle, marginTop: 16, opacity: totalSel === 0 ? 0.4 : 1 }}>
                    APPLIQUER
                  </button>
                </>
              );
            })()}

            {modal === "transfert" && (
              <>
                <div style={{ fontFamily: "'Lora', serif", fontSize: 17, fontWeight: 600, marginBottom: 20, color: "#2D3A35" }}>⇄ Transfert entre enveloppes</div>

                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 6 }}>DE</div>
                <select value={form.de || ""} onChange={e => setForm(f => ({ ...f, de: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 12 }}>
                  <option value="">— Choisir une enveloppe</option>
                  {data.enveloppes.map(e => (
                    <option key={e.id} value={e.id}>{e.icon} {e.name} ({fmt(getSoldeReel(e.id))})</option>
                  ))}
                </select>

                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 6 }}>VERS</div>
                <select value={form.vers || ""} onChange={e => setForm(f => ({ ...f, vers: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 12 }}>
                  <option value="">— Choisir une enveloppe</option>
                  {data.enveloppes.map(e => (
                    <option key={e.id} value={e.id}>{e.icon} {e.name} ({fmt(getSoldeReel(e.id))})</option>
                  ))}
                </select>

                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 6 }}>MONTANT</div>
                <input type="number" placeholder="0 €" value={form.montant || ""} onChange={e => setForm(f => ({ ...f, montant: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 20 }} />

                {form.de && form.vers && form.de === form.vers && (
                  <div style={{ fontSize: 12, color: "#C0533A", marginBottom: 12 }}>Source et destination identiques.</div>
                )}

                <button onClick={effectuerTransfert} style={btnPrimaryStyle}>TRANSFÉRER</button>
              </>
            )}

            {modal === "editEnv" && (
              <>
                <div style={{ fontFamily: "'Lora', serif", fontSize: 17, fontWeight: 600, marginBottom: 20, color: "#2D3A35" }}>
                  {editTarget === "new" ? "Nouvelle enveloppe" : "Modifier l'enveloppe"}
                </div>
                <input placeholder="Nom" value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 14 }} />

                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 8 }}>ICÔNE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {ICONS.map(ic => (
                    <button key={ic} onClick={() => setForm(f => ({ ...f, icon: ic }))}
                      style={{ width: 38, height: 38, borderRadius: 10, fontSize: 18,
                        background: form.icon === ic ? "#E6F5ED" : "#F7F5F2",
                        border: form.icon === ic ? "1px solid #5CB87A" : "0.5px solid #EDE9E3" }}>
                      {ic}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 8 }}>PROVISION MENSUELLE (optionnel)</div>
                <input type="number" placeholder="0 €" value={form.provisionMensuelle || ""} onChange={e => setForm(f => ({ ...f, provisionMensuelle: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 16 }} />

                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#8FA89A", marginBottom: 8 }}>OBJECTIF À ATTEINDRE (optionnel)</div>
                <input type="number" placeholder="ex : 5 000 €" value={form.objectif || ""} onChange={e => setForm(f => ({ ...f, objectif: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 16 }} />

                {/* Toggle épargne */}
                <button onClick={() => setForm(f => ({ ...f, isSavings: !f.isSavings }))}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: form.isSavings ? "#E6F5ED" : "#F7F5F2", border: form.isSavings ? "0.5px solid #AADABF" : "0.5px solid #EDE9E3", borderRadius: 10, marginBottom: 20 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#2D3A35" }}>Épingler en haut</span>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: form.isSavings ? "#3A8A5C" : "#D0CCC8", position: "relative", transition: "background .2s" }}>
                    <div style={{ position: "absolute", top: 2, left: form.isSavings ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                  </div>
                </button>

                <button onClick={sauvegarderEnv} style={{ ...btnPrimaryStyle, marginBottom: 10 }}>ENREGISTRER</button>
                {editTarget !== "new" && (
                  <button onClick={() => { supprimerEnv(editTarget); setModal(null); }}
                    style={{ width: "100%", padding: "12px", background: "transparent", border: "0.5px solid #F0B0A0", color: "#C0533A", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                    SUPPRIMER CETTE ENVELOPPE
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SortableEnvCard({ env, mouvements, onOpen, getPct, getSoldeReel, getSoldeProjete, hasFuturs, todayStr }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: env.id });
  const pal = CAT_PALETTES[env.paletteIdx ?? 4];
  const nbMvt = mouvements.filter(m => m.enveloppeId === env.id).length;
  const pct = getPct(env);
  const soldeReel = getSoldeReel(env.id);
  const soldeProjete = getSoldeProjete(env.id);
  const futurs = hasFuturs(env.id);

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", background: "#FFFFFF", border: "0.5px solid #EDE9E3", borderRadius: 12, boxShadow: isDragging ? "0 4px 16px rgba(0,0,0,0.10)" : "0 1px 3px rgba(0,0,0,0.03)" }}>
        {/* Poignée drag */}
        <div {...attributes} {...listeners}
          style={{ padding: "0 10px 0 14px", cursor: "grab", color: "#D0CCC8", fontSize: 16, flexShrink: 0, touchAction: "none" }}>
          ⠿
        </div>
        {/* Contenu cliquable */}
        <button className="env-card" onClick={onOpen}
          style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "13px 14px 13px 0", background: "transparent", border: "none", textAlign: "left" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: pal.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{env.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#2D3A35" }}>{env.name}</div>
            <div style={{ fontSize: 10, fontWeight: 400, color: "#B0A899", marginTop: 2 }}>
              {nbMvt} mouvement{nbMvt !== 1 ? "s" : ""}
              {env.provisionMensuelle > 0 && <span> · {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(env.provisionMensuelle)}/mois</span>}
            </div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ flex: 1, height: 4, background: "#F0EDE8", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pal.bar, borderRadius: 2, transition: "width .6s ease" }} />
              </div>
              {env.objectif > 0 && (
                <span style={{ fontSize: 9, color: "#B0A899", flexShrink: 0 }}>
                  {Math.round(pct)}% / {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(env.objectif)}
                </span>
              )}
            </div>
          </div>
          <div style={{ flexShrink: 0, paddingRight: 4, textAlign: "right" }}>
            <div style={{ fontFamily: "'Lora', serif", fontSize: 16, fontWeight: 600, color: soldeReel < 0 ? "#C0533A" : "#2D3A35" }}>
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(soldeReel)}
            </div>
            {futurs && (
              <div style={{ fontSize: 10, color: "#B0A899", marginTop: 2 }}>
                → {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(soldeProjete)} prévu
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "#F7F5F2",
  border: "0.5px solid #EDE9E3",
  color: "#2D3A35",
  padding: "12px 14px",
  borderRadius: 10,
  fontSize: 16,
  marginBottom: 10,
};

const btnPrimaryStyle = {
  width: "100%",
  padding: "14px",
  background: "#2D3A35",
  color: "#FAFAF8",
  borderRadius: 12,
  fontFamily: "'Nunito', sans-serif",
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: 0.5,
};

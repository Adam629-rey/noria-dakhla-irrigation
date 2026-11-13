from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import requests
import streamlit as st
from scipy.optimize import linprog


st.set_page_config(
    page_title="NORIA · Irrigation de précision",
    page_icon="🌊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
    :root { --ink:#112c35; --teal:#087e78; --mint:#d6f1e9; --sand:#f6f3ec; --coral:#f18062; }
    .stApp { background: #f5f7f4; color: var(--ink); font-family:'DM Sans',sans-serif; }
    [data-testid="stSidebar"] { background: #102f38; }
    [data-testid="stSidebar"] * { color: #ecf6f2 !important; }
    [data-testid="stSidebar"] input, [data-testid="stSidebar"] [data-baseweb="select"] > div { color:#102f38 !important; }
    h1,h2,h3 { font-family:'Manrope',sans-serif !important; letter-spacing:-.035em; color:var(--ink); }
    .hero { position:relative; overflow:hidden; border-radius:26px; padding:32px 36px; color:#fff;
      background: radial-gradient(circle at 86% 20%,rgba(98,226,188,.31),transparent 27%),
      linear-gradient(118deg,#0d3039 0%,#125e61 62%,#13847c 100%); margin: 5px 0 22px; }
    .hero:after { content:'≈'; position:absolute; right:5%; top:-62px; font-size:280px; line-height:1; font-weight:700; color:rgba(255,255,255,.055); }
    .hero-kicker { text-transform:uppercase; letter-spacing:.16em; font-size:11px; font-weight:700; color:#a8ead6; }
    .hero h1 { color:white !important; font-size:38px; margin:8px 0 5px; }
    .hero p { margin:0; max-width:680px; color:#d5eeea; font-size:15px; }
    .pill { display:inline-block; padding:6px 10px; margin-top:18px; border:1px solid rgba(255,255,255,.26); border-radius:999px; font-size:11px; color:#e2fff3; }
    .section-label { color:#52817d; text-transform:uppercase; letter-spacing:.14em; font-size:10px; font-weight:700; margin:10px 0 3px; }
    .panel { background:white; border:1px solid #e1eae5; border-radius:18px; padding:18px 20px; }
    .kpi { background:white; border:1px solid #e1eae5; border-radius:17px; padding:16px 18px; min-height:105px; }
    .kpi-label { color:#6b8581; font-size:11px; letter-spacing:.06em; text-transform:uppercase; font-weight:700; }
    .kpi-value { color:#102f38; font-family:'Manrope',sans-serif; font-size:25px; font-weight:800; margin-top:7px; }
    .kpi-note { color:#78908b; font-size:11px; margin-top:2px; }
    .tag-demo { background:#fff4df; color:#86591c; border:1px solid #f0dfbe; border-radius:10px; padding:9px 12px; font-size:12px; }
    .stButton > button { border-radius:12px; border:0; background:#087e78; color:white; font-weight:700; padding:.65rem 1rem; }
    .stButton > button:hover { background:#066b67; color:white; }
    [data-testid="stMetric"] { background:white; border:1px solid #e1eae5; padding:16px; border-radius:16px; }
    [data-testid="stDataFrame"] { border:1px solid #e1eae5; border-radius:14px; overflow:hidden; }
    hr { border-color:#e1eae5; }
    @media(max-width:700px){ .hero{padding:24px 22px}.hero h1{font-size:30px}.hero:after{font-size:175px;right:-3%} }
    </style>
    """,
    unsafe_allow_html=True,
)


# Baseline crop coefficients and Ky values follow FAO-56/FAO-33 tables.
# Phenological stage lengths use the arid/desert examples cited in SOURCES.md.
CROPS = {
    "Tomate": {"kc": (0.60, 1.15, 0.80), "ky": 1.05, "stages": (30, 40, 40, 25), "yield": 90, "price": 3200},
    "Pastèque": {"kc": (0.40, 1.00, 0.75), "ky": 1.10, "stages": (10, 20, 20, 30), "yield": 55, "price": 2600},
}
EFFICIENCY = 0.90
ET0_BASE = 5.0  # demo planning baseline, mm/day; not an observed Dakhla series
RAIN_BASE = 0.0  # conservative demo assumption; replace with a local station feed
WEATHER_CACHE = Path(__file__).parent / "data" / "open_meteo_cache.csv"


def fetch_open_meteo() -> pd.DataFrame:
    """Fetch seven forecast days and persist a small offline cache."""
    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": 23.7,
            "longitude": -15.9,
            "daily": "et0_fao_evapotranspiration,precipitation_sum",
            "forecast_days": 7,
            "timezone": "Africa/Casablanca",
        },
        timeout=8,
    )
    response.raise_for_status()
    payload = response.json()["daily"]
    frame = pd.DataFrame({
        "date": payload["time"],
        "et0_mm": payload["et0_fao_evapotranspiration"],
        "precipitation_mm": payload["precipitation_sum"],
    }).dropna()
    if len(frame) != 7:
        raise ValueError("La prévision reçue ne contient pas 7 jours complets.")
    frame["source"] = "Open-Meteo · prévision"
    frame["fetched_at"] = pd.Timestamp.now(tz="Africa/Casablanca").isoformat()
    WEATHER_CACHE.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(WEATHER_CACHE, index=False)
    return frame


def simulated_forecast() -> pd.DataFrame:
    """Deterministic fallback solely for the offline demo."""
    values = [4.8, 5.0, 5.2, 4.9, 5.3, 5.1, 4.7]
    return pd.DataFrame({
        "date": [(date.today() + timedelta(days=i)).isoformat() for i in range(7)],
        "et0_mm": values,
        "precipitation_mm": [0.0] * 7,
        "source": ["Simulation locale · hors ligne"] * 7,
        "fetched_at": [""] * 7,
    })


def kc_for_age(crop: str, age: int) -> float:
    ini, mid, end = CROPS[crop]["kc"]
    s1, s2, s3, s4 = CROPS[crop]["stages"]
    if age < 0:
        return 0.0
    if age < s1:
        return ini
    if age < s1 + s2:
        return ini + (mid - ini) * (age - s1) / s2
    if age < s1 + s2 + s3:
        return mid
    if age < s1 + s2 + s3 + s4:
        return mid + (end - mid) * (age - s1 - s2 - s3) / s4
    return 0.0


def daily_crop_need(crop: str, age: int, et0: float = ET0_BASE, rain: float = RAIN_BASE, efficiency: float = EFFICIENCY) -> float:
    """Gross drip-irrigation need in mm/day (FAO-56; 0.90 efficiency is an assumption)."""
    return max(0.0, kc_for_age(crop, age) * et0 - rain) / efficiency


def season_need_m3(crop: str, area_ha: float, age: int, et0_factor: float, efficiency: float = EFFICIENCY) -> float:
    # Planning horizon is the remaining crop cycle from today's age, using demo ET0 baseline.
    total_days = sum(CROPS[crop]["stages"])
    days = max(0, total_days - age)
    daily = [daily_crop_need(crop, d, ET0_BASE * et0_factor, efficiency=efficiency) for d in range(age, total_days)]
    return float(sum(daily) * 10 * area_ha) if days else 0.0


def solve_quota(parcels: list[dict], quota: float, method: str = "optimisé") -> tuple[list[float], bool]:
    needs = np.array([p["need"] for p in parcels], dtype=float)
    quota = min(max(0.0, quota), float(needs.sum()))
    if method == "uniforme":
        return (needs * (quota / needs.sum()) if needs.sum() else needs).tolist(), False
    min_share = 0.50
    lower = np.minimum(needs * min_share, quota / max(1, len(needs)))
    if quota < lower.sum():
        lower = np.zeros_like(needs)
    # Marginal value protected per m³: Ky × potential yield × assumed price / ETc volume.
    losses = np.array([
        p["ky"] * p["yield_t_ha"] * p["price_mad_t"] * p["area_ha"] / p["need"] if p["need"] > 0 else 0.0
        for p in parcels
    ])
    result = linprog(
        c=-losses,
        A_ub=np.ones((1, len(needs))),
        b_ub=[quota],
        bounds=[(float(lower[i]), float(needs[i])) for i in range(len(needs))],
        method="highs",
    )
    if result.success:
        return result.x.tolist(), False
    # Documented plan B: proportional allocation; no network or solver required.
    return (needs * (quota / needs.sum()) if needs.sum() else needs).tolist(), True


def impact(parcels: list[dict], allocations: list[float]) -> tuple[float, float]:
    weighted_preserved = 0.0
    total_value = 0.0
    for p, water in zip(parcels, allocations):
        ratio = min(1.0, water / max(p["need"], 1e-9))
        value = p["yield_t_ha"] * p["price_mad_t"] * p["area_ha"]
        loss_fraction = min(1.0, p["ky"] * (1 - ratio))
        weighted_preserved += max(0.0, 1 - loss_fraction) * value
        total_value += value
    return (100 * weighted_preserved / total_value if total_value else 0.0, weighted_preserved)


def card(label: str, value: str, note: str) -> None:
    st.markdown(
        f'<div class="kpi"><div class="kpi-label">{label}</div><div class="kpi-value">{value}</div><div class="kpi-note">{note}</div></div>',
        unsafe_allow_html=True,
    )


with st.sidebar:
    st.markdown("<div class='section-label'>NORIA · DAKHLA</div>", unsafe_allow_html=True)
    st.markdown("## Console du périmètre")
    st.caption("Piloter l'eau disponible, parcelle par parcelle.")
    st.divider()
    st.markdown("### Enveloppe d'eau")
    quota = st.number_input("Quota disponible · m³", min_value=500, max_value=500000, value=105000, step=5000)
    scenario = st.select_slider("Scénario ET₀", options=["Prudent −15 %", "Nominal", "Chaud +15 %"], value="Nominal")
    factor = {"Prudent −15 %": 0.85, "Nominal": 1.0, "Chaud +15 %": 1.15}[scenario]
    st.markdown("### Paramètres communs")
    eta = st.slider("Efficacité goutte-à-goutte", 0.70, 1.00, EFFICIENCY, 0.01)
    st.caption("Valeur par défaut : 0,90 · hypothèse à valider sur site.")
    st.markdown("### Météo · 7 jours")
    if st.button("↻ Actualiser Open-Meteo", width="stretch"):
        try:
            st.session_state["weather_forecast"] = fetch_open_meteo()
            st.session_state["weather_message"] = "Prévision reçue et mise en cache localement."
        except Exception as exc:
            st.session_state["weather_message"] = f"Réseau indisponible : {exc}. Mode hors ligne conservé."
    st.markdown("---")
    st.caption("Mode démonstration hors ligne · données de parcelles et météo simulées")

if "weather_forecast" in st.session_state:
    forecast = st.session_state["weather_forecast"]
elif WEATHER_CACHE.exists():
    try:
        forecast = pd.read_csv(WEATHER_CACHE).tail(7)
        forecast["source"] = forecast.get("source", "Cache Open-Meteo")
    except Exception:
        forecast = simulated_forecast()
else:
    forecast = simulated_forecast()
weather_source = str(forecast["source"].iloc[-1])
if st.session_state.get("weather_message"):
    st.sidebar.caption(st.session_state["weather_message"])


st.markdown(
    """
    <div class="hero">
      <div class="hero-kicker">Gestion intelligente de l'eau · Provinces du Sud</div>
      <h1>Chaque goutte a une mission.</h1>
      <p>NORIA transforme un quota limité en décisions d'irrigation lisibles : besoin des cultures, arbitrage entre parcelles, impact et incertitude.</p>
      <span class="pill">Dakhla · 23,7° N / 15,9° O</span>&nbsp;
      <span class="pill">30 M m³/an pour l'irrigation · 5 000 ha*</span>&nbsp;
      <span class="pill">FAO-56 · FAO-33 · scénario explicable</span>
    </div>
    """,
    unsafe_allow_html=True,
)

st.markdown("<div class='tag-demo'>⚠ Démonstrateur : parcelles simulées · ET₀ de planification fixé à 5,0 mm/j · résultats indicatifs, à calibrer avec une station locale.</div>", unsafe_allow_html=True)
st.caption("*Ordres de grandeur cités dans le dossier de projet du hackathon ; à revalider avec les organisateurs et les sources institutionnelles avant le pitch.")
st.markdown("<div class='section-label'>01 — CONFIGURATION DES PARCELLES</div>", unsafe_allow_html=True)

default_rows = [
    {"Parcelle": "N-01 · Littoral", "Culture": "Tomate", "Surface (ha)": 12.0, "Âge (jours)": 55, "Rendement (t/ha) · hypothèse": 90.0, "Prix (MAD/t) · hypothèse": 3200.0},
    {"Parcelle": "N-02 · Oued", "Culture": "Pastèque", "Surface (ha)": 8.0, "Âge (jours)": 32, "Rendement (t/ha) · hypothèse": 55.0, "Prix (MAD/t) · hypothèse": 2600.0},
    {"Parcelle": "N-03 · Dunes", "Culture": "Tomate", "Surface (ha)": 10.0, "Âge (jours)": 85, "Rendement (t/ha) · hypothèse": 90.0, "Prix (MAD/t) · hypothèse": 3200.0},
]
edited = st.data_editor(
    pd.DataFrame(default_rows),
    hide_index=True,
    width="stretch",
    column_config={
        "Parcelle": st.column_config.TextColumn("Parcelle", disabled=True),
        "Culture": st.column_config.SelectboxColumn("Culture", options=list(CROPS)),
        "Surface (ha)": st.column_config.NumberColumn("Surface (ha)", min_value=0.1, max_value=250, step=0.5, format="%.1f"),
        "Âge (jours)": st.column_config.NumberColumn("Âge (jours)", min_value=0, max_value=150, step=1),
        "Rendement (t/ha) · hypothèse": st.column_config.NumberColumn("Rendement (t/ha) · hypothèse", min_value=1, max_value=300, step=1),
        "Prix (MAD/t) · hypothèse": st.column_config.NumberColumn("Prix (MAD/t) · hypothèse", min_value=100, max_value=50000, step=100),
    },
)

parcels = []
for _, row in edited.iterrows():
    crop = row["Culture"]
    area = float(row["Surface (ha)"])
    age = int(row["Âge (jours)"])
    need = season_need_m3(crop, area, age, factor, eta)
    parcels.append({
        "name": row["Parcelle"], "crop": crop, "area_ha": area, "age": age, "need": need,
        "ky": CROPS[crop]["ky"], "yield_t_ha": float(row["Rendement (t/ha) · hypothèse"]),
        "price_mad_t": float(row["Prix (MAD/t) · hypothèse"]),
    })

max_quota = sum(p["need"] for p in parcels)
effective_quota = min(float(quota), max_quota)
opt, fallback = solve_quota(parcels, effective_quota, "optimisé")
uniform, _ = solve_quota(parcels, effective_quota, "uniforme")
preserved_opt, value_opt = impact(parcels, opt)
preserved_uni, value_uni = impact(parcels, uniform)
water_saved = max(0.0, effective_quota - sum(uniform))
delta_preserved = preserved_opt - preserved_uni

st.markdown("<div class='section-label'>02 — DÉCISION SOUS QUOTA</div>", unsafe_allow_html=True)
k1, k2, k3, k4 = st.columns(4)
with k1: card("Besoin saisonnier estimé", f"{max_quota:,.0f} m³", "cycle restant · coefficients culturaux FAO")
with k2: card("Quota mobilisé", f"{effective_quota:,.0f} m³", f"{(100*effective_quota/max_quota if max_quota else 0):.0f} % du besoin estimé")
with k3: card("Rendement préservé · optimisé", f"{preserved_opt:.1f} %", f"{delta_preserved:+.1f} pt vs partage uniforme")
with k4: card("Valeur protégée · hypothèse", f"{value_opt/1_000_000:.2f} M MAD", "potentiel théorique pondéré par Ky")

col_chart, col_plan = st.columns([1.2, 0.8], gap="large")
with col_chart:
    st.markdown("### L'eau va là où elle protège le plus de valeur")
    chart_df = pd.DataFrame({
        "Parcelle": [p["name"] for p in parcels] * 2,
        "Eau attribuée (m³)": opt + uniform,
        "Méthode": ["NORIA · optimisé"] * len(parcels) + ["Partage uniforme"] * len(parcels),
    })
    fig = go.Figure()
    colors = {"NORIA · optimisé": "#0b827b", "Partage uniforme": "#b8c9c5"}
    for method in ["NORIA · optimisé", "Partage uniforme"]:
        sub = chart_df[chart_df["Méthode"] == method]
        fig.add_trace(go.Bar(name=method, x=sub["Parcelle"], y=sub["Eau attribuée (m³)"], marker_color=colors[method], marker_line_width=0, text=[f"{x:,.0f}" for x in sub["Eau attribuée (m³)"]], textposition="outside"))
    fig.update_layout(barmode="group", height=330, margin=dict(l=5,r=10,t=25,b=5), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font=dict(family="DM Sans",color="#43635f",size=11), legend=dict(orientation="h",y=1.15,x=0), yaxis=dict(title="m³",gridcolor="#e8efeb",zeroline=False), xaxis=dict(showgrid=False), bargap=.28, bargroupgap=.12)
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
with col_plan:
    st.markdown("### Plan d'allocation")
    allocation_rows = []
    for p, water in zip(parcels, opt):
        share = 100 * water / max(p["need"], 1)
        allocation_rows.append({"Parcelle": p["name"], "Culture": p["crop"], "Besoin (m³)": round(p["need"]), "NORIA (m³)": round(water), "Part du besoin": f"{share:.0f} %"})
    st.dataframe(pd.DataFrame(allocation_rows), hide_index=True, width="stretch")
    st.caption("Le modèle garantit un plancher de 50 % du besoin quand le quota le permet, puis priorise la valeur marginale protégée. Le partage proportionnel sert de repli.")

st.markdown("<div class='section-label'>03 — DOSE DES 7 PROCHAINS JOURS</div>", unsafe_allow_html=True)
week_rows = []
start_day = date.fromisoformat(str(forecast["date"].iloc[0]))
for p in parcels:
    daily = [
        daily_crop_need(
            p["crop"], p["age"] + d,
            float(forecast.iloc[d]["et0_mm"]) * factor,
            float(forecast.iloc[d]["precipitation_mm"]),
            eta,
        )
        for d in range(min(7, len(forecast)))
    ]
    m3 = sum(daily) * 10 * p["area_ha"]
    week_rows.append({"Parcelle": p["name"], "Culture · stade": f"{p['crop']} · Kc {kc_for_age(p['crop'], p['age']):.2f}", "Dose 7 j (m³)": round(m3), "Moyenne (m³/j)": round(m3 / 7), "Bande ±15 %": f"{round(m3*.85):,} – {round(m3*1.15):,} m³"})
st.dataframe(pd.DataFrame(week_rows), hide_index=True, width="stretch")
st.caption(f"Fenêtre : {start_day:%d/%m} – {(start_day + timedelta(days=6)):%d/%m} · Source : {weather_source} · sensibilité ±15 % appliquée à l'ET₀. Le besoin saisonnier utilise séparément une ET₀ moyenne de démonstration à 5,0 mm/j.")

with st.expander("Voir l'impact sur les 3 scénarios météo"):
    sensitivity = []
    for label, f in [("Prudent · −15 %", .85), ("Nominal", 1.0), ("Chaud · +15 %", 1.15)]:
        ps = [dict(p, need=season_need_m3(p["crop"], p["area_ha"], p["age"], f, eta)) for p in parcels]
        q = min(float(quota), sum(p["need"] for p in ps))
        ao, used_fallback = solve_quota(ps, q, "optimisé")
        au, _ = solve_quota(ps, q, "uniforme")
        po, vo = impact(ps, ao)
        pu, vu = impact(ps, au)
        sensitivity.append({"Scénario ET₀": label, "Besoin": f"{sum(p['need'] for p in ps):,.0f} m³", "Quota": f"{q:,.0f} m³", "Préservé · NORIA": f"{po:.1f} %", "Préservé · uniforme": f"{pu:.1f} %", "Écart": f"{po-pu:+.1f} pt", "Repli": "Proportionnel" if used_fallback else "Optimisé"})
    st.dataframe(pd.DataFrame(sensitivity), hide_index=True, width="stretch")

with st.expander("Méthode, sources et limites"):
    st.markdown("""
    **Calcul** — ETc = Kc × ET₀ ; besoin brut = max(ETc − pluie, 0) / efficacité, converti à 10 m³/ha par mm. Le Kc évolue par stades avec interpolation linéaire (FAO-56). Le quota est réparti par programmation linéaire en minimisant la perte économique théorique : Ky × déficit relatif × rendement potentiel × prix × surface. La contrainte de 50 % est une hypothèse de partage, ajustable.

    **Sources agronomiques** — FAO Irrigation and Drainage Paper 56, chapitre 6, tableaux 11–12 (Kc et durées indicatives) ; FAO Irrigation and Drainage Paper 33 (Ky saisonnier et relation rendement-eau). Liens dans `SOURCES.md`.

    **Ce qui est simulé** — parcelles, rendement, prix et météo de référence. L'ET₀ de 5,0 mm/j est un scénario de démonstration, pas une observation ni une prévision météo pour Dakhla. Les coefficients Kc sont des valeurs de référence et doivent être ajustés aux pratiques, à la variété, au climat et à la conduite (serre/plein champ). Le résultat n'est pas une recommandation agronomique opérationnelle.

    **Différence avec un simple calculateur** — NORIA compare deux allocations sous une enveloppe collective fixe et rend visible le compromis entre uniformité, rendement et incertitude. La décision finale reste au gestionnaire du périmètre.
    """)

st.markdown("<hr><div style='display:flex;justify-content:space-between;color:#6b8581;font-size:11px'><span>NORIA · Dakhla — démonstrateur hackathon ENSA–ENTA</span><span>Décider mieux, sans dépasser le quota.</span></div>", unsafe_allow_html=True)

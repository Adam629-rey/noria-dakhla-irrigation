const CROPS = {
  // FAO-56 Table 12. Tomato Kc-end range is 0.70–0.90; demo uses its midpoint.
  // FAO-56 Table 11: arid Oct/Nov tomato stages; desert watermelon stages.
  Tomate: { kc: [0.60, 1.15, 0.80], kcEndRange: [0.70, 0.90], ky: 1.05, height: 0.60, stages: [35, 45, 70, 30] },
  Pastèque: { kc: [0.40, 1.00, 0.75], ky: 1.10, height: 0.40, stages: [10, 20, 20, 30] },
};
const isoDaysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const ageFromDate = (iso) => Math.max(0, Math.floor((new Date().setHours(12,0,0,0) - new Date(`${iso}T12:00:00`)) / 86400000));
const DEFAULT_PARCELS = [
  { id: "N-01", place: "Littoral", crop: "Tomate", area: 12, planting: isoDaysAgo(55), yield: 90, price: 3200 },
  { id: "N-02", place: "Oued", crop: "Pastèque", area: 8, planting: isoDaysAgo(32), yield: 55, price: 2600 },
  { id: "N-03", place: "Dunes", crop: "Tomate", area: 10, planting: isoDaysAgo(85), yield: 90, price: 3200 },
];
const BASE_ET0 = 5.0;
const WEEK_KEY = "noria-open-meteo-cache-v1";
const HISTORY_KEY = "noria-dakhla-history-2021-2025-v1";
const PILOT_KEY = "noria-pilot-metrics-v1";
let parcels = structuredClone(DEFAULT_PARCELS);
let forecast = readWeatherCache() || demoWeather();
let historyCache = readHistoryCache();
let climateMap = buildClimatology(historyCache?.rows || []);
let toastTimer;
let pilotInputs = readPilotInputs();

const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0);
const shortFmt = (n) => fmt(n, 0);
const euro = (n) => fmt(n / 1_000_000, 2);

function demoWeather() {
  const daily = [4.8, 5.0, 5.2, 4.9, 5.3, 5.1, 4.7];
  const today = new Date();
  return daily.map((et0, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    return { date: d.toISOString().slice(0, 10), et0, rain: 0, source: "Simulation locale · hors ligne" };
  });
}

function readWeatherCache() {
  try {
    const items = JSON.parse(localStorage.getItem(WEEK_KEY) || "null");
    if (Array.isArray(items) && items.length === 7 && items.every((x) => Number.isFinite(x.et0) && Number.isFinite(x.rain))) return items;
  } catch (_) { /* Empty or blocked browser storage: use the labelled demo data. */ }
  return null;
}

function readHistoryCache() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "null");
    if (data?.rows?.length > 1500 && data.start === "2021-01-01" && data.end === "2025-12-31") return data;
  } catch (_) { /* Invalid or unavailable local cache: show the labelled demo baseline. */ }
  return null;
}

function buildClimatology(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = row.date.slice(5);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  return new Map([...buckets].map(([key, values]) => [key, {
    et0: mean(values.map((x) => x.et0)), rain: mean(values.map((x) => x.rain)),
    rhMin: mean(values.map((x) => x.rhMin).filter(Number.isFinite)),
    wind10: mean(values.map((x) => x.wind10).filter(Number.isFinite)),
  }]));
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function climateForDate(iso) {
  const monthDay = iso.slice(5);
  const record = climateMap.get(monthDay) || (monthDay === "02-29" ? climateMap.get("02-28") : null);
  return record || { et0: BASE_ET0, rain: 0, rhMin: null, wind10: null };
}
function plusDays(iso, days) { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

function kcForAge(crop, age, coefficients = CROPS[crop].kc) {
  const [ini, mid, end] = coefficients;
  const [s1, s2, s3, s4] = CROPS[crop].stages;
  if (age < 0) return 0;
  if (age < s1) return ini;
  if (age < s1 + s2) return ini + (mid - ini) * (age - s1) / s2;
  if (age < s1 + s2 + s3) return mid;
  if (age < s1 + s2 + s3 + s4) return mid + (end - mid) * (age - s1 - s2 - s3) / s4;
  return 0;
}

function dailyNeedMm(crop, age, et0 = BASE_ET0, rain = 0, efficiency = 0.9, coefficients = CROPS[crop].kc) {
  return Math.max(0, kcForAge(crop, age, coefficients) * et0 - rain) / Math.max(0.01, efficiency);
}

function climateAdjustedKcs(cropName, planting) {
  const crop = CROPS[cropName];
  const [ini, midBase, endBase] = crop.kc;
  if (!historyCache) return crop.kc.slice();
  const [s1, s2, s3, s4] = crop.stages;
  const adjust = (base, ageStart, length) => {
    const samples = [];
    for (let d = ageStart; d < ageStart + length; d++) samples.push(climateForDate(plusDays(planting, d)));
    const rh = mean(samples.map((x) => x.rhMin).filter(Number.isFinite));
    const wind10 = mean(samples.map((x) => x.wind10).filter(Number.isFinite));
    if (!Number.isFinite(rh) || !Number.isFinite(wind10)) return base;
    const wind2 = wind10 * (4.87 / Math.log(67.8 * 10 - 5.42)); // FAO-56 Eq. 47, 10 m to 2 m
    const h = Math.max(0.1, crop.height);
    return base + (0.04 * (Math.min(6, Math.max(1, wind2)) - 2) - 0.004 * (Math.min(80, Math.max(20, rh)) - 45)) * (h / 3) ** 0.3;
  };
  return [ini, adjust(midBase, s1 + s2, s3), adjust(endBase, s1 + s2 + s3, s4)];
}

function seasonNeed(parcel, factor, efficiency) {
  const crop = CROPS[parcel.crop];
  const duration = crop.stages.reduce((a, b) => a + b, 0);
  const age = ageFromDate(parcel.planting);
  const kcs = climateAdjustedKcs(parcel.crop, parcel.planting);
  let etm3 = 0, effectiveRainM3 = 0, grossNeedM3 = 0;
  for (let day = age; day < duration; day++) {
    const weather = climateForDate(plusDays(parcel.planting, day));
    const etc = kcForAge(parcel.crop, day, kcs) * weather.et0 * factor;
    const rain = Math.min(etc, Math.max(0, weather.rain));
    etm3 += etc * 10 * parcel.area;
    effectiveRainM3 += rain * 10 * parcel.area;
    grossNeedM3 += Math.max(0, etc - rain) / efficiency * 10 * parcel.area;
  }
  return { need: grossNeedM3, etm3, effectiveRainM3, kcs, age };
}

function solve(parcelsWithNeed, quota, mode = "optimized") {
  const needs = parcelsWithNeed.map((p) => p.need);
  const total = needs.reduce((a, b) => a + b, 0);
  const q = Math.min(Math.max(0, quota), total);
  if (!total) return { allocations: needs.map(() => 0), fallback: false };
  if (mode === "uniform") return { allocations: needs.map((n) => n * q / total), fallback: false };
  // Under a separable linear loss model, ranking marginal value protected per m³
  // is equivalent to solving the one-constraint linear program exactly.
  let floors = needs.map((n) => Math.min(n * 0.5, q / Math.max(1, needs.length)));
  if (floors.reduce((a, b) => a + b, 0) > q + 1e-7) floors = needs.map(() => 0);
  const allocations = floors.slice();
  let remaining = Math.max(0, q - allocations.reduce((a, b) => a + b, 0));
  const order = parcelsWithNeed.map((p, i) => ({
    i,
    score: p.etm3 > 0 ? (p.ky * p.yield * p.price * p.area * p.efficiency) / p.etm3 : 0,
  })).sort((a, b) => b.score - a.score);
  for (const { i } of order) {
    const add = Math.min(remaining, Math.max(0, needs[i] - allocations[i]));
    allocations[i] += add;
    remaining -= add;
  }
  return { allocations, fallback: false };
}

function estimateImpact(items, allocations) {
  let totalValue = 0;
  let protectedValue = 0;
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const potential = p.yield * p.price * p.area;
    const fraction = p.etm3 > 0 ? Math.min(1, (p.effectiveRainM3 + allocations[i] * p.efficiency) / p.etm3) : 1;
    const loss = Math.min(1, p.ky * (1 - fraction));
    totalValue += potential;
    protectedValue += potential * Math.max(0, 1 - loss);
  }
  return { preserved: totalValue ? protectedValue / totalValue * 100 : 0, value: protectedValue };
}

function currentScenario() {
  const factor = Number($("scenarioSelect").value);
  const quota = Math.max(0, Math.min(500000, Number($("quotaInput").value) || 0));
  const efficiency = Number($("efficiencyInput").value);
  const items = parcels.map((p) => ({ ...p, ...seasonNeed(p, factor, efficiency), ky: CROPS[p.crop].ky, efficiency }));
  const totalNeed = items.reduce((a, p) => a + p.need, 0);
  const effectiveQuota = Math.min(quota, totalNeed);
  const optimized = solve(items, effectiveQuota);
  const uniform = solve(items, effectiveQuota, "uniform");
  return { factor, quota, efficiency, items, totalNeed, effectiveQuota, optimized: optimized.allocations, uniform: uniform.allocations };
}

function renderParcelTable(s) {
  const rows = s.items.map((p, i) => {
    const cropIcon = p.crop === "Pastèque" ? "◍" : "✿";
    const style = p.crop === "Pastèque" ? " watermelon" : "";
    return `<tr data-row="${i}">
      <td><div class="parcel-name"><span class="parcel-symbol${style}">${cropIcon}</span><span>${p.id}<small style="display:block;color:#9aabaa;font-weight:400;font-size:7px;margin-top:2px">${p.place}</small></span></div></td>
      <td><select class="crop-input" data-field="crop" aria-label="Culture de la parcelle ${i + 1}">${Object.keys(CROPS).map((name) => `<option ${name === p.crop ? "selected" : ""}>${name}</option>`).join("")}</select><small class="kc-hint">Kc ${p.kcs.map((x) => fmt(x, 2)).join(" · ")}</small></td>
      <td><input class="number-input" data-field="area" type="number" min="0.1" max="250" step="0.5" value="${p.area}" aria-label="Surface en hectares"></td>
      <td><input class="date-input" data-field="planting" type="date" value="${p.planting}" aria-label="Date de plantation"> <small class="age-hint">${p.age} j</small></td>
      <td><input class="yield-input" data-field="yield" type="number" min="1" max="300" step="1" value="${p.yield}" aria-label="Rendement potentiel"><small style="color:#97a9a6"> t/ha</small></td>
      <td><input class="price-input" data-field="price" type="number" min="100" max="50000" step="100" value="${p.price}" aria-label="Prix indicatif"><small style="color:#97a9a6"> MAD/t</small></td>
      <td class="need-cell">${shortFmt(p.need)} m³</td>
    </tr>`;
  }).join("");
  $("parcelRows").innerHTML = rows;
}

function renderChart(s) {
  const max = Math.max(1, ...s.items.map((p) => p.need));
  $("allocationChart").innerHTML = s.items.map((p, i) => {
    const opt = s.optimized[i];
    const uni = s.uniform[i];
    return `<div class="chart-row"><div class="chart-label" title="${p.id} · ${p.place}">${p.id} · ${p.place}</div><div class="bar-pair" aria-label="NORIA ${shortFmt(opt)} m³; uniforme ${shortFmt(uni)} m³"><div class="bar-track"><div class="bar optimized" style="width:${Math.max(0, opt / max * 100)}%"></div></div><div class="bar-track"><div class="bar uniform" style="width:${Math.max(0, uni / max * 100)}%"></div></div></div><div class="bar-value">${shortFmt(opt)}</div></div>`;
  }).join("");
}

function renderAllocation(s) {
  $("allocationList").innerHTML = s.items.map((p, i) => {
    const allocation = s.optimized[i];
    const share = p.need ? Math.min(100, allocation / p.need * 100) : 0;
    const dot = ["", " orange", " blue"][i % 3];
    return `<div class="allocation-item"><div class="alloc-top"><div class="alloc-left"><i class="alloc-dot${dot}"></i><strong>${p.id} · ${p.crop}</strong></div><span class="alloc-water">${shortFmt(allocation)} <small>m³</small></span></div><div class="alloc-progress"><span style="width:${share}%"></span></div><div class="alloc-caption"><span>${fmt(share, 0)} % du besoin couvert</span><span>Besoin ${shortFmt(p.need)} m³</span></div></div>`;
  }).join("");
  $("allocatedTotal").innerHTML = `${shortFmt(s.optimized.reduce((a, b) => a + b, 0))} <small>m³</small>`;
}

function readPilotInputs() {
  try { return JSON.parse(localStorage.getItem(PILOT_KEY) || "{}") || {}; }
  catch (_) { return {}; }
}

function savePilotInputs() {
  try { localStorage.setItem(PILOT_KEY, JSON.stringify(pilotInputs)); }
  catch (_) { /* Pilot notes remain optional if browser storage is unavailable. */ }
}

function attachPilotEvents() {
  const fields = { pilotEt0: "et0", pilotRain: "rain", pilotVolume: "volume", pilotMinutes: "minutes", pilotEase: "ease" };
  Object.entries(fields).forEach(([id, key]) => {
    const input = $(id);
    if (pilotInputs[key] !== undefined && pilotInputs[key] !== null) input.value = String(pilotInputs[key]);
    input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
      pilotInputs[key] = input.value === "" ? null : Number(input.value);
      savePilotInputs();
      renderPilotMetrics(currentScenario());
    });
  });
}

function renderExplanation(s) {
  const q = s.effectiveQuota;
  const total = s.totalNeed;
  let floors = s.items.map((p) => Math.min(p.need * 0.5, q / Math.max(1, s.items.length)));
  if (floors.reduce((a, b) => a + b, 0) > q + 1e-7) floors = s.items.map(() => 0);
  const priority = s.items.map((p, i) => ({ i, score: p.etm3 > 0 ? (p.ky * p.yield * p.price * p.area * p.efficiency) / p.etm3 : 0 }))
    .sort((a, b) => b.score - a.score);
  const rank = new Map(priority.map((p, i) => [p.i, i + 1]));
  const scenarioLabel = $("scenarioSelect").selectedOptions[0]?.textContent || "Scénario courant";
  const needMethod = historyCache ? "Climatologie ERA5 2021–2025 chargée" : `Référence démo : ET₀ fixe ${fmt(BASE_ET0, 1)} mm/j`;
  const quotaText = total <= 0 ? "Aucun besoin estimé sur le cycle restant." : q >= total - 0.5
    ? "Le quota couvre tous les besoins modélisés ; les parcelles reçoivent leur besoin estimé."
    : `Le quota couvre ${fmt(q / total * 100, 0)} % du besoin total ; un plancher d’équité est appliqué quand l’enveloppe le permet, puis le solde suit le rang de valeur protégée estimée par m³.`;
  $("decisionBadge").textContent = q < total - 0.5 ? "Quota contraint · arbitrage actif" : "Quota suffisant · besoins couverts";
  $("explanationSteps").innerHTML = `
    <div><span>1</span><p><b>Estimer le besoin</b> Kc × ET₀, moins la pluie efficace, corrigé par l’efficacité d’irrigation. ${needMethod}.</p></div>
    <div><span>2</span><p><b>Appliquer la contrainte</b> ${quotaText}</p></div>
    <div><span>3</span><p><b>Comparer les options</b> NORIA est comparé à un partage proportionnel aux besoins. Scénario actif : ${scenarioLabel}.</p></div>`;
  $("explainParcels").innerHTML = s.items.map((p, i) => {
    const amount = s.optimized[i];
    const coverage = p.need > 0 ? Math.min(100, amount / p.need * 100) : 0;
    const rankText = p.need <= 0 ? "Pas de besoin restant estimé" : q >= total - 0.5
      ? "Besoin estimé couvert par le quota"
      : `Rang ${rank.get(i)} / ${s.items.length} · score théorique ${fmt(priority.find((x) => x.i === i)?.score || 0, 2)} MAD protégés / m³`;
    const equityText = floors[i] > 0 ? `Plancher indicatif : ${shortFmt(floors[i])} m³` : "Pas de plancher dans cette enveloppe";
    return `<div class="explain-parcel"><div class="explain-parcel-head"><b>${p.id} · ${p.crop}</b><strong>${shortFmt(amount)} <small>m³</small></strong></div><div class="explain-meter"><span style="width:${coverage}%"></span></div><div class="explain-meta"><span>${fmt(coverage, 0)} % du besoin · ${equityText}</span><small>Besoin : ${shortFmt(p.need)} m³</small></div><p>${rankText}</p></div>`;
  }).join("");
  $("allocationModeNote").textContent = "Lecture indicative : le score est une priorité issue des rendements, prix et Ky saisis — pas une valeur économique constatée. Le plan doit être vérifié par le gestionnaire et les exploitants.";
}

function renderPilotMetrics(s) {
  const live = forecast[0]?.source?.includes("Open-Meteo");
  const observedEt0 = pilotInputs.et0;
  const observedRain = pilotInputs.rain;
  if (live && Number.isFinite(observedEt0) && Number.isFinite(observedRain)) {
    const et0Error = Math.abs(forecast[0].et0 - observedEt0) / Math.max(0.1, observedEt0) * 100;
    const rainError = Math.abs(forecast[0].rain - observedRain);
    $("pilotWeatherError").textContent = `Jour 1 vs station : écart ET₀ ${fmt(et0Error, 1)} % · écart pluie ${fmt(rainError, 1)} mm.`;
  } else if (!live) {
    $("pilotWeatherError").textContent = "Pas de prévision en direct : actualiser la météo avant de comparer aux mesures de station.";
  } else {
    $("pilotWeatherError").textContent = "Saisir les mesures d’une station locale pour calculer les écarts du jour 1.";
  }
  if (Number.isFinite(pilotInputs.volume)) {
    const recommended = s.optimized.reduce((a, b) => a + b, 0);
    const delta = pilotInputs.volume - recommended;
    const pct = recommended > 0 ? delta / recommended * 100 : 0;
    $("pilotVolumeGap").textContent = `Recommandé : ${shortFmt(recommended)} m³ · écart observé : ${delta >= 0 ? "+" : "−"}${shortFmt(Math.abs(delta))} m³ (${delta >= 0 ? "+" : "−"}${fmt(Math.abs(pct), 1)} %).`;
  } else {
    $("pilotVolumeGap").textContent = "À renseigner après le cycle, sur les mêmes parcelles.";
  }
  $("pilotTimeResult").textContent = Number.isFinite(pilotInputs.minutes) ? `${fmt(pilotInputs.minutes, 0)} minute(s) déclarée(s) pour préparer le plan.` : "À mesurer lors de chaque préparation.";
  const ease = Number.isFinite(pilotInputs.ease) ? pilotInputs.ease : null;
  $("pilotEaseResult").textContent = ease === null ? "Échelle prête · recueillir la note après usage." : `Note déclarée : ${ease} / 5.`;
}

function renderForecast(s) {
  const names = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const eto = forecast.map((d) => d.et0 * s.factor);
  $("forecastDays").innerHTML = forecast.map((d, i) => {
    const date = new Date(`${d.date}T12:00:00`);
    const dayName = names[date.getDay()];
    const dayNum = date.getDate();
    const icon = d.rain > 0.2 ? "☁" : "☼";
    const iconClass = d.rain > 0.2 ? " cloud" : "";
    return `<div class="day-cell${i === 0 ? " today" : ""}"><div class="day-name">${i === 0 ? "auj." : dayName} ${dayNum}</div><div class="day-icon${iconClass}">${icon}</div><div class="day-eto">${fmt(eto[i], 1)}<small style="font-size:6px;color:#9aaba7;font-weight:500"> mm</small></div><div class="day-mm">${d.rain > 0.2 ? `${fmt(d.rain, 1)} pluie` : "sec"}</div></div>`;
  }).join("");
  let week = s.items.map(() => 0);
  s.items.forEach((p, pi) => forecast.forEach((d, di) => {
    week[pi] += dailyNeedMm(p.crop, p.age + di, d.et0 * s.factor, d.rain, s.efficiency, p.kcs) * 10 * p.area;
  }));
  const total = week.reduce((a, b) => a + b, 0);
  $("weeklyTotals").innerHTML = `<div class="weekly-number">${shortFmt(total)} <small>m³</small></div><div class="weekly-detail">${fmt(total * 0.85)} – ${fmt(total * 1.15)} m³ · sensibilité ±15 %</div>`;
  const stamp = (d) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(d);
  $("forecastSource").textContent = forecast[0].source.includes("Open-Meteo") ? "Prévision Open-Meteo" : "Simulation hors ligne";
  const liveForecast = forecast[0].source.includes("Open-Meteo");
  $("weatherStatus").textContent = liveForecast ? `Prévision actualisée · ${stamp(new Date(`${forecast[0].date}T12:00:00`))}` : (historyCache ? "Climat ERA5 · semaine démo" : "Mode démo · hors ligne");
  document.querySelector(".offline-chip i").style.background = (liveForecast || historyCache) ? "#4f83f1" : "#e1a853";
  return { total, week };
}

function renderSeasonality() {
  const monthNames = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
  if (!historyCache || !historyCache.rows?.length) {
    $("loadClimate").innerHTML = "<span>↓</span> Charger l’historique 2021–2025";
    $("climateBadge").textContent = "À ACTUALISER";
    $("climateBadge").classList.remove("ready");
    $("climatePeriod").textContent = "Climatologie non chargée · mode démonstration";
    $("climateSummary").textContent = `Données simulées · ET₀ saisonnière fixe ${fmt(BASE_ET0, 1)} mm/j`;
    $("climateSummary").classList.remove("strong");
    $("seasonalChart").innerHTML = monthNames.map((name) => `<div class="month-column"><span class="month-value">—</span><div class="month-bars"><div class="month-bar" style="height:56%"></div></div><span class="month-label">${name}</span></div>`).join("");
    return;
  }
  const months = Array.from({ length: 12 }, () => []);
  historyCache.rows.forEach((r) => months[Number(r.date.slice(5, 7)) - 1].push(r));
  const stats = months.map((rows) => ({ et0: mean(rows.map((r) => r.et0).filter(Number.isFinite)), rain: mean(rows.map((r) => r.rain).filter(Number.isFinite)), days: rows.length }));
  const maxEt0 = Math.max(1, ...stats.map((m) => m.et0 || 0));
  const yearlyEt0 = stats.reduce((sum, m, i) => sum + (m.et0 || 0) * new Date(2025, i + 1, 0).getDate(), 0);
  const yearlyRain = stats.reduce((sum, m, i) => sum + (m.rain || 0) * new Date(2025, i + 1, 0).getDate(), 0);
  $("climateBadge").textContent = "OPEN-METEO · ERA5";
  $("climateBadge").classList.add("ready");
  const latitude = Number.isFinite(historyCache.latitude) ? historyCache.latitude : 23.7;
  const longitude = Number.isFinite(historyCache.longitude) ? historyCache.longitude : -15.9;
  $("climatePeriod").textContent = `Réanalyse quotidienne · ${historyCache.start} → ${historyCache.end} · maille ${fmt(latitude, 2)}° / ${fmt(longitude, 2)}°`;
  $("climateSummary").textContent = `ET₀ ${fmt(yearlyEt0)} mm/an · pluie ${fmt(yearlyRain)} mm/an en moyenne · 5 ans`;
  $("climateSummary").classList.add("strong");
  $("loadClimate").innerHTML = "↻ Actualiser l’historique";
  $("seasonalChart").innerHTML = stats.map((m, i) => {
    const height = m.et0 ? Math.max(3, m.et0 / maxEt0 * 58) : 0;
    const rainHeight = m.rain ? Math.max(2, m.rain / maxEt0 * 58) : 0;
    const monthRain = (m.rain || 0) * new Date(2025, i + 1, 0).getDate();
    return `<div class="month-column" title="${monthNames[i]} · ET₀ ${fmt(m.et0 || 0, 2)} mm/j · pluie ${fmt(monthRain, 1)} mm/mois"><span class="month-value">${fmt(m.et0 || 0, 1)}</span><div class="month-bars"><div class="month-bar" style="height:${height}px"></div><div class="month-bar rain" style="height:${rainHeight}px"></div></div><span class="month-label">${monthNames[i]}</span><small class="month-precip">P ${fmt(monthRain, 0)} mm</small></div>`;
  }).join("");
}

async function loadSeasonalHistory() {
  const button = $("loadClimate");
  button.disabled = true;
  button.innerHTML = "Chargement de la réanalyse…";
  try {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.search = new URLSearchParams({
      latitude: "23.7", longitude: "-15.9", start_date: "2021-01-01", end_date: "2025-12-31",
      daily: "et0_fao_evapotranspiration,precipitation_sum",
      hourly: "relative_humidity_2m,wind_speed_10m", wind_speed_unit: "ms", timezone: "Africa/Casablanca", models: "era5_seamless",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`API météo : ${response.status}`);
    const payload = await response.json();
    const hourly = new Map();
    payload.hourly.time.forEach((stamp, i) => {
      const day = stamp.slice(0, 10);
      if (!hourly.has(day)) hourly.set(day, { rh: [], wind: [] });
      const h = hourly.get(day);
      const rh = payload.hourly.relative_humidity_2m[i];
      const wind = payload.hourly.wind_speed_10m[i];
      if (Number.isFinite(rh)) h.rh.push(rh);
      if (Number.isFinite(wind)) h.wind.push(wind);
    });
    const rows = payload.daily.time.map((day, i) => {
      const h = hourly.get(day) || { rh: [], wind: [] };
      return { date: day, et0: payload.daily.et0_fao_evapotranspiration[i], rain: payload.daily.precipitation_sum[i], rhMin: h.rh.length ? Math.min(...h.rh) : null, wind10: mean(h.wind) };
    }).filter((r) => Number.isFinite(r.et0) && Number.isFinite(r.rain));
    if (rows.length < 1750) throw new Error(`Historique incomplet (${rows.length} jours valides sur environ 1 826).`);
    historyCache = { start: "2021-01-01", end: "2025-12-31", latitude: payload.latitude, longitude: payload.longitude, fetchedAt: new Date().toISOString(), rows };
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
    climateMap = buildClimatology(rows);
    showToast(`Historique Dakhla chargé : ${rows.length} jours, réanalyse 2021–2025.`);
  } catch (error) {
    showToast(`Historique indisponible : ${error.message}. La référence reste affichée.`);
  } finally {
    button.disabled = false;
    button.innerHTML = historyCache ? "✓ Historique chargé" : "<span>↓</span> Charger l’historique 2021–2025";
    update();
  }
}

function renderScenarios() {
  const labels = [[0.85, "Prudent", "ET₀ −15 %"], [1, "Nominal", "ET₀ de base"], [1.15, "Chaud", "ET₀ +15 %"]];
  const quota = Math.max(0, Number($("quotaInput").value) || 0);
  const efficiency = Number($("efficiencyInput").value);
  const rows = labels.map(([factor, title, sub]) => {
    const items = parcels.map((p) => ({ ...p, ...seasonNeed(p, factor, efficiency), ky: CROPS[p.crop].ky, efficiency }));
    const total = items.reduce((a, p) => a + p.need, 0);
    const q = Math.min(quota, total);
    const opt = solve(items, q).allocations;
    const uniform = solve(items, q, "uniform").allocations;
    const a = estimateImpact(items, opt).preserved;
    const b = estimateImpact(items, uniform).preserved;
    return `<tr><td><b>${title}</b><small style="display:block;color:#9aaba7;margin-top:2px">${sub}</small></td><td>${shortFmt(total)} m³</td><td>${fmt(a, 1)} %</td><td>${fmt(b, 1)} %</td><td>+${fmt(a - b, 1)} pt</td></tr>`;
  }).join("");
  $("scenarioRows").innerHTML = `<table class="scenario-table"><thead><tr><th>SCÉNARIO</th><th>BESOIN ESTIMÉ</th><th>NORIA</th><th>UNIFORME</th><th>ÉCART</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function update() {
  const s = currentScenario();
  const optImpact = estimateImpact(s.items, s.optimized);
  const uniImpact = estimateImpact(s.items, s.uniform);
  const usedPercent = s.totalNeed ? s.effectiveQuota / s.totalNeed * 100 : 0;
  $("efficiencyLabel").textContent = `${Math.round(s.efficiency * 100)} %`;
  $("needMetric").innerHTML = `${shortFmt(s.totalNeed)} <small>m³</small>`;
  $("allocatedMetric").innerHTML = `${shortFmt(s.effectiveQuota)} <small>m³</small>`;
  $("quotaPct").textContent = `${fmt(usedPercent, 0)} % du besoin`;
  $("yieldMetric").innerHTML = `${fmt(optImpact.preserved, 1)} <small>%</small>`;
  $("deltaMetric").textContent = `${fmt(optImpact.preserved - uniImpact.preserved, 1)} pt vs uniforme`;
  $("valueMetric").innerHTML = `${euro(optImpact.value)} <small>M MAD</small>`;
  $("sideQuota").innerHTML = `${shortFmt(s.quota)} <small>m³</small>`;
  $("quotaUsedLabel").textContent = `${fmt(usedPercent, 0)} % mobilisé`;
  $("quotaProgress").style.width = `${Math.max(0, Math.min(100, usedPercent))}%`;
  renderParcelTable(s);
  renderChart(s);
  renderAllocation(s);
  renderExplanation(s);
  renderPilotMetrics(s);
  renderSeasonality();
  renderForecast(s);
  renderScenarios();
}

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
}

async function refreshWeather() {
  const buttons = [$("refreshWeather"), $("refreshWeatherText")];
  buttons.forEach((b) => { b.disabled = true; b.style.opacity = ".55"; });
  $("weatherStatus").textContent = "Récupération météo…";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({ latitude: "23.7", longitude: "-15.9", daily: "et0_fao_evapotranspiration,precipitation_sum", forecast_days: "7", timezone: "Africa/Casablanca" });
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Réponse météo ${response.status}`);
    const payload = await response.json();
    const days = payload.daily.time.map((date, i) => ({ date, et0: payload.daily.et0_fao_evapotranspiration[i], rain: payload.daily.precipitation_sum[i], source: "Prévision Open-Meteo" }));
    if (days.length !== 7 || days.some((d) => !Number.isFinite(d.et0) || !Number.isFinite(d.rain))) throw new Error("Prévision incomplète");
    forecast = days;
    localStorage.setItem(WEEK_KEY, JSON.stringify(days));
    showToast("Prévision 7 jours actualisée et enregistrée dans ce navigateur.");
  } catch (error) {
    const saved = readWeatherCache();
    forecast = saved || demoWeather();
    showToast(saved ? "Réseau indisponible · cache météo local chargé." : "Réseau indisponible · scénario de démonstration conservé.");
  } finally {
    buttons.forEach((b) => { b.disabled = false; b.style.opacity = "1"; });
    update();
  }
}

function attachEvents() {
  attachPilotEvents();
  $("parcelRows").addEventListener("change", (event) => {
    const target = event.target;
    const row = target.closest("tr[data-row]");
    if (!row) return;
    const index = Number(row.dataset.row);
    const field = target.dataset.field;
    if (!field) return;
    const value = field === "crop" || field === "planting" ? target.value : Number(target.value);
    parcels[index][field] = field === "crop" || field === "planting" ? value : Math.max(field === "area" ? 0.1 : 0, value || 0);
    update();
  });
  ["quotaInput", "scenarioSelect", "efficiencyInput"].forEach((id) => $(id).addEventListener(id === "efficiencyInput" ? "input" : "change", update));
  $("refreshWeather").addEventListener("click", refreshWeather);
  $("refreshWeatherText").addEventListener("click", refreshWeather);
  $("loadClimate").addEventListener("click", loadSeasonalHistory);
  $("resetButton").addEventListener("click", () => { $("quotaInput").value = 105000; $("scenarioSelect").value = "1"; $("efficiencyInput").value = ".90"; parcels = structuredClone(DEFAULT_PARCELS); update(); showToast("Scénario initial rétabli."); });
  $("restoreParcels").addEventListener("click", () => { parcels = structuredClone(DEFAULT_PARCELS); update(); showToast("Parcelles de démonstration restaurées."); });
  $("showScenarios").addEventListener("click", () => { $("scenarioPanel").classList.toggle("hidden"); $("showScenarios").innerHTML = $("scenarioPanel").classList.contains("hidden") ? 'Voir les 3 scénarios <b>＋</b>' : 'Masquer les scénarios <b>−</b>'; });
  $("closeScenarios").addEventListener("click", () => { $("scenarioPanel").classList.add("hidden"); $("showScenarios").innerHTML = 'Voir les 3 scénarios <b>＋</b>'; });
  $("methodToggle").addEventListener("click", () => { $("methodDetails").classList.toggle("hidden"); $("methodToggle").innerHTML = $("methodDetails").classList.contains("hidden") ? 'Méthode & limites <span>⌄</span>' : 'Fermer les détails <span>⌃</span>'; });
}

attachEvents();
update();

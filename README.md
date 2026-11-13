# NORIA · Conseiller d'irrigation pour Dakhla

> 🏆 Lauréat du prix du meilleur projet du thème Environnement au hackathon ENSA–ENTA.

Prototype de démonstration pour le hackathon ENSA–ENTA « Innovons pour les Provinces du Sud ». NORIA aide le gestionnaire d'un périmètre irrigué à répartir une enveloppe fixe entre des parcelles, à comparer cette répartition à un partage proportionnel, et à voir l'effet des incertitudes météo. L'interface principale est une application web responsive en HTML, CSS et JavaScript pur, sans outil de compilation ni compte requis.

## Lancer l'interface web

Depuis la racine du projet :

```bash
python -m http.server 8502 --directory web
```

Ouvrir ensuite <http://127.0.0.1:8502>. Les calculs se font dans le navigateur. Cliquer sur « Charger l'historique 2021–2025 » pour récupérer la climatologie quotidienne de Dakhla (ET₀, pluie, humidité, vent) et la garder dans le stockage local. La prévision Open-Meteo des 7 jours se met à jour séparément. Sans réseau, le cache reste utilisable ; sans cache, une référence de démonstration clairement étiquetée est affichée.

## Lancer la version Streamlit (optionnelle)

Depuis ce dossier, avec Python 3.10 ou plus récent :

```bash
python -m pip install -r requirements.txt
streamlit run app.py
```

Cette version Python reste disponible comme variante de démonstration ; elle fonctionne hors ligne après installation des dépendances.

## Démo en 90 secondes

1. Garder les 3 parcelles simulées et le quota de 105 000 m³.
2. Montrer les entrées éditables (culture, surface, âge, rendement et prix hypothétiques).
3. Comparer la barre NORIA au partage uniforme et expliquer le plancher d'équité de 50 % lorsque le quota le permet.
4. Charger l'historique local 2021–2025, puis actualiser la prévision 7 jours si le réseau est disponible. Changer le scénario ET₀ de « Prudent » à « Chaud » et ouvrir la sensibilité.
5. Montrer la dose des 7 jours et ouvrir « Pourquoi NORIA propose cette répartition ? » pour expliquer les arbitrages parcelle par parcelle.
6. Montrer « Mesure du pilote » : erreurs météo vs station, écart entre volume recommandé et observé, temps de préparation et facilité d’usage. Les mesures saisies sont locales au navigateur et ne constituent pas encore des résultats de terrain.
7. Ouvrir « Méthode, sources et limites ».

## Décision mathématique

- ETc journalière = Kc × ET₀ (FAO-56), avec Kc interpolé au fil des stades.
- Besoin brut journalier = max(ETc − pluie, 0) / efficacité d'irrigation. En mode historique, ET₀ et pluie sont issus des moyennes par jour de l'année sur 2021–2025.
- Conversion : 1 mm sur 1 ha = 10 m³.
- Perte relative modélisée = Ky saisonnier × (1 − ETa / ETm) ; ETa compte pluie et eau d'irrigation corrigée par l'efficacité.
- L'optimiseur linéaire minimise la perte économique théorique estimée à partir du rendement, du prix et de la surface. Une contrainte de partage minimal de 50 % est appliquée lorsqu'elle est compatible avec le quota.
- Le partage proportionnel est le plan de secours si le solveur ne renvoie pas de solution.

## Périmètre et limites

Les hectares, dates, rendements, prix et quota de démo sont fictifs. Avant le chargement, l'ET₀ de 5 mm/j est une valeur de secours de démonstration. Après chargement, l'ET₀ et les pluies reposent sur la réanalyse ERA5-Seamless 2021–2025 pour la maille proche de Dakhla ; ce ne sont pas des mesures de station. Les coefficients FAO, ajustés au climat par RHmin et vent lorsque disponibles, doivent encore être validés avec des données d'exploitation. Le scénario ±15 % est une sensibilité, pas un intervalle de confiance. Aucune économie réelle ni hausse de rendement n'est revendiquée.

Avant un essai terrain : confronter la réanalyse à une station locale, valider les cultures et calendriers avec le gestionnaire et les agronomes, relever l'efficacité réelle, les rendements et prix, puis comparer les recommandations à CropWat et aux mesures de sol. Le gestionnaire humain garde la décision finale. La qualité de l'eau, le lessivage, le bilan hydrique complet du sol, les différences serre/plein champ et les contraintes du réseau ne sont pas modélisés dans ce MVP.

## Arborescence

- `web/index.html`, `web/styles.css`, `web/app.js` — interface web et calculs interactifs
- `app.py` — variante de démonstration Streamlit
- `SOURCES.md` — références agronomiques et événement
- `PITCH.md` — pitch de 3 minutes, trame de slides et réponses au jury
- `requirements.txt` — dépendances Python
# noria-dakhla-irrigation
NORIA — conseiller d’irrigation explicable pour répartir un quota d’eau entre parcelles à Dakhla. Lauréat du prix du meilleur projet du thème Environnement.

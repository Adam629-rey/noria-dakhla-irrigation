# Sources et hypothèses

## Références vérifiables

1. **FAO, Irrigation and Drainage Paper 56, chapitre 6, tableaux 11–12.** ETc = Kc × ET₀ ; Kc suit quatre stades et peut être ajusté selon vent, humidité, climat et fréquence de mouillage. [Chapitre 6 · FAO](https://www.fao.org/4/X0490E/x0490e0b.htm)
   - **Tomate** : Kc-initial 0,60 (groupe Solanacées), Kc-mi 1,15, Kc-fin 0,70–0,90. Le démonstrateur prend 0,80 comme valeur centrale de la plage tabulée.
   - **Pastèque** : Kc-initial 0,40, Kc-mi 1,00, Kc-fin 0,75 ; hauteur de référence 0,40 m.
   - Durées indicatives du tableau 11 : tomate aride semée en octobre/novembre 35/45/70/30 jours (180 jours) ; pastèque en climat désertique du Proche-Orient 10/20/20/30 jours (80 jours). Ces exemples de référence ne fixent pas le calendrier réel de Dakhla.
   - Après chargement de l'historique, Kc-mi et Kc-fin sont ajustés selon les équations 62 et 65, à partir des moyennes de RHmin et du vent à 2 m (dérivé du vent à 10 m) pendant ces stades. Kc-initial reste tabulé et doit être adapté à la fréquence réelle de mouillage.
2. **FAO, Irrigation and Drainage Paper 33**, repris dans l'annexe II, tableau 12 : Ky saisonnier tomate = 1,05 ; pastèque = 1,10. La relation agrégée relie déficit relatif d'évapotranspiration et baisse relative de rendement ; le Ky varie aussi selon les stades. [Annexe II · FAO](https://www.fao.org/4/X5647E/x5647e0e.htm)
3. **Open-Meteo Historical Weather API**, coordonnées demandées 23,7° N / 15,9° O, modèle ERA5-Seamless, période 2021–2025. L'interface récupère ET₀ FAO et pluie quotidiens, ainsi que humidité relative et vent horaires, construit une climatologie journalière moyenne par date, puis la conserve dans le stockage local du navigateur. L'API renvoie la maille météo effectivement utilisée ; elle peut différer légèrement du point demandé. [Documentation API historique](https://open-meteo.com/en/docs/historical-weather-api). C'est une réanalyse griddée, pas une mesure à la parcelle.
4. **Contexte du hackathon** : journée du 12 novembre 2026 à l'ENSA Marrakech ; hackathon inter-écoles autour de l'eau, des énergies renouvelables, de la pêche, du tourisme et des services aux citoyens. [Page ENSA Marrakech](https://ensa-marrakech.uca.ma/evenements/ensa-marrakech-enta-laayoune-enta-dakhla-ingenierie-au-service-de-unite-et-du-developpement-du-maroc-de-demain/)

## Hypothèses de démonstration

- Quota initial : 105 000 m³, choisi pour créer une contrainte visible dans l'interface.
- Trois parcelles et leurs surfaces, cultures, âges : cas fictif, modifiable.
- En l'absence d'historique téléchargé : ET₀ de secours 5,0 mm/j, pluie nulle. Après téléchargement, le besoin restant suit la climatologie locale quotidienne 2021–2025. Les scénarios prudent/chaud appliquent 0,85 ou 1,15 à l'ET₀.
- La dose à 7 jours peut utiliser l'API de prévision Open-Meteo (`et0_fao_evapotranspiration`, `precipitation_sum`) ; la semaine est mise en cache dans le navigateur.
- Efficacité d'irrigation : 0,90 par défaut, modifiable, à mesurer sur le terrain.
- Rendements potentiels et prix : valeurs hypothétiques réglables, uniquement utilisées pour illustrer le classement des pertes marginales.
- Plancher d'allocation de 50 % : choix de conception pour éviter une solution mathématique qui abandonne complètement une parcelle ; ce n'est pas une règle officielle.

## Limites de lecture

La valeur « rendement préservé » est un indicateur simulé par le modèle saisonnier Ky appliqué au déficit hydrique relatif ; ce n'est ni une prévision de rendement ni une économie validée. L'ajustement Kc et les profils météo utilisent une réanalyse de grille, qui ne remplace pas une station au champ. Le scénario météo ±15 % est une sensibilité, sans probabilité associée.

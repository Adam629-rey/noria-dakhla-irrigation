"""FAO : ETc=Kc*ET0 ; coefficients de démonstration NON calibrés pour Dakhla."""
import numpy as np
import pandas as pd
from .meteo import valider_meteo

# Valeurs pédagogiques : à remplacer par les valeurs validées du rôle Recherche.
PROFILS = {'Tomate': (.60, 1.15, .80), 'Melon': (.50, 1.05, .75)}
COLS = ['id','culture','surface_ha','plantation','milieu','ky','rendement_t_ha','prix_mad_kg']

def valider_parcelles(parcelles):
    p = parcelles.copy()
    if not set(COLS) <= set(p) or p.empty:
        raise ValueError('Parcelles : schéma incomplet ou tableau vide.')
    if p.id.isna().any() or p.id.astype(str).str.strip().eq('').any() or p.id.duplicated().any():
        raise ValueError('Chaque parcelle doit avoir un identifiant unique et non vide.')
    if not p.culture.isin(PROFILS).all() or not p.milieu.isin(['Plein champ','Serre']).all():
        raise ValueError('Culture ou milieu inconnu.')
    p['plantation'] = pd.to_datetime(p.plantation, errors='raise').dt.normalize()
    if p.plantation.isna().any():
        raise ValueError('Dates de plantation requises.')
    for c in COLS[2:3] + COLS[5:]:
        p[c] = pd.to_numeric(p[c], errors='raise')
        if not np.isfinite(p[c]).all() or (p[c] <= 0).any():
            raise ValueError(f'{c} doit être strictement positif et fini.')
    # Ky<=1 évite la troncature non linéaire de pertes >100% dans ce MVP.
    if (p.ky > 1).any():
        raise ValueError('Ce MVP linéaire accepte uniquement 0 < Ky <= 1 ; adapter le modèle pour Ky > 1.')
    return p

def besoin_parcelle(parcelles, meteo, facteur_et0=1., efficacite=.9):
    """Retourne (journalier, saison). Horizon météo complet, plantation relative à cet horizon."""
    p, w = valider_parcelles(parcelles), valider_meteo(meteo)
    if not np.isfinite(facteur_et0) or facteur_et0 <= 0 or not 0 < efficacite <= 1:
        raise ValueError('Facteur ET0 >0 et efficacité dans ]0,1] requis.')
    rows = []
    for r in p.itertuples():
        if r.plantation < w.date.min() or r.plantation + pd.Timedelta(days=89) > w.date.max():
            raise ValueError(f'{r.id} : le cache doit couvrir les 90 jours du cycle à partir de la plantation.')
        age = (w.date-r.plantation).dt.days.to_numpy()
        ini, mid, end = PROFILS[r.culture]
        # Cycle commun 90j : 15 initiaux, 25 développement, 30 mi-saison, 20 fin.
        kc = np.where(age < 15, ini, np.where(age < 40, ini+(mid-ini)*(age-15)/25,
             np.where(age < 70, mid, mid+(end-mid)*(age-70)/20)))
        kc = np.where((age >= 0)&(age < 90), kc, 0)
        etc = kc*w.et0_mm.to_numpy()*facteur_et0
        # Hypothèse serre : pluie exclue ; pas de correction ET0 microclimatique.
        pe = np.minimum(etc, w.pluie_mm.to_numpy()*.8 if r.milieu == 'Plein champ' else 0)
        rows.append(pd.DataFrame({'id':r.id,'date':w.date,'kc':kc,'etc_mm':etc,
            'pluie_eff_mm':pe,'besoin_m3':(etc-pe)*10*r.surface_ha/efficacite}))
    daily = pd.concat(rows, ignore_index=True)
    sums = daily.groupby('id')[['etc_mm','pluie_eff_mm','besoin_m3']].sum().reset_index()
    s = p.merge(sums, on='id', validate='one_to_one')
    s['etc_m3'] = s.etc_mm*s.surface_ha*10
    s['pluie_eff_m3'] = s.pluie_eff_mm*s.surface_ha*10
    s['valeur_pot_mad'] = s.surface_ha*s.rendement_t_ha*1000*s.prix_mad_kg
    s['efficacite'] = efficacite
    return daily, s

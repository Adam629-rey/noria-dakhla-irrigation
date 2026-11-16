"""Allocation de volumes bruts saisonniers ; objectif de perte économique linéaire."""
import numpy as np
import pandas as pd
from scipy.optimize import linprog

def repartir(quota, parcelles, methode='linprog', minimum=.5):
    """Retourne (table, statut). minimum irréalisable => proportionnel, avertissement explicite."""
    if not np.isfinite(quota) or quota < 0 or not 0 <= minimum <= 1:
        raise ValueError('Quota fini >=0 et minimum entre 0 et 1 requis.')
    if methode not in ['linprog','proportionnel']:
        raise ValueError('Méthode inconnue.')
    t = parcelles.copy()
    cols = ['besoin_m3','etc_m3','pluie_eff_m3','valeur_pot_mad','ky','efficacite']
    if t.empty or not set(cols) <= set(t):
        raise ValueError('Besoins saisonniers incomplets.')
    a = t[cols].to_numpy(dtype=float)
    if not np.isfinite(a).all() or (a < 0).any() or (t.etc_m3 <= 0).any() or (t.ky > 1).any() or (t.efficacite <= 0).any() or (t.efficacite > 1).any():
        raise ValueError('Besoins saisonniers invalides.')
    needs = t.besoin_m3.to_numpy()
    budget = min(quota, needs.sum())
    x = needs * (budget/needs.sum() if needs.sum() else 0)
    status = 'Partage proportionnel'
    if methode == 'linprog':
        if budget + 1e-8 < minimum*needs.sum():
            status = 'REPLI proportionnel : quota insuffisant pour les minima ; minima non respectés'
        else:
            slope = (t.valeur_pot_mad*t.ky*t.efficacite/t.etc_m3).to_numpy()
            try:
                result = linprog(-slope, A_ub=np.ones((1,len(t))), b_ub=[budget],
                    bounds=list(zip(minimum*needs,needs)), method='highs')
                if not result.success or not np.isfinite(result.x).all():
                    raise RuntimeError('Échec du solveur')
                x = result.x
                status = 'Optimisation linprog réussie'
            except (RuntimeError, ValueError):
                status = 'REPLI proportionnel : échec du solveur'
    t['alloue_m3'] = x
    t['couverture_pct'] = np.divide(x,needs,out=np.ones_like(x),where=needs>0)*100
    t['eta_m3'] = np.minimum(t.etc_m3, t.pluie_eff_m3+t.efficacite*x)
    t['rendement_relatif'] = 1-t.ky*(1-t.eta_m3/t.etc_m3)
    t['valeur_preservee_mad'] = t.valeur_pot_mad*t.rendement_relatif
    t['perte_mad'] = t.valeur_pot_mad-t.valeur_preservee_mad
    return t, status

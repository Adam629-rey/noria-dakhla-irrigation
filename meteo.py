"""Contrat météo v1 : dates locales ISO, ET0/pluie en mm/j, aucune donnée réelle incluse."""
from pathlib import Path
import numpy as np
import pandas as pd

CACHE = Path(__file__).resolve().parents[1] / 'data' / 'weather_cache.csv'

def valider_meteo(df):
    df = df.copy()
    required = ['date', 'et0_mm', 'pluie_mm']
    if not set(required) <= set(df):
        raise ValueError('Météo : colonnes date, et0_mm, pluie_mm requises.')
    df['date'] = pd.to_datetime(df['date'], errors='raise').dt.normalize()
    for col in required[1:]:
        df[col] = pd.to_numeric(df[col], errors='raise')
        if not np.isfinite(df[col]).all() or (df[col] < 0).any():
            raise ValueError('Météo : valeurs finies et positives ou nulles requises.')
    df = df.sort_values('date').reset_index(drop=True)
    if df.empty or df.date.duplicated().any() or (df.date.diff().dropna() != pd.Timedelta(days=1)).any():
        raise ValueError('Météo : série journalière continue, unique et non vide requise.')
    return df

def charger_meteo(path=CACHE):
    """Retourne (DataFrame, provenance). Cache absent/corrompu : secours déterministe en mémoire."""
    try:
        df = valider_meteo(pd.read_csv(path))
        if 'source' not in df or set(df.source) != {'simulation'}:
            raise ValueError('Provenance du cache non reconnue')
        return df, 'Cache local • météo SIMULÉE'
    except (OSError, ValueError, TypeError, pd.errors.ParserError):
        return simuler_meteo(), 'Secours en mémoire • cache absent/invalide • météo SIMULÉE'

def simuler_meteo():
    days = np.arange(120)
    return pd.DataFrame({'date': pd.date_range('2026-09-01', periods=120),
        'et0_mm': np.round(4.6 + .6*np.sin(days/13), 3),
        'pluie_mm': np.where(days % 19 == 0, 2., 0.), 'source': 'simulation'})

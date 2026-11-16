import unittest
from unittest.mock import patch
from pathlib import Path
import numpy as np
import pandas as pd
from modules.meteo import charger_meteo, simuler_meteo, valider_meteo
from modules.irrigation import besoin_parcelle
from modules.quota import repartir

ROOT = Path(__file__).resolve().parents[1]

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.p = pd.read_csv(ROOT/'data/parcelles.csv')
        self.w = simuler_meteo()
        self.d, self.s = besoin_parcelle(self.p,self.w)

    def test_manual_units(self):
        # P1 jour 2 : ETc=0.6*ET0, pas de pluie ; 1mm=10m3/ha.
        r = self.d[(self.d.id=='P1')].iloc[1]
        self.assertAlmostEqual(r.besoin_m3,.6*self.w.iloc[1].et0_mm*10*1.2/.9)
        # P3 sous serre : aucune pluie efficace.
        self.assertEqual(self.d[self.d.id=='P3'].pluie_eff_mm.sum(),0)

    def test_constraints_and_objective(self):
        for f in [.85,1.,1.15]:
            _,s = besoin_parcelle(self.p,self.w,f)
            quota = self.s.besoin_m3.sum()*.75
            b,_ = repartir(quota,s,'proportionnel')
            o,status = repartir(quota,s)
            self.assertIn('réussie',status)
            self.assertLessEqual(o.alloue_m3.sum(),quota+1e-6)
            self.assertTrue((o.alloue_m3 <= o.besoin_m3+1e-6).all())
            self.assertTrue((o.alloue_m3 >= .5*o.besoin_m3-1e-6).all())
            self.assertGreaterEqual(o.valeur_preservee_mad.sum()+1e-6,b.valeur_preservee_mad.sum())

    def test_zero_surplus_minimum_and_solver_failure(self):
        z,status = repartir(0,self.s)
        self.assertEqual(z.alloue_m3.sum(),0)
        self.assertIn('minima',status)
        o,_ = repartir(self.s.besoin_m3.sum()*2,self.s)
        np.testing.assert_allclose(o.alloue_m3,o.besoin_m3)
        np.testing.assert_allclose(o.rendement_relatif,1)
        with patch('modules.quota.linprog',side_effect=RuntimeError('test')):
            o,status = repartir(self.s.besoin_m3.sum()*.75,self.s)
            self.assertIn('REPLI',status)

    def test_bad_data_and_cache(self):
        _,source = charger_meteo(ROOT/'data/absent.csv')
        self.assertIn('Secours',source)
        for col,value in [('surface_ha',-1),('ky',1.2),('plantation','2026-01-01')]:
            p=self.p.copy(); p.loc[0,col]=value
            with self.assertRaises(ValueError): besoin_parcelle(p,self.w)
        with self.assertRaises(ValueError): repartir(-1,self.s)
        w=self.w.copy(); w.loc[0,'et0_mm']=np.nan
        with self.assertRaises(ValueError): valider_meteo(w)
        with self.assertRaises(ValueError): valider_meteo(self.w.iloc[[0,2]])

    def test_known_optimum(self):
        s=pd.DataFrame({'besoin_m3':[100.,100.], 'etc_m3':[100.,100.],
            'pluie_eff_m3':[0.,0.],'valeur_pot_mad':[1000.,100.], 'ky':[1.,1.], 'efficacite':[1.,1.]})
        o,_=repartir(150,s,minimum=.5)
        np.testing.assert_allclose(o.alloue_m3,[100,50])
        self.assertAlmostEqual(o.perte_mad.sum(),50)

if __name__=='__main__': unittest.main()

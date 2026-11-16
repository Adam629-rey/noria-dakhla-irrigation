import unittest
from pathlib import Path
from streamlit.testing.v1 import AppTest

class AppTests(unittest.TestCase):
    def test_dashboard_and_zero_quota(self):
        at = AppTest.from_file(str(Path(__file__).resolve().parents[1]/'app.py')).run(timeout=60)
        self.assertEqual(len(at.exception),0)
        self.assertEqual(len(at.metric),4)
        at.number_input[0].set_value(0.).run(timeout=60)
        self.assertEqual(len(at.exception),0)
        self.assertTrue(any('REPLI' in w.value for w in at.warning))
        at.selectbox[0].select('+15 %').run(timeout=60)
        self.assertEqual(len(at.exception),0)

if __name__=='__main__': unittest.main()

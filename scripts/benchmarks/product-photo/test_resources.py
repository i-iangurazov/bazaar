from types import SimpleNamespace
import threading
import unittest

import psutil

from run import ResourceMonitor


class FakeProcess:
    def __init__(self, pid, cpu=0, rss=0, children=None, gone=False):
        self.pid, self.total_cpu, self.rss, self.nested, self.gone = pid, cpu, rss, children or [], gone

    def children(self, recursive=True):
        return self.nested

    def create_time(self):
        return self.pid

    def cpu_times(self):
        if self.gone:
            raise psutil.NoSuchProcess(self.pid)
        return SimpleNamespace(user=self.total_cpu, system=0)

    def memory_info(self):
        if self.gone:
            raise psutil.ZombieProcess(self.pid)
        return SimpleNamespace(rss=self.rss)


class ResourceRegressionTests(unittest.TestCase):
    def monitor(self, process):
        monitor = ResourceMonitor.__new__(ResourceMonitor)
        monitor.process = process
        monitor.psutil = psutil
        monitor.cpu_observations = {}
        monitor.cpu_lock = threading.Lock()
        return monitor

    def test_exiting_import_helper_cannot_kill_memory_sampling(self):
        process = FakeProcess(1, rss=100, children=[FakeProcess(2, gone=True), FakeProcess(3, rss=30)])
        self.assertEqual(self.monitor(process).rss(), 130)

    def test_exiting_child_cannot_turn_cpu_time_negative(self):
        child = FakeProcess(2, cpu=5)
        process = FakeProcess(1, cpu=10, children=[child])
        monitor = self.monitor(process)
        self.assertEqual(monitor.cpu(), 15)
        process.nested = []
        process.total_cpu = 11
        self.assertEqual(monitor.cpu(), 16)


if __name__ == "__main__":
    unittest.main()

import unittest
from check_maps_plan import check

def item(address, after, actions=None):
    return {"address": address, "change": {"actions": actions or ["create"], "after": after}}

def good():
    return {"resource_changes": [
        item("neon_project.maps", {"name": "kunde-maps-dev", "history_retention_seconds": 21600}),
        item("render_web_service.maps", {"name": "kunde-maps-web-dev", "plan": "free", "runtime_source": {"docker": {"repo_url": "https://github.com/ADatkashov/kunde-maps", "auto_deploy_trigger": "off"}}}),
    ]}

class PlanTests(unittest.TestCase):
    def test_valid(self):
        check(good())
    def test_reject_delete(self):
        p = good()
        p["resource_changes"][0]["change"]["actions"] = ["delete"]
        with self.assertRaises(ValueError): check(p)
    def test_reject_paid(self):
        p = good()
        p["resource_changes"][1]["change"]["after"]["plan"] = "starter"
        with self.assertRaises(ValueError): check(p)
    def test_reject_shared_database(self):
        p = good()
        p["resource_changes"][0]["change"]["after"]["name"] = "kunde-dev"
        with self.assertRaises(ValueError): check(p)
    def test_reject_extra(self):
        p = good()
        p["resource_changes"].append(item("neon_project.other", {}))
        with self.assertRaises(ValueError): check(p)

if __name__ == "__main__":
    unittest.main()

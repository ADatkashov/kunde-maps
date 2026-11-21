#!/usr/bin/env python3
"""Fail-closed Terraform plan gate for a fresh, isolated KUNDE Maps DEV."""
import json
import sys

ALLOWED = {
    "neon_project.maps",
    "render_web_service.maps",
}
def check(plan):
    changes = plan.get("resource_changes", [])
    addresses = set()
    if len(changes) != 2:
        raise ValueError(f"Expected exactly two new resources, found {len(changes)}")
    for item in changes:
        addr = item["address"]
        actions = item["change"]["actions"]
        if addr not in ALLOWED or addr in addresses:
            raise ValueError(f"Unexpected resource: {addr}")
        if actions != ["create"]:
            raise ValueError(f"Unsafe actions for {addr}: {actions}")
        addresses.add(addr)
        after = item["change"].get("after") or {}
        if addr == "render_web_service.maps":
            if after.get("plan") != "free" or after.get("name") != "kunde-maps-web-dev":
                raise ValueError("Render must be a new named free-tier service")
            source = after.get("runtime_source") or {}
            docker = source.get("docker") or {}
            if docker.get("repo_url") != "https://github.com/ADatkashov/kunde-maps":
                raise ValueError("Unexpected Render source repository")
            if docker.get("auto_deploy_trigger") != "off":
                raise ValueError("Auto deploy must remain disabled")
        if addr == "neon_project.maps":
            if after.get("name") != "kunde-maps-dev":
                raise ValueError("Neon project name must be dedicated to KUNDE Maps")
            if after.get("history_retention_seconds") != 21600:
                raise ValueError("Neon PITR must be within free-tier limit")
    if addresses != ALLOWED:
        raise ValueError("Required resources missing")
    print("KUNDE Maps plan policy passed: exactly 2 creates, no changes/deletes")
if __name__ == "__main__":
    try:
        check(json.load(sys.stdin))
    except (KeyError, ValueError, TypeError) as error:
        print(f"Plan rejected: {error}", file=sys.stderr)
        sys.exit(1)

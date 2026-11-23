#!/usr/bin/env python3
"""Generate the Unity Catalog grants the app service principal needs, from a pack.

  python3 scripts/gen_grants.py --pack <pack.json> --catalog <cat> --app-sp <client-id> [--users-group <group>] > grants.sql

App SP (reads and writes everything through server routes, scoped to the caller's team in code):
  - studio schema: read views, append to entries/events/requests
  - each team: read the team schemas (sample rows, access check), read + write the team_work volume
Attendee group (optional; Genie runs on behalf of the user): read the studio views Genie spaces use.
"""
import argparse, json

TEAM_SCHEMAS = ["hga_source", "stg_hga", "all_stg_views", "edh", "all_edh_views", "cif", "all_cif_views", "legacy_edh", "recon", "faults", "snapshots"]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--app-sp", required=True)
    ap.add_argument("--users-group")
    a = ap.parse_args()
    pack = json.load(open(a.pack))
    studio = pack["workspace"]["studio_schema"]
    sp = f"`{a.app_sp}`"
    out = [f"GRANT USE CATALOG ON CATALOG {a.catalog} TO {sp};",
           f"GRANT USE SCHEMA, SELECT, MODIFY ON SCHEMA {a.catalog}.{studio} TO {sp};",
           f"GRANT READ VOLUME, WRITE VOLUME ON VOLUME {a.catalog}.{studio}.exports TO {sp};",
           f"GRANT READ VOLUME ON VOLUME {a.catalog}.{studio}.pack TO {sp};"]
    for t in pack["teams"] + [pack["demo_team"]]:
        p = t["prefix"]
        for s in TEAM_SCHEMAS:
            out.append(f"GRANT USE SCHEMA, SELECT ON SCHEMA {a.catalog}.{p}{s} TO {sp};")
        out.append(f"GRANT USE SCHEMA ON SCHEMA {a.catalog}.{p}workshop TO {sp};")
        out.append(f"GRANT READ VOLUME, WRITE VOLUME ON VOLUME {a.catalog}.{p}workshop.team_work TO {sp};")
        out.append(f"GRANT READ VOLUME ON VOLUME {a.catalog}.{p}workshop.legacy_code TO {sp};")
    if a.users_group:
        g = f"`{a.users_group}`"
        out += [f"GRANT USE CATALOG ON CATALOG {a.catalog} TO {g};", f"GRANT USE SCHEMA, SELECT ON SCHEMA {a.catalog}.{studio} TO {g};"]
    print("\n".join(out))

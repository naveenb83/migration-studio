#!/usr/bin/env python3
"""Write a team's Task 4 rules config (team_rules.recon.yml) from vetted pack templates.

Mirrors app/server/lib/rules.ts (same layout), so facilitators can reproduce a team's config from the CLI.

  python3 scripts/gen_team_rules.py --pack <pack.json> --team <team_id> --templates a,b,c [--param water_depth_preserved.tolerance=0.01]

The YAML is consumed by the kit's validation engine: top-level strings are table placeholders (overridable by the job's
`vars`), `derived` holds named sub-queries, `checks` the rules. `{{param}}` tokens are filled with validated numbers.
"""
import argparse, json, re, sys


def block(text: str, indent: int) -> str:
    pad = " " * indent
    return "|\n" + "\n".join(pad + line.rstrip() for line in text.strip("\n").splitlines())


def render(pack: dict, team_id: str, template_ids: list[str], params: dict[str, dict[str, float]]) -> str:
    ctx = pack["rule_context"]
    by_id = {t["id"]: t for t in pack["rule_templates"]}
    lines = [f"entity: {ctx['entity']}", f"owner: {json.dumps(team_id)}",
             "description: \"Team rules written by Migration Studio from vetted templates (Task 4).\""]
    for k, v in ctx["tables"].items():
        lines.append(f"{k}: {v}")
    lines.append("derived:")
    for k, v in ctx["derived"].items():
        lines.append(f"  {k}: {block(v, 4)}")
    lines.append("checks:")
    for tid in template_ids:
        t = by_id[tid]
        values = {p["name"]: float(params.get(tid, {}).get(p["name"], p.get("default"))) for p in t.get("params", [])}
        fill = lambda s: re.sub(r"\{\{(\w+)\}\}", lambda m: repr(values[m.group(1)]), s)
        lines += [f"  - name: rule_{tid}", f"    level: {t.get('level', 'L4')}", f"    severity: {t.get('severity', 'FAIL')}",
                  f"    expect: {json.dumps(t.get('expect', '== 0'))}", f"    description: {json.dumps(t.get('description', t['label']))}"]
        if t.get("min_coverage") is not None:
            lines.append(f"    min_coverage: {t['min_coverage']}")
        lines.append(f"    sql: {block(fill(t['sql']), 6)}")
        if t.get("sample_sql"):
            lines.append(f"    sample_sql: {block(fill(t['sample_sql']), 6)}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--team", required=True)
    ap.add_argument("--templates", required=True)
    ap.add_argument("--param", action="append", default=[])
    a = ap.parse_args()
    params: dict = {}
    for kv in a.param:
        k, v = kv.split("=", 1)
        tid, name = k.split(".", 1)
        params.setdefault(tid, {})[name] = float(v)
    sys.stdout.write(render(json.load(open(a.pack)), a.team, a.templates.split(","), params))

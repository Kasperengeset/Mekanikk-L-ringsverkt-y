"""
Uavhengig referanse for løseren (Port 2): regner hver testset/*/truth.json gjennom anaStruct og
skriver testset/<id>/reference.json med reaksjoner, stavkrefter og endemomenter i SI.

    python3 -m venv .venv && .venv/bin/pip install -r eval/anastruct/requirements.txt
    .venv/bin/python eval/anastruct/reference.py            # alle oppgaver
    .venv/bin/python eval/anastruct/reference.py ov03-1     # én oppgave

Tverrsnitt som ikke står i modellen, får samme standardverdier som løseren
(src/core/solver/element.ts: DEFAULT_SECTION), så også statisk ubestemte systemer kan sammenlignes.
"""
import contextlib
import glob
import io
import json
import math
import os
import sys

from anastruct import SystemElements

DEFAULT_SECTION = {"E": 210e9, "A": 1.0, "I": 1e-4}
PROFILES = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "src", "core", "data", "ipe.json")))["profiles"]


def shape_properties(shape):
    """Samme formler som src/core/sections.ts. A i m², I i m⁴."""
    u = LENGTH.get(shape.get("unit", "m"), 1.0)
    t = shape["type"]
    if t == "rectangle":
        b, h = shape["b"] * u, shape["h"] * u
        return b * h, b * h**3 / 12
    if t == "circle":
        D = shape["D"] * u
        return math.pi * D**2 / 4, math.pi * D**4 / 64
    if t == "tube":
        D = shape["D"] * u
        d = D - 2 * shape["t"] * u
        return math.pi * (D**2 - d**2) / 4, math.pi * (D**4 - d**4) / 64
    if t == "profile":
        p = PROFILES[shape["name"].replace(" ", "").upper()]
        return p["A"] * 1e-6, (p["Iz"] if shape["axis"] == "weak" else p["Iy"]) * 1e-12
    parts = [((-1 if q["hole"] else 1) * q["b"] * q["h"] * u * u, (q["z"] + q["h"] / 2) * u, (-1 if q["hole"] else 1) * q["b"] * q["h"] ** 3 / 12 * u**4) for q in shape["parts"]]
    A = sum(a for a, _, _ in parts)
    zc = sum(a * z for a, z, _ in parts) / A
    return A, sum(i0 + a * (z - zc) ** 2 for a, z, i0 in parts)


def resolve_section(sec):
    if sec is None:
        return DEFAULT_SECTION
    A, I = (shape_properties(sec["shape"]) if "shape" in sec else (None, None))
    return {"E": sec.get("E", DEFAULT_SECTION["E"]), "A": sec.get("A", A if A is not None else DEFAULT_SECTION["A"]), "I": sec.get("I", I if I is not None else DEFAULT_SECTION["I"])}
LENGTH = {"mm": 1e-3, "cm": 1e-2, "m": 1.0}
FORCE = {"N": 1.0, "kN": 1e3, "MN": 1e6}


def reference(model):
    l, f = LENGTH[model["units"]["length"]], FORCE[model["units"]["force"]]
    nodes = {n["id"]: (n["x"] * l, n["y"] * l) for n in model["nodes"]}
    sections = {s["id"]: s for s in model.get("sections", [])}
    ss = SystemElements()
    eid = {}
    for m in model["members"]:
        sec = resolve_section(sections.get(m.get("section")))
        loc = [list(nodes[m["i"]]), list(nodes[m["j"]])]
        if m["kind"] == "truss":
            eid[m["id"]] = ss.add_truss_element(location=loc, EA=sec["E"] * sec["A"])
        else:
            rel = m.get("release") or {}
            spring = {k: 0 for k, end in ((1, "i"), (2, "j")) if rel.get(end)}
            eid[m["id"]] = ss.add_element(location=loc, EA=sec["E"] * sec["A"], EI=sec["E"] * sec["I"], spring=spring or None)
    nid = {k: ss.find_node_id(vertex=list(v)) for k, v in nodes.items()}
    for s in model["supports"]:
        n = nid[s["node"]]
        if s["type"] == "fixed":
            ss.add_support_fixed(n)
        elif s["type"] == "pinned":
            ss.add_support_hinged(n)
        else:
            ang = (s.get("angle_deg") or 0) % 180
            if ang == 0:
                ss.add_support_roll(n, direction="x")
            elif ang == 90:
                ss.add_support_roll(n, direction="y")
            else:
                ss.add_support_roll(n, direction="x", angle=ang)
    members = {m["id"]: m for m in model["members"]}
    # anaStruct overskriver en nodelast hvis samme node får flere; summer dem først.
    node_loads = {}
    for L in model["loads"]:
        if L["type"] in ("point", "moment") and "node" in L:
            acc = node_loads.setdefault(L["node"], [0.0, 0.0, 0.0])
            if L["type"] == "point":
                a = math.radians(L["angle_deg"])
                acc[0] += L["P"] * f * math.cos(a)
                acc[1] += L["P"] * f * math.sin(a)
            else:
                acc[2] += L["M"] * f * l
    for node, (fx, fy, mz) in node_loads.items():
        if fx or fy:
            ss.point_load(nid[node], Fx=fx, Fy=fy)
        if mz:
            ss.moment_load(nid[node], Ty=mz)
    for L in model["loads"]:
        if L["type"] in ("point", "moment") and "node" not in L:
            raise ValueError(f"last {L['id']}: laster på elementer støttes ikke i referansen; bruk en node")
        if L["type"] in ("point", "moment"):
            continue
        else:
            if L["from"] != 0 or L["to"] != 1:
                raise ValueError(f"last {L['id']}: delvis fordelt last støttes ikke i referansen; del elementet")
            m = members[L["member"]]
            (x1, y1), (x2, y2) = nodes[m["i"]], nodes[m["j"]]
            length = math.hypot(x2 - x1, y2 - y1)
            c, s = abs(x2 - x1) / length, abs(y2 - y1) / length
            w = [L["w_start"] * f / l, L["w_end"] * f / l]
            if L["direction"] == "global_y":
                factor, direction = (c if L["basis"] == "projection" else 1), "y"
            elif L["direction"] == "global_x":
                factor, direction = (s if L["basis"] == "projection" else 1), "x"
            else:
                factor, direction = 1, "element"
            w = [v * factor for v in w]
            ss.q_load(w[0] if w[0] == w[1] else w, eid[m["id"]], direction=direction)
    with contextlib.redirect_stdout(io.StringIO()):
        ss.solve()
    out = {"reactions": {}, "members": {}}
    for s in model["supports"]:
        r = ss.get_node_results_system(nid[s["node"]])
        out["reactions"][s["node"]] = {"Fx": -r["Fx"], "Fy": -r["Fy"], "M": -r["Tz"] if s["type"] == "fixed" else 0.0}
    for mid, e in eid.items():
        r = ss.get_element_results(e, verbose=True)
        entry = {"kind": members[mid]["kind"], "N": float(r["Nmax"]) if members[mid]["kind"] == "truss" else None}
        if members[mid]["kind"] == "beam":
            entry["M_ends_abs"] = [abs(float(r["M"][0])), abs(float(r["M"][-1]))]
        out["members"][mid] = entry
    return out


def main(ids):
    paths = [f"testset/{i}/truth.json" for i in ids] if ids else sorted(glob.glob("testset/*/truth.json"))
    for p in paths:
        cid = os.path.basename(os.path.dirname(p))
        try:
            ref = reference(json.load(open(p)))
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {cid}: {exc}")
            continue
        with open(os.path.join(os.path.dirname(p), "reference.json"), "w") as fh:
            json.dump({"source": "anastruct", **ref}, fh, indent=2)
            fh.write("\n")
        print(f"✓ {cid}")


if __name__ == "__main__":
    main(sys.argv[1:])

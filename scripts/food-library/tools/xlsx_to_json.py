#!/usr/bin/env python3
"""Dump the sheets of an .xlsx workbook to JSON (standard library only).

    python3 scripts/food-library/tools/xlsx_to_json.py <book.xlsx> [--sheet NAME ...] > out.json

Output: {"sheets": {"<name>": [[cell, ...], ...]}} — every row as a list of
cell values (strings or numbers, None for empty), in sheet order. Used to
turn government food-composition spreadsheets into the JSON the Sombrey
Food Library adapters read. No formatting, formulas are read as their
cached values.
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1

def read(path, only=None):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sh in wb.find("m:sheets", NS):
        name = sh.get("name")
        if only and name not in only:
            continue
        target = rels[sh.get(REL)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
            cells = []
            for c in row.findall("m:c", NS):
                i = col_index(c.get("r"))
                while len(cells) < i:
                    cells.append(None)
                t, v = c.get("t"), c.find("m:v", NS)
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                elif v is None:
                    val = None
                else:
                    try:
                        f = float(v.text)
                        val = int(f) if f.is_integer() and t != "str" else f
                    except ValueError:
                        val = v.text
                cells.append(val)
            rows.append(cells)
        out[name] = rows
    return out

if __name__ == "__main__":
    args = sys.argv[1:]
    only = [args[i + 1] for i, a in enumerate(args) if a == "--sheet"]
    json.dump({"sheets": read(args[0], only or None)}, sys.stdout)

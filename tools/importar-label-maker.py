"""Genera src/datos/catalogo-inicial.json a partir de la base del proyecto label-maker.

Uso:  python tools/importar-label-maker.py [ruta/a/labels.db]
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

DB = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\label-maker\labels.db")
SALIDA = Path(__file__).resolve().parent.parent / "src" / "datos" / "catalogo-inicial.json"

GENERO = {"M": "Caballero", "F": "Dama", "US": "Unisex"}
# Marcas con texto mal codificado en la base original.
MARCA_FIX = {"Lanc\ufffdme": "Lancôme"}

con = sqlite3.connect(DB)
filas = con.execute(
    "SELECT id, product_name, brand, gender FROM labels ORDER BY brand, product_name"
).fetchall()

catalogo = []
for id_, nombre, marca, genero in filas:
    # Los paréntesis (p. ej. "(azul)") son notas internas de color del frasco: no van en la etiqueta.
    notas = re.findall(r"\(([^)]*)\)", nombre)
    limpio = re.sub(r"\s*\([^)]*\)", "", nombre).strip()
    catalogo.append({
        "id": f"lm-{id_}",
        "nombre": limpio,
        "marca": MARCA_FIX.get(marca, marca or "").strip(),
        "genero": GENERO.get(genero, "Unisex"),
        "nota": ", ".join(notas),
        "activo": True,
    })

SALIDA.parent.mkdir(parents=True, exist_ok=True)
SALIDA.write_text(json.dumps(catalogo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{len(catalogo)} perfumes -> {SALIDA}")

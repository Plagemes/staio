# Genera src/core/taste/data/flavorgraph.json dai vettori pubblicati da FlavorGraph.
# Uso:  python -I scripts/taste/build_taste.py <embeddings.pkl> <nodes.csv>
# I due file vengono dal repository lamypark/FlavorGraph (output/kitchenette_embeddings.pkl e input/nodes_191120.csv).
# Sono dati non fidati: il pickle si legge con un Unpickler che ammette solo numpy (ndarray, dtype, ricostruzione) e
# rifiuta qualunque altra cosa; non si esegue codice del repository scaricato. Serve numpy.
import csv
import glob
import hashlib
import json
import os
import pickle
import re
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAPPING = os.path.join(ROOT, "scripts", "taste", "mapping.txt")
FOODS_GLOB = os.path.join(ROOT, "src", "core", "nutrition", "data", "foods", "*.ts")
OUT = os.path.join(ROOT, "src", "core", "taste", "data", "flavorgraph.json")
UNMAPPED = os.path.join(ROOT, "scripts", "taste", "non-mappati.txt")
NEIGHBORS = 20
HUB_K = 10  # k di r(x) nella correzione CSLS
# Metodo che ordina i vicini: "cosine" (nessuna correzione), "csls" o "rank" (prossimità reciproca per rango).
METHOD = "csls"

# Coppie classiche della cucina italiana (nodi FlavorGraph). Servono SOLO a misurare i metodi: non entrano mai nel file
# e non cambiano l'ordine. Una coppia conta se ciascuno dei due è tra i primi 20 dell'altro, o almeno uno dei due.
CONTROL_PAIRS = [
    ("tomato", "mozzarella_cheese"),
    ("tomato", "basil"),
    ("tomato", "olive_oil"),
    ("tomato", "garlic"),
    ("pasta", "parmesan_cheese"),
    ("pear", "gorgonzola"),
    ("ham", "cantaloupe"),
    ("lemon", "salmon"),
    ("lemon", "shrimp"),
    ("dark_chocolate", "orange"),
    ("apple", "cinnamon"),
    ("potato", "rosemary"),
    ("egg", "bacon"),
    ("garlic", "olive_oil"),
    ("mozzarella_cheese", "basil"),
    ("ricotta_cheese", "spinach"),
    ("honey", "yogurt"),
    ("chicken", "rosemary"),
    ("chicken", "lemon"),
    ("tuna", "caper"),
    ("strawberry", "balsamic_vinegar"),
    ("shrimp", "garlic"),
    ("lentil", "carrot"),
    ("fennel", "orange"),
    ("pear", "walnut"),
    ("salmon", "dill"),
]

ALLOWED = {
    ("numpy.core.multiarray", "_reconstruct"),
    ("numpy._core.multiarray", "_reconstruct"),
    ("numpy", "ndarray"),
    ("numpy", "dtype"),
}


class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) in ALLOWED:
            return super().find_class(module, name)
        raise pickle.UnpicklingError(f"tipo non ammesso: {module}.{name}")


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def staio_foods():
    """Gli alimenti della tabella nutrizionale: id e nome."""
    out = {}
    for f in sorted(glob.glob(FOODS_GLOB)):
        text = open(f, encoding="utf8").read()
        for m in re.finditer(r'^    id: "([^"]+)",\n    name: "([^"]+)",', text, re.M):
            out[m.group(1)] = m.group(2)
    return out


def read_mapping(foods, vectors):
    rows, seen_fg, seen_ids = [], set(), set()
    for n, line in enumerate(open(MAPPING, encoding="utf8"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) not in (3, 4):
            sys.exit(f"mapping.txt riga {n}: attese 3 o 4 colonne")
        fg, name, ids = parts[0], parts[1], [i.strip() for i in parts[2].split(",") if i.strip()]
        aliases = [a.strip() for a in parts[3].split(",") if a.strip()] if len(parts) == 4 else []
        if fg not in vectors:
            sys.exit(f"mapping.txt riga {n}: «{fg}» non è un nodo ingrediente con vettore")
        if fg in seen_fg:
            sys.exit(f"mapping.txt riga {n}: nodo «{fg}» ripetuto")
        seen_fg.add(fg)
        for i in ids:
            if i not in foods:
                sys.exit(f"mapping.txt riga {n}: «{i}» non è un alimento di Staio")
            if i in seen_ids:
                sys.exit(f"mapping.txt riga {n}: «{i}» ripetuto")
            seen_ids.add(i)
        if not ids:
            sys.exit(f"mapping.txt riga {n}: nessun alimento")
        rows.append((fg, name, ids, aliases))
    return rows


def method_scores(cos):
    """Per ogni metodo una matrice «più alto è meglio» con cui ordinare i vicini. `cos` ha la diagonale a zero."""
    n = cos.shape[0]
    c = cos.copy()
    np.fill_diagonal(c, -np.inf)
    # r(x): media del coseno con i HUB_K vicini più prossimi. CSLS(x, y) = 2 cos(x, y) - r(x) - r(y).
    r = np.sort(c, axis=1)[:, -HUB_K:].mean(axis=1)
    csls = 2 * cos - r[:, None] - r[None, :]
    # prossimità reciproca per rango: posizione di y tra i vicini di x (1 = il più vicino), media geometrica dei due versi
    pos = np.empty((n, n))
    order = np.argsort(-c, axis=1, kind="stable")
    for i in range(n):
        pos[i, order[i]] = np.arange(1, n + 1)
    rank = -np.sqrt(pos * pos.T)
    return {"cosine": cos, "csls": csls, "rank": rank}


def top_lists(score, cos, keys):
    out = []
    for i in range(len(keys)):
        order = sorted((j for j in range(len(keys)) if j != i), key=lambda j: (-score[i, j], keys[j]))
        out.append([j for j in order if round(cos[i, j] * 100) > 0][:NEIGHBORS])
    return out


def measure(lists, keys):
    count = [0] * len(keys)
    for l in lists:
        for j in l:
            count[j] += 1
    top = sorted(range(len(keys)), key=lambda j: (-count[j], keys[j]))[:10]
    idx = {k: i for i, k in enumerate(keys)}
    hit, valid, missing = 0, 0, []
    for a, b in CONTROL_PAIRS:
        if a not in idx or b not in idx:
            missing.append(f"{a}-{b}")
            continue
        valid += 1
        i, j = idx[a], idx[b]
        if j in lists[i] or i in lists[j]:
            hit += 1
    return sum(count[j] for j in top), [(keys[j], count[j]) for j in top[:3]], hit, valid, missing


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pkl, nodes_csv = sys.argv[1], sys.argv[2]
    with open(pkl, "rb") as f:
        raw = RestrictedUnpickler(f).load()
    if not isinstance(raw, dict):
        sys.exit("il pickle non è un dizionario")
    node_rows = list(csv.DictReader(open(nodes_csv, encoding="utf8")))
    # un nome che compare anche come composto è ambiguo: fuori
    compound = {r["name"] for r in node_rows if r["node_type"] != "ingredient"}
    ingredient = {r["name"] for r in node_rows if r["node_type"] == "ingredient"} - compound
    # solo nodi ingrediente della tabella dei nodi, con un vettore a 300 numeri finiti
    vectors = {}
    for k, v in raw.items():
        if k in ingredient and isinstance(v, np.ndarray) and v.shape == (300,) and np.isfinite(v).all():
            vectors[k] = v.astype(np.float64)

    foods = staio_foods()
    rows = read_mapping(foods, vectors)
    mapped_ids = {i for _, _, ids, _ in rows for i in ids}
    keys = [fg for fg, _, _, _ in rows]

    m = np.stack([vectors[fg] for fg in keys])
    m = m / np.linalg.norm(m, axis=1, keepdims=True)
    cos = m @ m.T
    np.fill_diagonal(cos, 0)

    scores = method_scores(cos)
    print(f"misura sui {len(keys)} nodi mappati (primi {NEIGHBORS} vicini; {len(CONTROL_PAIRS)} coppie di controllo):")
    for name, sc in scores.items():
        hubs, worst, hit, valid, missing = measure(top_lists(sc, cos, keys), keys)
        print(f"  {name:7s} presenze dei 10 nodi più frequenti: {hubs:4d} su {len(keys) * NEIGHBORS}; {worst}; coppie: {hit}/{valid}")
    if missing:
        print(f"  coppie di controllo non misurabili (nodo non mappato): {', '.join(missing)}")
    print(f"metodo scelto: {METHOD}")

    chosen = scores[METHOD]
    lists = top_lists(chosen, cos, keys)
    # [indice, coseno per cento (è il punteggio mostrato), valore d'ordine per cento (decide l'ordine)]
    neighbors = [[[j, int(round(cos[i, j] * 100)), int(round(chosen[i, j] * 100))] for j in l] for i, l in enumerate(lists)]

    out = {
        "_licenza": "CC BY-NC-SA 3.0, solo uso non commerciale, con attribuzione e stessa licenza. Dato derivato da FlavorGraph "
        "(Park et al., Scientific Reports 2021, doi 10.1038/s41598-020-79422-8), che deriva da FlavorDB e Recipe1M. "
        "Vedi LICENZA-DATI.md e ../FONTI.md. Questa licenza vale per questo file e non per il codice.",
        "source": "flavorgraph",
        "version": f"kitchenette_embeddings sha256:{sha(pkl)[:12]} nodes_191120 sha256:{sha(nodes_csv)[:12]}",
        "method": METHOD,
        # [chiave, nome italiano, id Staio, alias opzionali]
        "foods": [[fg, name, ids] + ([aliases] if aliases else []) for fg, name, ids, aliases in rows],
        # per ogni alimento i vicini già ordinati: [indice, coseno per cento, valore d'ordine per cento]
        "neighbors": neighbors,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")

    left = [(i, n) for i, n in foods.items() if i not in mapped_ids]
    with open(UNMAPPED, "w", encoding="utf8", newline="\n") as f:
        f.write("# Alimenti di Staio senza un nodo di FlavorGraph scelto con sicurezza. File generato da build_taste.py.\n")
        for i, n in left:
            f.write(f"{i} | {n}\n")

    print(f"nodi ingrediente con vettore: {len(vectors)}")
    print(f"nodi mappati: {len(rows)}")
    print(f"alimenti di Staio mappati: {len(mapped_ids)} su {len(foods)}; fuori: {len(left)}")
    print(f"file: {OUT} ({os.path.getsize(OUT)} byte)")


if __name__ == "__main__":
    main()

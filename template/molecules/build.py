"""Draws a Course's molecules: each one's 2D structure in graphite and its 3D conformer, as RDKit
makes them from its SMILES, and a record for the molecule gates.

For every molecule in the Course (`modules/<NN-slug>/molecules/<name>.json`, naming its SMILES), this
writes, for the views the molecule asks for:

- `modules/<NN-slug>/molecules/<name>.svg`: the 2D structure (CoordGen layout, element letters only,
  no atom colours, no background). RDKit's black is replaced by the pad's graphite, and the SVG is
  then checked to hold no other colour: this script never writes a non-graphite structure;
- `modules/<NN-slug>/molecules/<name>.sdf`: the 3D conformer (hydrogens added, ETKDGv3 with a fixed
  seed, MMFF-optimised), the file the page's 3D viewer loads;
- `build-records/molecules/<NN-slug>/<name>.json`: the molecule record. RDKit's formula, InChI,
  InChIKey and heavy atoms for the SMILES, bound to the two files by their SHA-256, so a file edited
  after its build is stale.

The molecule gates check the files against the record in Node: Template CI has no RDKit, so the
record is RDKit's word, committed beside the Course's other build records.

Run with the machine venv's Python (it has RDKit), from the template:

    npm run molecules                      # every molecule in CONTENT_DIR (the Fixture Course by default)
    npm run molecules -- --module 13-cell-potential
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem, rdDepictor, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D

RECORD = "learn-premium molecule record v1"
# The embedding's seed: a rebuild draws the same conformer.
SEED = 24301
# One bond is 32 px long and no label is under 14 px, so the drawing is the size it is drawn at and
# the page never scales it down.
BOND_LENGTH = 32
MIN_FONT = 14
COLOUR = re.compile(r"#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b")


def sha256_text(text: str) -> str:
    """SHA-256 of a text with its line endings as LF, so a checkout's CRLF changes nothing."""
    return hashlib.sha256(text.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def write_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace("\r\n", "\n").encode("utf-8"))


def structure_svg(mol: Chem.Mol, graphite: str, where: str) -> str:
    """The 2D structure in graphite: element letters, no atom colours, no background."""
    flat = Chem.Mol(mol)
    rdDepictor.SetPreferCoordGen(True)
    rdDepictor.Compute2DCoords(flat)
    drawer = rdMolDraw2D.MolDraw2DSVG(-1, -1)
    options = drawer.drawOptions()
    options.useBWAtomPalette()
    options.clearBackground = False
    options.fixedBondLength = BOND_LENGTH
    options.minFontSize = MIN_FONT
    options.addStereoAnnotation = False
    drawer.DrawMolecule(flat)
    drawer.FinishDrawing()
    svg = re.sub("#000000", graphite, drawer.GetDrawingText(), flags=re.IGNORECASE)
    stray = sorted({c.upper() for c in COLOUR.findall(svg)} - {graphite.upper()})
    if stray:
        sys.exit(f"{where}: RDKit painted {', '.join(stray)}; a 2D structure is graphite only")
    return svg


def conformer_sdf(mol: Chem.Mol, where: str) -> str:
    """The 3D conformer, hydrogens included, as an SDF."""
    solid = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = SEED
    if AllChem.EmbedMolecule(solid, params) != 0:
        sys.exit(f"{where}: RDKit could not embed a 3D conformer for the SMILES")
    AllChem.MMFFOptimizeMolecule(solid)
    return Chem.MolToMolBlock(solid) + "$$$$\n"


def build_molecule(content: Path, module: str, descriptor: Path, graphite: str) -> str:
    name = descriptor.stem
    where = f"modules/{module}/molecules/{name}.json"
    spec = json.loads(descriptor.read_text(encoding="utf-8"))
    smiles = spec["smiles"]
    views = spec.get("views", ["structure", "viewer"])
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        sys.exit(f"{where}: RDKit can't read the SMILES {smiles!r}")
    folder = descriptor.parent
    record = {
        "record": RECORD,
        "by": f"RDKit {rdBase.rdkitVersion}",
        "smiles": smiles,
        "canonical": Chem.MolToSmiles(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "inchi": Chem.MolToInchi(mol),
        "inchiKey": Chem.MolToInchiKey(mol),
        "atoms": [atom.GetSymbol() for atom in mol.GetAtoms()],
    }
    if "structure" in views:
        svg = structure_svg(mol, graphite, where)
        write_lf(folder / f"{name}.svg", svg)
        record["svg"] = sha256_text(svg)
    if "viewer" in views:
        sdf = conformer_sdf(mol, where)
        write_lf(folder / f"{name}.sdf", sdf)
        record["sdf"] = sha256_text(sdf)
    record["seed"] = SEED
    write_lf(
        content / "build-records" / "molecules" / module / f"{name}.json",
        json.dumps(record, indent=2, ensure_ascii=False) + "\n",
    )
    return f"built {module}/{name}: {record['formula']} ({', '.join(views)})"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--content", required=True, type=Path, help="the Course's content folder")
    parser.add_argument("--graphite", required=True, help="the pad's graphite ink, as #RRGGBB")
    parser.add_argument("--module", help="build only this Module's molecules (its folder name)")
    args = parser.parse_args()
    content = args.content.resolve()
    built = 0
    for descriptor in sorted(content.glob("modules/*/molecules/*.json")):
        module = descriptor.parent.parent.name
        if args.module and module != args.module:
            continue
        print(build_molecule(content, module, descriptor, args.graphite))
        built += 1
    print(f"built {built} molecule(s) with RDKit {rdBase.rdkitVersion}")


if __name__ == "__main__":
    main()

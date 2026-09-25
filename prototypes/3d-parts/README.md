# PROTOTYPE — drawing to interactive 3D part (ticket #19)

Throwaway. Answers one question for the learn-premium map: *can an agent turn a machine drawing
into an accurate, interactive 3D part on a web page?* Not production code; nothing here ships.

## Run

```bash
py -3.13 -m venv .venv && .venv/Scripts/python -m pip install build123d numpy
npm run build     # build123d solids -> viewer/models/*.glb + viewer/checks.json, then the Node kinematics check
npm run serve     # or: .venv/Scripts/python -m http.server 5179 --directory viewer
```

Open <http://localhost:5179>. The page loads three.js from jsDelivr and hotlinks the source
drawings from Wikimedia Commons (nothing downloaded or committed).

## What is in it

| Source (openly licensed) | Model | Motion | Checks |
| --- | --- | --- | --- |
| Tee fitting, exam sheet Q4.1 (CC BY 4.0) | `cad/build.py` tee | Section plane | bbox vs stated dims, GLB bbox, B-rep volume vs independent grid integral |
| NASA TM-2010-216251 Table 1, design 1 (US gov) | `cad/involute.py` 28T gear, ×2 | Live, ratio 28:28 | OD, face, boolean-measured chordal thickness, contact ratio, overlap = 0 at 8 angles, backlash, wrong-phase control |
| Four-bar GIF, a10 b50 c30 d40 e20 (CC BY-SA 4.0) | four link GLBs | Live, loop solved per frame (`viewer/kinematics.js`) | Viewer solver vs Python Freudenstein, loop closure, Grashof |

Every number in `cad/build.py` is tagged stated / derived / scaled / assumed.

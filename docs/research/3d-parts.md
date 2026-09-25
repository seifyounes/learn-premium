# Research: routes to interactive 3D machine parts on a Study site

Ticket: [#7](https://github.com/seifyounes/learn-premium/issues/7) — "How can an agent produce
interactive 3D machine parts for a study site?"
Researched: 2026-09-25, by a background agent. Primary sources only; every claim links to the
source that owns it. Lines marked **(inference)** are the researcher's reasoning, not a sourced
fact. Findings, not decisions — the owner decides.

## The question

Given a lecture drawing of a machine part or mechanism in a Course's Materials, what routes let
an agent (Claude Code on Windows 11) produce an **accurate** 3D model and show it
**interactively** on a Study site — including assemblies, moving mechanisms, exploded views and
cross-sections — and what would have to be installed?

## Short answer

The pipeline has three stages, and the routes differ mainly in stage 1:

1. **Author** an exact solid (B-rep) from the drawing's dimensions — SolidWorks, Onshape,
   FreeCAD, code-CAD (CadQuery / build123d / OpenSCAD), Zoo KCL, or Blender (mesh, not B-rep).
2. **Tessellate + export** to glTF/GLB, the web format. glTF is a triangle mesh: the exact
   dimensions survive only up to the chosen tessellation tolerance. Its units are meters
   ([glTF 2.0 spec](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html): "The units for all
   linear distances are meters").
3. **Show** it with three.js / react-three-fiber (full control: clipping, per-part motion,
   explode) or `<model-viewer>` (drop-in, plays baked animations, no section-plane API).

Motion is the hard part everywhere: glTF animation can only target a node's
`translation`, `rotation`, `scale` or morph `weights`
([spec](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)). Mates, joints, constraints
and drivers do not survive export; a mechanism either ships as **baked keyframes** or is
**driven live in JavaScript** from its kinematics.

Nothing CAD-related is installed today. Present on this machine: Python 3.13.15 (plus 3.14.6)
and Node v24.16.0; `blender`, `openscad` and `freecad` are not on PATH, and no SolidWorks /
Blender / FreeCAD / OpenSCAD folder is in `C:\Program Files` (checked 2026-09-25).

---

## 1. SolidWorks

**API and automation.** The SOLIDWORKS API is a COM API callable from "Visual Basic for
Applications (VBA), VB.NET, Visual C#, Visual C++ 6.0, and Visual C++/CLI"
([API Welcome, 2025](https://help.solidworks.com/2025/english/api/sldworksapiprogguide/Welcome.htm)).
Saving to another format goes through `IModelDocExtension::SaveAs3`
([API help](https://help.solidworks.com/2025/english/api/sldworksapi/SolidWorks.Interop.sldworks~SolidWorks.Interop.sldworks.IModelDocExtension~SaveAs3.html)).
Python has no official binding; community MCP servers reach it via COM (below).

**Headless.** There is no true headless mode. The application can be hidden with
`ISldWorks.Visible = false`, but "the SOLIDWORKS application can only be hidden if
ISldWorks::UserControl is false and there are no visible documents open"
([Visible property](https://help.solidworks.com/2023/English/api/sldworksapi/SolidWorks.Interop.sldworks~SolidWorks.Interop.sldworks.ISldWorks~Visible.html)).
The separate **Document Manager API** reads files without SolidWorks running, but it needs a
licence key "only available ... to SOLIDWORKS customers who are currently under subscription",
and it reads/streams data rather than modelling geometry
([Document Manager Getting Started](https://help.solidworks.com/2023/English/api/swdocmgrapi/GettingStarted-swdocmgrapi.html)).
A community SolidWorks MCP notes the COM API "requires the full application"
([tmkaio/solidworks-mcp](https://github.com/tmkaio/solidworks-mcp)).

**Export to glTF/GLB — the strongest native story of any route.** SOLIDWORKS saves
`.gltf`/`.glb` ("Extended Reality"). Per the help page the files "contain information such as
geometry, appearances, textures, animations, motion studies, configurations, display states,
exploded views, lights, and metadata"; options include **Export Motion Studies** ("Exports
timeline animations as glTF keyframe sequences"), **Export Exploded Views** ("as glTF keyframe
sequences"), and **Use Draco** compression
([Exporting Using Extended Reality, 2025](https://help.solidworks.com/2025/english/solidworks/sldworks/t_export_using_extended_reality.htm)).
Caveat on the same page: "Only Approved Provider Viewers support the advanced capabilities of the
XR Exported file. These capabilities include Animations, Motion Studies, Exploded views, Display
States, Configurations, Decals, and Metadata." Whether three.js plays the exported keyframes
correctly is **untested** here. Exporting glTF through `SaveAs3` by API is plausible but not
confirmed by a documented example **(inference)**.

**Motion.** Motion studies come in three kinds: Animation (keyframes, motors), Basic Motion
(motors, springs, contact, gravity) and Motion Analysis
([Introduction to Motion Studies, 2026](https://help.solidworks.com/2026/english/SolidWorks/motionstudies/c_Introduction_to_Motion_Studies.htm)).
Motion Analysis is "available with the SOLIDWORKS Motion add-in from SOLIDWORKS Premium"
([Motion Analysis Overview](https://help.solidworks.com/2023/english/solidworks/motionstudies/c_Motion_Analysis.htm)).

**Licensing (Windows desktop only).**

| Edition | Cost | Notes |
| --- | --- | --- |
| SOLIDWORKS Design Standard for Students | Free (announced 2026-07-05) | Parts, assemblies, drawings, sheet metal; excludes Simulation, Toolbox, routing and other suite products; Windows PC ([SOLIDWORKS blog](https://blogs.solidworks.com/products/solidworks/free-cad-tools-solidworks-design-standard-for-students/), [offer page](https://www.solidworks.com/product/students/design-standard)) |
| 3DEXPERIENCE student offers | $60 / 60 € (xDesign listed) | Student verification ([3DS student solutions](https://www.3ds.com/edu/education/students/solutions)); the connected desktop edition needs Windows and cannot be installed alongside other SOLIDWORKS apps ([SOLIDWORKS blog, 2021](https://blogs.solidworks.com/products/solidworks/3dexperience-solidworks-for-students-defined/)) |
| 3DEXPERIENCE SOLIDWORKS for Makers | $48/yr (page title) | Hobby licence; the page refused direct fetch, price from its title ([Makers page](https://www.solidworks.com/solution/solidworks-makers)). Connected editions share the desktop API, but "some SOLIDWORKS APIs have been added, changed, or discontinued" ([API: SOLIDWORKS Connected](https://help.solidworks.com/2026/english/api/sldworksapiprogguide/Overview/SOLIDWORKS_Connected.htm), via search snippet) |

Education/maker licences are restricted to their stated use; building course material for a
paid product would need checking against the licence text **(inference)**.

**SolidWorks MCP servers (community, none official).**

| Repo | Stars | Last push | Licence | What it is |
| --- | --- | --- | --- | --- |
| [eyfel/mcp-server-solidworks](https://github.com/eyfel/mcp-server-solidworks) | 347 | 2026-09-10 | AGPL-3.0 | "SolidPilot": parts, features, drawings |
| [alisamsam/Solidworks-MCP](https://github.com/alisamsam/solidworks-mcp) | 140 | 2026-03-23 | MIT | 22 tools for parts/sketches/features |
| [tmkaio/solidworks-mcp](https://github.com/tmkaio/solidworks-mcp) | 0 | 2026-08-26 | MIT | Sheet-metal analysis via COM |
| [kilwizac/solidworks-api-mcp](https://github.com/kilwizac/solidworks-api-mcp) | 7 | 2026-08-20 | none | API documentation lookup only |

(Stars and dates from the GitHub REST API on 2026-09-25.)

## 2. Blender

**Scripting.** Blender runs scripts unattended: `-b, --background` ("Run in background") and
`-P, --python <filepath>` ("Run the given Python script file")
([command-line arguments, 5.2 manual](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)).

**Nature.** Blender is a mesh modeller; it has no native STEP (B-rep) import. The free
[STEP Importer extension](https://extensions.blender.org/add-ons/step-importer/) (GPL-3.0+,
Blender 5.1+, v1.2.1 of 2026-07-21) converts STEP to glTF with the Cascadio library and hands it
to Blender's glTF importer. Constraint-based sketching exists as an add-on,
[CAD_Sketcher](https://github.com/hlorus/CAD_Sketcher) (3,430 stars, GPL-3.0). So Blender can
hold exact numbers (you type them), but it has no parametric feature tree or engineering
dimension checks the way CAD does **(inference)**.

**glTF export and motion.** The Khronos-maintained exporter
([glTF-Blender-IO docs](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst))
exports only "Object transform (location, rotation, scale)", "Pose bones" and "Shape key values";
"Animation of other properties, like physics, lights, or materials, will be ignored". Rigs built
with constraints or drivers (gear ratios, linkages) must be **sampled/baked** into keyframes.
It supports `KHR_draco_mesh_compression` and `EXT_meshopt_compression`. Blender's strength is
presentation: materials, lighting, camera moves, keyframed exploded views.

**Blender MCP servers.**

| Server | Stars | Last activity | Licence | Notes |
| --- | --- | --- | --- | --- |
| [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) (now named `mcp-for-blender`) | 29,326 | push 2026-09-25 | MIT | Community. Blender 3.0+, Python 3.10+, `uv`. Scene/object tools, `execute_blender_code` (arbitrary Python), GLB/FBX export, Poly Haven / Sketchfab assets and AI-generated meshes (Hyper3D Rodin, Hunyuan3D). Warns the socket has no auth; opt-in safe mode |
| [Blender Lab `blender_mcp`](https://projects.blender.org/lab/blender_mcp) — official | 25 (Gitea) | commit 2026-09-11 | not stated on page | Experimental "Blender Lab" project, v1.0.3, needs **Blender 5.1+**. Warns it "will execute LLM generated code in Blender without any guards" and recommends a VM ([blender.org/lab/mcp-server](https://www.blender.org/lab/mcp-server/)) |
| [PatrykIti/blender-ai-mcp](https://github.com/PatrykIti/blender-ai-mcp) | 58 | 2026-06-27 | Apache-2.0 | Curated tools plus verification |

AI-generated meshes (Rodin, Hunyuan3D) are image/text-to-mesh: they carry no dimensional intent,
so they fail the accuracy bar for engineering parts **(inference)**.

**Install / licence.** Blender 5.2.2 LTS (2026-09-15), Windows installer 348 MB
([download](https://www.blender.org/download/)). GPL, free for commercial use, and "What you
create with Blender is your sole property" ([licence](https://www.blender.org/about/license/)).

## 3. Code-CAD (exact B-rep from text — the natural fit for an agent)

### CadQuery and build123d (Python, OpenCascade kernel)

- Both sit on `cadquery-ocp` 8.0.1.0.0 (2026-09-05): Windows x86-64 wheels for Python
  3.11–3.14, about 48 MB each, Apache-2.0 ([PyPI](https://pypi.org/project/cadquery-ocp/)).
  Install is one `pip install`; both Python versions on this machine qualify.
- **build123d** 0.13.0 (2026-09-21), Python >=3.11,<3.15, Apache-2.0
  ([PyPI](https://pypi.org/project/build123d/); repo 3,202 stars, push 2026-09-23). Exports STEP,
  STL, **glTF/GLB**, 3MF, OBJ, BREP, SVG, DXF. `export_gltf(shape, path, unit=Unit.MM,
  binary=False, linear_deflection=0.001, angular_deflection=0.1)`
  ([import/export docs](https://build123d.readthedocs.io/en/latest/import_export.html)).
  The deflection settings are the accuracy dial for the mesh.
- build123d **joints** (Rigid, Revolute, Linear, Cylindrical, Ball) take `angle`/`position`
  parameters, but `connect_to()` "only does a one time re-position of a part and does not bind
  them in any way" — no animation or kinematic simulation is documented
  ([joints docs](https://build123d.readthedocs.io/en/latest/joints.html)).
- **CadQuery** v2.8.0 (2026-06-20), Apache-2.0
  ([LICENSE](https://github.com/CadQuery/cadquery/blob/master/LICENSE); 5,832 stars).
  Assemblies export to STEP, XBF/XML and glTF (`.glb`/`.gltf`); tessellation `tolerance` and
  `angularTolerance` are exposed ([import/export](https://cadquery.readthedocs.io/en/latest/importexport.html)).
  Constraint assemblies (Point, Axis, Plane, PointInPlane, PointOnLine, Fixed*) are solved by
  optimisation via `.solve()` — a static pose, not motion
  ([assemblies](https://cadquery.readthedocs.io/en/latest/assy.html)).
- **Gears.** [bd_warehouse](https://bd-warehouse.readthedocs.io/en/latest/gear.html) (build123d,
  Apache-2.0, push 2026-09-21) provides true involute `SpurGear`, `HelicalGear`, `RackGear`,
  `Worm`/`WormWheel` with `module`, `tooth_count`, `pressure_angle`.
  [cq_gears](https://github.com/meadiode/cq_gears) does the same for CadQuery (last push 2024-12).
- **Viewer bonus.** [OCP CAD Viewer](https://github.com/bernhard-42/vscode-ocp-cad-viewer)
  (Apache-2.0) shows CadQuery/build123d objects with "Clipping planes", "Exploded view",
  measurement tools and an `Animation` class, in VS Code or a standalone browser viewer
  (`http://127.0.0.1:3939`). Its web engine,
  [three-cad-viewer](https://github.com/bernhard-42/three-cad-viewer) (npm `three-cad-viewer`
  5.0.7, MIT), is a three.js component with tree navigation, clipping with **stencil caps**,
  explode and animation playback; it takes its own tessellated JSON, not glTF (produced by
  [ocp-tessellate](https://github.com/bernhard-42/ocp-tessellate)).

**MCP servers for code-CAD.**

| Repo | Stars | Last push | Licence | Notes |
| --- | --- | --- | --- | --- |
| [jdilla1277/agentcad](https://github.com/jdilla1277/agentcad) | 137 | 2026-09-19 | Apache-2.0 | CLI + MCP; build123d default, CadQuery optional; STEP, STL/GLB/OBJ, PNG renders, metrics, spec checks, diffing, live browser preview. README says Python 3.10–3.12, which conflicts with cadquery-ocp's current 3.11–3.14 wheels |
| [pzfreo/build123d-mcp](https://github.com/pzfreo/build123d-mcp) | 94 | 2026-09-25 | Apache-2.0 | Persistent sessions; PNG/SVG/DXF previews; volume/area/bbox/centre-of-mass; hole/boss detection; STEP/STL/DXF/SVG export |
| [rishigundakaram/cadquery-mcp-server](https://github.com/rishigundakaram/cadquery-mcp-server) | 20 | 2025-06-29 | none | CadQuery generate + verify |
| [Casys-AI/mcp-build123d](https://github.com/Casys-AI/mcp-build123d) | 5 | 2026-09-24 | MIT | Mass properties, STEP/STL/GLTF export |

Note that Claude Code can already write and run a build123d script with its own tools; an MCP
mainly adds rendered previews and measurement for self-checking **(inference)**.

### OpenSCAD

CSG language that produces **meshes, not B-rep**. 3D export: STL, OFF, AMF, 3MF (plus 2D
DXF/SVG/PDF); STEP and glTF are not listed
([manual: Export](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Export)). The last stable
release is **2021.01** (GitHub releases); development snapshots need Windows 11 64-bit and carry
the new Manifold engine ([downloads](https://openscad.org/downloads.html)). 10,292 stars, active.
MCP: [jhacksman/OpenSCAD-MCP-Server](https://github.com/jhacksman/OpenSCAD-MCP-Server) (197
stars). Reaching glTF would need a second conversion step **(inference)**.

### FreeCAD (Python, OCCT, GUI + headless)

LGPL-2.1, v1.1.3 (2026-07-25), 33,753 stars. Std Export writes glTF/GLB since 0.19
([wiki: glTF](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/GlTF.md)). An issue
saying glTF export was GUI-only was closed in Feb 2023; a maintainer notes that headless you
must call `shape.tessellate()` yourself
([FreeCAD#8610](https://github.com/FreeCAD/FreeCAD/issues/8610)). FreeCAD 1.1 added **Create
Simulation** to the Assembly workbench, "making it possible to add motions to joints and create
animations" ([1.1 release notes](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Release_notes_1.1.md)).
Whether that motion reaches glTF is undocumented. MCP:
[neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp) (2,468 stars, MIT, push
2026-09-24): create/edit models, run Python, inspect documents, FEM.

### Onshape (cloud CAD, FeatureScript, REST API)

- FeatureScript is Onshape's language for custom **Part Studio** features; the built-in features
  are themselves written in it ([FeatureScript docs](https://cad.onshape.com/FsDoc/)).
- REST export: `POST /partstudios/.../export/gltf` and `POST /assemblies/.../export/gltf`,
  asynchronous, with `meshParams` (`angularTolerance`, `distanceTolerance`,
  `maximumChordLength`, `resolution`, `unit`)
  ([Import & Export API](https://onshape-public.github.io/docs/api-adv/translation/)). The docs do
  not cover exporting mates or animation to glTF.
- **Official MCP:** the Onshape Labs **FeatureScript MCP Server** (announced 2026-08-11,
  early access, subscribed via the Onshape App Store) lets Claude and other clients
  "generate, test, and refine FeatureScript"
  ([Onshape blog](https://www.onshape.com/en/blog/featurescript-mcp-server-enables-text-code-cad)).
  Community REST MCPs: [hedless/onshape-mcp](https://github.com/hedless/onshape-mcp) (144 stars).
- **Plans and limits.** Free plan: $0, non-commercial, **all documents public**; Standard
  $1,500/user/yr ([pricing](https://www.onshape.com/en/pricing)). Student plan free, education
  use only, watermarked ([education plans](https://www.onshape.com/en/education/plans)). API
  quota: 2,500 calls/year on Free, Standard and EDU Student; 402 once exhausted
  ([API limits](https://onshape-public.github.io/docs/auth/limits/)).
  Nothing to install, but it needs an account plus API keys, and a Course's parts would be public
  on the Free plan **(inference)**.

## 4. "Anything better?" — AI text-to-CAD and in-browser CAD

- **Zoo (formerly KittyCAD).** Text-to-CAD produces **B-rep** CAD (not mesh) written in the KCL
  language ([introduction, 2023](https://zoo.dev/blog/introducing-text-to-cad),
  [KCL](https://zoo.dev/research/introducing-kcl)). Design Studio is free and needs no CAD licence;
  assemblies have been supported since v1.0; "Zookeeper can make mistakes—it may misunderstand
  intent, produce incorrect geometry" ([FAQ](https://zoo.dev/docs/faq)). Exports STEP, STL,
  glTF/GLB, OBJ, PLY (FBX via API); mesh formats come out as one file with multiple meshes and
  body names kept ([export docs](https://zoo.dev/docs/zoo-design-studio/features/data-management/export)).
  Official **Zoo MCP**: `uvx zoo-mcp` with `ZOO_API_TOKEN`, counted as API usage
  ([Zoo MCP](https://zoo.dev/docs/developer-tools/mcp); [KittyCAD/mcp](https://github.com/KittyCAD/mcp), MIT).
  Pricing last published in numbers: 20 free minutes a month, then $0.50/min, per-second since
  2025-09-26 ([billing blog](https://zoo.dev/blog/turning-on-billing-for-text-to-cad)). The live
  pricing page loads its numbers dynamically, so they could not be confirmed
  ([pricing](https://zoo.dev/pricing)).
- **CADAM** ([Adam-CAD/CADAM](https://github.com/Adam-CAD/CADAM), 5,175 stars, GPL-3.0):
  open-source text/image-to-CAD web app that writes parametric **OpenSCAD** (WASM in the browser)
  and exports STL/SCAD/DXF. Mesh output only, no glTF.
- **In-browser B-rep:** [replicad](https://replicad.xyz/) (MIT, 688 stars) runs OpenCascade as
  WebAssembly with a CadQuery-like JS API and STEP export. It could make parts parametric live on
  the page, but its kernel ships as ~22.5 MB of WASM (`replicad_single.wasm`, 22,980,267 bytes,
  [jsDelivr](https://data.jsdelivr.com/v1/packages/npm/replicad-opencascadejs@1.1.0?structure=flat)).

## 5. The web side

| Viewer | Size | Motion | Explode | Cross-section | Fit |
| --- | --- | --- | --- | --- | --- |
| [`<model-viewer>`](https://github.com/google/model-viewer) 4.3.1 (Apache-2.0) | `model-viewer.min.js` 1,068,903 B (bundles three) | Plays glTF clips: `animation-name`, `play()`, `currentTime` (scrub), `timeScale`, `appendAnimation` for blending | Only if baked as a clip | No clipping API in the [docs data](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/docs.json); whole-model `orientation`/`scale` only | Fastest drop-in; annotations/hotspots; AR |
| three.js r186 (MIT, 115,882 stars) | GLTFLoader + core; meshopt decoder 29 KB, Draco decoder ~250 KB | `AnimationMixer` for clips, or set any node's transform per frame (live kinematics) | Move part nodes in JS | `Material.clippingPlanes` + `renderer.localClippingEnabled` ([Material.js](https://github.com/mrdoob/three.js/blob/dev/src/materials/Material.js)); capped sections in the `webgl_clipping_stencil` example ([examples](https://github.com/mrdoob/three.js/tree/dev/examples)) | Full control; vanilla JS, fits an offline single-file build |
| react-three-fiber (MIT, 32,484 stars) + [gltfjsx](https://github.com/pmndrs/gltfjsx) | as three.js + React | drei `useAnimations`; gltfjsx turns a GLB into a JSX component per node | per-node JSX | as three.js | If v2 moves to React/Next |
| [three-cad-viewer](https://github.com/bernhard-42/three-cad-viewer) (MIT) | npm unpacked 16 MB | Animation tracks | Built in | Built in, with stencil caps | CAD-grade UI out of the box; needs the OCP tessellation JSON, not GLB |

**File sizes (measured on real CAD-derived samples).** Khronos'
[GearboxAssy](https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/GearboxAssy) is
4,958,788 B as GLB against 447,659 B as Draco glTF (`.gltf` + `.bin`), about 11x smaller;
[2CylinderEngine](https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/2CylinderEngine)
is 1,838,084 B as GLB against 245,688 B as Draco (sizes from the GitHub contents API).
[glTF-Transform](https://gltf-transform.dev/cli) (`optimize`, `draco`, `meshopt`, `weld`,
`simplify`, `quantize`) does the compression; gltfjsx `--transform` claims "70%-90%" reduction.
Draco quantises positions (default 11 bits), so it is **lossy**
([google/draco](https://github.com/google/draco)). Harmless for viewing; it matters only if the
site displayed measurements read off the mesh **(inference)**.

**Offline caveat.** `<model-viewer>` loads its Draco decoder "from a Google CDN" by default
(configurable through `dracoDecoderLocation`), and meshopt is off by default
([docs data](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/docs.json)).
v1's offline single-file build (`v1-reference/SKILL.md`) would have to inline the decoders or
skip compression.

## 6. Cross-cutting findings

**Dimensional accuracy.** Exact B-rep routes (SolidWorks, Onshape, FreeCAD, CadQuery, build123d,
Zoo) keep the drawing's numbers exact in the source model and in STEP. The glTF is an
approximation bounded by the tessellation tolerance (build123d `linear_deflection`, Onshape
`distanceTolerance`), converted to meters. OpenSCAD and Blender are mesh-native. For an agent,
the practical risk is **reading the drawing**, not the kernel: dimensions missing from a sketchy
lecture figure have to be assumed and labelled as assumed **(inference)**. Code-CAD makes
self-checks cheap: bounding box, volume and centre of mass
([build123d-mcp](https://github.com/pzfreo/build123d-mcp)), and rendered views compared against
the source figure.

**Assemblies.** All CAD routes model assemblies; glTF carries them as a node tree, one node per
part (Zoo keeps body names). That per-part tree is what makes explode, highlight and hide
possible on the page.

**How motion survives export.**

| Route | Mechanism definition | What reaches glTF |
| --- | --- | --- |
| SolidWorks | Mates + motion studies | Keyframed TRS ("timeline animations as glTF keyframe sequences"); advanced playback promised only in approved viewers |
| Blender | Keyframes, drivers, constraints, bones | TRS/bones/shape keys; drivers and constraints must be baked |
| FreeCAD 1.1 | Assembly joints + Create Simulation | In-app animation; glTF export of it undocumented |
| CadQuery / build123d | Parameters (angle/position on joints) | Static pose. Motion must be (a) baked into clips with [glTF-Transform's Animation API](https://gltf-transform.dev/modules/core/classes/Animation) or three.js `GLTFExporter` (supports `animations`; [source](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/exporters/GLTFExporter.js)), or (b) computed live in JS |
| Onshape | Mates | Not documented for glTF |

Option (b), live kinematics in the page, often fits teaching better **(inference)**. Gear pairs
are a ratio, four-bar linkages and slider-cranks have closed-form positions, and a cam is a
lookup of its follower profile. A slider or input angle drives every part, so the student can
scrub the mechanism and the page can show the live numbers (angle, displacement, ratio).
Baked clips can only be played and scrubbed.

**Exploded views.** SolidWorks exports them as keyframes. Everywhere else, a per-part offset
along an explode vector, applied in JS, is simple and interactive (three-cad-viewer ships one).

**Cross-sections.** A web-side feature: three.js clipping planes with stencil caps, or
three-cad-viewer's built-in clipping. `<model-viewer>` has no section-plane API. Authoring a
separately cut solid in CAD and exporting it as a second model also works, but it is static.

## 7. What must be installed (nothing today)

| Route | Install on this PC | Cost / licence | Account |
| --- | --- | --- | --- |
| build123d / CadQuery | `pip install build123d` (pulls ~48 MB `cadquery-ocp` wheel) into existing Python 3.13 | Apache-2.0, free | None |
| + OCP viewer / MCP (optional) | `pip install ocp_vscode`; an MCP via `uv` | Apache-2.0 / MIT | None |
| FreeCAD | Installer (~1.1.3) + optional freecad-mcp | LGPL-2.1, free | None |
| OpenSCAD | 2021.01 stable or snapshot (Win 11) | GPL, free | None |
| Blender | 348 MB installer (5.2.2 LTS) + an MCP add-on | GPL, free incl. commercial | None |
| SolidWorks | Full Windows desktop app | Free student Standard (verified students) / $60 student offers / $48/yr Makers; commercial licences cost more; Motion Analysis needs Premium | Dassault / 3DEXPERIENCE login |
| Onshape | Nothing (cloud) | Free plan public and non-commercial; Student free, watermarked | Onshape account + API keys |
| Zoo | Nothing (cloud), `uvx zoo-mcp` | Free Design Studio; API metered | Zoo account + token |
| Web viewer | npm packages bundled into the Study site | MIT / Apache-2.0 | None |

## Implications for learn-premium

Options for the owner, with trade-offs. No choice is made here.

1. **Code-CAD pipeline (build123d or CadQuery → GLB → three.js).** The agent writes a Python
   model from the drawing's dimensions, self-checks it (bounding box, volume, rendered views), and
   exports a per-part GLB; the page drives motion, explode and sections in JS.
   *For:* exact and reproducible; one `pip install`; free; fully scriptable with no GUI; fits the
   verification discipline (numbers are checkable); gear libraries exist.
   *Against:* motion, explode and sections have to be built in the viewer; complex freeform parts
   are harder to write as code; mechanism kinematics must be coded per mechanism type.
2. **Same pipeline plus a CAD-grade viewer (three-cad-viewer).** Clipping with caps, explode,
   tree, measure and animation come ready-made.
   *For:* much less viewer work.
   *Against:* its own JSON format (via ocp-tessellate) instead of GLB; a third-party UI to restyle
   for the non-default design; a small project (391 stars) with one main maintainer.
3. **SolidWorks authoring → XR glTF export.** Mates, motion studies and exploded views export as
   keyframes natively.
   *For:* the richest native motion and explode export; the tool engineering students already use.
   *Against:* Windows GUI app with no true headless mode; licence and login overhead;
   education/maker terms to check; community MCPs are young; advanced XR playback is promised only
   in "approved" viewers, so three.js playback needs testing.
4. **Blender as the presentation layer** (import the code-CAD or SolidWorks GLB, animate, bake,
   re-export). *For:* best visual polish and camera animation; mature MCPs (the community one
   has 29k stars, plus an official Blender Lab one). *Against:* mesh-only, so not an accuracy
   source; baking breaks the link to parameters; a 348 MB install; MCPs execute arbitrary code
   (both warn).
5. **Cloud CAD (Onshape FeatureScript MCP, or Zoo KCL MCP).** *For:* nothing to install; B-rep;
   official MCPs; glTF export by API. *Against:* accounts and tokens; Onshape Free makes documents
   public and non-commercial with 2,500 API calls a year; Zoo is metered, and its current prices
   could not be confirmed; motion export is undocumented for both.
6. **Viewer choice, independent of authoring.** `<model-viewer>` gets playback of baked clips with
   the least code, but has no sections and no per-part control. three.js / react-three-fiber gives
   full interactivity (live kinematics, explode, capped sections) at the cost of more code. An
   offline single-file build needs the Draco/meshopt decoders inlined.
7. **Scope lever.** Many lecture figures (a gear pair, a four-bar, a cam-follower) may teach better
   as parametric, JS-driven mechanisms built from a few primitive solids than as full CAD models.
   A hybrid is possible: exact CAD for a hero part, lightweight live mechanisms for the rest.

Open questions worth a prototype: does SolidWorks' keyframed XR glTF play correctly in three.js,
and how large is a typical lecture part's GLB at a tolerance that looks right (for example
build123d `linear_deflection` of 0.01–0.1 mm)?

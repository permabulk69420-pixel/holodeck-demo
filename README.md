# holodeck-demo

WebXR prototype: turn real walls into windows onto other scenes.

Scenes are shared per room and locked to it: the first surface you put a scene on is its
"front", every other surface shows its own direction into the same world. Pick
**Fill whole room** to open every wall, the floor and the ceiling onto one scene.
Desktop preview: `?room=city` or `?room=space`.

## Sky islands (`?room=sky`)
Golden hour above a sea of cloud, entirely a Blender render: `tools/render_sky.py` (Cycles, `pip install bpy`)
writes the 360 panorama to `assets/sky.jpg` and `src/scenes/sky.js` just shows it (no live 3D layer).
`python3 tools/render_sky.py OUT.png 2048 16` takes ~6 min on 2 CPU cores. 8192 wide needs well over 6 GB of RAM
(it was OOM-killed on a 2-core / ~6 GB box), so render that size on a bigger machine.

## Celworld meadow (`?room=celworld`)
A 360 capture of the real [Celworld](https://github.com/permabulk69420-pixel/-Celworld) Three.js scene, taken from eye height in the meadow
(cottage ahead, willow and bridge to the left, garden right). `tools/celworld_capture/` renders six 90° cube faces in headless
Chromium (copy `capture.html`/`capture.js` into a Celworld checkout, `npx vite --port 5199`, then `cw_shoot.py OUTDIR X Y Z 2048 17`)
and `stitch.py FACEDIR OUT.png 8192 [heading]` makes the equirect panorama for `assets/celworld.jpg`. Pure panorama, no live layer.

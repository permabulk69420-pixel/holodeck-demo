# holodeck-demo

WebXR prototype: turn real walls into windows onto other scenes.

Scenes are shared per room and locked to it: the first surface you put a scene on is its
"front", every other surface shows its own direction into the same world. Pick
**Fill whole room** to open every wall, the floor and the ceiling onto one scene.
Desktop preview: `?room=city` or `?room=space`.

## Sky islands (`?room=sky`)
Golden hour above a sea of cloud. `tools/render_sky.py` (Blender/Cycles, `pip install bpy`) renders the
360 panorama to `assets/sky.jpg`; `src/scenes/sky.js` adds live drifting rock chunks, birds and lanterns.
`python3 tools/render_sky.py OUT.png 2048 20` (about 6 min on 2 CPU cores).

# Renders the top-down walk-cycle sprite from a downloaded, rigged cockroach
# model: "Cockroach" by xcellf on Sketchfab (CC BY 4.0),
# https://sketchfab.com/3d-models/cockroach-cead55b8aa8643d48d67240bad028592
# The model ships with an 8-frame in-place tripod walk; we sample it at
# FRAMES phases and render each one with the same camera/lights as before.
#
# Put the unzipped download in tools/models/xcellf (source/roach.fbx after
# extracting Roach.rar, plus textures/). Then, inside Blender:
#   exec(open(r"C:/git/MyPetDoris/tools/roach_model.py").read()); build(); render_cycle(out_dir)
# and pack with: python tools/pack_sprites.py <out_dir>
#
# Body units as in roach_blender.py: x = forward, y = left, z = up,
# pronotum front at x = 0.47, wing tips at x = -0.53.

import bpy, math, os
from mathutils import Vector

FRAMES = 16
RES = 640
CAM_CX = 0.12
CAM_SCALE = 2.6
SRC = os.path.join(r"C:/git/MyPetDoris/tools/models/xcellf")
CYCLE = (1, 9)        # source animation: frame 9 == frame 1
FRONT_MM, TIP_MM = -4.0, 19.5   # pronotum front / wing tips along the model's y axis (mm)
SCENE = 'RoachModel'


def scene():
    sc = bpy.data.scenes.get(SCENE)
    if sc is None:
        sc = bpy.data.scenes.new(SCENE)
    bpy.context.window.scene = sc
    return sc


def clear(sc):
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def link(sc, ob):
    sc.collection.objects.link(ob)
    return ob


def textures():
    m = bpy.data.materials.get('roach_one_texture1')
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    D = os.path.join(SRC, 'textures')

    def img(f, noncolor=False):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(os.path.join(D, f), check_existing=True)
        if noncolor:
            n.image.colorspace_settings.name = 'Non-Color'
        return n
    nt.links.new(img('BaseColor.png').outputs[0], b.inputs['Base Color'])
    nt.links.new(img('Roughness.png', True).outputs[0], b.inputs['Roughness'])
    nm = next((n for n in nt.nodes if n.type == 'NORMAL_MAP'), None) or nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(img('Normal.png', True).outputs[0], nm.inputs['Color'])
    nt.links.new(nm.outputs[0], b.inputs['Normal'])
    b.inputs['Coat Weight'].default_value = 0.35
    b.inputs['Coat Roughness'].default_value = 0.08


def import_model(sc):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, 'source', 'roach.fbx'))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    # model mm -> body units: head (-y) becomes +x, scaled so L = 1
    L = (TIP_MM - FRONT_MM) / 1000
    rig = link(sc, bpy.data.objects.new('rig', None))
    rig.rotation_euler = (0, 0, math.pi / 2)
    rig.scale = (1 / L,) * 3
    rig.location = (0.47 + FRONT_MM / 1000 / L, 0, 0)
    arm.parent = rig
    textures()
    fix_antennae(next(o for o in new if o.type == 'MESH'))
    return arm


def islands(bm):
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        st, comp = [v], []
        seen.add(v.index)
        while st:
            a = st.pop(); comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); st.append(b)
        out.append(comp)
    return out


def fix_antennae(mesh_ob, spread=0.42, droop=0.05, grow=1.6):
    """The model's antennae point steeply up, so from above they look stubby.
    Swing each one (a separate mesh island) down to lie forward/outward and
    lengthen it. Mesh-local axes: y = up, z = forward, x = left."""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(mesh_ob.data)
    for comp in islands(bm):
        ys = [v.co.y for v in comp]
        # antennae: thin islands rising well above the head
        if max(ys) < 1.4 or len(comp) > 400:
            continue
        base = min(comp, key=lambda v: v.co.y).co.copy()
        tip = max(comp, key=lambda v: (v.co - base).length).co.copy()
        side = 1 if tip.x > 0 else -1
        want = Vector((side * spread, droop, 1)).normalized()
        q = (tip - base).normalized().rotation_difference(want)
        for v in comp:
            d = q @ (v.co - base)
            along = d.dot(want)
            v.co = base + d + want * along * (grow - 1)
    bm.to_mesh(mesh_ob.data); bm.free()
    mesh_ob.data.update()


def setup_render(sc):
    sc.render.engine = 'CYCLES'
    try:
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.cycles.samples = 128
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'

    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = CAM_SCALE
    co = link(sc, bpy.data.objects.new('cam', cam))
    co.location = (CAM_CX, 0, 5)
    sc.camera = co

    key = bpy.data.lights.new('key', 'AREA'); key.size = 0.7; key.energy = 30
    ko = link(sc, bpy.data.objects.new('key', key)); ko.location = (0.6, 0.9, 3.0)
    ko.rotation_euler = (-ko.location).to_track_quat('-Z', 'Y').to_euler()
    fill = bpy.data.lights.new('fill', 'AREA'); fill.size = 4; fill.energy = 3
    fo = link(sc, bpy.data.objects.new('fill', fill)); fo.location = (-1.0, -1.2, 3.0)
    fo.rotation_euler = (-fo.location).to_track_quat('-Z', 'Y').to_euler()
    w = bpy.data.worlds.get('RoachWorld') or bpy.data.worlds.new('RoachWorld')
    sc.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.5, 0.42, 0.34, 1)
    bg.inputs['Strength'].default_value = 0.07


def build():
    sc = scene()
    clear(sc)
    import_model(sc)
    setup_render(sc)
    sc.frame_set(CYCLE[0])


def set_phase(sc, phase):
    f = CYCLE[0] + (CYCLE[1] - CYCLE[0]) * phase
    sc.frame_set(int(f), subframe=f - int(f))


def render_cycle(out_dir, frames=FRAMES):
    sc = scene()
    os.makedirs(out_dir, exist_ok=True)
    for i in range(frames):
        set_phase(sc, i / frames)
        sc.render.filepath = os.path.join(out_dir, f'roach_{i:02d}.png')
        bpy.ops.render.render(write_still=True, scene=sc.name)

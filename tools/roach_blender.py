# Builds a procedural American cockroach in Blender and renders a top-down
# walk cycle (transparent background) used by the app as a sprite sheet.
#
# Run inside Blender:  exec(open(r"C:/git/MyPetDoris/tools/roach_blender.py").read())
# then build(); render_cycle(out_dir)
#
# Units: body length L = 1 (pronotum front to wing tips). x = forward, y = left,
# z = up. Camera looks straight down.

import bpy, bmesh, math
from mathutils import Vector

FRAMES = 16          # walk-cycle phases
STRIDE = 0.30        # foot travel per cycle (body lengths)
LIFT = 0.05
DUTY = 0.55
RES = 640
CAM_CX = 0.12        # camera centre (x) in body units
CAM_SCALE = 2.6      # ortho width/height in body units

sc = bpy.context.scene

# leg spec mirrors the old 2D rig: hip, rest foot, femur a, tibia b, tripod group, width, tarsus
LEGS = [
    dict(hip=(0.30, 0.060), rest=(0.44, 0.30), a=0.20, b=0.27, g=0, w=0.030, t=0.13),
    dict(hip=(0.30, -0.060), rest=(0.44, -0.30), a=0.20, b=0.27, g=1, w=0.030, t=0.13),
    dict(hip=(0.17, 0.080), rest=(0.06, 0.40), a=0.24, b=0.31, g=1, w=0.034, t=0.15),
    dict(hip=(0.17, -0.080), rest=(0.06, -0.40), a=0.24, b=0.31, g=0, w=0.034, t=0.15),
    dict(hip=(0.06, 0.075), rest=(-0.40, 0.34), a=0.31, b=0.46, g=0, w=0.040, t=0.19),
    dict(hip=(0.06, -0.075), rest=(-0.40, -0.34), a=0.31, b=0.46, g=1, w=0.040, t=0.19),
]


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for d in list(coll):
            coll.remove(d)


def link(ob):
    sc.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- materials

def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def mat_basic(name, base, rough=0.3, coat=0.5, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m)
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.04
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = (0.02, 0.008, 0.004)
    return m


def ramp_mat(name, stops, coord_fn, rough=0.28, coat=0.6, bump=None, sss=0.0):
    """Base colour from a colour ramp driven by node graph coord_fn(nodes, links) -> socket."""
    m = mat_basic(name, (0.2, 0.06, 0.02), rough, coat, sss)
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    b = principled(m)
    fac = coord_fn(N, Lk)
    cr = N.new('ShaderNodeValToRGB')
    el = cr.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
    el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = el.new(p); e.color = (*c, 1)
    Lk.new(fac, cr.inputs['Fac'])
    # fine mottling
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 90; nz.inputs['Detail'].default_value = 6
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.18
    Lk.new(cr.outputs['Color'], mix.inputs['A'])
    Lk.new(nz.outputs['Color'], mix.inputs['B'])
    Lk.new(mix.outputs['Result'], b.inputs['Base Color'])
    if bump:
        bm = N.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = bump[1]; bm.inputs['Distance'].default_value = 0.002
        Lk.new(bump[0](N, Lk), bm.inputs['Height'])
        Lk.new(bm.outputs['Normal'], b.inputs['Normal'])
        Lk.new(bm.outputs['Normal'], b.inputs['Coat Normal'])
    return m


def obj_coord(N, Lk, loc=(0, 0, 0), scale=(1, 1, 1)):
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = loc
    mp.inputs['Scale'].default_value = scale
    Lk.new(tc.outputs['Object'], mp.inputs['Vector'])
    return mp.outputs['Vector']


def make_materials():
    M = {}

    def pron_fac(N, Lk):
        v = obj_coord(N, Lk, loc=(-0.31 / 0.13, 0, 0), scale=(1 / 0.13, 1 / 0.175, 1))
        # mapping applies scale after location -> shift accordingly
        g = N.new('ShaderNodeTexGradient'); g.gradient_type = 'SPHERICAL'
        Lk.new(v, g.inputs['Vector'])
        return g.outputs['Fac']
    # gradient: 0 at rim -> 1 at centre. pale yellow rim, dark brown disc, red-brown core
    M['pron'] = ramp_mat('pronotum', [
        (0.00, (0.80, 0.62, 0.28)), (0.20, (0.72, 0.52, 0.20)), (0.27, (0.12, 0.03, 0.006)),
        (0.55, (0.09, 0.022, 0.005)), (1.00, (0.20, 0.05, 0.01))], pron_fac, rough=0.16, coat=1.0)

    def wing_fac(N, Lk):
        v = obj_coord(N, Lk)
        sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(v, sep.inputs['Vector'])
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = -0.52; mr.inputs['From Max'].default_value = 0.26
        Lk.new(sep.outputs['X'], mr.inputs['Value'])
        return mr.outputs['Result']

    def wing_veins(N, Lk):
        v = obj_coord(N, Lk)
        w = N.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'Y'
        w.inputs['Scale'].default_value = 55; w.inputs['Distortion'].default_value = 6
        w.inputs['Detail'].default_value = 3
        Lk.new(v, w.inputs['Vector'])
        return w.outputs['Fac']
    M['wing'] = ramp_mat('wing', [
        (0.0, (0.16, 0.035, 0.006)), (0.6, (0.26, 0.065, 0.010)), (0.9, (0.34, 0.10, 0.018)),
        (1.0, (0.40, 0.15, 0.03))], wing_fac, rough=0.18, coat=1.0, bump=(wing_veins, 0.08), sss=0.2)

    M['leg'] = mat_basic('leg', (0.30, 0.10, 0.025), rough=0.28, coat=0.6, sss=0.3)
    M['dark'] = mat_basic('dark', (0.10, 0.03, 0.008), rough=0.3, coat=0.5)
    M['body'] = mat_basic('abdomen', (0.16, 0.04, 0.008), rough=0.35, coat=0.4)
    M['eye'] = mat_basic('eye', (0.02, 0.015, 0.012), rough=0.15, coat=0.9)
    return M


# ---------------------------------------------------------------- geometry

def shell(name, x0, x1, halfw, h, z, material, cy=0.0, skew=None, thick=0.012, nx=56, ny=28, edge=0.55):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rows = []
    for i in range(nx + 1):
        u = i / nx
        x = x0 + (x1 - x0) * u
        w = max(1e-4, halfw(u))
        row = []
        for j in range(ny + 1):
            v = -1 + 2 * j / ny
            y = cy + v * w + (skew(u) if skew else 0)
            zz = h * max(0, 1 - v * v) ** edge * max(0.0, math.sin(math.pi * u)) ** 0.3
            row.append(bm.verts.new((x, y, z + zz)))
        rows.append(row)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for p in me.polygons:
        p.use_smooth = True
    s = ob.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = -1
    ob.modifiers.new('sub', 'SUBSURF').levels = 1
    me.materials.append(material)
    return ob


def ellipsoid(name, loc, scale, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    return ob


def tube(name, pts, radii, material, res=6):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = res // 2
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, P, r in zip(sp.points, pts, radii):
        p.co = (P[0], P[1], P[2], 1)
        p.radius = r
    ob = link(bpy.data.objects.new(name, cu))
    cu.materials.append(material)
    return ob


def supere(u, p):
    return max(0.0, 1 - abs(2 * u - 1) ** p) ** (1 / p)


def build_body(M):
    # pronotum: rounded shield, broad behind, gently narrowing to the front
    shell('pronotum', 0.21, 0.44, lambda u: 0.19 * supere(u, 2.4) * (1.06 - 0.22 * u), 0.045, 0.072, M['pron'], thick=0.014)
    # tegmina (fore wings): left under, right over, rounded tips overlapping at the midline
    for side, z in ((1, 0.060), (-1, 0.066)):
        shell(f'wing_{"L" if side > 0 else "R"}', -0.53, 0.25,
              lambda u: 0.13 * supere(0.5 * u ** 0.8, 2.0) ** 0.8,
              0.02, z, M['wing'], cy=side * 0.05,
              skew=lambda u, s=side: -s * 0.046 * (1 - u) ** 1.6 + s * 0.002, thick=0.005, edge=0.35)
    ellipsoid('abdomen', (-0.12, 0, 0.035), (0.36, 0.17, 0.035), M['body'])
    ellipsoid('thorax', (0.15, 0, 0.04), (0.14, 0.11, 0.035), M['body'])
    ellipsoid('head', (0.425, 0, 0.034), (0.055, 0.07, 0.04), M['dark'])
    for s in (1, -1):
        ellipsoid(f'eye{s}', (0.43, s * 0.05, 0.04), (0.03, 0.018, 0.026), M['eye'], rot=(0, 0, s * 0.5))
        # cerci
        tube(f'cercus{s}', [(-0.44, s * 0.035, 0.035), (-0.52, s * 0.06, 0.03), (-0.58, s * 0.085, 0.024)],
             [0.012, 0.008, 0.003], M['leg'])
        # maxillary palps
        tube(f'palp{s}', [(0.46, s * 0.02, 0.02), (0.50, s * 0.045, 0.012), (0.52, s * 0.05, 0.006)],
             [0.006, 0.005, 0.003], M['leg'])


# ---------------------------------------------------------------- legs / antennae per phase

def smooth(t):
    return t * t * (3 - 2 * t)


def foot_pos(l, phase):
    p = (phase + (0.5 if l['g'] else 0.0)) % 1.0
    rx, ry = l['rest']
    if p < DUTY:
        s = p / DUTY
        return Vector((rx + STRIDE / 2 - STRIDE * s, ry, 0.012))
    s = (p - DUTY) / (1 - DUTY)
    e = smooth(s)
    return Vector((rx - STRIDE / 2 + STRIDE * e, ry + math.copysign(0.02, ry) * math.sin(math.pi * s), 0.012 + LIFT * math.sin(math.pi * s)))


def ik(hip, foot, a, b, side):
    d = foot - hip
    dist = d.length
    maxd = (a + b) * 0.985
    if dist > maxd:
        foot = hip + d.normalized() * maxd
        d = foot - hip
        dist = maxd
    u = d.normalized()
    hint = Vector((0, side * 1.1, 1.0))
    bend = (hint - u * hint.dot(u)).normalized()
    along = (a * a - b * b + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, a * a - along * along))
    return hip + u * along + bend * h, foot


def spines(bm, p0, p1, side, n, length, r):
    seg = p1 - p0
    u = seg.normalized()
    out = Vector((0, side, -0.2)).normalized()
    for k in range(n):
        t = 0.2 + 0.75 * k / max(1, n - 1)
        base = p0 + seg * t
        alt = 1 if k % 2 else -1
        dirv = (u * 0.75 + (out * alt if alt > 0 else Vector((0, 0, -1))) * 0.55).normalized()
        tip = base + dirv * length * (0.8 + 0.4 * (k % 3) / 2)
        ring = []
        perp = dirv.orthogonal().normalized()
        perp2 = dirv.cross(perp)
        for j in range(5):
            a = j / 5 * math.tau
            ring.append(bm.verts.new(base + (perp * math.cos(a) + perp2 * math.sin(a)) * r))
        tv = bm.verts.new(tip)
        for j in range(5):
            bm.faces.new((ring[j], ring[(j + 1) % 5], tv))


def pose(M, phase):
    for o in [o for o in bpy.data.objects if o.get('dyn')]:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Curve):
            bpy.data.curves.remove(data)
        else:
            bpy.data.meshes.remove(data)
    sbm = bmesh.new()
    for i, l in enumerate(LEGS):
        side = 1 if l['hip'][1] > 0 else -1
        hip = Vector((l['hip'][0], l['hip'][1], 0.035))
        foot = foot_pos(l, phase)
        knee, foot = ik(hip, foot, l['a'], l['b'], side)
        # tarsus continues outward along the ground
        dirh = Vector((foot.x - knee.x, foot.y - knee.y, 0))
        dirh = dirh.normalized() if dirh.length > 1e-6 else Vector((0, side, 0))
        t1 = foot + dirh * l['t'] * 0.55 + Vector((0, 0, -0.006))
        t2 = t1 + (dirh + Vector((0, 0, -0.1))).normalized() * l['t'] * 0.45
        t2.z = max(0.004, t2.z)
        r0 = l['w'] * 0.68
        coxa = hip + (knee - hip) * 0.18
        pts = [hip, coxa, hip.lerp(knee, 0.6), knee, knee.lerp(foot, 0.5), foot, t1, t2]
        rad = [r0 * 1.15, r0 * 1.1, r0 * 1.0, r0 * 0.7, r0 * 0.52, r0 * 0.42, r0 * 0.3, r0 * 0.16]
        ob = tube(f'leg{i}', pts, rad, M['leg'])
        ob['dyn'] = 1
        spines(sbm, knee, foot, side, 9, 0.045 + l['w'] * 0.6, r0 * 0.2)
        spines(sbm, hip.lerp(knee, 0.3), knee, side, 3, 0.022, r0 * 0.18)
    me = bpy.data.meshes.new('spines')
    sbm.to_mesh(me); sbm.free()
    so = link(bpy.data.objects.new('spines', me)); so['dyn'] = 1
    me.materials.append(M['leg'])
    for p in me.polygons:
        p.use_smooth = True

    # antennae: long, thin, sweeping forward and outward, gently waving
    for s in (1, -1):
        pts, rad = [], []
        n = 36
        ang = s * 0.32 + 0.08 * math.sin(math.tau * phase + (0 if s > 0 else 1.7))
        P = Vector((0.47, s * 0.03, 0.05))
        for k in range(n):
            t = k / (n - 1)
            pts.append(P.copy())
            rad.append(0.0075 * (1 - t) + 0.0018)
            curl = s * (0.55 + 0.15 * math.sin(math.tau * phase + s)) * t
            a = ang + curl * 1.0
            step = 1.05 / (n - 1)
            P = P + Vector((math.cos(a) * step, math.sin(a) * step, -0.0012 if t < 0.5 else -0.0004))
            P.z = max(0.006, P.z)
        ob = tube(f'antenna{s}', pts, rad, M['leg'], res=4)
        ob['dyn'] = 1


# ---------------------------------------------------------------- scene / render

def setup_render():
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
    sc.view_settings.exposure = 0.0

    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = CAM_SCALE
    co = link(bpy.data.objects.new('cam', cam))
    co.location = (CAM_CX, 0, 5)
    sc.camera = co

    key = bpy.data.lights.new('key', 'AREA'); key.size = 0.7; key.energy = 30
    ko = link(bpy.data.objects.new('key', key)); ko.location = (0.6, 0.9, 3.0)
    ko.rotation_euler = (Vector((0, 0, 0)) - ko.location).to_track_quat('-Z', 'Y').to_euler()
    fill = bpy.data.lights.new('fill', 'AREA'); fill.size = 4; fill.energy = 3
    fo = link(bpy.data.objects.new('fill', fill)); fo.location = (-1.0, -1.2, 3.0)
    fo.rotation_euler = (Vector((0, 0, 0)) - fo.location).to_track_quat('-Z', 'Y').to_euler()
    w = sc.world or bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.5, 0.42, 0.34, 1)
    bg.inputs['Strength'].default_value = 0.07


MATS = {}


def build():
    clear()
    MATS.update(make_materials())
    build_body(MATS)
    setup_render()
    pose(MATS, 0.0)


def render_cycle(out_dir, frames=FRAMES):
    import os
    os.makedirs(out_dir, exist_ok=True)
    for f in range(frames):
        pose(MATS, f / frames)
        sc.render.filepath = os.path.join(out_dir, f'roach_{f:02d}.png')
        bpy.ops.render.render(write_still=True)

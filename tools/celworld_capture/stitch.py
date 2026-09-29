import sys, numpy as np
from PIL import Image
# usage: stitch.py FACEDIR OUT.png WIDTH [HEADING_DEG]
# Output: equirect, centre of the image looks along world heading H (0 = world -Z, +90 = world +X, clockwise from above)
fd, out, W = sys.argv[1], sys.argv[2], int(sys.argv[3])
H_deg = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
Hh = W // 2
FACES = {
 'px': ((1,0,0),(0,1,0)), 'nx': ((-1,0,0),(0,1,0)),
 'py': ((0,1,0),(0,0,1)), 'ny': ((0,-1,0),(0,0,-1)),
 'pz': ((0,0,1),(0,1,0)), 'nz': ((0,0,-1),(0,1,0)),
}
imgs = {k: np.asarray(Image.open(f"{fd}/{k}.png").convert("RGB")) for k in FACES}
S = imgs['px'].shape[0]
basis = {}
for k,(f,u) in FACES.items():
    f=np.array(f,float); u=np.array(u,float); r=np.cross(f,u); basis[k]=(f,u,r)
res = np.zeros((Hh, W, 3), np.uint8)
hd = np.radians(H_deg)
cols = np.arange(W)
lon = ((cols + 0.5) / W - 0.5) * 2 * np.pi + hd   # pano-centre -> heading
CH = 256
for r0 in range(0, Hh, CH):
    rows = np.arange(r0, min(r0 + CH, Hh))
    lat = (0.5 - (rows + 0.5) / Hh) * np.pi
    LA, LO = np.meshgrid(lat, lon, indexing='ij')
    d = np.stack([np.cos(LA)*np.sin(LO), np.sin(LA), -np.cos(LA)*np.cos(LO)], -1)  # world dir (-Z is heading 0)
    ax = np.abs(d); major = np.argmax(ax, -1)
    block = np.zeros(d.shape, np.uint8)
    for k,(f,u,rgt) in basis.items():
        depth = d @ f
        m = depth > 0
        # pick the face whose forward axis is the dominant one
        axis = int(np.argmax(np.abs(f))); sign = f[axis]
        m &= (major == axis) & (np.sign(d[..., axis]) == sign)
        if not m.any(): continue
        dd = d[m]
        x = (dd @ rgt) / (dd @ f); y = (dd @ u) / (dd @ f)
        px = (x * 0.5 + 0.5) * S - 0.5; py = (0.5 - y * 0.5) * S - 0.5
        x0 = np.clip(np.floor(px).astype(int), 0, S-2); y0 = np.clip(np.floor(py).astype(int), 0, S-2)
        fx = (np.clip(px, 0, S-1) - x0)[:, None]; fy = (np.clip(py, 0, S-1) - y0)[:, None]
        im = imgs[k].astype(np.float32)
        c = (im[y0,x0]*(1-fx)*(1-fy) + im[y0,x0+1]*fx*(1-fy) + im[y0+1,x0]*(1-fx)*fy + im[y0+1,x0+1]*fx*fy)
        block[m] = np.clip(c, 0, 255).astype(np.uint8)
    res[rows[0]:rows[-1]+1] = block
Image.fromarray(res).save(out)
print("wrote", out, res.shape)

#!/usr/bin/env python3
"""Development helper: downloads the CC0 texture sets used by PRIDA and writes 512 px JPEGs to public/textures/.

Each Poly Haven set becomes <name>.jpg (colour), <name>_n.jpg (OpenGL normal map) and <name>_arm.jpg
(ambient occlusion / roughness / metalness). The foliage cards (leaves.webp, needles.webp) are composed from
ambientCG leaf atlases by scripts/make-foliage.py. Nothing is fetched while the game runs.

Usage: python3 scripts/fetch-textures.py [name ...]   (needs curl and Pillow)
"""
import json, os, subprocess, sys, tempfile
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
# game name -> Poly Haven asset id (https://polyhaven.com/a/<id>, all CC0)
SETS = {
    'bricks': 'brick_4',
    'plaster': 'painted_plaster_wall',
    'concrete': 'brushed_concrete',
    'asphalt': 'asphalt_02',
    'paving': 'square_brick_paving',
    'grass': 'forrest_ground_01',
    'dirt': 'brown_mud_leaves_01',
    'sand': 'coast_sand_01',
    'tiles': 'floor_tiles_06',
    'wood': 'laminate_floor_02',
    'roof': 'grey_roof_tiles_02',
    'metal': 'metal_plate',
    'bark': 'bark_brown_02',
    # 0.20
    'rock': 'rock_boulder_dry',
    'claytiles': 'clay_roof_tiles_02',
    'corrugated': 'corrugated_iron_02',
    'gravel': 'tarred_gravel',
    'fabric': 'rough_linen',
    'oak': 'oak_veneer_01',
    'panels': 'concrete_wall_008',
    'sidewalk': 'concrete_pavement',
    'pinebark': 'pine_bark',
}
SIZE = 512


def curl(url, path):
    subprocess.check_call(['curl', '-sfL', '-A', 'Mozilla/5.0', '-o', path, url])


def fetch(name, asset):
    info = json.loads(subprocess.check_output(['curl', '-sf', '-A', 'Mozilla/5.0', f'https://api.polyhaven.com/files/{asset}']))
    colour = 'Diffuse' if 'Diffuse' in info else sorted(k for k in info if k.startswith('col'))[0]
    for key, suffix in ((colour, ''), ('nor_gl', '_n'), ('arm', '_arm')):
        with tempfile.NamedTemporaryFile(suffix='.jpg') as tmp:
            curl(info[key]['1k']['jpg']['url'], tmp.name)
            im = Image.open(tmp.name).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
            im.save(os.path.join(OUT, name + suffix + '.jpg'), quality=84, optimize=True)
    print('ok', name, '<-', asset)


if __name__ == '__main__':
    wanted = sys.argv[1:] or list(SETS)
    for n in wanted:
        fetch(n, SETS[n])

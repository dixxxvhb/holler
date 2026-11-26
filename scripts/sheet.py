# Contact sheet of layout screenshots for one device: python scripts/sheet.py <device> <out.png>
from PIL import Image, ImageDraw
import sys, glob, os, re
dev, out = sys.argv[1], sys.argv[2]
fs = sorted(glob.glob(f'shots/layout/{dev}-*.png'), key=lambda f: (('safari' in f), int(re.search(r'-([0-9]+)[a-z]', os.path.basename(f)).group(1))))
ims = [Image.open(f).convert('RGB') for f in fs]
w = 260
ims = [im.resize((w, int(im.height * w / im.width))) for im in ims]
h = max(i.height for i in ims)
cols = 6
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * (w + 8), rows * (h + 18)), 'white')
d = ImageDraw.Draw(S)
for i, (im, f) in enumerate(zip(ims, fs)):
    x = (i % cols) * (w + 8); y = (i // cols) * (h + 18)
    S.paste(im, (x, y)); d.text((x + 2, y + h + 3), os.path.basename(f), fill='black')
S.save(out)

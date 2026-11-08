"""Junta os quadros gravados por telas.mjs em docs/agente.gif.
Quadros iguais em sequência viram um só, com a duração somada, e o GIF fica leve.
Uso: python scripts/montar_gif.py [largura]   (requer Pillow)"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

largura = int(sys.argv[1]) if len(sys.argv) > 1 else 360
pasta = Path("tmp/quadros")
tempos = json.loads((pasta / "tempos.json").read_text())
quadros, duracoes = [], []
anterior = None
for i, t in enumerate(tempos):
    img = Image.open(pasta / f"f{i:04d}.png").convert("RGB")
    img = img.resize((largura, img.height * largura // img.width), Image.LANCZOS)
    dur = (tempos[i + 1] - t) if i + 1 < len(tempos) else 2800
    if anterior is not None and ImageChops.difference(img, anterior).getbbox() is None:
        duracoes[-1] += dur
        continue
    quadros.append(img)
    duracoes.append(dur)
    anterior = img
duracoes = [max(40, round(d / 10) * 10) for d in duracoes]
duracoes[-1] = max(duracoes[-1], 2800)
paleta = [q.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for q in quadros]
saida = Path("docs/agente.gif")
paleta[0].save(saida, save_all=True, append_images=paleta[1:], duration=duracoes, loop=0, optimize=True, disposal=1)
print(len(quadros), "quadros,", round(sum(duracoes) / 1000, 1), "s,", round(saida.stat().st_size / 1e6, 2), "MB")

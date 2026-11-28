"""Recreate authored, image-only bilingual PDF; not needed for running tests.

Requires Pillow 12.3.0, arabic-reshaper 3.0.1, python-bidi 0.6.10 and pypdf,
and the system DejaVuSans.ttf font. No OCR model or network access is used.
"""
from io import BytesIO
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter

image = Image.new('RGB', (1800, 900), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 55)
draw.text((80, 200), 'Photosynthesis uses sunlight to produce sugar.', font=font, fill='black')
draw.text((250, 400), get_display(arabic_reshaper.reshape('تستخدم النباتات ضوء الشمس لإنتاج الغذاء')), font=font, fill='black')
buffer = BytesIO()
image.save(buffer, format='PDF', resolution=150)
writer = PdfWriter()
writer.add_blank_page(width=864, height=432)
writer.add_page(PdfReader(buffer).pages[0])
writer.write(Path(__file__).with_name('ocr-bilingual.pdf'))
image.close()

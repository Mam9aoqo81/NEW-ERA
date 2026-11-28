"""Standalone child: never import the application or database in this process."""
import io
import os
import json
import resource
import sys

ocr_enabled = os.getenv('KNOWLM_OCR_ENABLED', '0') == '1'
memory = (1024 if ocr_enabled else 512) * 1024 * 1024
cpu = 45 if ocr_enabled else 20
resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
os.environ['OMP_THREAD_LIMIT'] = '1'
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
from pypdf import PdfReader


def extract():
    raw = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        return {'error': 'file_too_large', 'status_code': 413}
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:
            return {'error': 'encrypted_pdf'}
        if len(reader.pages) > 200:
            return {'error': 'too_many_pages', 'status_code': 413}
        pages, total = [], 0
        for page in reader.pages:
            text = page.extract_text() or ''
            total += len(text)
            if total > 500_000:
                return {'error': 'text_too_large', 'status_code': 413}
            pages.append(text)
        ocr_pages = []
        if ocr_enabled and any(not p.strip() for p in pages):
            from ocr_engine import OCRError, recognize_pages
            try:
                pages, ocr_pages = recognize_pages(raw, pages, os.getenv('KNOWLM_OCR_DATA_PATH'))
            except OCRError as exc:
                return {'error': str(exc)}
        if not any(p.strip() for p in pages):
            return {'error': 'ocr_required'}
        return {'pages': pages, 'ocr_pages': ocr_pages}
    except Exception:
        return {'error': 'unreadable_pdf'}


if __name__ == '__main__':
    print(json.dumps(extract(), ensure_ascii=False))

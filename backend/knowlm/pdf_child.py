"""Standalone child: never import the application or database in this process."""
import io
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
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
        if not any(p.strip() for p in pages):
            return {'error': 'ocr_required'}
        return {'pages': pages}
    except Exception:
        return {'error': 'unreadable_pdf'}


if __name__ == '__main__':
    print(json.dumps(extract(), ensure_ascii=False))

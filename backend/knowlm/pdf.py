"""Extract untrusted PDFs in a disposable, resource-limited subprocess (Linux).

Resource limits are not a security sandbox: production also requires container
isolation, no network access, filesystem restrictions and upload quotas.
"""
import json
import os
import subprocess
import sys
from pathlib import Path


class ExtractionError(Exception):
    def __init__(self, code, status_code=422):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


class PDFPages(list):
    def __init__(self, pages, ocr_pages=None):
        super().__init__(pages)
        self.ocr_pages = ocr_pages or []


def extract_pdf(raw):
    try:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('pdf_child.py'))],
            input=raw, capture_output=True, timeout=60 if os.getenv('KNOWLM_OCR_ENABLED', '0') == '1' else 30,
        )
    except subprocess.TimeoutExpired:
        raise ExtractionError('extraction_timeout')
    if result.returncode != 0:
        raise ExtractionError('extraction_resource_or_process_failure')
    try:
        output = json.loads(result.stdout)
        if 'error' in output:
            raise ExtractionError(output['error'], output.get('status_code', 422))
        pages = output['pages']
        if not isinstance(pages, list) or not all(isinstance(p, str) for p in pages):
            raise ValueError('Invalid result')
        ocr_pages = output.get('ocr_pages', [])
        if not isinstance(ocr_pages, list) or any(type(p) is not int or not 1 <= p <= len(pages) for p in ocr_pages) or len(set(ocr_pages)) != len(ocr_pages):
            raise ValueError('Invalid OCR page metadata')
        if len(pages) > 200 or sum(len(p) for p in pages) > 500_000:
            raise ValueError('Invalid extraction size')
        return PDFPages(pages, ocr_pages)
    except (ValueError, KeyError, TypeError):
        raise ExtractionError('invalid_extractor_output')

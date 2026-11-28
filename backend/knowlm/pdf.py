"""Extract untrusted PDFs in a disposable, resource-limited subprocess (Linux).

Resource limits are not a security sandbox: production also requires container
isolation, no network access, filesystem restrictions and upload quotas.
"""
import json
import subprocess
import sys
from pathlib import Path


class ExtractionError(Exception):
    def __init__(self, code, status_code=422):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


def extract_pdf(raw):
    try:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('pdf_child.py'))],
            input=raw, capture_output=True, timeout=30,
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
        return pages
    except (ValueError, KeyError, TypeError):
        raise ExtractionError('invalid_extractor_output')

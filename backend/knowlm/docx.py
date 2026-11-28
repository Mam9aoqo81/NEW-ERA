"""Bounded DOCX extraction in a disposable child; no links or embedded files run."""
import json
from pathlib import Path
import subprocess
import sys

from knowlm.pdf import ExtractionError


def extract_docx(raw):
    try:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('docx_child.py'))],
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
        paragraphs = output['paragraphs']
        if (not isinstance(paragraphs, list) or not 1 <= len(paragraphs) <= 5000
                or not all(isinstance(p, str) for p in paragraphs)
                or sum(map(len, paragraphs)) > 500_000):
            raise ValueError('Invalid result')
        return paragraphs
    except (ValueError, KeyError, TypeError):
        raise ExtractionError('invalid_extractor_output')

"""Explicit operator-only download of pinned Apache-2.0 tessdata_fast models.

Never called by the API or worker. Files belong outside Git and must be reviewed
for your deployment/license policy. No credentials or source text are sent.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request

MODELS = {
    'ara': ('c8d129c67821c1592cac46836686b057ecc203dc', 'e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729'),
    'eng': ('bbef4675053b5b468cdb477053e28b1c698ba08e', '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'),
}


def install(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for language, (blob, expected) in MODELS.items():
        target = directory / (language + '.traineddata')
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            continue
        request = urllib.request.Request(
            f'https://api.github.com/repos/tesseract-ocr/tessdata_fast/git/blobs/{blob}',
            headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'KnowLM-OCR-model-setup'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError('Model download exceeded size limit')
        result = json.loads(raw)
        if result.get('encoding') != 'base64':
            raise ValueError('Invalid model encoding')
        data = base64.b64decode(result['content'])
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Model checksum mismatch')
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
            temporary = Path(output.name)
            try:
                output.write(data)
                output.flush()
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    install(args.directory)
    print('Verified Arabic and English OCR models')


if __name__ == '__main__':
    main()

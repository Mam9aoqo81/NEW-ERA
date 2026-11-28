"""Standalone bounded OOXML text reader. Never import application or database."""
import io
import json
import resource
import sys
import zipfile

from defusedxml import ElementTree as ET

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
SKIP = {W + name for name in ('del', 'drawing', 'object', 'pict', 'txbxContent')}


def paragraph_text(node):
    if node.tag in SKIP:
        return ''
    if node.tag == W + 't':
        return node.text or ''
    if node.tag == W + 'tab':
        return '\t'
    if node.tag in (W + 'br', W + 'cr'):
        return '\n'
    return ''.join(paragraph_text(child) for child in node)


def body_paragraphs(node):
    for child in node:
        if child.tag in SKIP:
            continue
        if child.tag == W + 'p':
            yield child
        else:
            yield from body_paragraphs(child)


def extract():
    raw = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        return {'error': 'file_too_large', 'status_code': 413}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(infos) > 1000 or len(names) != len(set(names)):
                return {'error': 'unsafe_docx_archive'}
            if any(i.flag_bits & 1 or i.file_size > 5_000_000 or
                   i.file_size > max(1, i.compress_size) * 200 for i in infos):
                return {'error': 'unsafe_docx_archive'}
            if sum(i.file_size for i in infos) > 25_000_000:
                return {'error': 'unsafe_docx_archive'}
            if any('vbaproject' in n.lower() for n in names):
                return {'error': 'macro_docx_not_supported'}
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
                return {'error': 'unreadable_docx'}
            types = ET.fromstring(archive.read('[Content_Types].xml'), forbid_dtd=True)
            if not any(n.tag == CT + 'Override' and n.get('PartName') == '/word/document.xml'
                       and n.get('ContentType') == MAIN_TYPE for n in types):
                return {'error': 'unsupported_docx_type'}
            document = ET.fromstring(archive.read('word/document.xml'), forbid_dtd=True)
            body = document.find(W + 'body')
            if document.tag != W + 'document' or body is None:
                return {'error': 'unreadable_docx'}
            paragraphs, total = [], 0
            for p in body_paragraphs(body):
                text = paragraph_text(p)
                total += len(text)
                if total > 500_000 or len(paragraphs) >= 5000:
                    return {'error': 'docx_text_too_large', 'status_code': 413}
                paragraphs.append(text)
            if not any(p.strip() for p in paragraphs):
                return {'error': 'docx_no_text'}
            return {'paragraphs': paragraphs}
    except Exception:
        # Never return parser exceptions or private document text.
        return {'error': 'unreadable_docx'}


if __name__ == '__main__':
    print(json.dumps(extract(), ensure_ascii=False))

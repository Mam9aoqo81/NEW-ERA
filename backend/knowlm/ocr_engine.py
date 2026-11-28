"""Local OCR helpers used only inside the bounded PDF extraction child.

Never fetch models or use network here. This is not handwriting recognition or
layout reconstruction. Resource limits are applied by pdf_child before imports.
"""
import math


class OCRError(Exception):
    pass


def recognize_pages(raw, pages, data_path):
    missing = [i for i, text in enumerate(pages) if not text.strip()]
    if not missing:
        return pages, []
    if len(missing) > 10:
        raise OCRError('ocr_page_limit')
    if not data_path:
        raise OCRError('ocr_not_configured')
    try:
        import pypdfium2 as pdfium
        import tesserocr
    except ImportError:
        raise OCRError('ocr_unavailable') from None
    try:
        api = tesserocr.PyTessBaseAPI(path=data_path, lang='ara+eng', psm=tesserocr.PSM.AUTO)
    except RuntimeError:
        raise OCRError('ocr_not_configured') from None
    recognized = []
    try:
        with api, pdfium.PdfDocument(raw) as document:
            if len(document) != len(pages):
                raise OCRError('ocr_invalid_document')
            for i in missing:
                page = document[i]
                try:
                    width, height = page.get_size()
                    scale = 200 / 72
                    w, h = math.ceil(width * scale), math.ceil(height * scale)
                    if w <= 0 or h <= 0 or max(w, h) > 10000 or w * h > 12_000_000:
                        raise OCRError('ocr_page_too_large')
                    bitmap = page.render(scale=scale, grayscale=True)
                    try:
                        image = bitmap.to_pil()
                        try:
                            api.SetImage(image)
                            text = api.GetUTF8Text().strip()
                            confidence = api.MeanTextConf()
                        finally:
                            image.close()
                    finally:
                        bitmap.close()
                    api.Clear()
                    if text:
                        if confidence < 40:
                            raise OCRError('ocr_low_confidence')
                        pages[i] = text
                        recognized.append(i + 1)
                    if sum(len(text) for text in pages) > 500_000:
                        raise OCRError('text_too_large')
                finally:
                    page.close()
    except OCRError:
        raise
    except Exception:
        raise OCRError('ocr_failed') from None
    return pages, recognized

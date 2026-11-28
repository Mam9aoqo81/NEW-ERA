"""Isolated eSpeak NG renderer. JSON stdin, PCM WAV stdout; no source files."""
import ctypes
import io
import json
import re
import sys
import wave


def main():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16_000_000, 16_000_000))
    except ImportError:
        pass
    import espeakng_loader
    body = json.loads(sys.stdin.buffer.read(40000))
    text, speaker = body['text'], body['speaker']
    if not isinstance(text, str) or not 0 < len(text) <= 8000 or speaker not in ('host', 'reader'):
        raise ValueError('Invalid speech input')
    lib = ctypes.CDLL(espeakng_loader.get_library_path())
    lib.espeak_Initialize.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    lib.espeak_Initialize.restype = ctypes.c_int
    rate = lib.espeak_Initialize(2, 0, espeakng_loader.get_data_path().encode(), 0)
    if rate <= 0:
        raise RuntimeError('Speech initialization failed')
    callback_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
    frames = bytearray()
    def callback(data, count, events):
        if count > 0:
            if len(frames) + count * 2 > 15_900_000:
                return 1
            frames.extend(ctypes.string_at(data, count * 2))
        return 0
    callback_pointer = callback_type(callback)
    lib.espeak_SetSynthCallback.argtypes = [callback_type]
    lib.espeak_SetSynthCallback(callback_pointer)
    lib.espeak_SetVoiceByName.argtypes = [ctypes.c_char_p]
    language = 'ar' if re.search(r'[\u0600-\u06ff]', text) else 'en-us'
    if lib.espeak_SetVoiceByName((language + ('+m1' if speaker == 'host' else '+f2')).encode()) != 0:
        raise RuntimeError('Speech voice unavailable')
    # Distinct synthetic variants, not natural speakers or dialect guarantees.
    lib.espeak_SetParameter(1, 155 if speaker == 'host' else 145, 0)
    encoded = text.encode('utf-8') + b'\0'
    lib.espeak_Synth.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    if lib.espeak_Synth(encoded, len(encoded), 0, 1, 0, 1, None, None) != 0:
        raise RuntimeError('Speech synthesis failed')
    lib.espeak_Synchronize()
    lib.espeak_Terminate()
    if not frames or len(frames) > 15_800_000:
        raise RuntimeError('Invalid speech output')
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(frames)
    sys.stdout.buffer.write(output.getvalue())


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Local speech rendering failed', file=sys.stderr)
        sys.exit(1)

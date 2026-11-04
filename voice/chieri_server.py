"""Local voice server for the 千绘莉 desktop pet.

Loads the Chieri GPT-SoVITS weights (v2ProPlus, provided by 雪村落雪 on Bilibili; GPT-SoVITS reads the
version from the SoVITS file's header) from the model package next to this file once, then answers
POST /tts {"text": "<Japanese>"} with a 16-bit WAV (GET /health for a status check). It listens on
127.0.0.1 only, prints one line "CHIERI_READY {json}" when it can take requests (with short hashes of
the weights it loaded), and exits as soon as the app that started it (electron/voice.js, which passes
its process id as --parent) is gone, also while it is still loading. Loading stages go to stderr; one
that runs longer than STALL seconds also gets a stack dump of where it is (and again every STALL).

Synthesis follows the package's README / scripts/speak.py: reference audio + text from delivery/,
all_ja, seed from profile.json, cut0, top_k 15, top_p 1, temperature 1, repetition_penalty 1.2.

By hand:  python chieri_server.py --model Chieri_GPTSoVITS_20261103 [--device cpu] [--port 9881]
"""
import argparse
import faulthandler
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
import sys
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


STALL = 90   # seconds one loading stage may run before its stack is dumped to the log


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def stage(msg):
    """Log a loading stage. If it then runs for STALL seconds, Python's stack goes to stderr (again every
    STALL seconds): the imports print nothing on their own, and a stuck one would look like a slow one."""
    log(msg)
    faulthandler.cancel_dump_traceback_later()
    faulthandler.dump_traceback_later(STALL, repeat=True, file=sys.stderr)


def activate(root, cache):
    """The package's scripts/runtime.py activate(), with the caches outside the (maybe read-only) install folder."""
    repo = root / 'vendor' / 'GPT-SoVITS'
    os.chdir(repo)   # GPT-SoVITS finds its text front-end files relative to here (and so avoids non-ASCII paths)
    sys.path[:0] = [str(repo), str(repo / 'GPT_SoVITS')]
    for key, name in {'HF_HOME': 'huggingface', 'TEMP': 'tmp', 'TMP': 'tmp', 'MPLCONFIGDIR': 'matplotlib',
                      'NLTK_DATA': 'nltk', 'NUMBA_CACHE_DIR': 'numba'}.items():
        path = cache / name
        path.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(path)
    os.environ.update(PYTHONUTF8='1', version='v2Pro', OMP_NUM_THREADS='4', MKL_NUM_THREADS='4',
                      HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                      TOKENIZERS_PARALLELISM='false', GRADIO_ANALYTICS_ENABLED='False')
    if importlib.util.find_spec('jieba_fast') is None:
        import jieba
        sys.modules['jieba_fast'] = jieba
    return repo


def skip_web_ui():
    """tools/my_utils.py imports gradio only for the training web UI's pop-ups (gr.Warning). The real one
    would pull in a whole web stack (fastapi, uvicorn, httpx, pydantic...) for nothing: give it a stand-in."""
    if 'gradio' in sys.modules:
        return
    stub = types.ModuleType('gradio')
    stub.__spec__ = importlib.machinery.ModuleSpec('gradio', None)

    def missing(name):
        if name.startswith('__'):
            raise AttributeError(name)
        return lambda *a, **k: None
    stub.__getattr__ = missing
    sys.modules['gradio'] = stub


def watch_parent(pid):
    """Exit once the app is gone: a server left running would hold GPU memory and files in the install folder.
    (Not by waiting for stdin to close: on Windows a thread blocked reading a pipe stalls every child process
    that inherits the pipe, at its start-up, and GPT-SoVITS may start ffmpeg.)"""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        handle = k32.OpenProcess(0x00100000, False, pid)   # SYNCHRONIZE
        if handle:
            k32.WaitForSingleObject(handle, 0xFFFFFFFF)
        elif ctypes.get_last_error() != 87:                 # (87: no such process, i.e. already gone)
            log(f'warning: cannot watch the app (process {pid}, error {ctypes.get_last_error()})')
            return
    else:
        while True:
            time.sleep(2)
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            except PermissionError:
                pass
    os._exit(0)


def sha256(path):
    h = hashlib.sha256()   # (not hashlib.file_digest: a user's own environment may be older than Python 3.11)
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', type=Path, required=True, help='the Chieri_GPTSoVITS_20261103 folder')
    ap.add_argument('--cache', type=Path, default=None, help='folder for caches and temp files (default: <model>/.cache)')
    ap.add_argument('--device', choices=['auto', 'cuda', 'cpu'], default='auto')
    ap.add_argument('--port', type=int, default=0, help='0 = any free port')
    ap.add_argument('--parent', type=int, default=0, help='exit when this process (the app) is gone')
    a = ap.parse_args()
    if a.parent:
        threading.Thread(target=watch_parent, args=(a.parent,), daemon=True).start()
    t0 = time.perf_counter()
    root = a.model.resolve()
    cache = (a.cache or root / '.cache').resolve()
    delivery = root / 'delivery'
    profile = json.loads((delivery / 'profile.json').read_text(encoding='utf-8'))
    summary = json.loads((delivery / 'training-summary.json').read_text(encoding='utf-8'))
    weights = {'gpt': delivery / 'chieri-gpt.ckpt', 'sovits': delivery / 'chieri-sovits.pth'}
    # the weights on disk are what gets loaded; a hash that differs from the package's records (weights
    # swapped by hand, an update that could not replace a file) is reported, not fatal
    loaded, recorded = {'verified': True}, summary.get('weights_sha256', {})
    for key, path in weights.items():
        if not path.is_file():
            raise SystemExit(f'missing weight file: {path}')
        digest = sha256(path)
        loaded[key] = digest[:8]
        if recorded.get(path.name) != digest:
            loaded['verified'] = False
            log(f'warning: {path.name} sha256 {digest} does not match training-summary.json ({recorded.get(path.name)})')
    update = summary.get('model_update') or summary.get('gpt_update') or {}
    loaded['label'] = update.get('info', '') if loaded['verified'] else ''
    log(f"weights: GPT {loaded['gpt']} {loaded['label']} / SoVITS {loaded['sovits']}")

    # stages go to the app's log: the imports alone can take a minute or more the first time
    since = lambda: f'{time.perf_counter() - t0:.0f} 秒'
    stage('导入 PyTorch…（第一次启动可能要一两分钟）')
    repo = activate(root, cache)
    t1 = time.perf_counter()
    import numpy as np
    import soundfile as sf
    import torch
    stage(f'导入 GPT-SoVITS…（PyTorch 用了 {time.perf_counter() - t1:.0f} 秒）')
    skip_web_ui()
    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

    cuda = torch.cuda.is_available() and a.device != 'cpu'
    if a.device == 'cuda' and not cuda:
        raise SystemExit('no CUDA GPU available (torch.cuda.is_available() is False)')
    device = 'cuda' if cuda else 'cpu'
    log(f"导入完成（{since()}）：torch {torch.__version__} · {('显卡 ' + torch.cuda.get_device_name(0)) if cuda else 'CPU'}")
    torch.set_num_threads(4)
    rel = lambda p: os.path.relpath(p, repo)   # relative to the working folder: ASCII even if the install path is not
    pre = Path('GPT_SoVITS') / 'pretrained_models'
    config = TTS_Config({'custom': {'version': 'v2Pro', 'device': device, 'is_half': cuda,
                                    't2s_weights_path': rel(weights['gpt']),
                                    'vits_weights_path': rel(weights['sovits']),
                                    'bert_base_path': str(pre / 'chinese-roberta-wwm-ext-large'),
                                    'cnhuhbert_base_path': str(pre / 'chinese-hubert-base')}})
    config.configs_path = str(cache / 'runtime-tts.yaml')
    # TTS_Config quietly falls back to the pretrained base models when a path does not resolve
    for key, attr in (('gpt', 't2s_weights_path'), ('sovits', 'vits_weights_path')):
        if Path(getattr(config, attr)).resolve() != weights[key].resolve():
            raise SystemExit(f'{key} weights would not be loaded (TTS_Config fell back to {getattr(config, attr)})')
    stage('加载 GPT / SoVITS / BERT / HuBERT 权重…')
    model = TTS(config)
    stage(f'权重加载完成（{since()}），预热：试合成一句…')
    ref, prompt, seed = rel(delivery / 'reference.wav'), profile['reference_text'], int(profile.get('seed', 20261030))
    lock = threading.Lock()

    def synth(text):
        with lock:
            chunks, sr = [], None
            for sample_rate, audio in model.run({'text': text, 'text_lang': 'all_ja', 'ref_audio_path': ref,
                                                 'prompt_text': prompt, 'prompt_lang': 'all_ja', 'text_split_method': 'cut0',
                                                 'batch_size': 1, 'speed_factor': 1.0, 'seed': seed, 'parallel_infer': False,
                                                 'streaming_mode': False, 'top_k': 15, 'top_p': 1, 'temperature': 1,
                                                 'repetition_penalty': 1.2}):
                sr = sample_rate
                chunks.append(np.asarray(audio))
        if not chunks:
            raise RuntimeError('no audio produced')
        buf = io.BytesIO()
        sf.write(buf, np.concatenate(chunks), sr, format='WAV', subtype='PCM_16')
        return buf.getvalue()

    synth('こんにちは。')   # warm-up: loads the reference features and the text front-end
    faulthandler.cancel_dump_traceback_later()
    gpu = torch.cuda.get_device_name(0) if cuda else ''

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body, ctype='application/json'):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/health':
                self.reply(200, json.dumps({'ok': True, 'device': device, 'gpu': gpu}).encode())
            else:
                self.reply(404, b'{"error": "not found"}')

        def do_POST(self):
            if self.path != '/tts':
                return self.reply(404, b'{"error": "not found"}')
            try:
                n = int(self.headers.get('Content-Length') or 0)
                text = str(json.loads(self.rfile.read(n) or b'{}').get('text') or '').strip()[:300]
                if not text:
                    raise ValueError('empty text')
                t = time.perf_counter()
                wav = synth(text)
                log(f'tts {time.perf_counter() - t:.1f}s: {text}')
                self.reply(200, wav, 'audio/wav')
            except Exception as e:
                log('tts failed:', repr(e))
                self.reply(500, json.dumps({'error': str(e)}, ensure_ascii=False).encode())

    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print('CHIERI_READY ' + json.dumps({'port': srv.server_address[1], 'device': device, 'gpu': gpu, 'model': loaded,
                                        'seconds': round(time.perf_counter() - t0, 1)}, ensure_ascii=False), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()

from __future__ import annotations

import cgi
import json
import os
import tempfile
import threading
import time
import uuid
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("WHISPER_SERVICE_PORT", "8765"))
ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE = ROOT / ".runtime" / "whisper-models"
ALLOWED_MODELS = {"tiny.en", "base.en", "small.en"}
ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".mp4"}
LOCAL_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:4173", "http://127.0.0.1:4173"}
REMOTE_ORIGIN = re.compile(r"^https://(?:aistudio\.google\.com|[a-z0-9-]+\.(?:googleusercontent\.com|usercontent\.goog))$")
EXTRA_ORIGINS = {value.strip() for value in os.environ.get("WHISPER_ALLOWED_ORIGINS", "").split(",") if value.strip()}
TOKEN_FILE = ROOT / ".runtime" / "whisper-access-token.txt"
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

jobs: dict[str, dict] = {}
transcription_lock = threading.Lock()
models: dict[str, object] = {}


def public_job(job: dict) -> dict:
    return {key: value for key, value in job.items() if key not in {"cancel", "temp_path"}}


def run_transcription(job_id: str) -> None:
    job = jobs[job_id]
    temp_path = job["temp_path"]
    acquired = False
    try:
        if not transcription_lock.acquire(blocking=False):
            job.update(status="queued", progress=0)
            transcription_lock.acquire()
        acquired = True
        if job["cancel"].is_set():
            job.update(status="cancelled")
            return
        job.update(status="loading_model", progress=2)
        from faster_whisper import WhisperModel

        model_name = job["model"]
        if model_name not in models:
            MODEL_CACHE.mkdir(parents=True, exist_ok=True)
            models[model_name] = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=max(1, min(8, os.cpu_count() or 4)), download_root=str(MODEL_CACHE))
        if job["cancel"].is_set():
            job.update(status="cancelled")
            return

        job.update(status="transcribing", progress=5)
        segments_iter, info = models[model_name].transcribe(
            temp_path, language="en", beam_size=5, word_timestamps=True,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=True,
        )
        duration = float(info.duration or 0)
        segments, words = [], []
        for segment in segments_iter:
            if job["cancel"].is_set():
                job.update(status="cancelled")
                return
            segment_words = []
            for word in segment.words or []:
                item = {"text": word.word, "start": round(float(word.start), 3), "end": round(float(word.end), 3), "probability": round(float(word.probability), 5)}
                words.append(item)
                segment_words.append(item)
            segments.append({"start": round(float(segment.start), 3), "end": round(float(segment.end), 3), "text": segment.text.strip(), "words": segment_words})
            if duration > 0:
                job["progress"] = min(98, max(5, round((float(segment.end) / duration) * 100)))

        job.update(status="completed", progress=100, result={
            "audioFileName": job["audioFileName"], "duration": round(duration, 3), "language": "en",
            "languageProbability": round(float(info.language_probability or 0), 5), "model": model_name,
            "computeType": "int8", "text": " ".join(s["text"] for s in segments).strip(),
            "segments": segments, "words": words,
        })
    except Exception as exc:
        job.update(status="failed", error=str(exc), progress=0)
    finally:
        if acquired:
            transcription_lock.release()
        try:
            os.remove(temp_path)
        except OSError:
            pass
        job.pop("temp_path", None)


class Handler(BaseHTTPRequestHandler):
    server_version = "AssemblyLineWhisper/1.0"

    def _origin(self):
        origin = self.headers.get("Origin")
        return origin if origin in LOCAL_ORIGINS or origin in EXTRA_ORIGINS or (origin and REMOTE_ORIGIN.match(origin)) else None

    def _authorized(self):
        origin = self.headers.get("Origin")
        if origin in LOCAL_ORIGINS or not origin:
            return True
        if not self._origin() or not TOKEN_FILE.exists():
            return False
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        return supplied == TOKEN_FILE.read_text(encoding="utf-8").strip()

    def _require_authorized(self):
        if self._authorized():
            return True
        self._json(401, {"error": "Local companion access token is missing or invalid"})
        return False

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        if self._origin():
            self.send_header("Access-Control-Allow-Origin", self._origin())
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        if self._origin():
            self.send_header("Access-Control-Allow-Origin", self._origin())
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self) -> None:
        if not self._require_authorized(): return
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {"status": "ok", "service": "faster-whisper", "device": "cpu", "computeType": "int8", "models": sorted(ALLOWED_MODELS), "loadedModels": sorted(models)})
        elif path.startswith("/transcriptions/"):
            job = jobs.get(path.rsplit("/", 1)[-1])
            self._json(200, public_job(job)) if job else self._json(404, {"error": "Job not found"})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if not self._require_authorized(): return
        if urlparse(self.path).path != "/transcriptions":
            self._json(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            self._json(413, {"error": "Audio upload is empty or exceeds 1 GB"})
            return
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type", ""), "CONTENT_LENGTH": str(length)})
        model = form.getfirst("model", "base.en")
        upload = form["file"] if "file" in form else None
        filename = Path(getattr(upload, "filename", "") or "").name
        suffix = Path(filename).suffix.lower()
        if model not in ALLOWED_MODELS:
            self._json(400, {"error": "Unsupported model"})
            return
        if upload is None or not filename or suffix not in ALLOWED_SUFFIXES:
            self._json(400, {"error": "Unsupported or missing audio file"})
            return
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="assembly-line-vo-") as temp:
            while chunk := upload.file.read(1024 * 1024):
                temp.write(chunk)
            temp_path = temp.name
        job_id = str(uuid.uuid4())
        jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0, "model": model, "audioFileName": filename, "createdAt": time.time(), "error": None, "result": None, "cancel": threading.Event(), "temp_path": temp_path}
        threading.Thread(target=run_transcription, args=(job_id,), daemon=True).start()
        self._json(202, {"id": job_id, "status": "queued"})

    def do_DELETE(self) -> None:
        if not self._require_authorized(): return
        path = urlparse(self.path).path
        job = jobs.get(path.rsplit("/", 1)[-1]) if path.startswith("/transcriptions/") else None
        if not job:
            self._json(404, {"error": "Job not found"})
            return
        job["cancel"].set()
        self._json(202, {"id": job["id"], "status": "cancelling"})


if __name__ == "__main__":
    print(f"Assembly Line Whisper companion listening on http://{HOST}:{PORT}")
    print(f"Google AI Studio token file: {TOKEN_FILE}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

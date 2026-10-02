"""Execute one bounded alignment inside the sidecar-owned job directory."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import sysconfig

SPEC = json.loads(Path(__file__).with_name("runtime-spec.json").read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_runtime(root):
    installed = {}
    for path in (Path(sys.prefix) / "conda-meta").glob("*.json"):
        package = json.loads(path.read_text())
        installed[package["name"]] = package["version"]
    for package, version in SPEC["packages"].items():
        if installed.get(package) != version:
            raise ValueError("alignment_runtime_mismatch")
    sources = Path(sysconfig.get_paths()["purelib"]) / "montreal_forced_aligner/alignment"
    for name, hashes in SPEC["sources"].items():
        if digest(sources / name) != hashes["patched"]:
            raise ValueError("alignment_runtime_mismatch")
    for model in SPEC["models"]:
        if digest(root / model["path"]) != model["sha256"]:
            raise ValueError("alignment_runtime_mismatch")


def refinement_completed(log):
    """Check execution, not whether resulting boundaries happen to be off-grid."""
    marker = "Fine tuning alignments..."
    if log.count(marker) != 1:
        return False
    section = log.split(marker, 1)[1].split("Analyzing alignment quality...", 1)[0]
    return re.search(r"(?m)^\s*100%[^\n]*\b1\s*/\s*1\b", section) is not None


def run_alignment(mfa, root, job, request):
    verify_runtime(root)
    corpus = job / "corpus/speaker"
    corpus.mkdir(parents=True)
    (corpus / "utterance.wav").write_bytes(base64.b64decode(request["audio"], validate=True))
    (corpus / "utterance.lab").write_text(request["text"], encoding="utf8")
    environment = {name: value for name, value in os.environ.items()
                   if name in ("PATH", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT")}
    environment.update({
        "PATH": str(mfa.parent) + os.pathsep + environment.get("PATH", ""),
        "MFA_ROOT_DIR": str(root),
        "MPLCONFIGDIR": str(job / "matplotlib"),
        "NUMBA_CACHE_DIR": str(root / "numba-cache"),
        "HF_HOME": str(root / "huggingface-cache"),
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
    })
    command = [str(mfa), "align", str(job / "corpus"),
               str(root / "pretrained_models/dictionary/english_mfa.dict"),
               str(root / "pretrained_models/acoustic/english_mfa.zip"),
               str(job / "output"), "--single_speaker", "--fine_tune",
               "--output_format", "json", "--temporary_directory", str(job / "work"),
               "--num_jobs", "1", "--clean"]
    with (job / "alignment.log").open("w") as log:
        completed = subprocess.run(command, env=environment, stdout=log, stderr=subprocess.STDOUT)
    if completed.returncode:
        raise ValueError("alignment_failed")
    if not refinement_completed((job / "alignment.log").read_text()):
        raise ValueError("alignment_not_refined")
    output = job / "output/speaker/utterance.json"
    if not output.is_file():
        raise ValueError("alignment_incomplete")
    data = json.loads(output.read_text())
    entries = data.get("tiers", {}).get("words", {}).get("entries", [])
    # The host validates complete transcript coverage, ordering, and bounds.
    words = [{"text": text, "start": round(start, 3), "end": round(end, 3)}
             for start, end, text in entries]
    return {
        "text": request["text"], "words": words,
        "provenance": {
            "method": "forced_alignment", "engine": "mfa", "version": SPEC["version"],
            "acousticModel": "english_mfa@3.1.0", "dictionary": "english_mfa",
            "language": "en", "transcriptVerified": False, "refined": True,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mfa", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    try:
        request = json.loads(sys.stdin.read(2_570_001))
        result = run_alignment(args.mfa, args.root, args.job, request)
    except Exception as error:
        known = {"alignment_failed", "alignment_incomplete", "alignment_runtime_mismatch", "alignment_not_refined"}
        code = str(error) if str(error) in known else "alignment_failed"
        print(json.dumps({"error": {"code": code}}))
        return 1
    print(json.dumps(result, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

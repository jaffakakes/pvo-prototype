"""Create an isolated, pinned MFA runtime; never install into system Python."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys

SPEC = json.loads(Path(__file__).with_name("runtime-spec.json").read_text())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def patch_sources(site, backup):
    source = site / "montreal_forced_aligner/alignment"
    backup.mkdir(parents=True, exist_ok=True)
    diffs = []
    for name, expected in SPEC["sources"].items():
        path = source / name
        if sha256(path) == expected["patched"]:
            continue
        if sha256(path) != expected["original"]:
            raise RuntimeError("MFA source differs from the tested release")
        original = path.read_text()
        if name == "pretrained.py":
            changed = original.replace(
                "        super()._align()\n        if self.fine_tune:\n            self.fine_tune_alignments()\n",
                "        super()._align()\n",
            ).replace(
                "        self.setup()\n        super().align()\n\n    def fine_tune_alignments",
                "        self.setup()\n        super().align()\n        if self.fine_tune:\n            self.fine_tune_alignments()\n\n    def fine_tune_alignments",
            )
        else:
            start = original.index("class FineTuneFunction(")
            end = original.index("class PhoneConfidenceFunction(", start)
            body = original[start:end].replace(
                "alignment = alignment_archive[utterance.id]",
                "alignment = alignment_archive[utterance.kaldi_id]",
            ).replace(
                "                alignment_archive = AlignmentArchive(ali_path)",
                '                words_path = job.construct_path(workflow.working_directory, "words", "ark", d.name)\n'
                "                alignment_archive = AlignmentArchive(ali_path, words_file_name=words_path)",
            )
            changed = original[:start] + body + original[end:]
        if hashlib.sha256(changed.encode()).hexdigest() != expected["patched"]:
            raise RuntimeError("Refinement patch did not produce the tested source")
        (backup / name).write_text(original)
        path.write_text(changed)
        diffs.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
                                        fromfile="stock/" + name, tofile="pvo-refinement/" + name))
    if diffs:
        (backup / "refinement.patch").write_text("".join(diffs))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--micromamba", type=Path, required=True)
    parser.add_argument("--prefix", type=Path, required=True)
    args = parser.parse_args()
    prefix = args.prefix.expanduser().resolve()
    environment = prefix / "env"
    if not (environment / "bin/python").exists():
        subprocess.run([str(args.micromamba.resolve()), "--no-rc", "--root-prefix",
                        str(prefix / "mamba-root"), "create", "--prefix", str(environment),
                        "--channel", "conda-forge", "--strict-channel-priority", "--yes",
                        "python=3.14.7", "montreal-forced-aligner=3.4.2", "kalpy=0.10.5"], check=True)
    python = environment / "bin/python"
    versions = {}
    for path in (environment / "conda-meta").glob("*.json"):
        package = json.loads(path.read_text())
        versions[package["name"]] = package["version"]
    if any(versions.get(name) != version for name, version in SPEC["packages"].items()):
        raise RuntimeError("Existing environment does not have the pinned MFA packages")
    site = Path(subprocess.check_output([str(python), "-c",
                'import sysconfig; print(sysconfig.get_paths()["purelib"])'], text=True).strip())
    patch_sources(site, prefix / "stock-source")
    root = prefix / "mfa-root"
    for model in SPEC["models"]:
        target = root / model["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            download = target.with_suffix(target.suffix + ".download")
            try:
                subprocess.run(["curl", "--fail", "--location", "--retry", "2",
                                model["url"], "--output", str(download)], check=True)
                if sha256(download) != model["sha256"]:
                    raise RuntimeError("MFA model checksum mismatch")
                download.replace(target)
            finally:
                download.unlink(missing_ok=True)
        if sha256(target) != model["sha256"]:
            raise RuntimeError("Installed MFA model checksum mismatch")
    (prefix / "runtime-spec.json").write_text(json.dumps(SPEC, indent=2))
    print(json.dumps({"mfa": str(environment / "bin/mfa"), "root": str(root),
                      "version": SPEC["version"]}))


if __name__ == "__main__":
    main()

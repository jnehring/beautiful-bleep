# SPDX-License-Identifier: MIT
"""Community modules (website/content/developers/modules/library.md): what the library checks before it publishes a package an
account uploaded, and how it builds the package it stores.

What keeps users safe is the sandbox and the checks below, which every client repeats before it runs the file. The checks are
deliberately strict about WHAT a package may contain, and say nothing about who wrote it.
"""
import io
import json
import re
import zipfile

ENGINE_ABI = 1

# website/content/developers/modules/module-abi.md, sections 2 (imports) and 4 (exports). scripts/release/package-module.py checks first-party
# modules against the same sets.
ALLOWED_IMPORTS = {
    ("env", "emscripten_notify_memory_growth"),
    ("env", "bleep_media_info"), ("env", "bleep_media_read"),  # sample files, answered by the host (module-abi.md, "Media")
    *(("env", n) for n in ("bleep_record_open", "bleep_record_take", "bleep_record_write", "bleep_record_status", "bleep_record_text",
                           "bleep_record_free", "bleep_record_close")),  # recording, answered by the host (module-abi.md, "Recording")
    *(("wasi_snapshot_preview1", n) for n in ("fd_close", "fd_read", "fd_seek", "fd_write", "environ_get", "environ_sizes_get", "clock_time_get")),
}
REQUIRED_EXPORTS = {
    "memory", "_initialize", "bleep_error", "bleep_spec_json", "bleep_spec_json_length", "bleep_type_count", "bleep_chunk", "bleep_create",
    "bleep_destroy", "bleep_reset", "bleep_params_ptr", "bleep_inputs_ptr", "bleep_outputs_ptr", "bleep_in_connected_ptr",
    "bleep_out_connected_ptr", "bleep_set_knob", "bleep_set_transport", "bleep_process", "bleep_notes_in_ptr", "bleep_notes_out_ptr",
    "bleep_note_event_size", "bleep_scratch", "bleep_text", "bleep_text_length", "bleep_set_data", "bleep_sanitise_data", "bleep_perform",
    "bleep_command", "bleep_live", "bleep_param_text", "bleep_output_display", "bleep_take_data",
}

# Limits of a community package (the host's own limit for a module file is 32 MiB).
MAX_PACKAGE_BYTES = 12 * 1024 * 1024
MAX_WASM_BYTES = 8 * 1024 * 1024
MAX_FILES = 24
MAX_TEXT_BYTES = 256 * 1024       # module.json, spec.json, LICENSE, view.sandbox.js, source.dsp.ts, doc/*.md
MAX_IMAGE_BYTES = 1024 * 1024     # image.*, doc/*.png

# A community package is data plus sandboxed WebAssembly. There is no `ui/*.js`: a module's own page script runs in the page, which only
# first-party modules may do (bleep-script.md section 9.5). The one JavaScript file a package may have is `view.sandbox.js`, the module's
# own picture: the board never runs it in the page, only in the sandboxed worker frame a Code node's UI runs in (no network, no storage, no DOM,
# stopped when it hangs), so it is data like the rest.
# `source.dsp.ts` is the module's Bleep Script source, when the author shares it: text the board shows in a Code node ("Convert to code"), compiled
# only by the user's own compiler in the browser.
# `image.png|jpg|webp` is the picture on the module's tile in the library (display data, up to 1 MB).
ALLOWED_FILES = re.compile(r"^(module\.json|module\.wasm|spec\.json|LICENSE|view\.sandbox\.js|source\.dsp\.ts|image\.(png|jpg|webp)|doc/[A-Za-z0-9._-]+\.(md|png))$")
IMAGE_NAME = re.compile(r"^image\.(png|jpg|webp)$")
REQUIRED_FILES = ("module.json", "module.wasm", "spec.json")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
ZIP_DATE = (2020, 1, 1, 0, 0, 0)


MAX_MEMBER_BYTES = 512 * 1024 * 1024    # one file inside a package (plugin packages carry big binaries)
MAX_TOTAL_BYTES = 1024 * 1024 * 1024    # all files of a package together
MAX_RATIO = 1000                        # uncompressed / compressed, for members above RATIO_FROM (a zip bomb is far above)
RATIO_FROM = 16 * 1024 * 1024
MAX_META_BYTES = 1024 * 1024            # module.json


def safe_path(path: str) -> str:
    parts = path.split("/")
    if not path or path.startswith("/") or "\\" in path or "\0" in path or any(p in ("", ".", "..") for p in parts):
        raise ValueError(f"bad path in package: {path!r}")
    return path


def check_member(info: zipfile.ZipInfo, total: int = 0, *, max_member: int | None = None, max_total: int | None = None) -> int:
    """Refuses an oversize or bomb-like zip member before anything is decompressed; returns the running total."""
    max_member = MAX_MEMBER_BYTES if max_member is None else max_member
    max_total = MAX_TOTAL_BYTES if max_total is None else max_total
    if info.file_size > max_member:
        raise ValueError(f"{info.filename}: {info.file_size} bytes uncompressed, more than the limit of {max_member}")
    if info.file_size > RATIO_FROM and info.file_size > MAX_RATIO * max(info.compress_size, 1):
        raise ValueError(f"{info.filename}: compression ratio is implausibly high")
    if total + info.file_size > max_total:
        raise ValueError(f"package is larger than {max_total} bytes uncompressed")
    return total + info.file_size


def read_member(z: zipfile.ZipFile, name: str, limit: int = MAX_META_BYTES) -> bytes:
    """One (small) member's bytes, refused when it is larger than `limit`."""
    check_member(z.getinfo(name), max_member=limit)
    return z.read(name)


class Rejected(ValueError):
    """The package breaks a rule; the message is shown to the author."""


# ---- the .wasm file: just enough of the binary format to read imports and exports -------------

def _leb(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7
        if shift > 63:
            raise ValueError("number too long")


def _name(data: bytes, pos: int) -> tuple[str, int]:
    n, pos = _leb(data, pos)
    if pos + n > len(data):
        raise ValueError("name runs past the end of the file")
    return data[pos:pos + n].decode(), pos + n


def read_wasm(data: bytes) -> tuple[list[tuple[str, str]], list[str]]:
    """(imports as (module, name), export names) of a WebAssembly binary. Raises ValueError for anything that is not one."""
    if data[:8] != b"\0asm\x01\0\0\0":
        raise ValueError("not a WebAssembly 1.0 binary")
    imports: list[tuple[str, str]] = []
    exports: list[str] = []
    pos = 8
    while pos < len(data):
        sid = data[pos]
        size, pos = _leb(data, pos + 1)
        end = pos + size
        if end > len(data):
            raise ValueError("a section runs past the end of the file")
        if sid == 2:
            count, p = _leb(data, pos)
            for _ in range(count):
                mod, p = _name(data, p)
                name, p = _name(data, p)
                kind = data[p]
                p += 1
                if kind == 0:                      # function: type index
                    _, p = _leb(data, p)
                elif kind == 1:                    # table: element type, limits
                    p += 1
                    flags, p = _leb(data, p)
                    _, p = _leb(data, p)
                    if flags & 1:
                        _, p = _leb(data, p)
                elif kind == 2:                    # memory: limits
                    flags, p = _leb(data, p)
                    _, p = _leb(data, p)
                    if flags & 1:
                        _, p = _leb(data, p)
                elif kind == 3:                    # global: type, mutability
                    p += 2
                elif kind == 4:                    # tag: attribute, type index
                    p += 1
                    _, p = _leb(data, p)
                else:
                    raise ValueError(f"unknown import kind {kind}")
                imports.append((mod, name))
        elif sid == 7:
            count, p = _leb(data, pos)
            for _ in range(count):
                name, p = _name(data, p)
                p += 1
                _, p = _leb(data, p)
                exports.append(name)
        pos = end
    return imports, exports


def check_abi(data: bytes) -> list[str]:
    """What is wrong with this module file under module-abi.md (empty: nothing)."""
    try:
        imports, exports = read_wasm(data)
    except (ValueError, IndexError, UnicodeDecodeError) as e:
        return [f"cannot read the file: {e}"]
    problems = [f"imports {m}.{n}, which the ABI does not allow" for m, n in imports if (m, n) not in ALLOWED_IMPORTS]
    problems += [f"does not export {n}" for n in sorted(REQUIRED_EXPORTS - set(exports))]
    return problems


# ---- the package ------------------------------------------------------------------------------

def inspect(data: bytes) -> tuple[dict[str, bytes], dict]:
    """Opens an uploaded .bleepmod and checks it against the rules for a community package. Returns ({path: bytes}, module.json).

    Raises Rejected with the reason. Nothing here trusts the package: sizes are checked before anything is decompressed, only the
    files of ALLOWED_FILES are accepted, and the .wasm must import only what the host stubs out and export the whole ABI."""
    if len(data) > MAX_PACKAGE_BYTES:
        raise Rejected(f"A community module package is at most {MAX_PACKAGE_BYTES // (1024 * 1024)} MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise Rejected("This is not a .bleepmod package (a zip file)")
    files: dict[str, bytes] = {}
    with z:
        infos = [i for i in z.infolist() if not i.is_dir() and i.filename != "META/signature.json"]  # a leftover signature file is ignored
        if len(infos) > MAX_FILES:
            raise Rejected(f"A package has at most {MAX_FILES} files")
        total = 0
        for info in infos:
            name = info.filename
            try:
                safe_path(name)
                total = check_member(info, total, max_member=MAX_WASM_BYTES, max_total=2 * MAX_WASM_BYTES)
            except ValueError as e:
                raise Rejected(str(e))
            if (info.external_attr >> 28) == 0xA:
                raise Rejected(f"{name}: a symbolic link")
            if name in files:
                raise Rejected(f"{name}: appears twice")
            if not ALLOWED_FILES.match(name):
                hint = " (a community module cannot bring page scripts; its own picture is view.sandbox.js, which runs in a sandbox)" if name.endswith(".js") else ""
                raise Rejected(f"{name}: not allowed in a community package{hint}. Allowed: module.json, module.wasm, spec.json, LICENSE, view.sandbox.js, source.dsp.ts, image.png|jpg|webp, doc/*.md, doc/*.png")
            limit = MAX_WASM_BYTES if name == "module.wasm" else MAX_IMAGE_BYTES if name.endswith((".png", ".jpg", ".webp")) else MAX_TEXT_BYTES
            if info.file_size > limit:
                raise Rejected(f"{name}: larger than {limit // 1024} KB")
            files[name] = z.read(info)
    missing = [n for n in REQUIRED_FILES if n not in files]
    if missing:
        raise Rejected(f"Missing from the package: {', '.join(missing)}")
    for name, content in files.items():
        if name.endswith(".png") and not content.startswith(PNG_MAGIC):
            raise Rejected(f"{name}: not a PNG file")
        if name == "image.jpg" and not content.startswith(b"\xff\xd8\xff"):
            raise Rejected(f"{name}: not a JPEG file")
        if name == "image.webp" and not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
            raise Rejected(f"{name}: not a WebP file")
    problems = check_abi(files["module.wasm"])
    if problems:
        raise Rejected("module.wasm: " + "; ".join(problems))
    try:
        meta = json.loads(files["module.json"])
        json.loads(files["spec.json"])
    except ValueError as e:
        raise Rejected(f"module.json and spec.json must be JSON: {e}")
    if not isinstance(meta, dict):
        raise Rejected("module.json must be a JSON object")
    return files, meta


def build_zip(files: dict[str, bytes]) -> bytes:
    """The package as the library stores it: the same files, sorted, with fixed dates."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(files, key=lambda p: p.encode()):
            info = zipfile.ZipInfo(path, ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, files[path], compresslevel=9)
    return out.getvalue()

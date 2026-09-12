#!/usr/bin/env python3
"""Audit project clutter and optionally combine Markdown. Never edits source files."""

import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
import io
import os
from pathlib import Path
import re
import stat
import subprocess
import tokenize
from urllib.parse import quote


SKIP_DIRS = {
    '.git', '.hg', '.svn', 'node_modules', 'vendor', '.venv', 'venv',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
    'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.cleanup-reports', '.project-intake',
}
SOURCE_EXTENSIONS = {
    '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.java', '.go',
    '.rs', '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.swift', '.vue', '.svelte',
}
PROTECTED_DOCS = {'agents', 'claude', 'gemini', 'skill', 'license', 'licence',
                  'copying', 'security', 'code_of_conduct', 'contributing'}


def display(path):
    return str(path).replace('\n', '\\n').replace('\r', '\\r').replace('`', '\\`')


def collect_files(root, warnings):
    try:
        subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        result = subprocess.run(
            ['git', '-C', str(root), 'ls-files', '--cached', '--others',
             '--exclude-standard', '-z', '--', '.'],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        candidates = [root / os.fsdecode(p) for p in result.stdout.split(b'\0') if p]
        scope = 'Git tracked and untracked non-ignored files; standard generated folders excluded.'
    except (OSError, subprocess.CalledProcessError):
        candidates = []
        for folder, dirs, files in os.walk(root, followlinks=False,
                                           onerror=lambda e: warnings.append(str(e))):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS
                             and not (Path(folder) / d).is_symlink())
            candidates.extend(Path(folder) / name for name in sorted(files))
        scope = 'Filesystem scan; standard generated folders excluded. Git ignore rules unavailable.'
    selected = []
    for path in sorted(set(candidates)):
        relative = path.relative_to(root)
        if any(part in SKIP_DIRS for part in relative.parts):
            continue
        if path.name == '.env' or path.name.startswith('.env.'):
            continue
        if any((root / Path(*relative.parts[:i])).is_symlink()
               for i in range(1, len(relative.parts) + 1)):
            continue
        try:
            if stat.S_ISREG(path.lstat().st_mode):
                selected.append(path)
        except OSError as error:
            warnings.append(f'{display(relative)}: {error}')
    return selected, scope


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def audit(root, files, max_bytes, warnings):
    sizes = defaultdict(list)
    large = []
    comments = []
    markdown = []
    skipped = []
    for path in files:
        relative = path.relative_to(root)
        try:
            size = path.stat().st_size
            if size > max_bytes:
                skipped.append(relative)
                continue
            sizes[size].append(path)
            if path.suffix.lower() == '.md':
                markdown.append(path)
            if path.suffix.lower() not in SOURCE_EXTENSIONS:
                continue
            if path.suffix.lower() == '.py':
                with tokenize.open(path) as handle:
                    content = handle.read()
            else:
                content = path.read_text(encoding='utf-8')
            lines = content.splitlines()
            if len(lines) >= 500:
                large.append((relative, len(lines)))
            if path.suffix.lower() == '.py':
                tokens = tokenize.generate_tokens(io.StringIO(content).readline)
                comment_lines = {t.start[0] for t in tokens if t.type == tokenize.COMMENT}
                nonempty = sum(bool(line.strip()) for line in lines)
                ratio = len(comment_lines) / max(nonempty, 1)
                if len(comment_lines) >= 20 and ratio >= 0.30:
                    comments.append((relative, len(comment_lines), round(ratio * 100)))
        except (OSError, UnicodeError, SyntaxError, LookupError, tokenize.TokenError) as error:
            warnings.append(f'{display(relative)}: {error}')
    duplicates = []
    for size, paths in sizes.items():
        if size == 0 or len(paths) < 2:
            continue
        hashes = defaultdict(list)
        for path in paths:
            try:
                hashes[digest(path)].append(path.relative_to(root))
            except OSError as error:
                warnings.append(f'{display(path.relative_to(root))}: {error}')
        duplicates.extend((size, group) for group in hashes.values() if len(group) > 1)
    return duplicates, sizes.get(0, []), large, comments, markdown, skipped


def nested_headings(content):
    fence = None
    output = []
    for line in content.splitlines():
        match = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if fence:
            if match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not match[2].strip():
                fence = None
        elif match:
            fence = match[1]
        else:
            line = re.sub(r'^(#{1,6})(\s+)', lambda m: '#' * min(6, len(m[1]) + 2) + m[2], line)
        output.append(line)
    if fence:
        output.append(fence)
    return '\n'.join(output)


def merge_docs(root, out, requested, markdown):
    selections = []
    for value in requested:
        path = (root / value).resolve()
        if path != root and root not in path.parents:
            raise ValueError(f'Markdown selection is outside the project: {value}')
        if not path.exists():
            raise ValueError(f'Markdown selection does not exist: {value}')
        if path.is_file() and path.suffix.lower() != '.md':
            raise ValueError(f'Expected a Markdown file or directory: {value}')
        selections.append(path)
    selected = [p for p in markdown if any(p == s or s in p.parents for s in selections)
                and p.stem.lower() not in PROTECTED_DOCS
                and '.agents' not in p.parts and '.codex' not in p.parts]
    if not selected:
        raise ValueError('No eligible Markdown files in the selected paths.')
    sections = ['# Combined documentation — review draft',
                'Original files are unchanged. Review before adopting this draft. Relative links, '
                'images, anchors, front matter, and reference-link names retain their original context '
                'and may need adjustment. Use the source links below to open the originals.\n',
                '## Contents']
    for index, path in enumerate(selected, 1):
        sections.append(f'- [{display(path.relative_to(root))}](#document-{index})')
    for index, path in enumerate(selected, 1):
        content = path.read_text(encoding='utf-8-sig')
        source = quote(os.path.relpath(path, out).replace(os.sep, '/'), safe='/')
        sections.extend(['\n---\n', f'<a id="document-{index}"></a>',
                         f'## {display(path.relative_to(root))}', f'[Open original]({source})\n',
                         nested_headings(content)])
    with (out / 'COMBINED_DOCS.md').open('x', encoding='utf-8') as handle:
        handle.write('\n\n'.join(sections) + '\n')
    return len(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', default='.', help='Project directory (default: current directory)')
    parser.add_argument('--merge-md', nargs='+', metavar='PATH',
                        help='Combine selected Markdown files/directories, relative to project root')
    parser.add_argument('--max-mb', type=int, default=20, help='Skip files larger than this (default: 20)')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir() or args.max_mb < 1:
        parser.error('Root must be an existing directory and --max-mb must be positive.')
    warnings = []
    files, scope = collect_files(root, warnings)
    duplicate, empty, large, comments, markdown, skipped = audit(root, files, args.max_mb * 1024**2, warnings)
    parent = root / '.cleanup-reports'
    if parent.is_symlink():
        parser.error('Refusing to write through a symlink at .cleanup-reports.')
    parent.mkdir(exist_ok=True)
    out = parent / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    out.mkdir()
    report = ['# Project cleanup review', f'Project: `{display(root)}`',
              f'Scope: {scope} Symlinks and .env files excluded.',
              f'Files in scope: {len(files)}. Files exceeding {args.max_mb} MB: {len(skipped)}.',
              'No source files were edited, moved, or deleted. Findings are review candidates, '
              'not proof that a file or comment is unnecessary. This does not analyze unused code, '
              'duplicate code fragments, or application correctness.',
              '## Files with identical SHA-256 hashes',
              'Both paths may be required, even when contents match. Empty files are listed separately.']
    for size, group in sorted(duplicate, key=lambda item: item[0], reverse=True):
        report.append(f'\nGroup ({size:,} bytes per file):')
        report.extend(f'- `{display(p)}`' for p in group)
    if not duplicate:
        report.append('None found within scan scope.')
    report.extend(['\n## Empty files', 'Empty package markers and placeholders may be intentional.'])
    report.extend(f'- `{display(p.relative_to(root))}`' for p in empty)
    report.extend(['\n## Source files with at least 500 lines', 'Length alone is not a defect.'])
    report.extend(f'- `{display(p)}`: {count} lines' for p, count in sorted(large, key=lambda x: -x[1]))
    report.extend(['\n## Python files with many comments',
                   'At least 20 comment-bearing lines and 30% of nonblank lines. Tokenized Python '
                   'comments only; strings/docstrings are not counted. Review explanations manually; '
                   'retain licenses, type/lint directives, and useful rationale.'])
    report.extend(f'- `{display(p)}`: {count} comment-bearing lines ({ratio}%)' for p, count, ratio in comments)
    report.append('\n## Markdown inventory')
    report.extend(f'- `{display(p.relative_to(root))}`' for p in markdown)
    if args.merge_md:
        try:
            count = merge_docs(root, out, args.merge_md, markdown)
            report.extend(['\n## Documentation draft', f'Combined {count} files into [COMBINED_DOCS.md](COMBINED_DOCS.md). '
                           'Originals preserved. Agent instructions and common license/policy files excluded.'])
        except (ValueError, OSError, UnicodeError) as error:
            warnings.append(f'Documentation merge failed: {error}')
    report.append('\n## Files exceeding the scan size limit')
    report.extend(f'- `{display(p)}`' for p in skipped)
    report.append('\n## Warnings and incomplete reads')
    report.extend(f'- {display(w)}' for w in warnings)
    if not warnings:
        report.append('None.')
    with (out / 'REPORT.md').open('x', encoding='utf-8') as handle:
        handle.write('\n\n'.join(report) + '\n')
    print(f'Report: {out / "REPORT.md"}')
    if (out / 'COMBINED_DOCS.md').exists():
        print(f'Combined documentation: {out / "COMBINED_DOCS.md"}')
    print(f'{len(duplicate)} duplicate-content groups; {len(large)} long source files; '
          f'{len(comments)} Python files with many comments. Originals unchanged.')
    if warnings:
        print(f'{len(warnings)} warning(s): inspect the report. Audit is incomplete.')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

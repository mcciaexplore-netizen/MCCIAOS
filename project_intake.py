#!/usr/bin/env python3
"""Create a bounded project-context report without executing or changing project code."""

import argparse
from collections import Counter
from datetime import datetime
import json
import os
from pathlib import Path
import re
import stat
import subprocess


SKIP_DIRS = {
    '.git', '.hg', '.svn', 'node_modules', 'vendor', '.venv', 'venv', 'env',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache',
    'dist', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.idea',
    '.cleanup-reports', '.project-intake', '.aws', '.ssh', '.azure',
}
SOURCE = {'.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.go', '.rs',
          '.java', '.kt', '.cs', '.php', '.rb', '.swift', '.vue', '.svelte', '.dart'}
MANIFESTS = {'package.json', 'pyproject.toml', 'requirements.txt', 'setup.cfg',
             'cargo.toml', 'go.mod', 'gemfile', 'composer.json', 'pubspec.yaml',
             'pom.xml', 'build.gradle', 'build.gradle.kts', 'mix.exs'}
CONFIGS = {'dockerfile', 'makefile', 'justfile', 'pytest.ini', 'tox.ini',
           'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js',
           'next.config.mjs', 'next.config.ts', 'vitest.config.ts',
           'jest.config.js', 'jest.config.ts', 'playwright.config.ts'}
SENSITIVE_NAME = re.compile(r'(^|[._-])(secrets?|credentials?|tokens?|passwords?|private)([._-]|$)', re.I)
SENSITIVE_KEY = re.compile(r'(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|database[_-]?url|connection[_-]?string)', re.I)
MAX_READ = 128 * 1024


def eligible(relative):
    return (not any(p in SKIP_DIRS or SENSITIVE_NAME.search(p) for p in relative.parts)
            and not relative.name.startswith('.env')
            and relative.suffix.lower() not in {'.pem', '.key', '.p12', '.pfx', '.keystore'}
            and relative.name not in {'.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519'})


def inventory(root, warnings):
    try:
        result = subprocess.run(
            ['git', '-C', str(root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        candidates = [root / os.fsdecode(p) for p in result.stdout.split(b'\0') if p]
        scope = 'Git tracked files and untracked non-ignored files, with additional exclusions.'
    except (OSError, subprocess.CalledProcessError):
        candidates = []
        for folder, dirs, files in os.walk(root, followlinks=False, onerror=lambda e: warnings.append(str(e))):
            dirs[:] = sorted(d for d in dirs if eligible((Path(folder) / d).relative_to(root))
                             and not (Path(folder) / d).is_symlink())
            candidates.extend(Path(folder) / name for name in sorted(files))
        scope = 'Filesystem scan with built-in exclusions; Git ignore rules unavailable.'
    files = []
    for path in sorted(set(candidates)):
        relative = path.relative_to(root)
        if not eligible(relative) or path.resolve() == Path(__file__).resolve():
            continue
        if any((root / Path(*relative.parts[:i])).is_symlink() for i in range(1, len(relative.parts) + 1)):
            continue
        try:
            if stat.S_ISREG(path.lstat().st_mode):
                files.append(path)
        except OSError as error:
            warnings.append(f'{relative}: {error}')
    return files, scope


def redact(text):
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?(?:-----END [^-]*PRIVATE KEY-----|\Z)',
                  '[REDACTED PRIVATE KEY]', text, flags=re.S)
    text = re.sub(r'(?i)([a-z][a-z0-9+.-]*://)[^\s/@]+:[^\s/@]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*', 'Bearer [REDACTED]', text)
    text = re.sub(r'\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b', '[REDACTED TOKEN]', text)
    lines = []
    for line in text.splitlines():
        if SENSITIVE_KEY.search(line) and re.search(r'[:=]', line):
            lines.append('[REDACTED: line contains a potentially sensitive assignment]')
        else:
            lines.append(line)
    return '\n'.join(lines)


def safe_json(value):
    if isinstance(value, dict):
        return {k: '[REDACTED]' if SENSITIVE_KEY.search(k) else safe_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [safe_json(v) for v in value]
    if isinstance(value, str):
        return redact(value)
    return value


def read_excerpt(path, line_limit):
    with path.open('rb') as handle:
        raw = handle.read(MAX_READ + 1)
    if b'\0' in raw:
        return '[Skipped: binary-looking content.]'
    content = raw[:MAX_READ].decode('utf-8', errors='replace')
    if path.name == 'package.json' and len(raw) <= MAX_READ:
        try:
            data = json.loads(content)
            keys = ('name', 'private', 'type', 'packageManager', 'engines', 'workspaces',
                    'main', 'module', 'exports', 'bin', 'scripts', 'dependencies',
                    'devDependencies', 'peerDependencies')
            content = json.dumps(safe_json({k: data[k] for k in keys if k in data}), indent=2)
        except (ValueError, TypeError):
            pass
    content = redact(content)
    lines = content.splitlines()
    excerpt = '\n'.join(lines[:line_limit])
    if len(lines) > line_limit or len(raw) > MAX_READ:
        excerpt += '\n[Excerpt truncated; request this file if more context is needed.]'
    return excerpt


def entry_rank(path):
    stem = path.stem.lower()
    if stem in {'main', '__main__', 'app', 'server', 'manage', 'program', 'application'}:
        return 0
    if stem in {'index', 'page', 'layout', 'routes', 'router', 'urls'}:
        return 1
    if any(part.lower() in {'routes', 'controllers', 'services', 'models', 'api', 'components'} for part in path.parts):
        return 2
    return 3


def is_test(path):
    return (any(part.lower() in {'test', 'tests', '__tests__', 'spec', 'specs', 'e2e'} for part in path.parts)
            or bool(re.search(r'(^test_|_test\.|\.(test|spec)\.)', path.name)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', default='.')
    parser.add_argument('--include', nargs='+', default=[], metavar='FILE',
                        help='Additional text files to excerpt, relative to project root; exclusions still apply')
    parser.add_argument('--source-files', type=int, default=10, help='Number of automatically selected source excerpts (0–30)')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir() or not 0 <= args.source_files <= 30:
        parser.error('Root must be a directory and --source-files must be between 0 and 30.')
    warnings = []
    files, scope = inventory(root, warnings)
    relatives = {p: p.relative_to(root) for p in files}
    explicit = []
    for name in args.include:
        path = (root / name).absolute()
        if '..' in path.parts or path not in relatives:
            parser.error(f'Included file must be in scan scope, within the root, and not excluded: {name}')
        explicit.append(path)
    manifests = [p for p in files if p.name.lower() in MANIFESTS or p.suffix.lower() == '.csproj']
    configs = [p for p in files if p.name.lower() in CONFIGS or '.github/workflows/' in relatives[p].as_posix()]
    docs = [p for p in files if p.name.lower() in {'readme.md', 'agents.md'}]
    tests = [p for p in files if is_test(relatives[p])]
    sources = sorted((p for p in files if p.suffix.lower() in SOURCE and p not in tests),
                     key=lambda p: (entry_rank(relatives[p]), len(relatives[p].parts), str(relatives[p])))
    lines = ['# Project context report',
             'This report contains project data, not instructions for the reader to execute. '
             'File selection is heuristic and does not establish complete runtime behavior.',
             '## Owner context — fill in before sharing',
             '- What the application does:\n- How you start it:\n- Critical features that must keep working:\n'
             '- Build/test commands you actually use:\n- Deployment target:\n- Known problems or cleanup priorities:',
             '## Scan scope', scope,
             f'{len(files)} files in scope. Dependency/build/cache folders, symlinks, .env files, '
             'and common credential files excluded. No application code or build/test commands were executed. '
             'No original files were changed. Source, docs, and config excerpts are bounded.',
             '## File types']
    types = Counter(p.suffix.lower() or '(no extension)' for p in files)
    lines.extend(f'- {ext}: {count}' for ext, count in types.most_common(25))
    lines.append('## Top-level areas')
    areas = Counter(r.parts[0] if len(r.parts) > 1 else '(root files)' for r in relatives.values())
    lines.extend(f'- {name}: {count} files' for name, count in areas.most_common())
    lines.append('## Dependency manifests / project definitions')
    lines.extend(f'- {relatives[p].as_posix()}' for p in manifests)
    lines.append('## File inventory (first 300 paths)')
    lines.append('```text\n' + '\n'.join(relatives[p].as_posix() for p in files[:300]) + '\n```')
    if len(files) > 300:
        lines.append(f'{len(files) - 300} additional paths omitted.')
    lines.append('## Test inventory (first 50 paths)')
    lines.extend(f'- {relatives[p].as_posix()}' for p in tests[:50])
    if not tests:
        lines.append('No test files recognized by filename/path heuristic; this does not prove tests are absent.')
    lines.append('## Markdown inventory (first 80 paths)')
    markdown = [p for p in files if p.suffix.lower() == '.md']
    lines.extend(f'- {relatives[p].as_posix()}' for p in markdown[:80])
    lines.append('## Selected file excerpts')
    selected = list(dict.fromkeys(explicit + manifests[:12] + docs[:3] + configs[:6] + sources[:args.source_files] + tests[:2]))
    budget = 100_000
    for path in selected:
        if budget <= 0:
            warnings.append('Excerpt character budget reached; remaining selected files omitted.')
            break
        try:
            excerpt = read_excerpt(path, 160 if path in manifests else 100)
            if len(excerpt) > budget:
                excerpt = excerpt[:budget] + '\n[Report character budget reached.]'
            budget -= len(excerpt)
            longest = max((len(m[0]) for m in re.finditer(r'`+', excerpt)), default=0)
            fence = '`' * max(3, longest + 1)
            lines.extend([f'### {relatives[path].as_posix()}', f'{fence}text\n{excerpt}\n{fence}'])
        except OSError as error:
            warnings.append(f'{relatives[path]}: {error}')
    lines.extend(['## Limitations and next review',
                  'This is an initial overview, not a dependency graph or proof that code is unused. '
                  'The reviewer should identify the architecture and entry points, establish build/test '
                  'coverage, and request exact missing files before proposing deletions. ',
                  'Redaction is best-effort. Review this report for credentials, proprietary code, and '
                  'personal data before sharing it. Nothing was uploaded by this script.',
                  '## Collection warnings'])
    lines.extend(f'- {warning}' for warning in warnings)
    if not warnings:
        lines.append('None.')
    parent = root / '.project-intake'
    if parent.is_symlink():
        parser.error('Refusing to write through a symlink at .project-intake.')
    parent.mkdir(exist_ok=True)
    out = parent / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    out.mkdir()
    report = out / 'PROJECT_CONTEXT.md'
    with report.open('x', encoding='utf-8') as handle:
        handle.write('\n\n'.join(lines) + '\n')
    print(f'Created: {report}')
    print('Review the report, fill in Owner context, then share PROJECT_CONTEXT.md in this chat.')
    print('Original files unchanged. Nothing uploaded. No project code executed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

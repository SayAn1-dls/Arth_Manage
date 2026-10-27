import { AppError } from '../../http/errors.js';

export function githubRepo(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw AppError.invalid('Enter a GitHub repository URL');
  }
  const parts = u.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'github.com' ||
    parts.length !== 2 ||
    parts.some((p) => !/^[-\w.]+$/.test(p))
  )
    throw AppError.invalid('Use https://github.com/owner/repository');
  return `${parts[0]}/${parts[1]}`;
}
async function github(path: string) {
  const res = await fetch(`https://api.github.com/repos/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Arthakram-Project-Review' },
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!res.ok)
    throw AppError.conflict(
      'github_unavailable',
      res.status === 403
        ? 'GitHub rate limit reached; retry later'
        : 'Repository is unavailable or private. Public repository access is required.',
    );
  return (await res.json()) as Record<string, unknown>;
}
export async function provenance(raw: string, startsAt: Date) {
  const repo = githubRepo(raw);
  const meta = await github(repo);
  const commits = (await github(
    `${repo}/commits?until=${encodeURIComponent(startsAt.toISOString())}&per_page=1`,
  )) as unknown as { html_url: string }[];
  return {
    repoUrl: `https://github.com/${repo}`,
    createdAt: String(meta.created_at),
    fork: meta.fork === true,
    parentUrl: (meta.parent as { html_url?: string } | undefined)?.html_url ?? null,
    beforeKickoff: commits.length > 0,
    earlierCommitUrl: commits[0]?.html_url ?? null,
    note: commits.length
      ? 'Commits dated before event kickoff were found. Review event rules and history; timestamps alone do not prove misconduct.'
      : 'No pre-kickoff commits were found in the default branch. This does not certify originality.',
  };
}

/** Bounded evidence comparison for an admin-selected reference; no blanket plagiarism verdict. */
export async function compareFile(repoUrl: string, referenceUrl: string, path: string) {
  const repo = githubRepo(repoUrl),
    reference = githubRepo(referenceUrl);
  if (!path || path.length > 300 || path.split('/').some((p) => p === '..') || path.startsWith('/'))
    throw AppError.invalid('Use a relative source file path');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  async function file(id: string) {
    const v = await github(`${id}/contents/${encoded}`);
    if (
      v.type !== 'file' ||
      v.encoding !== 'base64' ||
      typeof v.content !== 'string' ||
      Number(v.size) > 100000
    )
      throw AppError.invalid('Choose a text file under 100 KB present in both repositories');
    return Buffer.from(v.content, 'base64').toString('utf8');
  }
  const [left, right] = await Promise.all([file(repo), file(reference)]);
  return { kind: 'CODE_COMPARISON', repoUrl, referenceUrl, path, ...compareLines(left, right) };
}
export function compareLines(left: string, right: string) {
  const normal = (s: string) => s.replace(/\s+/g, '').trim();
  const source = right
    .split('\n')
    .map((text, i) => ({ text, line: i + 1, key: normal(text) }))
    .filter((r) => r.key.length >= 30);
  const reference = new Map(source.map((r) => [r.key, r]));
  const lines = left
    .split('\n')
    .map((text, i) => ({ text, line: i + 1, key: normal(text) }))
    .filter((r) => r.key.length >= 30);
  const matches = lines.flatMap((r) => {
    const other = reference.get(r.key);
    return other
      ? [
          {
            line: r.line,
            text: r.text.slice(0, 500),
            referenceLine: other.line,
            referenceText: other.text.slice(0, 500),
          },
        ]
      : [];
  });
  return {
    comparedLines: lines.length,
    matchedLines: matches.length,
    matches: matches.slice(0, 50),
    note: 'Matching substantial lines are evidence to inspect. Shared libraries, templates and permitted reuse may be legitimate.',
  };
}

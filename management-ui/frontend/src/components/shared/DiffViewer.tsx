import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseDiff(raw: string): DiffFile[] {
  if (!raw) return [];

  const files: DiffFile[] = [];
  const lines = raw.split('\n');
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file diff
    if (line.startsWith('diff --git')) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      current = {
        path: match ? match[2] : 'unknown',
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      currentHunk = null;
      continue;
    }

    // Skip meta lines (index, ---, +++)
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to') ||
      line.startsWith('Binary files')
    ) {
      continue;
    }

    // Hunk header
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      oldLine = match ? parseInt(match[1], 10) : 0;
      newLine = match ? parseInt(match[2], 10) : 0;
      currentHunk = {
        header: line,
        lines: [{
          type: 'hunk-header',
          content: line,
        }],
      };
      if (current) current.hunks.push(currentHunk);
      continue;
    }

    if (!current || !currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ });
      current.additions++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++ });
      current.deletions++;
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({ type: 'ctx', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }

  return files;
}

function FileHeader({ file, expanded, onToggle }: { file: DiffFile; expanded: boolean; onToggle: () => void }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-left hover:bg-muted transition-colors"
    >
      <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 font-mono text-xs font-medium truncate">{file.path}</span>
      <span className="flex items-center gap-1.5 text-xs">
        {file.additions > 0 && <span className="text-green-600 dark:text-green-400">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>}
      </span>
    </button>
  );
}

function DiffTable({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs leading-5">
      <tbody>
        {hunks.map((hunk, hi) =>
          hunk.lines.map((line, li) => {
            if (line.type === 'hunk-header') {
              return (
                <tr key={`${hi}-${li}`} className="bg-blue-50/60 dark:bg-blue-950/30">
                  <td className="w-10 select-none px-2 text-right text-muted-foreground/50" />
                  <td className="w-10 select-none px-2 text-right text-muted-foreground/50" />
                  <td className="px-3 py-0.5 text-blue-600 dark:text-blue-400 select-none">
                    {line.content}
                  </td>
                </tr>
              );
            }

            const bgClass =
              line.type === 'add'
                ? 'bg-green-50/70 dark:bg-green-950/20'
                : line.type === 'del'
                  ? 'bg-red-50/70 dark:bg-red-950/20'
                  : '';

            const lineNumClass =
              line.type === 'add'
                ? 'bg-green-100/60 dark:bg-green-900/20 text-green-700/60 dark:text-green-400/60'
                : line.type === 'del'
                  ? 'bg-red-100/60 dark:bg-red-900/20 text-red-700/60 dark:text-red-400/60'
                  : 'text-muted-foreground/40';

            const contentClass =
              line.type === 'add'
                ? 'text-green-800 dark:text-green-300'
                : line.type === 'del'
                  ? 'text-red-800 dark:text-red-300'
                  : '';

            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

            return (
              <tr key={`${hi}-${li}`} className={cn(bgClass, 'hover:brightness-95 dark:hover:brightness-110')}>
                <td className={cn('w-10 min-w-10 select-none border-r border-border/40 px-2 text-right', lineNumClass)}>
                  {line.oldLine ?? ''}
                </td>
                <td className={cn('w-10 min-w-10 select-none border-r border-border/40 px-2 text-right', lineNumClass)}>
                  {line.newLine ?? ''}
                </td>
                <td className={cn('whitespace-pre px-1', contentClass)}>
                  <span className={cn('inline-block w-4 select-none text-center', contentClass)}>{prefix}</span>
                  {line.content}
                </td>
              </tr>
            );
          }),
        )}
      </tbody>
    </table>
  );
}

export function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  if (!files.length) {
    return (
      <pre className="rounded-lg bg-muted p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre">
        {diff}
      </pre>
    );
  }

  const toggle = (idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{files.length} {files.length === 1 ? 'файл' : 'файлов'} изменено</span>
        {totalAdditions > 0 && <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>}
        {totalDeletions > 0 && <span className="text-red-600 dark:text-red-400">-{totalDeletions}</span>}
      </div>
      {files.map((file, i) => (
        <div key={i} className="rounded-lg border border-border overflow-hidden">
          <FileHeader file={file} expanded={!collapsed.has(i)} onToggle={() => toggle(i)} />
          {!collapsed.has(i) && (
            <div className="overflow-x-auto">
              <DiffTable hunks={file.hunks} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

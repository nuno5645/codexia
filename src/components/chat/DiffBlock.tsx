import { useMemo } from 'react';

interface FileDiff {
  header: string;
  hunks: string[];
  add: number;
  del: number;
}

function parseUnifiedDiff(raw: string): FileDiff[] {
  const txt = raw.trim().replace(/^```diff\n?/m, '').replace(/\n?```$/m, '');
  const lines = txt.split(/\r?\n/);
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      current = { header: line, hunks: [], add: 0, del: 0 };
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) current.add++;
      if (line.startsWith('-') && !line.startsWith('---')) current.del++;
      current.hunks.push(line);
    }
  }
  if (current) files.push(current);
  return files;
}

export function DiffBlock({ content }: { content: string }) {
  const files = useMemo(() => parseUnifiedDiff(content), [content]);

  if (!files.length) {
    return (
      <pre className="bg-slate-50 border border-slate-200 rounded p-3 text-xs overflow-auto whitespace-pre-wrap">
        {content}
      </pre>
    );
  }

  return (
    <div className="space-y-2">
      {files.map((f, idx) => (
        <details key={idx} className="border border-slate-200 rounded">
          <summary className="cursor-pointer select-none flex items-center justify-between gap-2 px-3 py-2 bg-slate-50">
            <span className="font-mono text-sm text-slate-800 truncate">{f.header.replace('diff --git ', '')}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs rounded px-1.5 py-0.5 bg-green-100 text-green-700">+{f.add}</span>
              <span className="text-xs rounded px-1.5 py-0.5 bg-rose-100 text-rose-700">-{f.del}</span>
              <button
                className="text-xs text-slate-600 hover:text-slate-900 border border-slate-300 rounded px-2 py-0.5"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const text = [f.header, ...f.hunks].join('\n');
                  navigator.clipboard?.writeText(text).catch(() => {});
                }}
              >
                Copy diff
              </button>
            </span>
          </summary>
          <div className="p-0">
            <div className="text-[12px] font-mono overflow-auto">
              {f.hunks.map((raw, i) => {
                let cls = 'px-3 py-0.5';
                if (raw.startsWith('+++ ') || raw.startsWith('--- ')) cls += ' bg-slate-100 text-slate-800';
                else if (raw.startsWith('@@')) cls += ' bg-slate-200 text-slate-900';
                else if (raw.startsWith('+')) cls += ' bg-green-50 text-green-800';
                else if (raw.startsWith('-')) cls += ' bg-rose-50 text-rose-800';
                else cls += ' text-slate-700';
                return (
                  <div key={i} className={cls}>
                    {raw}
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}


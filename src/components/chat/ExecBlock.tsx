import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ExecBlockProps {
  content: string;
}

function parseExecContent(content: string) {
  const lines = content.split(/\r?\n/);
  let cwd: string | undefined;
  let cmdLine: string | undefined;
  let exitCode: number | undefined;
  let startIdx = 0;

  if (lines[0]?.startsWith('cwd: ')) {
    cwd = lines[0].slice(5);
    startIdx = 1;
  }
  if (lines[startIdx]?.startsWith('$ ')) {
    cmdLine = lines[startIdx].slice(2);
    startIdx += 1;
  }
  // Last non-empty line may be exit code
  for (let i = lines.length - 1; i >= startIdx; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    const m = l.match(/^exit\s+(-?\d+)/);
    if (m) {
      exitCode = parseInt(m[1], 10);
      lines.splice(i, 1); // remove exit line from output
    }
    break;
  }
  const output = lines.slice(startIdx).join('\n');
  return { cwd, cmdLine, output, exitCode };
}

function isProbablyReadOnly(cmdLine?: string) {
  if (!cmdLine) return false;
  const cmd = cmdLine.trim();
  const readPrefixes = [
    'cat ', 'bat ', 'less', 'more', 'head ', 'tail ', 'ls', 'tree', 'pwd',
    'rg ', 'grep ', 'fd ', 'find ', 'stat ', 'wc ', 'echo ', 'printf ',
    'git status', 'git diff', 'git log', 'git show', 'git fetch', 'git pull',
  ];
  return readPrefixes.some(p => cmd.startsWith(p));
}

export function ExecBlock({ content }: ExecBlockProps) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseExecContent(content), [content]);
  const readOnly = isProbablyReadOnly(parsed.cmdLine);
  const statusColor = parsed.exitCode === undefined
    ? 'text-amber-600'
    : parsed.exitCode === 0
      ? 'text-green-600'
      : 'text-red-600';

  return (
    <div className="rounded-md border border-slate-300 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className={`text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-100`}>
          {readOnly ? 'read' : 'exec'}
        </span>
        {parsed.cmdLine && (
          <code className="text-sm font-mono text-slate-900 truncate">$ {parsed.cmdLine}</code>
        )}
        <div className="ml-auto flex items-center gap-2">
          {parsed.cwd && (
            <span className="text-xs text-slate-500 font-mono">cwd: {parsed.cwd}</span>
          )}
          <span className={`text-xs ${statusColor}`}>
            {parsed.exitCode === undefined ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                running…
              </span>
            ) : (
              `exit ${parsed.exitCode}`
            )}
          </span>
          <button
            type="button"
            className="ml-1 text-slate-600 hover:text-slate-900"
            onClick={() => setOpen(!open)}
            aria-label="Toggle output"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && (
        <pre className="m-0 p-3 bg-slate-900 text-slate-100 text-sm overflow-auto whitespace-pre-wrap">
{parsed.output || '(no output)'}
        </pre>
      )}
    </div>
  );
}


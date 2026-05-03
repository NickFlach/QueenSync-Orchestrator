import { useQuery } from "@tanstack/react-query";
import { api, asArray } from "@/lib/api";

interface MemoryItem {
  id: string;
  kind?: string;
  type?: string;
  tag?: string;
  status?: string;
  summary?: string;
  content?: string;
  text?: string;
  createdAt?: string;
}

export function MemoryMonitor() {
  const q = useQuery({
    queryKey: ["memory"],
    queryFn: () => api<unknown>("/memory?limit=20"),
    refetchInterval: 5000,
  });
  const items = asArray<MemoryItem>(q.data, "memory");

  return (
    <div className="absolute inset-0 p-2 qs-font-mono text-[10px] qs-scrollbar overflow-y-auto flex flex-col space-y-1.5">
      {q.isLoading && <div className="text-indigo-500">› reading memory bus…</div>}
      {q.isError && <div className="text-red-400">› memory layer offline</div>}
      {!q.isLoading && items.length === 0 && (
        <div className="text-indigo-500">› no memory events</div>
      )}
      {items.slice(0, 16).map((m) => (
        <div key={m.id} className="border-l-2 border-violet-700/50 pl-2">
          <div className="flex justify-between text-[9px]">
            <span className="text-violet-400">
              {m.kind ?? m.type ?? m.tag ?? "mem"}
            </span>
            {m.status && <span className="text-indigo-500">{m.status}</span>}
          </div>
          <div className="text-indigo-200 truncate">
            {m.summary ?? m.content ?? m.text ?? m.id}
          </div>
        </div>
      ))}
    </div>
  );
}

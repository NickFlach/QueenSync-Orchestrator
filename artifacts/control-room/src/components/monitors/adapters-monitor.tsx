import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Health {
  ok?: boolean;
  status?: string;
  lastSeen?: string;
  lastSeenAt?: string;
}

function Row({ label, q }: { label: string; q: { data?: Health; isError: boolean; isLoading: boolean } }) {
  const ok = q.data?.ok;
  const tone = q.isError
    ? "text-red-500"
    : ok === undefined
      ? "text-indigo-400"
      : ok
        ? "text-emerald-500"
        : "text-red-500";
  const text = q.isError
    ? "OFFLINE"
    : q.isLoading
      ? "…"
      : ok === undefined
        ? "UNKNOWN"
        : ok
          ? "OK"
          : "DOWN";
  return (
    <div className="flex justify-between items-center border-b border-indigo-900/30 pb-1">
      <span className="text-indigo-300">{label}</span>
      <span className={tone}>{text}</span>
    </div>
  );
}

export function AdaptersMonitor() {
  const radio = useQuery({
    queryKey: ["adapters-radio"],
    queryFn: () => api<Health>("/adapters/radio/health"),
    refetchInterval: 5000,
  });
  const obs = useQuery({
    queryKey: ["adapters-obs"],
    queryFn: () => api<Health>("/adapters/observatory/health"),
    refetchInterval: 5000,
  });
  return (
    <div className="absolute inset-0 p-2 qs-font-mono text-[10px] flex flex-col space-y-1.5">
      <Row label="radio" q={radio} />
      <Row label="observatory" q={obs} />
    </div>
  );
}

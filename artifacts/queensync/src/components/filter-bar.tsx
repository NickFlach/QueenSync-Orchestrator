import { useCallback, useMemo } from "react";
import { useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";

export type FilterFieldOption = { value: string; label: string };

export type FilterField =
  | {
      kind: "select";
      key: string;
      label: string;
      placeholder?: string;
      options: FilterFieldOption[];
    }
  | {
      kind: "text";
      key: string;
      label: string;
      placeholder?: string;
    };

const ALL_VALUE = "__all__";

function getCurrentParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function writeParams(next: URLSearchParams) {
  const search = next.toString();
  const url =
    window.location.pathname + (search ? `?${search}` : "") + window.location.hash;
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useFilterState(fields: FilterField[]) {
  const search = useSearch();
  const values = useMemo(() => {
    const params = new URLSearchParams(search);
    const out: Record<string, string> = {};
    for (const f of fields) {
      out[f.key] = params.get(f.key) ?? "";
    }
    return out;
  }, [search, fields]);

  const setValue = useCallback((key: string, value: string) => {
    const params = getCurrentParams();
    if (!value) params.delete(key);
    else params.set(key, value);
    writeParams(params);
  }, []);

  const clearAll = useCallback(() => {
    const params = getCurrentParams();
    for (const f of fields) params.delete(f.key);
    writeParams(params);
  }, [fields]);

  const hasActive = fields.some((f) => Boolean(values[f.key]));

  return { values, setValue, clearAll, hasActive };
}

export function FilterBar({
  fields,
  values,
  setValue,
  clearAll,
  hasActive,
  testIdPrefix = "filter",
  resultCount,
}: {
  fields: FilterField[];
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  clearAll: () => void;
  hasActive: boolean;
  testIdPrefix?: string;
  resultCount?: number;
}) {
  return (
    <div
      className="flex flex-wrap items-end gap-3 bg-card border border-border/50 rounded-md p-3"
      data-testid={`${testIdPrefix}-bar`}
    >
      {fields.map((f) => {
        if (f.kind === "select") {
          const v = values[f.key] || "";
          return (
            <div key={f.key} className="flex flex-col gap-1 min-w-[140px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {f.label}
              </Label>
              <Select
                value={v || ALL_VALUE}
                onValueChange={(next) =>
                  setValue(f.key, next === ALL_VALUE ? "" : next)
                }
              >
                <SelectTrigger
                  className="h-8 text-xs"
                  data-testid={`${testIdPrefix}-select-${f.key}`}
                >
                  <SelectValue placeholder={f.placeholder ?? "All"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>
                    {f.placeholder ?? "All"}
                  </SelectItem>
                  {f.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }
        return (
          <div key={f.key} className="flex flex-col gap-1 min-w-[200px] flex-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {f.label}
            </Label>
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={values[f.key] || ""}
                onChange={(e) => setValue(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="h-8 text-xs pl-7"
                data-testid={`${testIdPrefix}-search-${f.key}`}
              />
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2 ml-auto">
        {typeof resultCount === "number" && (
          <span
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
            data-testid={`${testIdPrefix}-count`}
          >
            {resultCount} match{resultCount === 1 ? "" : "es"}
          </span>
        )}
        {hasActive && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={clearAll}
            data-testid={`${testIdPrefix}-clear`}
          >
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.trim()) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

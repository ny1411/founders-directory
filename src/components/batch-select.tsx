"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCallback, useMemo } from "react";
import { parseSelections, updateDirectoryParams } from "@/lib/directory-filters";

export function BatchSelect({ batches }: { batches: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentBatches = parseSelections(searchParams.getAll("batch"), batches);

  const items = useMemo(() => [
    ...batches.map(batch => ({ value: batch, label: batch })),
  ], [batches]);

  const handleValueChange = useCallback(
    (values: string[]) => {
      const params = updateDirectoryParams(new URLSearchParams(searchParams.toString()), { batch: values });
      router.push(`/?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col gap-2">
    <Select multiple items={items} value={currentBatches} onValueChange={handleValueChange}>
      <SelectTrigger className="w-full min-w-0" aria-label="Batch">
        <SelectValue className="min-w-0 truncate" placeholder="All batches">
          {(values: string[]) => (
            <span className="block truncate" title={values.length ? values.join(", ") : "All batches"}>
              {values.length ? values.join(", ") : "All batches"}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        <SelectGroup>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
    {currentBatches.length > 0 && (
      <button type="button" onClick={() => handleValueChange([])} className="text-xs text-left underline text-secondary-foreground">
        Clear batches
      </button>
    )}
    </div>
  );
}

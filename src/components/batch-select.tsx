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
import { parseBatch, updateBatchParams } from "@/lib/batch-filter";

export function BatchSelect({ batches }: { batches: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentBatch = parseBatch(searchParams.get("batch"), batches);

  const items = useMemo(() => [
    { value: "all", label: "All batches" },
    ...batches.map(batch => ({ value: batch, label: batch })),
  ], [batches]);

  const handleValueChange = useCallback(
    (value: string | null) => {
      const params = updateBatchParams(new URLSearchParams(searchParams.toString()), value);
      router.push(`/?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <Select items={items} value={currentBatch} onValueChange={handleValueChange}>
      <SelectTrigger className="w-full" aria-label="Batch">
        <SelectValue placeholder="Select batch" />
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
  );
}

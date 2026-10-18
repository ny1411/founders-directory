"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemo } from "react";

export function BatchSelect({ batches, selected: currentBatches, onChange }: {
  batches: string[]; selected: string[]; onChange: (values: string[]) => void
}) {

  const items = useMemo(() => [
    ...batches.map(batch => ({ value: batch, label: batch })),
  ], [batches]);


  return (
    <div className="flex flex-col gap-2">
    <Select multiple items={items} value={currentBatches} onValueChange={onChange}>
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
      <button type="button" onClick={() => onChange([])} className="text-xs text-left underline text-secondary-foreground">
        Clear batches
      </button>
    )}
    </div>
  );
}

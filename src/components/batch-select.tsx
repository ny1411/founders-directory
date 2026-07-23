"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCallback, useMemo } from "react";

export function BatchSelect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentBatch = searchParams.get("batch") || "all";

  const batches = useMemo(() => {
    const seasons = ["Fall", "Summer", "Spring", "Winter"]; // Ordering within the same year? YC technically goes Winter -> Summer. So Winter is earliest in year. If we go descending: Fall, Summer, Spring, Winter.
    const years = Array.from({ length: 2027 - 2005 + 1 }, (_, i) => 2027 - i);
    const result: string[] = [];
    years.forEach((year) => {
      seasons.forEach((season) => {
        result.push(`${season} ${year}`);
      });
    });
    return result;
  }, []);

  const handleValueChange = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all" || value === null) {
        params.delete("batch");
      } else {
        params.set("batch", value);
      }
      params.delete("page"); // reset pagination
      params.delete("cursor"); // reset pagination cursor
      router.push(`/?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <Select value={currentBatch} onValueChange={handleValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select batch" />
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        <SelectItem value="all">All batches</SelectItem>
        {batches.map((batch) => (
          <SelectItem key={batch} value={batch}>
            {batch}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

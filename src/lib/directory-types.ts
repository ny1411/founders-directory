import type { Company } from "./types"

export type DirectoryCompany = Pick<Company,
  "id" | "slug" | "name" | "oneLiner" | "description" | "logoUrl" |
  "vcBacker" | "industry" | "employees" | "location" | "tags" | "batch"
>

export interface DirectoryPageData {
  companies: DirectoryCompany[]
  totalCount: number
  totalPages: number
  page: number
}

export interface DirectoryInitialData extends DirectoryPageData {
  batches: string[]
  vcs: string[]
}

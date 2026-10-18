import { Directory } from "@/components/directory"
import { getDefaultDirectory } from "@/lib/directory-cache"
import { getDirectoryOptions } from "@/lib/directory-options"

export const revalidate = 3600

/** No request/searchParams dependencies: a complete default listing is ISR HTML. */
export default async function Home() {
  const [initialPage, options] = await Promise.all([getDefaultDirectory(), getDirectoryOptions()])
  return <Directory initialPage={initialPage} {...options} />
}

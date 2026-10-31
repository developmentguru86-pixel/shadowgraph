import type { PagePrefetchFn } from "@runtime/prefetch";
import { homepageBootstrap } from "../helpers/homepageBootstrap";

export const prefetch: PagePrefetchFn = async ({ qc }) => {
  await qc.prefetchQuery({
    queryKey: ["homepage-bootstrap"],
    queryFn: homepageBootstrap,
  });

  return { maxAge: 120 };
};

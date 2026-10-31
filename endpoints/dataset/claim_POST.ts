import { z } from "zod";
import { dependencyDataset } from "../../helpers/dependencyDataset";
import { schema } from "../dataset_claim_POST.schema";

// Exchanges a paid Checkout session for the subscriber API key. The key is shown exactly once.
export async function handle(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return Response.json({ status: "not_found" }, { status: 400 });
  }
  const result = await dependencyDataset.claim(input.sessionId);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
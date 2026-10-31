import type {eventExecution} from "../helpers/eventExecution";
export type OutputType=Awaited<ReturnType<typeof eventExecution.summary>>;
export async function getEventExecution():Promise<OutputType>{const r=await fetch("/_api/event_execution",{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error("Event research temporarily unavailable");return r.json();}
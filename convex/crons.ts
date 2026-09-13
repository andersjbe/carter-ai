import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "recheck open product queries",
  { hours: 6 },
  internal.digests.recheckOpenQueries,
  {},
);

export default crons;

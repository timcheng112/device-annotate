import * as z from "zod";
import Ajv2020 from "ajv/dist/2020.js";

// Focused M1 contract probe, not the production spec validator.
const schema = z.strictObject({
  criteria: z.array(z.strictObject({
    criterion: z.string(),
    steps: z.record(z.string(), z.strictObject({})),
  })),
}).superRefine((input, context) => {
  const seen = new Set();
  for (const [index, criterion] of input.criteria.entries()) {
    for (const name of Object.keys(criterion.steps)) {
      if (seen.has(name)) {
        context.addIssue({ code: "custom", path: ["criteria", index, "steps", name], message: "Step names must be unique across the file." });
      }
      seen.add(name);
    }
  }
});

const input = { criteria: [
  { criterion: "First criterion", steps: { after: {} } },
  { criterion: "Second criterion", steps: { after: {} } },
] };
const runtime = schema.safeParse(input);
const exported = new Ajv2020({ strict: true }).compile(z.toJSONSchema(schema, { io: "input" }));
console.log(JSON.stringify({
  experiment: "Duplicate step names across criterion groups",
  zodAccepts: runtime.success,
  generatedJSONSchemaAccepts: exported(input),
  runtimeIssues: runtime.success ? [] : runtime.error.issues,
}, null, 2));

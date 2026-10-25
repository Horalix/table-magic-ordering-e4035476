# Architecture rules

- Keep pending promotion fields optional in the shared application menu type, not generated database types, so the frontend tolerates the pre-migration schema.
- Pass printer binary responses as owned ArrayBuffers so both browser and edge-runtime response types accept the same payload.
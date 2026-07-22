-- Add the "Start" paid tier to the Plan enum. Appended last (ADD VALUE appends),
-- matching the enum declaration order in schema.prisma. Idempotent so a re-run
-- (or an environment already patched by hand) is safe.
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'START';

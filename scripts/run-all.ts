import "dotenv/config";

process.env.DATABASE_URL = process.env.DATABASE_URL?.includes("railway.internal")
  ? process.env.DATABASE_URL.replace("postgres.railway.internal:5432", "interchange.proxy.rlwy.net:22053")
  : process.env.DATABASE_URL;

async function main() {
  const { runInvestigateLineTask } = await import("../src/server/services/investigation");
  const { getDb } = await import("../src/server/db/client");
  const { footageAssets, footageQuotes, scriptLines } = await import("../src/server/db/schema");
  const { eq, sql } = await import("drizzle-orm");

  const db = getDb();
  const projectId = "df52a584-e638-4932-a667-d723b728da7b";

  const lines = await db.select().from(scriptLines)
    .where(eq(scriptLines.projectId, projectId))
    .orderBy(scriptLines.lineIndex);

  for (const line of lines) {
    const start = Date.now();
    process.stdout.write(`${line.lineKey} [${line.lineType}]... `);
    try {
      await runInvestigateLineTask({ projectId, scriptLineId: line.id });
      const [v] = await db.select({ c: sql<number>`count(*)::int` }).from(footageAssets).where(sql`${footageAssets.scriptLineId} = ${line.id} AND ${footageAssets.filtered} = false`);
      const [q] = await db.select({ c: sql<number>`count(*)::int` }).from(footageQuotes).where(eq(footageQuotes.scriptLineId, line.id));
      console.log(`${v.c} visible, ${q.c} quotes (${((Date.now()-start)/1000).toFixed(0)}s)`);
    } catch (e) {
      console.log(`FAILED: ${e instanceof Error ? e.message.slice(0,60) : e}`);
    }
  }

  const [t] = await db.select({ c: sql<number>`count(*)::int` }).from(footageAssets).where(eq(footageAssets.filtered, false));
  const [q] = await db.select({ c: sql<number>`count(*)::int` }).from(footageQuotes);
  console.log(`\nDONE: ${t.c} visible assets, ${q.c} quotes`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

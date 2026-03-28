const { Client } = require("pg");

const missingRunIds = process.argv.slice(2);

if (missingRunIds.length === 0) {
  console.error("Usage: SOURCE_DB=... TARGET_DB=... node scripts/sync-script-agent-runs.cjs <run-id> [...]");
  process.exit(1);
}

if (!process.env.SOURCE_DB || !process.env.TARGET_DB) {
  console.error("Both SOURCE_DB and TARGET_DB must be set.");
  process.exit(1);
}

function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

async function getColumns(client, table) {
  const { rows } = await client.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position`,
    [table]
  );

  return rows.map((row) => ({
    columnName: row.column_name,
    dataType: row.data_type,
  }));
}

async function syncTable({ source, target, table, whereClause, params }) {
  const columns = await getColumns(source, table);
  const columnNames = columns.map((column) => column.columnName);
  const columnList = columnNames.map(quoteIdent).join(", ");
  const selectSql = `select ${columnList} from public.${quoteIdent(table)} where ${whereClause}`;
  const { rows } = await source.query(selectSql, params);

  if (rows.length === 0) {
    console.log(`${table}: 0 rows`);
    return;
  }

  const insertSql = `insert into public.${quoteIdent(table)} (${columnList})
    values (${columnNames.map((_, index) => `$${index + 1}`).join(", ")})
    on conflict (${quoteIdent("id")}) do update set
    ${columnNames
      .filter((column) => column !== "id")
      .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)
      .join(", ")}`;

  for (const row of rows) {
    const values = columns.map(({ columnName, dataType }) => {
      const value = row[columnName];
      if (value === null || value === undefined) {
        return value ?? null;
      }

      if (dataType === "json" || dataType === "jsonb") {
        return JSON.stringify(value);
      }

      return value;
    });

    await target.query(insertSql, values);
  }

  console.log(`${table}: ${rows.length} rows`);
}

async function main() {
  const source = new Client({ connectionString: process.env.SOURCE_DB });
  const target = new Client({ connectionString: process.env.TARGET_DB });

  await source.connect();
  await target.connect();

  try {
    await target.query("begin");

    await syncTable({
      source,
      target,
      table: "script_agent_runs",
      whereClause: "id = any($1::uuid[])",
      params: [missingRunIds],
    });

    for (const table of [
      "script_agent_stages",
      "script_agent_sources",
      "script_agent_quotes",
      "script_agent_claims",
    ]) {
      await syncTable({
        source,
        target,
        table,
        whereClause: "run_id = any($1::uuid[])",
        params: [missingRunIds],
      });
    }

    await target.query("commit");
  } catch (error) {
    await target.query("rollback");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main();

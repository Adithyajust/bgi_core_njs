import { NextResponse } from "next/server";
import { connectDB } from "../../../../lib/mssql";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = await connectDB();
    const result = await pool.request().query(`
      SELECT
        CASE
          WHEN OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NOT NULL
            AND COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') IS NOT NULL
            AND OBJECT_ID(N'dbo.TR_replenish_work_orders_summary', N'TR') IS NOT NULL
            AND COL_LENGTH(N'dbo.replenish_work_order_points', N'activity_type') IS NOT NULL
            AND COL_LENGTH(N'dbo.replenish_work_order_points', N'pagu') IS NOT NULL
            AND COL_LENGTH(N'dbo.replenish_work_order_points', N'denomination_value') IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM sys.columns
              WHERE object_id = OBJECT_ID(N'dbo.replenish_work_order_points')
                AND name = N'required_cassettes'
            )
          THEN CONVERT(BIT, 1)
          ELSE CONVERT(BIT, 0)
        END AS schema_ready;
    `);

    const schemaReady = Boolean(result.recordset[0]?.schema_ready);
    if (!schemaReady) {
      return NextResponse.json(
        {
          status: "not_ready",
          database: "available",
          schema: "pending_migration",
          migration_required: true,
          timestamp: new Date().toISOString(),
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "10",
          },
        },
      );
    }

    return NextResponse.json(
      {
        status: "ready",
        database: "available",
        schema: "ready",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Readiness check failed", {
      name: error?.name,
      code: error?.code,
    });

    return NextResponse.json(
      {
        status: "not_ready",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "10",
        },
      },
    );
  }
}

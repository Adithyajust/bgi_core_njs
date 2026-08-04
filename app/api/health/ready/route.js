import { NextResponse } from "next/server";
import { connectDB } from "../../../../lib/mssql";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = await connectDB();
    await pool.request().query("SELECT CAST(1 AS INT) AS ready;");

    return NextResponse.json(
      {
        status: "ready",
        database: "available",
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

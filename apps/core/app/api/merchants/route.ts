import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  try {
    const db = await getDb();
    const merchants = await db.collection("merchants").find({}).toArray();
    return NextResponse.json(merchants);
  } catch (err) {
    // Returning [] made a database failure indistinguishable from "no rows".
    return NextResponse.json(
      { error: (err as Error).message ?? "Query failed" },
      { status: 500 }
    );
  }
}

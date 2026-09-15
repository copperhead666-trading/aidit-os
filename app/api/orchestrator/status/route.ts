import { NextResponse } from 'next/server';
import { orchestratorSnapshot } from '@/lib/connectors/conductor';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await orchestratorSnapshot();
  return NextResponse.json(snapshot);
}

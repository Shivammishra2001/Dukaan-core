import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return proxyToStrapi(request, `/api/shifts/${params.id}/close`, { method: 'POST' });
}

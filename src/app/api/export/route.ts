import { NextResponse, type NextRequest } from 'next/server';
import { VerifiedActorSchema } from '../../../domain/schemas';
import { getServerContainer } from '../../../server/container';

export async function GET(req: NextRequest) {
  try {
    const uid = req.headers.get('x-low-uid') ?? req.nextUrl.searchParams.get('uid') ?? 'berezovsky360';
    const orgId = req.headers.get('x-low-org-id') ?? req.nextUrl.searchParams.get('orgId') ?? 'org-berezovsky';
    const role = (req.headers.get('x-low-role') ?? req.nextUrl.searchParams.get('role') ?? 'owner') as
      | 'owner'
      | 'admin'
      | 'member';

    const actor = VerifiedActorSchema.parse({ uid, orgId, role });
    const container = getServerContainer();
    await container.ensureSeeded();

    const exported = await container.exportService.exportOrganizationZip(actor);

    if (req.nextUrl.searchParams.get('format') === 'json') {
      return NextResponse.json({
        orgId: actor.orgId,
        zipSizeBytes: exported.zipBuffer.byteLength,
        files: exported.files,
      });
    }

    return new NextResponse(new Uint8Array(exported.zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${actor.orgId}-low-export.zip"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}

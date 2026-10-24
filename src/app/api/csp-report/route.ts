import { receiveCspReport } from '@/lib/csp-report';

export const POST = (request: Request) => receiveCspReport(request);

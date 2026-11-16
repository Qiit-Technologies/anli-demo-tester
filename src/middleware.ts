import { NextRequest, NextResponse } from "next/server";

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    pathname === "/api/webhook" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const username = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!username || !password) {
    return new NextResponse("Dashboard credentials are not configured.", {
      status: 503,
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, encodedCredentials] = authorization.split(" ", 2);
  if (scheme !== "Basic" || !encodedCredentials) {
    return new NextResponse("Dashboard authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Anli webhook tester"' },
    });
  }

  let credentials: string;
  try {
    credentials = atob(encodedCredentials);
  } catch {
    credentials = "";
  }

  if (!constantTimeEqual(credentials, `${username}:${password}`)) {
    return new NextResponse("Invalid dashboard credentials.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Anli webhook tester"' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

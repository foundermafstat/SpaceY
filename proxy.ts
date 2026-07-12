import { NextResponse, type NextRequest } from "next/server";

export function proxy(_request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/dev/:path*",
};

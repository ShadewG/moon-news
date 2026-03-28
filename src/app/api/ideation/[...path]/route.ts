import { NextResponse } from "next/server";

import { getEnv } from "@/server/config/env";

export const dynamic = "force-dynamic";

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const upstream = path.join("/");
  const backendUrl = getEnv().IDEATION_BACKEND_URL;
  const url = new URL(`/${upstream}`, backendUrl);

  // Forward query params
  const { searchParams } = new URL(request.url);
  searchParams.forEach((value, key) => url.searchParams.set(key, value));

  const headers: Record<string, string> = {};
  const contentType = request.headers.get("content-type");

  // Don't set content-type for FormData — let fetch handle boundary
  if (contentType && !contentType.includes("multipart/form-data")) {
    headers["content-type"] = contentType;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min

  try {
    const init: RequestInit = {
      method: request.method,
      headers,
      signal: controller.signal,
      redirect: "manual", // capture redirects instead of following
    };

    // Forward body for non-GET requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (contentType?.includes("multipart/form-data")) {
        // Stream FormData body directly
        init.body = request.body;
        // @ts-expect-error -- needed for Node fetch to not buffer the stream
        init.duplex = "half";
      } else {
        init.body = await request.text();
      }
    }

    const res = await fetch(url.toString(), init);
    clearTimeout(timeout);

    // Handle redirects (e.g., OAuth authorize)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        return NextResponse.redirect(location, res.status);
      }
    }

    // Handle non-JSON responses (FileResponse, HTML)
    const resContentType = res.headers.get("content-type") ?? "";
    if (!resContentType.includes("application/json")) {
      const body = await res.arrayBuffer();
      return new NextResponse(body, {
        status: res.status,
        headers: {
          "content-type": resContentType,
          ...(res.headers.get("content-disposition")
            ? { "content-disposition": res.headers.get("content-disposition")! }
            : {}),
        },
      });
    }

    // Standard JSON response
    if (res.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Proxy error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const PUT = proxy;

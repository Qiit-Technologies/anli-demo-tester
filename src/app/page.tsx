import { headers } from "next/headers";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const safeHost = /^[a-z\d.-]+(?::\d{1,5})?$/i.test(requestHost)
    ? requestHost
    : "localhost:3000";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProtocol === "https" ||
    (forwardedProtocol !== "http" && !safeHost.startsWith("localhost"))
      ? "https"
      : "http";

  return <Dashboard receiverUrl={`${protocol}://${safeHost}/api/webhook`} />;
}

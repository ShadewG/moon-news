import { getBoardBootstrapPayload } from "@/server/services/board";
import BoardClient from "./board-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research Board — Moon News Studio" };

export default async function BoardPage() {
  const data = await getBoardBootstrapPayload();
  return <BoardClient data={data as Parameters<typeof BoardClient>[0]["data"]} />;
}

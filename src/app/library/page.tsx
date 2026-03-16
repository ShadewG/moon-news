import { listLibraryClips } from "@/server/services/clip-library";
import LibraryClient from "./library-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clip Library — Moon News Studio" };

export default async function LibraryPage() {
  const initialData = await listLibraryClips();

  return <LibraryClient initialData={initialData} />;
}

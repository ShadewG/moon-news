import BoardLoader from "./board-loader";

export const metadata = { title: "Research Board — Moon News Studio" };

// Render shell instantly; BoardLoader fetches bootstrap data client-side
export default function BoardPage() {
  return <BoardLoader />;
}
